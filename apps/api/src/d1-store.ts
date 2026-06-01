import { ProposalStatus, ProposalType, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';
import type {
  CancelReasonRecord,
  DaoDetail,
  DaoSummary,
  EvidenceFileRecord,
  OffchainStore,
  ProposalDetail,
  TransactionLog,
} from './offchain';
import { normalizeAddress } from './offchain';

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatement;
};

export function createD1Store(db: D1DatabaseLike): OffchainStore {
  return {
    async listDaosByMember(memberAddress: string): Promise<DaoSummary[]> {
      const member = normalizeAddress(memberAddress);
      const { results = [] } = await db
        .prepare(
          `SELECT d.dao_id, d.contract_address, d.name, d.status, d.member_count, d.approval_rule, d.created_at
           FROM dao_cache d
           INNER JOIN dao_members_cache m ON m.dao_id = d.dao_id
           WHERE lower(m.wallet_address) = ? AND m.is_active = 1
           ORDER BY d.created_at DESC`,
        )
        .bind(member)
        .all<DaoRow>();

      return results.map(toDaoSummary);
    },

    async getDaoDetail(daoAddress: string): Promise<DaoDetail | null> {
      const dao = await getDaoRow(db, daoAddress);
      if (!dao) return null;

      const daoId = String(dao.dao_id);
      const [{ results: memberRows = [] }, { results: proposalRows = [] }] = await Promise.all([
        db
          .prepare(
            `SELECT wallet_address
             FROM dao_members_cache
             WHERE dao_id = ? AND is_active = 1
             ORDER BY joined_at ASC`,
          )
          .bind(daoId)
          .all<{ wallet_address: string }>(),
        db
          .prepare(
            `SELECT proposal_id, proposal_type, title, description, amount_wei, recipient, deadline,
                    approval_type, content_hash, created_at
             FROM proposal_details
             WHERE dao_id = ?
             ORDER BY proposal_id ASC`,
          )
          .bind(daoId)
          .all<ProposalRow>(),
      ]);

      const proposals = await Promise.all(
        proposalRows.map(async (row) =>
          toProposalDetail(dao, row, await getProposalProposer(db, daoId, String(row.proposal_id))),
        ),
      );

      return {
        ...toDaoSummary(dao),
        members: memberRows.map((row) => normalizeAddress(String(row.wallet_address))),
        proposals,
      };
    },

    async getProposalDetail(
      daoAddress: string,
      proposalId: string,
    ): Promise<ProposalDetail | null> {
      const dao = await getDaoRow(db, daoAddress);
      if (!dao) return null;

      const row = await db
        .prepare(
          `SELECT proposal_id, proposal_type, title, description, amount_wei, recipient, deadline,
                  approval_type, content_hash, created_at
           FROM proposal_details
           WHERE dao_id = ? AND proposal_id = ?`,
        )
        .bind(String(dao.dao_id), proposalId)
        .first<ProposalRow>();

      if (!row) return null;

      return {
        ...toProposalDetail(
          dao,
          row,
          await getProposalProposer(db, String(dao.dao_id), proposalId),
        ),
        status: await getCachedProposalStatus(db, String(dao.dao_id), proposalId),
      };
    },

    async saveProposalDetail(detail: ProposalDetail): Promise<void> {
      const dao = await getDaoRow(db, detail.daoAddress);
      const daoId = dao ? String(dao.dao_id) : normalizeAddress(detail.daoAddress);
      const id = proposalKey(daoId, detail.proposalId);

      await db
        .prepare(
          `INSERT INTO proposal_details (
             id, proposal_id, dao_id, proposal_type, title, description, amount_wei, recipient,
             deadline, approval_type, content_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(dao_id, proposal_id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             amount_wei = excluded.amount_wei,
             recipient = excluded.recipient,
             deadline = excluded.deadline,
             approval_type = excluded.approval_type,
             content_hash = excluded.content_hash`,
        )
        .bind(
          id,
          detail.proposalId,
          daoId,
          detail.proposalType,
          detail.title,
          detail.description,
          detail.amountWei,
          detail.recipient,
          detail.deadline,
          detail.approvalType,
          detail.contentHash,
          detail.createdAt,
        )
        .run();
    },

    async saveCancelReason(record: CancelReasonRecord): Promise<void> {
      const dao = await getDaoRow(db, record.daoAddress);
      const daoId = dao ? String(dao.dao_id) : normalizeAddress(record.daoAddress);
      const detailId = proposalKey(daoId, record.proposalId);

      await db
        .prepare(
          `INSERT INTO proposal_cancel_details (
             id, proposal_detail_id, proposal_id, dao_id, cancel_reason, cancel_reason_hash,
             canceled_by, canceled_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(dao_id, proposal_id) DO UPDATE SET
             cancel_reason = excluded.cancel_reason,
             cancel_reason_hash = excluded.cancel_reason_hash,
             canceled_by = excluded.canceled_by,
             canceled_at = excluded.canceled_at`,
        )
        .bind(
          `cancel:${detailId}`,
          detailId,
          record.proposalId,
          daoId,
          record.cancelReason,
          record.cancelReasonHash,
          normalizeAddress(record.canceledBy),
          record.canceledAt,
        )
        .run();
    },

    async listTransactionLogs(daoAddress: string): Promise<TransactionLog[]> {
      const dao = await getDaoRow(db, daoAddress);
      if (!dao) return [];

      const { results = [] } = await db
        .prepare(
          `SELECT tx_hash, log_index, dao_id, proposal_id, event_type, actor, amount_wei,
                  status, block_number, created_at
           FROM transaction_logs
           WHERE dao_id = ?
           ORDER BY block_number DESC, log_index DESC`,
        )
        .bind(String(dao.dao_id))
        .all<TransactionRow>();

      return results.map((row) => toTransactionLog(dao, row));
    },

    async listEvidenceFiles(daoAddress: string, proposalId: string): Promise<EvidenceFileRecord[]> {
      const dao = await getDaoRow(db, daoAddress);
      if (!dao) return [];

      const { results = [] } = await db
        .prepare(
          `SELECT evidence_id, dao_id, proposal_id, uploader, evidence_type, r2_object_key,
                  mime_type, file_size, description, content_hash, created_at
           FROM evidence_files
           WHERE dao_id = ? AND proposal_id = ?
           ORDER BY created_at ASC`,
        )
        .bind(String(dao.dao_id), proposalId)
        .all<EvidenceRow>();

      return results.map((row) => toEvidenceFile(dao, row));
    },

    async saveEvidenceFile(record: EvidenceFileRecord): Promise<void> {
      const dao = await getDaoRow(db, record.daoAddress);
      const daoId = dao ? String(dao.dao_id) : normalizeAddress(record.daoAddress);
      const detailId = proposalKey(daoId, record.proposalId);

      await db
        .prepare(
          `INSERT INTO evidence_files (
             evidence_id, dao_id, proposal_id, proposal_key, uploader, evidence_type,
             r2_object_key, mime_type, file_size, description, content_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.evidenceId,
          daoId,
          record.proposalId,
          detailId,
          normalizeAddress(record.uploader),
          record.evidenceType,
          record.r2ObjectKey,
          record.mimeType,
          record.fileSize,
          record.description,
          record.contentHash,
          record.createdAt,
        )
        .run();
    },
  };
}

type DaoRow = {
  dao_id: string;
  contract_address: string;
  name: string;
  status: number;
  member_count: number;
  approval_rule: number;
  created_at: string;
};

type ProposalRow = {
  proposal_id: number | string;
  proposal_type: number;
  title: string;
  description: string;
  amount_wei: string | null;
  recipient: string | null;
  deadline: number | string;
  approval_type: number;
  content_hash: string;
  created_at: string;
};

type TransactionRow = {
  tx_hash: string;
  log_index: number;
  proposal_id: number | string | null;
  event_type: string;
  actor: string | null;
  amount_wei: string | null;
  status: string;
  block_number: number | string;
  created_at: string;
};

type EvidenceRow = {
  evidence_id: string;
  proposal_id: number | string;
  uploader: string;
  evidence_type: string;
  r2_object_key: string;
  mime_type: string;
  file_size: number;
  description: string | null;
  content_hash: string;
  created_at: string;
};

async function getDaoRow(db: D1DatabaseLike, daoAddress: string): Promise<DaoRow | null> {
  return db
    .prepare(
      `SELECT dao_id, contract_address, name, status, member_count, approval_rule, created_at
       FROM dao_cache
       WHERE lower(contract_address) = ?`,
    )
    .bind(normalizeAddress(daoAddress))
    .first<DaoRow>();
}

async function getCachedProposalStatus(
  db: D1DatabaseLike,
  daoId: string,
  proposalId: string,
): Promise<ProposalStatus | undefined> {
  const row = await db
    .prepare(
      `SELECT event_type, status
       FROM transaction_logs
       WHERE dao_id = ? AND proposal_id = ?
       ORDER BY block_number DESC, log_index DESC
       LIMIT 1`,
    )
    .bind(daoId, proposalId)
    .first<{ event_type: string; status: string }>();

  if (!row) return undefined;
  if (row.event_type === 'ProposalExecuted' || row.event_type === 'TerminationExecuted') {
    return ProposalStatus.Executed;
  }
  if (row.event_type === 'ProposalExecutionFailed') return ProposalStatus.ExecutionFailed;
  if (row.event_type === 'ProposalCanceled') return ProposalStatus.Canceled;
  if (row.status === 'proposal:2') return ProposalStatus.Rejected;
  if (row.status === 'proposal:3') return ProposalStatus.Executable;

  return undefined;
}

function toDaoSummary(row: DaoRow): DaoSummary {
  return {
    daoAddress: normalizeAddress(row.contract_address),
    name: row.name,
    status: Number(row.status),
    memberCount: Number(row.member_count),
    approvalRule: Number(row.approval_rule),
    createdAt: row.created_at,
  };
}

async function getProposalProposer(
  db: D1DatabaseLike,
  daoId: string,
  proposalId: string,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT actor
       FROM transaction_logs
       WHERE dao_id = ? AND proposal_id = ? AND event_type = 'ProposalCreated'
       ORDER BY block_number ASC, log_index ASC
       LIMIT 1`,
    )
    .bind(daoId, proposalId)
    .first<{ actor: string | null }>();

  return row?.actor ? normalizeAddress(row.actor) : '0x0000000000000000000000000000000000000000';
}

function toProposalDetail(
  dao: DaoRow,
  row: ProposalRow,
  proposer = '0x0000000000000000000000000000000000000000',
): ProposalDetail {
  return {
    schemaVersion: 1,
    chainId: SEPOLIA_CHAIN_ID,
    daoAddress: normalizeAddress(dao.contract_address),
    proposalType: Number(row.proposal_type) as ProposalType,
    proposer,
    title: row.title,
    description: row.description,
    amountWei: row.amount_wei,
    recipient: row.recipient ? normalizeAddress(row.recipient) : null,
    deadline: Number(row.deadline),
    approvalType: Number(row.approval_type),
    proposalId: String(row.proposal_id),
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function toTransactionLog(dao: DaoRow, row: TransactionRow): TransactionLog {
  return {
    txHash: row.tx_hash,
    logIndex: Number(row.log_index),
    daoAddress: normalizeAddress(dao.contract_address),
    proposalId: row.proposal_id === null ? null : String(row.proposal_id),
    eventType: row.event_type,
    actor: row.actor,
    amountWei: row.amount_wei,
    status: row.status,
    blockNumber: String(row.block_number),
    createdAt: row.created_at,
  };
}

function toEvidenceFile(dao: DaoRow, row: EvidenceRow): EvidenceFileRecord {
  return {
    evidenceId: row.evidence_id,
    daoAddress: normalizeAddress(dao.contract_address),
    proposalId: String(row.proposal_id),
    uploader: normalizeAddress(row.uploader),
    evidenceType: row.evidence_type,
    r2ObjectKey: row.r2_object_key,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    description: row.description,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function proposalKey(daoId: string, proposalId: string) {
  return `${daoId}:${proposalId}`;
}

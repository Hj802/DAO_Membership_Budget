import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  D1_SCHEMA_PATH,
  EVENT_TYPES,
  MAX_SYNC_BLOCK_RANGE,
  type DaoCacheRecord,
  type DaoMemberCacheRecord,
  type EvidenceFileRecord,
  type ProposalCancelDetailRecord,
  type ProposalDetailRecord,
  type SyncRepository,
  type SyncStateRecord,
  type TransactionLogRecord,
  buildEvidenceObjectKey,
  databasePackageName,
  syncEventBatch,
} from './index';

class InMemorySyncRepository implements SyncRepository {
  daos = new Map<string, DaoCacheRecord>();
  members = new Map<string, DaoMemberCacheRecord>();
  proposals = new Map<string, ProposalDetailRecord>();
  cancellations = new Map<string, ProposalCancelDetailRecord>();
  evidence = new Map<string, EvidenceFileRecord>();
  transactions = new Map<string, TransactionLogRecord>();
  syncStates = new Map<string, SyncStateRecord>();

  async hasTransactionLog(txHash: string, logIndex: number) {
    return this.transactions.has(`${txHash}:${logIndex}`);
  }

  async upsertDaoCache(record: DaoCacheRecord) {
    this.daos.set(record.daoId, record);
  }

  async upsertDaoMembers(daoId: string, members: DaoMemberCacheRecord[]) {
    for (const member of members) {
      this.members.set(`${daoId}:${member.walletAddress}`, member);
    }
  }

  async getDaoIdByAddress(contractAddress: string) {
    return this.daos.get(contractAddress.toLowerCase())?.daoId ?? null;
  }

  async getProposalDetail(daoId: string, proposalId: bigint) {
    return this.proposals.get(`${daoId}:${proposalId.toString()}`) ?? null;
  }

  async upsertProposalDetail(record: ProposalDetailRecord) {
    this.proposals.set(`${record.daoId}:${record.proposalId.toString()}`, record);
  }

  async updateDaoStatus(daoId: string, status: 0 | 1 | 2, terminatedAt?: Date | null) {
    const dao = this.daos.get(daoId);
    if (!dao) throw new Error(`missing dao ${daoId}`);

    this.daos.set(daoId, {
      ...dao,
      status,
      terminatedAt: terminatedAt === undefined ? dao.terminatedAt : terminatedAt,
    });
  }

  async upsertProposalCancelDetail(record: ProposalCancelDetailRecord) {
    this.cancellations.set(`${record.daoId}:${record.proposalId.toString()}`, record);
  }

  async upsertEvidenceFile(record: EvidenceFileRecord) {
    this.evidence.set(record.evidenceId, record);
  }

  async appendTransactionLog(record: TransactionLogRecord) {
    this.transactions.set(`${record.txHash}:${record.logIndex}`, record);
  }

  async getSyncState(source: string, contractAddress: string) {
    return this.syncStates.get(`${source}:${contractAddress.toLowerCase()}`) ?? null;
  }

  async upsertSyncState(record: SyncStateRecord) {
    this.syncStates.set(`${record.source}:${record.contractAddress.toLowerCase()}`, record);
  }
}

describe('db phase 8 sync foundation', () => {
  const daoAddress = '0xDA00000000000000000000000000000000000001';
  const normalizedDaoAddress = daoAddress.toLowerCase();
  const factoryAddress = '0xFA00000000000000000000000000000000000001';
  const creator = '0xC000000000000000000000000000000000000001';
  const member = '0xC000000000000000000000000000000000000002';

  it('exports package metadata and D1 schema tables required by the PRD/SRS', () => {
    const schema = readFileSync(D1_SCHEMA_PATH, 'utf8');

    expect(databasePackageName).toBe('@dao-budget/db');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS dao_cache');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS dao_members_cache');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS proposal_details');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS proposal_cancel_details');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS evidence_files');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS transaction_logs');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS sync_state');
    expect(schema).not.toContain('file_blob');
  });

  it('creates deterministic R2 object keys scoped by DAO, proposal, and evidence id', () => {
    expect(
      buildEvidenceObjectKey({
        daoAddress,
        proposalId: 7n,
        evidenceId: 'receipt-01',
        fileName: 'receipt photo.png',
      }),
    ).toBe(`dao/${normalizedDaoAddress}/proposal/7/evidence/receipt-01/receipt_photo.png`);
  });

  it('applies DAO, proposal, cancellation, evidence, termination, and transaction log events', async () => {
    const repository = new InMemorySyncRepository();

    const result = await syncEventBatch({
      repository,
      source: 'factory',
      contractAddress: factoryAddress,
      fromBlock: 100n,
      toBlock: 108n,
      events: [
        {
          eventType: EVENT_TYPES.DAO_CREATED,
          txHash: '0x1',
          logIndex: 0,
          blockNumber: 100n,
          daoAddress,
          factoryAddress,
          creator,
          name: 'Blockchain Club',
          memberCount: 2,
          approvalRule: 0,
          members: [creator, member],
          timestamp: 1_700_000_000,
        },
        {
          eventType: EVENT_TYPES.PROPOSAL_CREATED,
          txHash: '0x2',
          logIndex: 0,
          blockNumber: 101n,
          daoAddress,
          proposalId: 1n,
          proposalType: 0,
          proposer: creator,
          amountWei: '100',
          recipient: member,
          deadline: 1_700_001_000n,
          approvalType: 0,
          contentHash: '0xcontent',
          title: 'Buy supplies',
          description: 'Purchase receipts are uploaded later.',
          timestamp: 1_700_000_010,
        },
        {
          eventType: EVENT_TYPES.PROPOSAL_CANCELED,
          txHash: '0x3',
          logIndex: 0,
          blockNumber: 102n,
          daoAddress,
          proposalId: 1n,
          canceledBy: creator,
          cancelReasonHash: '0xcancel',
          cancelReason: 'Wrong recipient',
          timestamp: 1_700_000_020,
        },
        {
          eventType: EVENT_TYPES.PROPOSAL_CREATED,
          txHash: '0x4',
          logIndex: 0,
          blockNumber: 103n,
          daoAddress,
          proposalId: 2n,
          proposalType: 1,
          proposer: creator,
          amountWei: null,
          recipient: null,
          deadline: 1_700_002_000n,
          approvalType: 0,
          contentHash: '0xtermination',
          timestamp: 1_700_000_030,
        },
        {
          eventType: EVENT_TYPES.PROPOSAL_FINALIZED,
          txHash: '0x5',
          logIndex: 0,
          blockNumber: 104n,
          daoAddress,
          proposalId: 2n,
          finalStatus: 2,
          yesVotes: 0n,
          noVotes: 2n,
          timestamp: 1_700_000_040,
        },
        {
          eventType: EVENT_TYPES.EVIDENCE_HASH_REGISTERED,
          txHash: '0x6',
          logIndex: 0,
          blockNumber: 105n,
          daoAddress,
          proposalId: 1n,
          evidenceHash: '0xevidence',
          uploader: creator,
          evidenceId: 'evidence-1',
          mimeType: 'image/png',
          fileSize: 1234,
          timestamp: 1_700_000_050,
        },
        {
          eventType: EVENT_TYPES.VOTE_CAST,
          txHash: '0x7',
          logIndex: 0,
          blockNumber: 106n,
          daoAddress,
          proposalId: 2n,
          voter: member,
          support: true,
          timestamp: 1_700_000_055,
        },
        {
          eventType: EVENT_TYPES.TERMINATION_EXECUTED,
          txHash: '0x8',
          logIndex: 0,
          blockNumber: 107n,
          daoAddress,
          proposalId: 2n,
          memberCount: 2,
          refundPerMemberWei: '50',
          remainderWei: '1',
          remainderRecipient: creator,
          timestamp: 1_700_000_060,
        },
      ],
    });

    expect(result).toEqual({
      appliedEvents: 8,
      skippedEvents: 0,
      fromBlock: 100n,
      toBlock: 108n,
      lastSyncedBlock: 108n,
    });
    expect(repository.daos.get(normalizedDaoAddress)?.status).toBe(2);
    expect(repository.daos.get(normalizedDaoAddress)?.terminatedAt?.toISOString()).toBe(
      '2023-11-14T22:14:20.000Z',
    );
    expect(repository.members.size).toBe(2);
    expect(repository.proposals.get(`${normalizedDaoAddress}:2`)?.amountWei).toBeNull();
    expect(repository.proposals.get(`${normalizedDaoAddress}:2`)?.recipient).toBeNull();
    expect(repository.cancellations.get(`${normalizedDaoAddress}:1`)?.cancelReasonHash).toBe(
      '0xcancel',
    );
    expect(repository.evidence.get('evidence-1')?.r2ObjectKey).toBe(
      `dao/${normalizedDaoAddress}/proposal/1/evidence/evidence-1/evidence-1.bin`,
    );
    expect(repository.transactions.get('0x7:0')?.status).toBe('vote:yes');
    expect(repository.transactions.size).toBe(8);
  });

  it('skips duplicate or already-synced events and resumes from the last synced block', async () => {
    const repository = new InMemorySyncRepository();

    await syncEventBatch({
      repository,
      source: 'factory',
      contractAddress: factoryAddress,
      fromBlock: 100n,
      toBlock: 100n,
      events: [
        {
          eventType: EVENT_TYPES.DAO_CREATED,
          txHash: '0x1',
          logIndex: 0,
          blockNumber: 100n,
          daoAddress,
          factoryAddress,
          creator,
          name: 'Blockchain Club',
          memberCount: 2,
          approvalRule: 0,
          members: [creator, member],
          timestamp: 1_700_000_000,
        },
      ],
    });

    const result = await syncEventBatch({
      repository,
      source: 'factory',
      contractAddress: factoryAddress,
      fromBlock: 100n,
      toBlock: 101n,
      events: [
        {
          eventType: EVENT_TYPES.DAO_CREATED,
          txHash: '0x1',
          logIndex: 0,
          blockNumber: 100n,
          daoAddress,
          factoryAddress,
          creator,
          name: 'Duplicate',
          memberCount: 2,
          approvalRule: 0,
          members: [creator, member],
          timestamp: 1_700_000_000,
        },
        {
          eventType: EVENT_TYPES.DEPOSIT_RECEIVED,
          txHash: '0x2',
          logIndex: 0,
          blockNumber: 101n,
          daoAddress,
          depositor: member,
          amountWei: '10',
          balanceAfterWei: '10',
          timestamp: 1_700_000_010,
        },
      ],
    });

    expect(result.appliedEvents).toBe(1);
    expect(result.skippedEvents).toBe(1);
    expect(result.fromBlock).toBe(101n);
    expect(repository.daos.get(normalizedDaoAddress)?.name).toBe('Blockchain Club');
    expect(repository.transactions.size).toBe(2);
  });

  it('limits a single sync range to protect RPC providers', async () => {
    const repository = new InMemorySyncRepository();

    await expect(
      syncEventBatch({
        repository,
        source: 'factory',
        contractAddress: factoryAddress,
        fromBlock: 1n,
        toBlock: MAX_SYNC_BLOCK_RANGE + 1n,
        events: [],
      }),
    ).rejects.toThrow('SYNC_RANGE_TOO_LARGE');
  });
});

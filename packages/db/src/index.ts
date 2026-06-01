export const databasePackageName = '@dao-budget/db';

export const D1_SCHEMA_PATH = 'd1/schema.sql';
export const R2_EVIDENCE_BUCKET_BINDING = 'DAO_BUDGET_EVIDENCE_BUCKET';
export const MAX_SYNC_BLOCK_RANGE = 500n;

export const EVENT_TYPES = {
  DAO_CREATED: 'DAOCreated',
  DEPOSIT_RECEIVED: 'DepositReceived',
  PROPOSAL_CREATED: 'ProposalCreated',
  PROPOSAL_CANCELED: 'ProposalCanceled',
  VOTE_CAST: 'VoteCast',
  PROPOSAL_FINALIZED: 'ProposalFinalized',
  PROPOSAL_EXECUTED: 'ProposalExecuted',
  PROPOSAL_EXECUTION_FAILED: 'ProposalExecutionFailed',
  TERMINATION_EXECUTED: 'TerminationExecuted',
  EVIDENCE_HASH_REGISTERED: 'EvidenceHashRegistered',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export type DaoStatus = 0 | 1 | 2;
export type ProposalStatus = 0 | 1 | 2 | 3 | 4 | 5;
export type ProposalType = 0 | 1;

type BaseChainEvent = {
  eventType: EventType;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  daoAddress: string;
  timestamp: number;
};

export type DaoCreatedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.DAO_CREATED;
  factoryAddress: string;
  creator: string;
  name: string;
  memberCount: number;
  approvalRule: number;
  members: string[];
};

export type DepositReceivedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.DEPOSIT_RECEIVED;
  depositor: string;
  amountWei: string;
  balanceAfterWei: string;
};

export type ProposalCreatedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.PROPOSAL_CREATED;
  proposalId: bigint;
  proposalType: ProposalType;
  proposer: string;
  amountWei: string | null;
  recipient: string | null;
  deadline: bigint;
  approvalType: number;
  contentHash: string;
  title?: string;
  description?: string;
};

export type ProposalCanceledEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.PROPOSAL_CANCELED;
  proposalId: bigint;
  canceledBy: string;
  cancelReasonHash: string;
  cancelReason?: string;
};

export type VoteCastEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.VOTE_CAST;
  proposalId: bigint;
  voter: string;
  support: boolean;
};

export type ProposalFinalizedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.PROPOSAL_FINALIZED;
  proposalId: bigint;
  finalStatus: ProposalStatus;
  yesVotes: bigint;
  noVotes: bigint;
};

export type ProposalExecutedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.PROPOSAL_EXECUTED;
  proposalId: bigint;
  recipient: string;
  amountWei: string;
};

export type ProposalExecutionFailedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.PROPOSAL_EXECUTION_FAILED;
  proposalId: bigint;
  recipient: string;
  amountWei: string;
  reasonCode: number;
};

export type TerminationExecutedEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.TERMINATION_EXECUTED;
  proposalId: bigint;
  memberCount: number;
  refundPerMemberWei: string;
  remainderWei: string;
  remainderRecipient: string;
};

export type EvidenceHashRegisteredEvent = BaseChainEvent & {
  eventType: typeof EVENT_TYPES.EVIDENCE_HASH_REGISTERED;
  proposalId: bigint;
  evidenceHash: string;
  uploader: string;
  evidenceId?: string;
  evidenceType?: string;
  r2ObjectKey?: string;
  mimeType?: string;
  fileSize?: number;
  description?: string;
};

export type ChainEvent =
  | DaoCreatedEvent
  | DepositReceivedEvent
  | ProposalCreatedEvent
  | ProposalCanceledEvent
  | VoteCastEvent
  | ProposalFinalizedEvent
  | ProposalExecutedEvent
  | ProposalExecutionFailedEvent
  | TerminationExecutedEvent
  | EvidenceHashRegisteredEvent;

export type DaoCacheRecord = {
  daoId: string;
  contractAddress: string;
  factoryAddress: string;
  name: string;
  status: DaoStatus;
  memberCount: number;
  approvalRule: number;
  createdAt: Date;
  terminatedAt: Date | null;
  syncedBlock: bigint;
};

export type DaoMemberCacheRecord = {
  daoId: string;
  walletAddress: string;
  joinedAt: Date;
  isActive: boolean;
};

export type ProposalDetailRecord = {
  daoId: string;
  proposalId: bigint;
  proposalType: ProposalType;
  title: string;
  description: string;
  amountWei: string | null;
  recipient: string | null;
  deadline: bigint;
  approvalType: number;
  contentHash: string;
  createdAt: Date;
};

export type ProposalCancelDetailRecord = {
  daoId: string;
  proposalId: bigint;
  cancelReason: string;
  cancelReasonHash: string;
  canceledBy: string;
  canceledAt: Date;
};

export type EvidenceFileRecord = {
  evidenceId: string;
  daoId: string;
  proposalId: bigint;
  uploader: string;
  evidenceType: string;
  r2ObjectKey: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  contentHash: string;
  createdAt: Date;
};

export type TransactionLogRecord = {
  txHash: string;
  logIndex: number;
  daoId: string;
  proposalId: bigint | null;
  eventType: EventType;
  actor: string | null;
  amountWei: string | null;
  status: string;
  blockNumber: bigint;
  createdAt: Date;
};

export type SyncStateRecord = {
  source: string;
  contractAddress: string;
  lastSyncedBlock: bigint;
  updatedAt: Date;
};

export type SyncRepository = {
  hasTransactionLog(txHash: string, logIndex: number): Promise<boolean>;
  upsertDaoCache(record: DaoCacheRecord): Promise<void>;
  upsertDaoMembers(daoId: string, members: DaoMemberCacheRecord[]): Promise<void>;
  getDaoIdByAddress(contractAddress: string): Promise<string | null>;
  getProposalDetail(daoId: string, proposalId: bigint): Promise<ProposalDetailRecord | null>;
  upsertProposalDetail(record: ProposalDetailRecord): Promise<void>;
  updateDaoStatus(daoId: string, status: DaoStatus, terminatedAt?: Date | null): Promise<void>;
  upsertProposalCancelDetail(record: ProposalCancelDetailRecord): Promise<void>;
  upsertEvidenceFile(record: EvidenceFileRecord): Promise<void>;
  appendTransactionLog(record: TransactionLogRecord): Promise<void>;
  getSyncState(source: string, contractAddress: string): Promise<SyncStateRecord | null>;
  upsertSyncState(record: SyncStateRecord): Promise<void>;
};

export type SyncEventBatchInput = {
  repository: SyncRepository;
  source: string;
  contractAddress: string;
  fromBlock: bigint;
  toBlock: bigint;
  events: ChainEvent[];
  now?: Date;
};

export type SyncEventBatchResult = {
  appliedEvents: number;
  skippedEvents: number;
  fromBlock: bigint;
  toBlock: bigint;
  lastSyncedBlock: bigint;
};

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function toEventDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}

export function buildEvidenceObjectKey(input: {
  daoAddress: string;
  proposalId: bigint | number | string;
  evidenceId: string;
  fileName?: string;
}): string {
  const daoAddress = normalizeAddress(input.daoAddress);
  const proposalId = input.proposalId.toString();
  const evidenceId = input.evidenceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = input.fileName?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? `${evidenceId}.bin`;

  return `dao/${daoAddress}/proposal/${proposalId}/evidence/${evidenceId}/${fileName}`;
}

export function assertSyncBlockRange(fromBlock: bigint, toBlock: bigint): void {
  if (toBlock < fromBlock) {
    throw new Error('SYNC_RANGE_INVALID');
  }

  if (toBlock - fromBlock + 1n > MAX_SYNC_BLOCK_RANGE) {
    throw new Error('SYNC_RANGE_TOO_LARGE');
  }
}

export async function syncEventBatch(input: SyncEventBatchInput): Promise<SyncEventBatchResult> {
  assertSyncBlockRange(input.fromBlock, input.toBlock);

  const state = await input.repository.getSyncState(input.source, input.contractAddress);
  const replayStartBlock =
    state && state.lastSyncedBlock >= input.fromBlock
      ? state.lastSyncedBlock + 1n
      : input.fromBlock;

  let appliedEvents = 0;
  let skippedEvents = 0;
  const sortedEvents = [...input.events].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );

  for (const event of sortedEvents) {
    if (event.blockNumber < replayStartBlock || event.blockNumber > input.toBlock) {
      skippedEvents += 1;
      continue;
    }

    const applied = await applyChainEvent(input.repository, event);
    if (applied) {
      appliedEvents += 1;
    } else {
      skippedEvents += 1;
    }
  }

  await input.repository.upsertSyncState({
    source: input.source,
    contractAddress: normalizeAddress(input.contractAddress),
    lastSyncedBlock: input.toBlock,
    updatedAt: input.now ?? new Date(),
  });

  return {
    appliedEvents,
    skippedEvents,
    fromBlock: replayStartBlock,
    toBlock: input.toBlock,
    lastSyncedBlock: input.toBlock,
  };
}

export async function applyChainEvent(
  repository: SyncRepository,
  event: ChainEvent,
): Promise<boolean> {
  if (await repository.hasTransactionLog(event.txHash, event.logIndex)) {
    return false;
  }

  const daoId = await resolveDaoId(repository, event);

  switch (event.eventType) {
    case EVENT_TYPES.DAO_CREATED:
      await applyDaoCreated(repository, event);
      break;
    case EVENT_TYPES.PROPOSAL_CREATED:
      await repository.upsertProposalDetail({
        daoId,
        proposalId: event.proposalId,
        proposalType: event.proposalType,
        title: event.title ?? '',
        description: event.description ?? '',
        amountWei: event.amountWei,
        recipient: event.recipient ? normalizeAddress(event.recipient) : null,
        deadline: event.deadline,
        approvalType: event.approvalType,
        contentHash: event.contentHash,
        createdAt: toEventDate(event.timestamp),
      });
      if (event.proposalType === 1) {
        await repository.updateDaoStatus(daoId, 1, null);
      }
      break;
    case EVENT_TYPES.PROPOSAL_CANCELED:
      await repository.upsertProposalCancelDetail({
        daoId,
        proposalId: event.proposalId,
        cancelReason: event.cancelReason ?? '',
        cancelReasonHash: event.cancelReasonHash,
        canceledBy: normalizeAddress(event.canceledBy),
        canceledAt: toEventDate(event.timestamp),
      });
      if ((await repository.getProposalDetail(daoId, event.proposalId))?.proposalType === 1) {
        await repository.updateDaoStatus(daoId, 0, null);
      }
      break;
    case EVENT_TYPES.PROPOSAL_FINALIZED:
      if (
        event.finalStatus === 2 &&
        (await repository.getProposalDetail(daoId, event.proposalId))?.proposalType === 1
      ) {
        await repository.updateDaoStatus(daoId, 0, null);
      }
      break;
    case EVENT_TYPES.TERMINATION_EXECUTED:
      await repository.updateDaoStatus(daoId, 2, toEventDate(event.timestamp));
      break;
    default:
      break;
  }

  if (event.eventType === EVENT_TYPES.EVIDENCE_HASH_REGISTERED) {
    const evidenceId = event.evidenceId ?? `${event.txHash}-${event.logIndex}`;
    await repository.upsertEvidenceFile({
      evidenceId,
      daoId,
      proposalId: event.proposalId,
      uploader: normalizeAddress(event.uploader),
      evidenceType: event.evidenceType ?? 'receipt',
      r2ObjectKey:
        event.r2ObjectKey ??
        buildEvidenceObjectKey({
          daoAddress: event.daoAddress,
          proposalId: event.proposalId,
          evidenceId,
        }),
      mimeType: event.mimeType ?? 'application/octet-stream',
      fileSize: event.fileSize ?? 0,
      description: event.description ?? null,
      contentHash: event.evidenceHash,
      createdAt: toEventDate(event.timestamp),
    });
  }

  await repository.appendTransactionLog(toTransactionLog(daoId, event));
  return true;
}

async function resolveDaoId(repository: SyncRepository, event: ChainEvent): Promise<string> {
  if (event.eventType === EVENT_TYPES.DAO_CREATED) {
    return normalizeAddress(event.daoAddress);
  }

  const daoId = await repository.getDaoIdByAddress(event.daoAddress);
  if (!daoId) {
    throw new Error(`DAO_NOT_SYNCED:${event.daoAddress}`);
  }

  return daoId;
}

async function applyDaoCreated(repository: SyncRepository, event: DaoCreatedEvent): Promise<void> {
  const daoId = normalizeAddress(event.daoAddress);
  const createdAt = toEventDate(event.timestamp);

  await repository.upsertDaoCache({
    daoId,
    contractAddress: daoId,
    factoryAddress: normalizeAddress(event.factoryAddress),
    name: event.name,
    status: 0,
    memberCount: event.memberCount,
    approvalRule: event.approvalRule,
    createdAt,
    terminatedAt: null,
    syncedBlock: event.blockNumber,
  });
  await repository.upsertDaoMembers(
    daoId,
    event.members.map((walletAddress) => ({
      daoId,
      walletAddress: normalizeAddress(walletAddress),
      joinedAt: createdAt,
      isActive: true,
    })),
  );
}

function toTransactionLog(daoId: string, event: ChainEvent): TransactionLogRecord {
  return {
    txHash: event.txHash,
    logIndex: event.logIndex,
    daoId,
    proposalId: 'proposalId' in event ? event.proposalId : null,
    eventType: event.eventType,
    actor: getActor(event),
    amountWei: getAmountWei(event),
    status: getEventStatus(event),
    blockNumber: event.blockNumber,
    createdAt: toEventDate(event.timestamp),
  };
}

function getActor(event: ChainEvent): string | null {
  switch (event.eventType) {
    case EVENT_TYPES.DAO_CREATED:
      return normalizeAddress(event.creator);
    case EVENT_TYPES.DEPOSIT_RECEIVED:
      return normalizeAddress(event.depositor);
    case EVENT_TYPES.PROPOSAL_CREATED:
      return normalizeAddress(event.proposer);
    case EVENT_TYPES.PROPOSAL_CANCELED:
      return normalizeAddress(event.canceledBy);
    case EVENT_TYPES.VOTE_CAST:
      return normalizeAddress(event.voter);
    case EVENT_TYPES.PROPOSAL_EXECUTED:
      return normalizeAddress(event.recipient);
    case EVENT_TYPES.PROPOSAL_EXECUTION_FAILED:
      return normalizeAddress(event.recipient);
    case EVENT_TYPES.TERMINATION_EXECUTED:
      return normalizeAddress(event.remainderRecipient);
    case EVENT_TYPES.EVIDENCE_HASH_REGISTERED:
      return normalizeAddress(event.uploader);
    default:
      return null;
  }
}

function getAmountWei(event: ChainEvent): string | null {
  switch (event.eventType) {
    case EVENT_TYPES.DEPOSIT_RECEIVED:
    case EVENT_TYPES.PROPOSAL_EXECUTED:
    case EVENT_TYPES.PROPOSAL_EXECUTION_FAILED:
      return event.amountWei;
    case EVENT_TYPES.PROPOSAL_CREATED:
      return event.amountWei;
    case EVENT_TYPES.TERMINATION_EXECUTED:
      return event.refundPerMemberWei;
    default:
      return null;
  }
}

function getEventStatus(event: ChainEvent): string {
  switch (event.eventType) {
    case EVENT_TYPES.PROPOSAL_FINALIZED:
      return `proposal:${event.finalStatus}`;
    case EVENT_TYPES.PROPOSAL_EXECUTED:
      return 'executed';
    case EVENT_TYPES.PROPOSAL_EXECUTION_FAILED:
      return `execution_failed:${event.reasonCode}`;
    case EVENT_TYPES.TERMINATION_EXECUTED:
      return 'terminated';
    default:
      return 'recorded';
  }
}

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  EVENT_TYPES,
  MAX_SYNC_BLOCK_RANGE,
  normalizeAddress,
  syncEventBatch,
  type ChainEvent,
} from '../../../packages/db/src/index.js';
import type { D1DatabaseLike } from './d1-store.js';
import { createD1SyncRepository, listKnownDaoAddresses } from './d1-store.js';
import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const EVENT_SIGNATURES = {
  DAOCreated: 'DAOCreated(address,address,string,uint256,uint8,uint256)',
  DepositReceived: 'DepositReceived(address,address,uint256,uint256,uint256)',
  ProposalCreated:
    'ProposalCreated(address,uint256,uint8,address,uint256,address,uint256,uint8,bytes32)',
  ProposalCanceled: 'ProposalCanceled(address,uint256,address,bytes32,uint256)',
  VoteCast: 'VoteCast(address,uint256,address,bool,uint256)',
  ProposalFinalized: 'ProposalFinalized(address,uint256,uint8,uint256,uint256,uint256)',
  ProposalExecuted: 'ProposalExecuted(address,uint256,address,uint256,uint256)',
  ProposalExecutionFailed: 'ProposalExecutionFailed(address,uint256,address,uint256,uint8,uint256)',
  TerminationExecuted:
    'TerminationExecuted(address,uint256,uint256,uint256,uint256,address,uint256)',
  EvidenceHashRegistered: 'EvidenceHashRegistered(address,uint256,bytes32,address,uint256)',
} as const;

const EVENT_TOPICS = {
  [EVENT_TYPES.DAO_CREATED]: topicFor(EVENT_SIGNATURES.DAOCreated),
  [EVENT_TYPES.DEPOSIT_RECEIVED]: topicFor(EVENT_SIGNATURES.DepositReceived),
  [EVENT_TYPES.PROPOSAL_CREATED]: topicFor(EVENT_SIGNATURES.ProposalCreated),
  [EVENT_TYPES.PROPOSAL_CANCELED]: topicFor(EVENT_SIGNATURES.ProposalCanceled),
  [EVENT_TYPES.VOTE_CAST]: topicFor(EVENT_SIGNATURES.VoteCast),
  [EVENT_TYPES.PROPOSAL_FINALIZED]: topicFor(EVENT_SIGNATURES.ProposalFinalized),
  [EVENT_TYPES.PROPOSAL_EXECUTED]: topicFor(EVENT_SIGNATURES.ProposalExecuted),
  [EVENT_TYPES.PROPOSAL_EXECUTION_FAILED]: topicFor(EVENT_SIGNATURES.ProposalExecutionFailed),
  [EVENT_TYPES.TERMINATION_EXECUTED]: topicFor(EVENT_SIGNATURES.TerminationExecuted),
  [EVENT_TYPES.EVIDENCE_HASH_REGISTERED]: topicFor(EVENT_SIGNATURES.EvidenceHashRegistered),
} as const;

const GET_MEMBERS_SELECTOR = selectorFor('getMembers()');

type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

type RpcBlock = {
  timestamp: string;
};

type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
};

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type RpcClient = {
  call<T>(method: string, params: unknown[]): Promise<T>;
};

export type ScheduledSyncEnvironment = {
  RPC_URL?: string;
  FACTORY_CONTRACT_ADDRESS?: string;
  DAO_BUDGET_DB?: D1DatabaseLike;
};

export type ScheduledSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  chainId: number;
  maxBlockRange: string;
  r2Binding: string;
  appliedEvents?: number;
  skippedEvents?: number;
  fromBlock?: string;
  toBlock?: string;
  lastSyncedBlock?: string;
};

export async function runScheduledSync(
  env: ScheduledSyncEnvironment,
): Promise<ScheduledSyncResult> {
  if (!env.RPC_URL || !env.FACTORY_CONTRACT_ADDRESS || !env.DAO_BUDGET_DB) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing-sync-bindings',
      chainId: SEPOLIA_CHAIN_ID,
      maxBlockRange: MAX_SYNC_BLOCK_RANGE.toString(),
      r2Binding: 'DAO_BUDGET_EVIDENCE_BUCKET',
    };
  }

  const rpc = createRpcClient(env.RPC_URL);
  const latestBlock = await rpc.call<string>('eth_blockNumber', []);
  const latestBlockNumber = hexToBigInt(latestBlock);
  const repository = createD1SyncRepository(env.DAO_BUDGET_DB);
  const normalizedFactoryAddress = normalizeAddress(env.FACTORY_CONTRACT_ADDRESS);
  const syncState = await repository.getSyncState('sepolia-factory', normalizedFactoryAddress);
  const fromBlock =
    syncState === null
      ? latestBlockNumber >= MAX_SYNC_BLOCK_RANGE - 1n
        ? latestBlockNumber - (MAX_SYNC_BLOCK_RANGE - 1n)
        : 0n
      : syncState.lastSyncedBlock + 1n;

  if (fromBlock > latestBlockNumber) {
    return {
      ok: true,
      skipped: true,
      reason: 'already-synced',
      chainId: SEPOLIA_CHAIN_ID,
      maxBlockRange: MAX_SYNC_BLOCK_RANGE.toString(),
      r2Binding: 'DAO_BUDGET_EVIDENCE_BUCKET',
      appliedEvents: 0,
      skippedEvents: 0,
      fromBlock: fromBlock.toString(),
      toBlock: latestBlockNumber.toString(),
      lastSyncedBlock: syncState?.lastSyncedBlock.toString() ?? latestBlockNumber.toString(),
    };
  }

  const toBlock = latestBlockNumber;
  const knownDaos = await listKnownDaoAddresses(env.DAO_BUDGET_DB);
  const events = await fetchSyncEvents(
    rpc,
    normalizedFactoryAddress,
    knownDaos,
    fromBlock,
    toBlock,
  );
  const result = await syncEventBatch({
    repository,
    source: 'sepolia-factory',
    contractAddress: normalizedFactoryAddress,
    fromBlock,
    toBlock,
    events,
  });

  return {
    ok: true,
    skipped: false,
    chainId: SEPOLIA_CHAIN_ID,
    maxBlockRange: MAX_SYNC_BLOCK_RANGE.toString(),
    r2Binding: 'DAO_BUDGET_EVIDENCE_BUCKET',
    appliedEvents: result.appliedEvents,
    skippedEvents: result.skippedEvents,
    fromBlock: result.fromBlock.toString(),
    toBlock: result.toBlock.toString(),
    lastSyncedBlock: result.lastSyncedBlock.toString(),
  };
}

async function fetchSyncEvents(
  rpc: RpcClient,
  factoryAddress: string,
  knownDaos: string[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ChainEvent[]> {
  const blockTimestampCache = new Map<string, number>();
  const factoryLogs = await getLogs(rpc, {
    address: factoryAddress,
    fromBlock,
    toBlock,
    topics: [EVENT_TOPICS.DAOCreated],
  });

  const daoCreatedEvents = await Promise.all(
    factoryLogs.map((log) => parseDaoCreatedLog(log, factoryAddress, rpc, blockTimestampCache)),
  );
  const allDaoAddresses = new Set<string>([
    ...knownDaos,
    ...daoCreatedEvents.map((event) => event.daoAddress),
  ]);
  const daoLogs = await Promise.all(
    [...allDaoAddresses].map((daoAddress) =>
      getLogs(rpc, {
        address: daoAddress,
        fromBlock,
        toBlock,
      }),
    ),
  );

  const vaultEvents = (
    await Promise.all(
      daoLogs.flatMap((logs) => logs.map((log) => parseVaultLog(log, rpc, blockTimestampCache))),
    )
  ).filter((event): event is ChainEvent => event !== null);

  return [...daoCreatedEvents, ...vaultEvents];
}

async function parseDaoCreatedLog(
  log: RpcLog,
  factoryAddress: string,
  rpc: RpcClient,
  blockTimestampCache: Map<string, number>,
) {
  const words = getDataWords(log.data);
  const daoAddress = decodeAddressTopic(log.topics[1]);
  const creator = decodeAddressTopic(log.topics[2]);
  const timestamp = await getBlockTimestamp(rpc, log.blockNumber, blockTimestampCache);

  return {
    eventType: EVENT_TYPES.DAO_CREATED,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(hexToBigInt(log.logIndex)),
    blockNumber: hexToBigInt(log.blockNumber),
    daoAddress,
    factoryAddress,
    creator,
    name: decodeDynamicString(log.data, 0),
    memberCount: Number(decodeUint256(words[1])),
    approvalRule: Number(decodeUint256(words[2])),
    members: await readMembers(rpc, daoAddress),
    timestamp,
  } as const;
}

async function parseVaultLog(
  log: RpcLog,
  rpc: RpcClient,
  blockTimestampCache: Map<string, number>,
): Promise<ChainEvent | null> {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) {
    return null;
  }

  const base = {
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(hexToBigInt(log.logIndex)),
    blockNumber: hexToBigInt(log.blockNumber),
    daoAddress: decodeAddressTopic(log.topics[1]),
    timestamp: await getBlockTimestamp(rpc, log.blockNumber, blockTimestampCache),
  };
  const words = getDataWords(log.data);

  switch (topic0) {
    case EVENT_TOPICS.DepositReceived:
      return {
        ...base,
        eventType: EVENT_TYPES.DEPOSIT_RECEIVED,
        depositor: decodeAddressTopic(log.topics[2]),
        amountWei: decodeUint256(words[0]).toString(),
        balanceAfterWei: decodeUint256(words[1]).toString(),
      };
    case EVENT_TOPICS.ProposalCreated: {
      const proposalType = Number(decodeUint256(words[0])) as 0 | 1;
      const recipient = decodeAddressWord(words[2]);
      return {
        ...base,
        eventType: EVENT_TYPES.PROPOSAL_CREATED,
        proposalId: decodeUint256(log.topics[2]),
        proposalType,
        proposer: decodeAddressTopic(log.topics[3]),
        amountWei: proposalType === 1 ? null : decodeUint256(words[1]).toString(),
        recipient: proposalType === 1 || recipient === ZERO_ADDRESS ? null : recipient,
        deadline: decodeUint256(words[3]),
        approvalType: Number(decodeUint256(words[4])),
        contentHash: normalizeBytes32(words[5]),
      };
    }
    case EVENT_TOPICS.ProposalCanceled:
      return {
        ...base,
        eventType: EVENT_TYPES.PROPOSAL_CANCELED,
        proposalId: decodeUint256(log.topics[2]),
        canceledBy: decodeAddressTopic(log.topics[3]),
        cancelReasonHash: normalizeBytes32(words[0]),
      };
    case EVENT_TOPICS.VoteCast:
      return {
        ...base,
        eventType: EVENT_TYPES.VOTE_CAST,
        proposalId: decodeUint256(log.topics[2]),
        voter: decodeAddressTopic(log.topics[3]),
        support: decodeUint256(words[0]) === 1n,
      };
    case EVENT_TOPICS.ProposalFinalized:
      return {
        ...base,
        eventType: EVENT_TYPES.PROPOSAL_FINALIZED,
        proposalId: decodeUint256(log.topics[2]),
        finalStatus: Number(decodeUint256(words[0])) as 0 | 1 | 2 | 3 | 4 | 5,
        yesVotes: decodeUint256(words[1]),
        noVotes: decodeUint256(words[2]),
      };
    case EVENT_TOPICS.ProposalExecuted:
      return {
        ...base,
        eventType: EVENT_TYPES.PROPOSAL_EXECUTED,
        proposalId: decodeUint256(log.topics[2]),
        recipient: decodeAddressTopic(log.topics[3]),
        amountWei: decodeUint256(words[0]).toString(),
      };
    case EVENT_TOPICS.ProposalExecutionFailed:
      return {
        ...base,
        eventType: EVENT_TYPES.PROPOSAL_EXECUTION_FAILED,
        proposalId: decodeUint256(log.topics[2]),
        recipient: decodeAddressTopic(log.topics[3]),
        amountWei: decodeUint256(words[0]).toString(),
        reasonCode: Number(decodeUint256(words[1])),
      };
    case EVENT_TOPICS.TerminationExecuted:
      return {
        ...base,
        eventType: EVENT_TYPES.TERMINATION_EXECUTED,
        proposalId: decodeUint256(log.topics[2]),
        memberCount: Number(decodeUint256(words[0])),
        refundPerMemberWei: decodeUint256(words[1]).toString(),
        remainderWei: decodeUint256(words[2]).toString(),
        remainderRecipient: decodeAddressTopic(log.topics[3]),
      };
    case EVENT_TOPICS.EvidenceHashRegistered:
      return {
        ...base,
        eventType: EVENT_TYPES.EVIDENCE_HASH_REGISTERED,
        proposalId: decodeUint256(log.topics[2]),
        evidenceHash: normalizeBytes32(words[0]),
        uploader: decodeAddressTopic(log.topics[3]),
      };
    default:
      return null;
  }
}

function createRpcClient(rpcUrl: string): RpcClient {
  let nextId = 1;

  return {
    async call<T>(method: string, params: unknown[]) {
      const body: RpcRequest = {
        jsonrpc: '2.0',
        id: nextId++,
        method,
        params,
      };
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`RPC_HTTP_${response.status}`);
      }

      const payload = (await response.json()) as RpcResponse<T>;
      if (payload.error) {
        throw new Error(`RPC_${method}_${payload.error.code}:${payload.error.message}`);
      }
      if (payload.result === undefined) {
        throw new Error(`RPC_${method}_EMPTY_RESULT`);
      }

      return payload.result;
    },
  };
}

async function getLogs(
  rpc: RpcClient,
  input: { address: string; fromBlock: bigint; toBlock: bigint; topics?: (string | null)[] },
): Promise<RpcLog[]> {
  return rpc.call<RpcLog[]>('eth_getLogs', [
    {
      address: input.address,
      fromBlock: toQuantityHex(input.fromBlock),
      toBlock: toQuantityHex(input.toBlock),
      ...(input.topics ? { topics: input.topics } : {}),
    },
  ]);
}

async function readMembers(rpc: RpcClient, daoAddress: string): Promise<string[]> {
  const raw = await rpc.call<string>('eth_call', [
    {
      to: daoAddress,
      data: GET_MEMBERS_SELECTOR,
    },
    'latest',
  ]);

  return decodeAddressArrayOutput(raw);
}

async function getBlockTimestamp(
  rpc: RpcClient,
  blockNumberHex: string,
  cache: Map<string, number>,
): Promise<number> {
  const normalizedBlock = blockNumberHex.toLowerCase();
  const cached = cache.get(normalizedBlock);
  if (cached !== undefined) {
    return cached;
  }

  const block = await rpc.call<RpcBlock>('eth_getBlockByNumber', [normalizedBlock, false]);
  const timestamp = Number(hexToBigInt(block.timestamp));
  cache.set(normalizedBlock, timestamp);
  return timestamp;
}

function decodeDynamicString(data: string, headIndex: number): string {
  const bytes = hexToBytes(strip0x(data));
  const offset = Number(readUint256(bytes, headIndex * 32));
  const length = Number(readUint256(bytes, offset));
  const start = offset + 32;
  const end = start + length;

  return new TextDecoder().decode(bytes.slice(start, end));
}

function decodeAddressArrayOutput(data: string): string[] {
  const bytes = hexToBytes(strip0x(data));
  const offset = Number(readUint256(bytes, 0));
  const length = Number(readUint256(bytes, offset));
  const addresses: string[] = [];

  for (let index = 0; index < length; index += 1) {
    addresses.push(
      decodeAddressBytes(bytes.slice(offset + 32 + index * 32, offset + 64 + index * 32)),
    );
  }

  return addresses;
}

function decodeAddressTopic(topic: string): string {
  return normalizeAddress(`0x${strip0x(topic).slice(-40)}`);
}

function decodeAddressWord(word: string): string {
  return decodeAddressTopic(word);
}

function decodeAddressBytes(bytes: Uint8Array): string {
  return normalizeAddress(`0x${bytesToHex(bytes.slice(-20))}`);
}

function decodeUint256(value: string): bigint {
  return hexToBigInt(value);
}

function getDataWords(data: string): string[] {
  const hex = strip0x(data);
  const words: string[] = [];

  for (let index = 0; index < hex.length; index += 64) {
    words.push(`0x${hex.slice(index, index + 64)}`);
  }

  return words;
}

function normalizeBytes32(value: string): string {
  return `0x${strip0x(value).padStart(64, '0').toLowerCase()}`;
}

function readUint256(bytes: Uint8Array, offset: number): bigint {
  return hexToBigInt(`0x${bytesToHex(bytes.slice(offset, offset + 32))}`);
}

function selectorFor(signature: string): string {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4))}`;
}

function topicFor(signature: string): string {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(signature)))}`;
}

function strip0x(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function toQuantityHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function hexToBigInt(value: string): bigint {
  return BigInt(value);
}

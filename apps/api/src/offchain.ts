import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import { ApprovalType, ProposalStatus, ProposalType, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

export const API_ERROR = {
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  MISSING_BINDING: 'MISSING_BINDING',
} as const;

export type ApiErrorCode = (typeof API_ERROR)[keyof typeof API_ERROR];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type CanonicalProposalInput = {
  schemaVersion: number;
  chainId: number;
  daoAddress: string;
  proposalType: ProposalType;
  proposer: string;
  title: string;
  description: string;
  amountWei: string | null;
  recipient: string | null;
  deadline: number;
  approvalType: ApprovalType;
};

export type ProposalDetail = CanonicalProposalInput & {
  proposalId: string;
  contentHash: string;
  createdAt: string;
  status?: ProposalStatus;
};

export type CancelReasonRecord = {
  daoAddress: string;
  proposalId: string;
  cancelReason: string;
  cancelReasonHash: string;
  canceledBy: string;
  canceledAt: string;
};

export type EvidenceFileRecord = {
  evidenceId: string;
  daoAddress: string;
  proposalId: string;
  uploader: string;
  evidenceType: string;
  r2ObjectKey: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  contentHash: string;
  createdAt: string;
};

export type DaoSummary = {
  daoAddress: string;
  name: string;
  status: number;
  memberCount: number;
  approvalRule: number;
  createdAt: string;
};

export type DaoDetail = DaoSummary & {
  members: string[];
  proposals: ProposalDetail[];
};

export type TransactionLog = {
  txHash: string;
  logIndex: number;
  daoAddress: string;
  proposalId: string | null;
  eventType: string;
  actor: string | null;
  amountWei: string | null;
  status: string;
  blockNumber: string;
  createdAt: string;
};

export type EvidenceMetadataInput = {
  daoAddress: string;
  proposalId: string;
  uploader: string;
  evidenceType: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string | null;
  contentHash: string;
};

export type OffchainStore = {
  listDaosByMember(memberAddress: string): Promise<DaoSummary[]>;
  getDaoDetail(daoAddress: string): Promise<DaoDetail | null>;
  getProposalDetail(daoAddress: string, proposalId: string): Promise<ProposalDetail | null>;
  saveProposalDetail(detail: ProposalDetail): Promise<void>;
  saveCancelReason(record: CancelReasonRecord): Promise<void>;
  listTransactionLogs(daoAddress: string): Promise<TransactionLog[]>;
  listEvidenceFiles(daoAddress: string, proposalId: string): Promise<EvidenceFileRecord[]>;
  saveEvidenceFile(record: EvidenceFileRecord): Promise<void>;
};

export function canonicalizeProposal(input: CanonicalProposalInput): string {
  const normalized = normalizeProposalInput(input);

  return JSON.stringify({
    amountWei: normalized.amountWei,
    approvalType: normalized.approvalType,
    chainId: normalized.chainId,
    daoAddress: normalized.daoAddress,
    deadline: normalized.deadline,
    description: normalized.description,
    proposalType: normalized.proposalType,
    proposer: normalized.proposer,
    recipient: normalized.recipient,
    schemaVersion: normalized.schemaVersion,
    title: normalized.title,
  });
}

export function hashCanonicalProposal(input: CanonicalProposalInput) {
  const canonicalJson = canonicalizeProposal(input);
  return {
    canonicalJson,
    contentHash: `0x${bytesToHex(keccak_256(new TextEncoder().encode(canonicalJson)))}`,
  };
}

export function hashCancelReason(cancelReason: string): string {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(cancelReason)))}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);

  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

export function buildEvidenceObjectKey(input: {
  daoAddress: string;
  proposalId: string;
  evidenceId: string;
  fileName: string;
}) {
  const fileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

  return `dao/${normalizeAddress(input.daoAddress)}/proposal/${input.proposalId}/evidence/${
    input.evidenceId
  }/${fileName}`;
}

export function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Invalid wallet address.');
  }

  return trimmed;
}

export function requireMember(dao: DaoDetail, memberAddress: string): string {
  const normalized = normalizeAddress(memberAddress);
  if (!dao.members.map((member) => member.toLowerCase()).includes(normalized)) {
    throw new ApiError(403, API_ERROR.FORBIDDEN, 'Only DAO members can access this resource.');
  }

  return normalized;
}

export function validateProposalInput(input: CanonicalProposalInput): CanonicalProposalInput {
  const normalized = normalizeProposalInput(input);

  if (!normalized.title || !normalized.description) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Proposal title and description are required.');
  }
  if (!Number.isInteger(normalized.deadline) || normalized.deadline <= 0) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Proposal deadline must be a Unix timestamp.');
  }
  if (![ProposalType.Spending, ProposalType.Termination].includes(normalized.proposalType)) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Invalid proposal type.');
  }
  if (![ApprovalType.Default, ApprovalType.Unanimous].includes(normalized.approvalType)) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Invalid approval type.');
  }
  if (normalized.proposalType === ProposalType.Spending) {
    if (!normalized.amountWei || BigInt(normalized.amountWei) <= 0n) {
      throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Spending proposals require amountWei.');
    }
    if (!normalized.recipient) {
      throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Spending proposals require recipient.');
    }
  }
  if (normalized.proposalType === ProposalType.Termination) {
    if (normalized.amountWei !== null || normalized.recipient !== null) {
      throw new ApiError(
        400,
        API_ERROR.BAD_REQUEST,
        'Termination proposal amountWei and recipient must be null.',
      );
    }
  }

  return normalized;
}

export function validateEvidenceMetadataInput(input: EvidenceMetadataInput): EvidenceMetadataInput {
  const normalized = {
    ...input,
    daoAddress: normalizeAddress(input.daoAddress),
    uploader: normalizeAddress(input.uploader),
  };

  if (!normalized.proposalId || !/^[0-9]+$/.test(normalized.proposalId)) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'proposalId must be a decimal string.');
  }
  if (!normalized.evidenceType || !normalized.fileName || !normalized.mimeType) {
    throw new ApiError(
      400,
      API_ERROR.BAD_REQUEST,
      'Evidence type, file name, and MIME type are required.',
    );
  }
  if (!Number.isInteger(normalized.fileSize) || normalized.fileSize <= 0) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'Evidence file size must be positive.');
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized.contentHash)) {
    throw new ApiError(
      400,
      API_ERROR.BAD_REQUEST,
      'Evidence contentHash must be a SHA-256 hex value.',
    );
  }

  return normalized;
}

export function createEvidenceRecord(input: EvidenceMetadataInput): EvidenceFileRecord {
  const normalized = validateEvidenceMetadataInput(input);
  const evidenceId = globalThis.crypto.randomUUID();

  return {
    evidenceId,
    daoAddress: normalized.daoAddress,
    proposalId: normalized.proposalId,
    uploader: normalized.uploader,
    evidenceType: normalized.evidenceType,
    r2ObjectKey: buildEvidenceObjectKey({
      daoAddress: normalized.daoAddress,
      proposalId: normalized.proposalId,
      evidenceId,
      fileName: normalized.fileName,
    }),
    mimeType: normalized.mimeType,
    fileSize: normalized.fileSize,
    description: normalized.description ?? null,
    contentHash: normalized.contentHash.toLowerCase(),
    createdAt: new Date().toISOString(),
  };
}

function normalizeProposalInput(input: CanonicalProposalInput): CanonicalProposalInput {
  return {
    schemaVersion: input.schemaVersion,
    chainId: input.chainId,
    daoAddress: normalizeAddress(input.daoAddress),
    proposalType: input.proposalType,
    proposer: normalizeAddress(input.proposer),
    title: input.title.trim(),
    description: input.description.trim(),
    amountWei: input.amountWei === null ? null : BigInt(input.amountWei).toString(),
    recipient: input.recipient === null ? null : normalizeAddress(input.recipient),
    deadline: Number(input.deadline),
    approvalType: input.approvalType,
  };
}

export function proposalInputFromBody(body: unknown): CanonicalProposalInput {
  const value = requireObject(body);

  return validateProposalInput({
    schemaVersion: Number(value.schemaVersion ?? 1),
    chainId: Number(value.chainId ?? SEPOLIA_CHAIN_ID),
    daoAddress: requireString(value.daoAddress, 'daoAddress'),
    proposalType: Number(value.proposalType) as ProposalType,
    proposer: requireString(value.proposer, 'proposer'),
    title: requireString(value.title, 'title'),
    description: requireString(value.description, 'description'),
    amountWei:
      value.amountWei === null || value.amountWei === undefined ? null : String(value.amountWei),
    recipient:
      value.recipient === null || value.recipient === undefined ? null : String(value.recipient),
    deadline: Number(value.deadline),
    approvalType: Number(value.approvalType ?? ApprovalType.Default) as ApprovalType,
  });
}

export function evidenceBytesFromBody(body: unknown): Uint8Array {
  const value = requireObject(body);
  const fileBase64 = requireString(value.fileBase64, 'fileBase64');

  return Uint8Array.from(globalThis.atob(fileBase64), (char) => char.charCodeAt(0));
}

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, `${fieldName} is required.`);
  }

  return value;
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, API_ERROR.BAD_REQUEST, 'JSON object body is required.');
  }

  return value as Record<string, unknown>;
}

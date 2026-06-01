import {
  ApprovalRule,
  ApprovalType,
  MAX_DAO_MEMBER_COUNT,
  ProposalStatus,
  ProposalType,
} from '@dao-budget/shared';

export const createDaoSelector = '0xa5daeb23';
export const depositSelector = '0xd0e30db0';
export const createProposalSelector = '0x1fa4cb95';
export const voteSelector = '0xc9d27afe';
export const finalizeProposalSelector = '0x5652077c';
export const cancelProposalSelector = '0x8b0bbf39';
export const executeProposalSelector = '0x0d61b519';
export const registerEvidenceHashSelector = '0x27892b39';

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export type CreateDaoValidationInput = {
  creatorAddress: string;
  name: string;
  additionalMembers: string[];
  approvalRule: ApprovalRule;
};

export type CreateDaoValidationResult =
  | {
      ok: true;
      name: string;
      additionalMembers: string[];
      approvalRule: ApprovalRule;
      memberCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export function isAddress(value: string) {
  return addressPattern.test(value.trim());
}

export function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export function validateCreateDaoInput(input: CreateDaoValidationInput): CreateDaoValidationResult {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: '조직명을 입력하세요.' };
  }
  if (![ApprovalRule.Majority, ApprovalRule.TwoThirds].includes(input.approvalRule)) {
    return { ok: false, error: '기본 승인 기준을 선택하세요.' };
  }
  if (!isAddress(input.creatorAddress)) {
    return { ok: false, error: '생성자 지갑 주소가 올바르지 않습니다.' };
  }

  const creator = normalizeAddress(input.creatorAddress);
  const seen = new Set([creator]);
  const normalizedMembers: string[] = [];

  for (const member of input.additionalMembers) {
    if (!isAddress(member)) {
      return { ok: false, error: '추가 구성원 주소 형식이 올바르지 않습니다.' };
    }

    const normalized = normalizeAddress(member);
    if (seen.has(normalized)) {
      return {
        ok: false,
        error:
          normalized === creator
            ? '생성자 주소는 자동 포함되므로 추가 구성원에 다시 넣을 수 없습니다.'
            : '중복된 구성원 주소가 있습니다.',
      };
    }

    seen.add(normalized);
    normalizedMembers.push(normalized);
  }

  const memberCount = normalizedMembers.length + 1;
  if (memberCount > MAX_DAO_MEMBER_COUNT) {
    return { ok: false, error: `구성원은 생성자 포함 최대 ${MAX_DAO_MEMBER_COUNT}명입니다.` };
  }

  return {
    ok: true,
    name,
    additionalMembers: normalizedMembers,
    approvalRule: input.approvalRule,
    memberCount,
  };
}

export function validateDepositEth(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false as const, error: '입금 금액을 입력하세요.' };
  }
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) {
    return { ok: false as const, error: 'ETH 금액은 최대 소수점 18자리까지 입력할 수 있습니다.' };
  }

  const wei = parseEtherToWei(trimmed);
  if (wei <= 0n) {
    return { ok: false as const, error: '0보다 큰 금액을 입력하세요.' };
  }

  return { ok: true as const, wei };
}

export type SpendingProposalInput = {
  daoAddress: string;
  proposer: string;
  title: string;
  description: string;
  amountEth: string;
  recipient: string;
  deadline: number;
  approvalType: ApprovalType;
};

export type SpendingProposalValidationResult =
  | {
      ok: true;
      amountWei: string;
      approvalType: ApprovalType;
      deadline: number;
      description: string;
      recipient: string;
      title: string;
    }
  | { ok: false; error: string };

export function validateSpendingProposalInput(
  input: SpendingProposalInput,
  nowMs = Date.now(),
): SpendingProposalValidationResult {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title) return { ok: false, error: '제안 제목을 입력하세요.' };
  if (!description) return { ok: false, error: '제안 설명을 입력하세요.' };
  if (!isAddress(input.daoAddress)) return { ok: false, error: 'DAO 주소가 올바르지 않습니다.' };
  if (!isAddress(input.proposer)) return { ok: false, error: '제안자 주소가 올바르지 않습니다.' };
  if (!isAddress(input.recipient)) return { ok: false, error: '수신자 주소가 올바르지 않습니다.' };
  if (![ApprovalType.Default, ApprovalType.Unanimous].includes(input.approvalType)) {
    return { ok: false, error: '승인 조건이 올바르지 않습니다.' };
  }

  const amount = validateDepositEth(input.amountEth);
  if (!amount.ok) return { ok: false, error: amount.error };
  if (!Number.isInteger(input.deadline) || input.deadline * 1000 <= nowMs) {
    return { ok: false, error: '투표 마감일은 현재 시각 이후여야 합니다.' };
  }

  return {
    ok: true,
    amountWei: amount.wei.toString(),
    approvalType: input.approvalType,
    deadline: input.deadline,
    description,
    recipient: normalizeAddress(input.recipient),
    title,
  };
}

export function parseEtherToWei(value: string) {
  const [whole, fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}

export function toQuantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

export function encodeCreateDaoCall(
  name: string,
  additionalMembers: string[],
  approvalRule: number,
) {
  const normalizedMembers = additionalMembers.map(normalizeAddress);
  const encodedName = encodeString(name);
  const encodedMembers = encodeAddressArray(normalizedMembers);
  const nameOffset = 32n * 3n;
  const membersOffset = nameOffset + BigInt(encodedName.length / 2);

  return [
    createDaoSelector,
    encodeUint(nameOffset),
    encodeUint(membersOffset),
    encodeUint(BigInt(approvalRule)),
    encodedName,
    encodedMembers,
  ].join('');
}

export function encodeCreateSpendingProposalCall(input: {
  amountWei: string;
  recipient: string;
  deadline: number;
  approvalType: ApprovalType;
  contentHash: string;
}) {
  return [
    createProposalSelector,
    encodeUint(BigInt(ProposalType.Spending)),
    encodeUint(BigInt(input.amountWei)),
    encodeAddress(input.recipient),
    encodeUint(BigInt(input.deadline)),
    encodeUint(BigInt(input.approvalType)),
    encodeBytes32(input.contentHash),
  ].join('');
}

export function encodeVoteCall(proposalId: string, support: boolean) {
  return `${voteSelector}${encodeUint(BigInt(proposalId))}${encodeUint(support ? 1n : 0n)}`;
}

export function encodeFinalizeProposalCall(proposalId: string) {
  return `${finalizeProposalSelector}${encodeUint(BigInt(proposalId))}`;
}

export function encodeCancelProposalCall(proposalId: string, cancelReasonHash: string) {
  return `${cancelProposalSelector}${encodeUint(BigInt(proposalId))}${encodeBytes32(
    cancelReasonHash,
  )}`;
}

export function encodeExecuteProposalCall(proposalId: string) {
  return `${executeProposalSelector}${encodeUint(BigInt(proposalId))}`;
}

export function encodeRegisterEvidenceHashCall(proposalId: string, evidenceHash: string) {
  return `${registerEvidenceHashSelector}${encodeUint(BigInt(proposalId))}${encodeBytes32(
    evidenceHash,
  )}`;
}

export function validateEvidenceRegistration(input: {
  currentAddress: string;
  proposalType?: ProposalType;
  proposalStatus?: number;
  proposer?: string;
}) {
  if (input.proposalType !== ProposalType.Spending) {
    return { ok: false as const, error: '지출 제안에만 증빙을 등록할 수 있습니다.' };
  }
  if (input.proposalStatus !== ProposalStatus.Executed) {
    return { ok: false as const, error: '집행 완료된 제안에만 증빙을 등록할 수 있습니다.' };
  }
  if (
    !input.proposer ||
    normalizeAddress(input.proposer) !== normalizeAddress(input.currentAddress)
  ) {
    return { ok: false as const, error: '제안자만 증빙을 등록할 수 있습니다.' };
  }

  return { ok: true as const };
}

export async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function encodeString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${encodeUint(BigInt(bytes.length))}${padRight(hex)}`;
}

function encodeAddressArray(addresses: string[]) {
  return `${encodeUint(BigInt(addresses.length))}${addresses.map(encodeAddress).join('')}`;
}

function encodeUint(value: bigint) {
  return value.toString(16).padStart(64, '0');
}

function encodeAddress(address: string) {
  return normalizeAddress(address).replace(/^0x/, '').padStart(64, '0');
}

function encodeBytes32(value: string) {
  const hex = value.toLowerCase().replace(/^0x/, '');
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error('bytes32 값이 올바르지 않습니다.');
  }

  return hex;
}

function padRight(hex: string) {
  const padding = (64 - (hex.length % 64)) % 64;
  return `${hex}${'0'.repeat(padding)}`;
}

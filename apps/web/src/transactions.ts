import { ApprovalRule, MAX_DAO_MEMBER_COUNT } from '@dao-budget/shared';

export const createDaoSelector = '0xa5daeb23';
export const depositSelector = '0xd0e30db0';

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

function encodeString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${encodeUint(BigInt(bytes.length))}${padRight(hex)}`;
}

function encodeAddressArray(addresses: string[]) {
  return `${encodeUint(BigInt(addresses.length))}${addresses
    .map((address) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0'))
    .join('')}`;
}

function encodeUint(value: bigint) {
  return value.toString(16).padStart(64, '0');
}

function padRight(hex: string) {
  const padding = (64 - (hex.length % 64)) % 64;
  return `${hex}${'0'.repeat(padding)}`;
}

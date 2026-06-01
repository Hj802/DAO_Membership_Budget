import { describe, expect, it } from 'vitest';
import { ApprovalRule, DaoStatus, MAX_DAO_MEMBER_COUNT, SEPOLIA_CHAIN_ID } from './index';

describe('shared constants', () => {
  it('matches the MVP network and policy constants', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
    expect(MAX_DAO_MEMBER_COUNT).toBe(20);
    expect(ApprovalRule.Majority).toBe(0);
    expect(DaoStatus.Terminated).toBe(2);
  });
});

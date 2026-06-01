import { describe, expect, it } from 'vitest';
import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

describe('web scaffold', () => {
  it('uses Sepolia as the default chain', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
  });
});

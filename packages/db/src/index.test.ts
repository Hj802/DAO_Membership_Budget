import { describe, expect, it } from 'vitest';
import { databasePackageName } from './index';

describe('db scaffold', () => {
  it('exports the db package marker', () => {
    expect(databasePackageName).toBe('@dao-budget/db');
  });
});

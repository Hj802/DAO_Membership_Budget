import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('api scaffold', () => {
  it('creates an express app', () => {
    const app = createApp();
    expect(app).toBeDefined();
  });
});

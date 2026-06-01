import { describe, expect, it } from 'vitest';
import { handleRequest } from './app';

describe('api scaffold', () => {
  it('responds to health checks with the Workers-compatible handler', async () => {
    const response = await handleRequest(new Request('https://api.example.test/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: 'dao-budget-api',
      runtime: 'cloudflare-workers',
      chainId: 11155111,
    });
  });

  it('handles CORS preflight requests', async () => {
    const response = await handleRequest(
      new Request('https://api.example.test/health', { method: 'OPTIONS' }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await handleRequest(new Request('https://api.example.test/unknown'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      error: 'Not found',
    });
  });
});

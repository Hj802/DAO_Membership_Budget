import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init.headers,
    },
  });
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders,
    });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({
      ok: true,
      service: 'dao-budget-api',
      runtime: 'cloudflare-workers',
      chainId: SEPOLIA_CHAIN_ID,
    });
  }

  return jsonResponse(
    {
      ok: false,
      error: 'Not found',
    },
    { status: 404 },
  );
}

export default {
  fetch: handleRequest,
};

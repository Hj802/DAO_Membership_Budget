import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

const maxSyncBlockRange = 500n;
const r2EvidenceBucketBinding = 'DAO_BUDGET_EVIDENCE_BUCKET';

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

export type ScheduledSyncEnvironment = {
  RPC_URL?: string;
  FACTORY_CONTRACT_ADDRESS?: string;
  DAO_BUDGET_DB?: unknown;
  DAO_BUDGET_EVIDENCE_BUCKET?: unknown;
};

export type ScheduledSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  chainId: number;
  maxBlockRange: string;
  r2Binding: string;
};

export async function handleScheduledSync(
  env: ScheduledSyncEnvironment = {},
): Promise<ScheduledSyncResult> {
  if (!env.RPC_URL || !env.FACTORY_CONTRACT_ADDRESS || !env.DAO_BUDGET_DB) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing-sync-bindings',
      chainId: SEPOLIA_CHAIN_ID,
      maxBlockRange: maxSyncBlockRange.toString(),
      r2Binding: r2EvidenceBucketBinding,
    };
  }

  return {
    ok: true,
    skipped: true,
    reason: 'sync-adapter-pending-phase-9',
    chainId: SEPOLIA_CHAIN_ID,
    maxBlockRange: maxSyncBlockRange.toString(),
    r2Binding: r2EvidenceBucketBinding,
  };
}

export default {
  fetch: handleRequest,
  scheduled: async (_event: unknown, env: ScheduledSyncEnvironment) => {
    await handleScheduledSync(env);
  },
};

import { ProposalStatus, ProposalType, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';
import { createD1Store, type D1DatabaseLike } from './d1-store';
import {
  API_ERROR,
  ApiError,
  type CancelReasonRecord,
  type EvidenceMetadataInput,
  type OffchainStore,
  type ProposalDetail,
  createEvidenceRecord,
  evidenceBytesFromBody,
  hashCancelReason,
  hashCanonicalProposal,
  proposalInputFromBody,
  requireMember,
  requireObject,
  requireString,
  sha256Hex,
  validateEvidenceMetadataInput,
} from './offchain';

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

export type ApiEnvironment = {
  store?: OffchainStore;
  DAO_BUDGET_DB?: D1DatabaseLike;
  DAO_BUDGET_EVIDENCE_BUCKET?: R2BucketLike;
};

export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

export async function handleRequest(request: Request, env: ApiEnvironment = {}): Promise<Response> {
  try {
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

    const store = env.store ?? (env.DAO_BUDGET_DB ? createD1Store(env.DAO_BUDGET_DB) : undefined);

    if (request.method === 'POST' && url.pathname === '/proposal-details/hash') {
      const proposalInput = proposalInputFromBody(await request.json());
      return jsonResponse({
        ok: true,
        ...hashCanonicalProposal(proposalInput),
      });
    }

    if (request.method === 'POST' && url.pathname === '/proposal-details') {
      assertStore(store);
      const body = requireObject(await request.json());
      const proposalInput = proposalInputFromBody(body);
      const dao = await requireDao(store, proposalInput.daoAddress);
      requireMember(dao, proposalInput.proposer);

      const { contentHash, canonicalJson } = hashCanonicalProposal(proposalInput);
      if (body.contentHash && String(body.contentHash).toLowerCase() !== contentHash) {
        throw new ApiError(
          400,
          API_ERROR.BAD_REQUEST,
          'contentHash does not match proposal detail.',
        );
      }

      const detail: ProposalDetail = {
        ...proposalInput,
        proposalId: requireString(body.proposalId, 'proposalId'),
        contentHash,
        createdAt: new Date().toISOString(),
        status: ProposalStatus.Voting,
      };

      await store.saveProposalDetail(detail);

      return jsonResponse({ ok: true, detail, canonicalJson, contentHash }, { status: 201 });
    }

    if (request.method === 'POST' && url.pathname === '/cancel-reasons/hash') {
      const body = requireObject(await request.json());
      const cancelReason = requireString(body.cancelReason, 'cancelReason');

      return jsonResponse({
        ok: true,
        cancelReasonHash: hashCancelReason(cancelReason),
      });
    }

    if (request.method === 'POST' && url.pathname === '/cancel-reasons') {
      assertStore(store);
      const body = requireObject(await request.json());
      const daoAddress = requireString(body.daoAddress, 'daoAddress');
      const canceledBy = requireString(body.canceledBy, 'canceledBy');
      const dao = await requireDao(store, daoAddress);
      requireMember(dao, canceledBy);

      const cancelReason = requireString(body.cancelReason, 'cancelReason');
      const cancelReasonHash = hashCancelReason(cancelReason);
      if (
        body.cancelReasonHash &&
        String(body.cancelReasonHash).toLowerCase() !== cancelReasonHash
      ) {
        throw new ApiError(
          400,
          API_ERROR.BAD_REQUEST,
          'cancelReasonHash does not match cancel reason.',
        );
      }

      const record: CancelReasonRecord = {
        daoAddress: dao.daoAddress,
        proposalId: requireString(body.proposalId, 'proposalId'),
        cancelReason,
        cancelReasonHash,
        canceledBy,
        canceledAt: new Date().toISOString(),
      };
      await store.saveCancelReason(record);

      return jsonResponse({ ok: true, record }, { status: 201 });
    }

    if (request.method === 'POST' && url.pathname === '/evidence/hash') {
      return jsonResponse({
        ok: true,
        contentHash: await sha256Hex(evidenceBytesFromBody(await request.json())),
      });
    }

    if (request.method === 'POST' && url.pathname === '/evidence-files') {
      assertStore(store);
      const body = requireObject(await request.json());
      const input = validateEvidenceMetadataInput(body as EvidenceMetadataInput);
      const dao = await requireDao(store, input.daoAddress);
      const uploader = requireMember(dao, input.uploader);
      const proposal = await requireProposal(store, input.daoAddress, input.proposalId);

      if (
        proposal.proposer.toLowerCase() !== uploader ||
        proposal.proposalType !== ProposalType.Spending ||
        proposal.status !== ProposalStatus.Executed
      ) {
        throw new ApiError(
          403,
          API_ERROR.FORBIDDEN,
          'Evidence can only be registered by the proposer of an executed spending proposal.',
        );
      }

      const record = createEvidenceRecord(input);
      if (body.fileBase64 && env.DAO_BUDGET_EVIDENCE_BUCKET) {
        await env.DAO_BUDGET_EVIDENCE_BUCKET.put(record.r2ObjectKey, evidenceBytesFromBody(body), {
          httpMetadata: {
            contentType: record.mimeType,
          },
        });
      }
      await store.saveEvidenceFile(record);

      return jsonResponse({ ok: true, record }, { status: 201 });
    }

    if (request.method === 'GET' && url.pathname === '/daos') {
      assertStore(store);
      const member = requireString(url.searchParams.get('member'), 'member');
      return jsonResponse({ ok: true, daos: await store.listDaosByMember(member) });
    }

    const daoDetailMatch = url.pathname.match(/^\/daos\/([^/]+)$/);
    if (request.method === 'GET' && daoDetailMatch) {
      assertStore(store);
      const member = requireString(url.searchParams.get('member'), 'member');
      const dao = await requireDao(store, daoDetailMatch[1]);
      requireMember(dao, member);
      return jsonResponse({ ok: true, dao });
    }

    const proposalDetailMatch = url.pathname.match(/^\/daos\/([^/]+)\/proposals\/([^/]+)$/);
    if (request.method === 'GET' && proposalDetailMatch) {
      assertStore(store);
      const member = requireString(url.searchParams.get('member'), 'member');
      const dao = await requireDao(store, proposalDetailMatch[1]);
      requireMember(dao, member);
      const proposal = await requireProposal(store, proposalDetailMatch[1], proposalDetailMatch[2]);
      const evidence = await store.listEvidenceFiles(
        proposalDetailMatch[1],
        proposalDetailMatch[2],
      );

      return jsonResponse({ ok: true, proposal, evidence });
    }

    if (request.method === 'GET' && url.pathname === '/budget-history') {
      assertStore(store);
      const daoAddress = requireString(url.searchParams.get('daoAddress'), 'daoAddress');
      const member = requireString(url.searchParams.get('member'), 'member');
      const dao = await requireDao(store, daoAddress);
      requireMember(dao, member);

      return jsonResponse({ ok: true, transactions: await store.listTransactionLogs(daoAddress) });
    }

    return jsonResponse(
      {
        ok: false,
        error: 'Not found',
      },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(
        {
          ok: false,
          code: error.code,
          error: error.message,
        },
        { status: error.status },
      );
    }

    throw error;
  }
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
    reason: 'sync-adapter-pending-rpc-event-source',
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

function assertStore(store: OffchainStore | undefined): asserts store is OffchainStore {
  if (!store) {
    throw new ApiError(503, API_ERROR.MISSING_BINDING, 'API data store binding is not configured.');
  }
}

async function requireDao(store: OffchainStore, daoAddress: string) {
  const dao = await store.getDaoDetail(daoAddress);
  if (!dao) {
    throw new ApiError(404, API_ERROR.NOT_FOUND, 'DAO not found.');
  }

  return dao;
}

async function requireProposal(store: OffchainStore, daoAddress: string, proposalId: string) {
  const proposal = await store.getProposalDetail(daoAddress, proposalId);
  if (!proposal) {
    throw new ApiError(404, API_ERROR.NOT_FOUND, 'Proposal not found.');
  }

  return proposal;
}

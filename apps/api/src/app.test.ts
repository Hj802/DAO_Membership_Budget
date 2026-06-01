import { describe, expect, it } from 'vitest';
import { ProposalStatus, ProposalType } from '@dao-budget/shared';
import { handleRequest, handleScheduledSync } from './app';
import type {
  CancelReasonRecord,
  DaoDetail,
  DaoSummary,
  EvidenceFileRecord,
  OffchainStore,
  ProposalDetail,
  TransactionLog,
} from './offchain';

class MemoryStore implements OffchainStore {
  daos = new Map<string, DaoDetail>();
  proposals = new Map<string, ProposalDetail>();
  cancellations = new Map<string, CancelReasonRecord>();
  evidence = new Map<string, EvidenceFileRecord[]>();
  transactions = new Map<string, TransactionLog[]>();

  async listDaosByMember(memberAddress: string): Promise<DaoSummary[]> {
    const normalized = memberAddress.toLowerCase();
    return [...this.daos.values()]
      .filter((dao) => dao.members.map((member) => member.toLowerCase()).includes(normalized))
      .map(({ proposals: _proposals, members: _members, ...summary }) => summary);
  }

  async getDaoDetail(daoAddress: string) {
    return this.daos.get(daoAddress.toLowerCase()) ?? null;
  }

  async getProposalDetail(daoAddress: string, proposalId: string) {
    return this.proposals.get(`${daoAddress.toLowerCase()}:${proposalId}`) ?? null;
  }

  async saveProposalDetail(detail: ProposalDetail) {
    this.proposals.set(`${detail.daoAddress}:${detail.proposalId}`, detail);
    const dao = this.daos.get(detail.daoAddress);
    if (dao) {
      dao.proposals = [
        ...dao.proposals.filter((proposal) => proposal.proposalId !== detail.proposalId),
        detail,
      ];
    }
  }

  async saveCancelReason(record: CancelReasonRecord) {
    this.cancellations.set(`${record.daoAddress.toLowerCase()}:${record.proposalId}`, record);
  }

  async listTransactionLogs(daoAddress: string) {
    return this.transactions.get(daoAddress.toLowerCase()) ?? [];
  }

  async listEvidenceFiles(daoAddress: string, proposalId: string) {
    return this.evidence.get(`${daoAddress.toLowerCase()}:${proposalId}`) ?? [];
  }

  async saveEvidenceFile(record: EvidenceFileRecord) {
    const key = `${record.daoAddress}:${record.proposalId}`;
    this.evidence.set(key, [...(this.evidence.get(key) ?? []), record]);
  }
}

describe('api scaffold', () => {
  const daoAddress = '0xda00000000000000000000000000000000000001';
  const creator = '0xc000000000000000000000000000000000000001';
  const member = '0xc000000000000000000000000000000000000002';
  const outsider = '0xc000000000000000000000000000000000000099';

  function createStore() {
    const store = new MemoryStore();
    const dao: DaoDetail = {
      daoAddress,
      name: 'Blockchain Club',
      status: 0,
      memberCount: 2,
      approvalRule: 0,
      createdAt: '2026-06-02T00:00:00.000Z',
      members: [creator, member],
      proposals: [],
    };
    const proposal: ProposalDetail = {
      schemaVersion: 1,
      chainId: 11155111,
      daoAddress,
      proposalType: ProposalType.Spending,
      proposer: creator,
      title: 'Snacks',
      description: 'Buy snacks for meetup',
      amountWei: '100',
      recipient: member,
      deadline: 1_800_000_000,
      approvalType: 0,
      proposalId: '1',
      contentHash: '0xcontent',
      createdAt: '2026-06-02T00:00:00.000Z',
      status: ProposalStatus.Executed,
    };

    dao.proposals.push(proposal);
    store.daos.set(daoAddress, dao);
    store.proposals.set(`${daoAddress}:1`, proposal);
    store.transactions.set(daoAddress, [
      {
        txHash: '0xtx',
        logIndex: 0,
        daoAddress,
        proposalId: '1',
        eventType: 'ProposalExecuted',
        actor: member,
        amountWei: '100',
        status: 'executed',
        blockNumber: '123',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
    ]);

    return store;
  }

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

  it('creates canonical proposal JSON and stores proposal details with matching content hash', async () => {
    const store = createStore();
    const body = {
      schemaVersion: 1,
      chainId: 11155111,
      daoAddress,
      proposalType: ProposalType.Termination,
      proposer: creator,
      title: 'Close DAO',
      description: 'Return the remaining vault balance equally.',
      amountWei: null,
      recipient: null,
      deadline: 1_800_000_001,
      approvalType: 0,
      proposalId: '2',
    };
    const hashResponse = await handleRequest(
      new Request('https://api.example.test/proposal-details/hash', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    const hashBody = await hashResponse.json();

    expect(hashBody.canonicalJson).toBe(
      '{"amountWei":null,"approvalType":0,"chainId":11155111,"daoAddress":"0xda00000000000000000000000000000000000001","deadline":1800000001,"description":"Return the remaining vault balance equally.","proposalType":1,"proposer":"0xc000000000000000000000000000000000000001","recipient":null,"schemaVersion":1,"title":"Close DAO"}',
    );
    expect(hashBody.contentHash).toMatch(/^0x[a-f0-9]{64}$/);

    const response = await handleRequest(
      new Request('https://api.example.test/proposal-details', {
        method: 'POST',
        body: JSON.stringify({ ...body, contentHash: hashBody.contentHash }),
      }),
      { store },
    );
    const responseBody = await response.json();

    expect(response.status).toBe(201);
    expect(responseBody.detail.amountWei).toBeNull();
    expect(responseBody.detail.recipient).toBeNull();
    expect(await store.getProposalDetail(daoAddress, '2')).toMatchObject({
      proposalId: '2',
      contentHash: hashBody.contentHash,
    });
  });

  it('stores cancel reasons only for DAO members and validates the reason hash', async () => {
    const store = createStore();
    const hashResponse = await handleRequest(
      new Request('https://api.example.test/cancel-reasons/hash', {
        method: 'POST',
        body: JSON.stringify({ cancelReason: 'Wrong amount' }),
      }),
    );
    const hashBody = await hashResponse.json();

    const response = await handleRequest(
      new Request('https://api.example.test/cancel-reasons', {
        method: 'POST',
        body: JSON.stringify({
          daoAddress,
          proposalId: '1',
          canceledBy: creator,
          cancelReason: 'Wrong amount',
          cancelReasonHash: hashBody.cancelReasonHash,
        }),
      }),
      { store },
    );

    expect(response.status).toBe(201);
    expect(store.cancellations.get(`${daoAddress}:1`)?.cancelReasonHash).toBe(
      hashBody.cancelReasonHash,
    );

    const forbidden = await handleRequest(
      new Request('https://api.example.test/cancel-reasons', {
        method: 'POST',
        body: JSON.stringify({
          daoAddress,
          proposalId: '1',
          canceledBy: outsider,
          cancelReason: 'Wrong amount',
        }),
      }),
      { store },
    );

    expect(forbidden.status).toBe(403);
  });

  it('hashes evidence bytes and stores only R2 metadata for executed spending proposals', async () => {
    const store = createStore();
    const uploadedObjects = new Map<string, Uint8Array>();
    const hashResponse = await handleRequest(
      new Request('https://api.example.test/evidence/hash', {
        method: 'POST',
        body: JSON.stringify({ fileBase64: Buffer.from('receipt').toString('base64') }),
      }),
    );
    const hashBody = await hashResponse.json();

    expect(hashBody.contentHash).toMatch(/^0x[a-f0-9]{64}$/);

    const response = await handleRequest(
      new Request('https://api.example.test/evidence-files', {
        method: 'POST',
        body: JSON.stringify({
          daoAddress,
          proposalId: '1',
          uploader: creator,
          evidenceType: 'receipt',
          fileName: 'receipt photo.png',
          mimeType: 'image/png',
          fileSize: 7,
          description: 'Receipt photo',
          contentHash: hashBody.contentHash,
          fileBase64: Buffer.from('receipt').toString('base64'),
        }),
      }),
      {
        store,
        DAO_BUDGET_EVIDENCE_BUCKET: {
          async put(key, value) {
            uploadedObjects.set(key, value);
          },
        },
      },
    );
    const responseBody = await response.json();

    expect(response.status).toBe(201);
    expect(responseBody.record.r2ObjectKey).toContain(`dao/${daoAddress}/proposal/1/evidence/`);
    expect(responseBody.record.r2ObjectKey).toContain('/receipt_photo.png');
    expect(responseBody.record).not.toHaveProperty('fileBase64');
    expect(uploadedObjects.get(responseBody.record.r2ObjectKey)).toEqual(
      Uint8Array.from(Buffer.from('receipt')),
    );

    const forbidden = await handleRequest(
      new Request('https://api.example.test/evidence-files', {
        method: 'POST',
        body: JSON.stringify({
          daoAddress,
          proposalId: '1',
          uploader: member,
          evidenceType: 'receipt',
          fileName: 'receipt.png',
          mimeType: 'image/png',
          fileSize: 7,
          contentHash: hashBody.contentHash,
        }),
      }),
      { store },
    );

    expect(forbidden.status).toBe(403);
  });

  it('allows only DAO members to query DAO details, proposal details, evidence, and budget history', async () => {
    const store = createStore();
    await store.saveEvidenceFile({
      evidenceId: 'e1',
      daoAddress,
      proposalId: '1',
      uploader: creator,
      evidenceType: 'receipt',
      r2ObjectKey: 'dao/x/proposal/1/evidence/e1/receipt.png',
      mimeType: 'image/png',
      fileSize: 7,
      description: null,
      contentHash: '0x' + 'a'.repeat(64),
      createdAt: '2026-06-02T00:00:00.000Z',
    });

    const list = await handleRequest(
      new Request(`https://api.example.test/daos?member=${creator}`),
      { store },
    );
    expect((await list.json()).daos).toHaveLength(1);

    const detail = await handleRequest(
      new Request(`https://api.example.test/daos/${daoAddress}?member=${creator}`),
      { store },
    );
    expect(detail.status).toBe(200);

    const proposal = await handleRequest(
      new Request(`https://api.example.test/daos/${daoAddress}/proposals/1?member=${creator}`),
      { store },
    );
    const proposalBody = await proposal.json();
    expect(proposalBody.evidence).toHaveLength(1);

    const history = await handleRequest(
      new Request(
        `https://api.example.test/budget-history?daoAddress=${daoAddress}&member=${creator}`,
      ),
      { store },
    );
    expect((await history.json()).transactions).toHaveLength(1);

    const forbidden = await handleRequest(
      new Request(`https://api.example.test/daos/${daoAddress}?member=${outsider}`),
      { store },
    );
    expect(forbidden.status).toBe(403);
  });

  it('returns a clear error when API storage binding is missing', async () => {
    const response = await handleRequest(
      new Request(`https://api.example.test/daos?member=${creator}`),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe('MISSING_BINDING');
  });

  it('exposes a Workers Cron sync entrypoint with Cloudflare binding metadata', async () => {
    await expect(handleScheduledSync()).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: 'missing-sync-bindings',
      chainId: 11155111,
      maxBlockRange: '500',
      r2Binding: 'DAO_BUDGET_EVIDENCE_BUCKET',
    });
  });
});

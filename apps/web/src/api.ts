import { ApprovalType, DaoStatus, ProposalType } from '@dao-budget/shared';

export type DaoSummary = {
  daoAddress: string;
  name: string;
  status: DaoStatus;
  memberCount: number;
  approvalRule: number;
  createdAt: string;
  balanceEth?: string;
  activeProposalCount?: number;
};

export type DaoListResponse = {
  ok: boolean;
  daos: DaoSummary[];
};

export type ProposalDetail = {
  schemaVersion?: number;
  chainId?: number;
  daoAddress?: string;
  proposalType?: ProposalType;
  proposer?: string;
  proposalId: string;
  title: string;
  description?: string;
  amountWei: string | null;
  recipient?: string | null;
  status?: number;
  deadline: number;
  approvalType?: ApprovalType;
  contentHash?: string;
  createdAt?: string;
};

export type DaoDetail = DaoSummary & {
  members: string[];
  proposals: ProposalDetail[];
};

export type TransactionLog = {
  txHash: string;
  logIndex: number;
  daoAddress: string;
  proposalId: string | null;
  eventType: string;
  actor: string | null;
  amountWei: string | null;
  status: string;
  blockNumber: string;
  createdAt: string;
};

export type ApiClient = {
  listMyDaos(memberAddress: string): Promise<DaoSummary[]>;
  getDaoDetail(daoAddress: string, memberAddress: string): Promise<DaoDetail>;
  listBudgetHistory(daoAddress: string, memberAddress: string): Promise<TransactionLog[]>;
  hashProposal(input: ProposalHashInput): Promise<ProposalHashResult>;
  saveProposalDetail(
    input: ProposalHashInput & { proposalId: string; contentHash: string },
  ): Promise<void>;
  hashCancelReason(cancelReason: string): Promise<string>;
};

export type ProposalHashInput = {
  schemaVersion: number;
  chainId: number;
  daoAddress: string;
  proposalType: ProposalType;
  proposer: string;
  title: string;
  description: string;
  amountWei: string | null;
  recipient: string | null;
  deadline: number;
  approvalType: ApprovalType;
};

export type ProposalHashResult = {
  canonicalJson: string;
  contentHash: string;
};

const defaultApiBaseUrl = 'http://127.0.0.1:4000';

export function createApiClient(
  baseUrl = import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl,
): ApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return {
    async listMyDaos(memberAddress: string) {
      const response = await fetch(
        `${normalizedBaseUrl}/daos?member=${encodeURIComponent(memberAddress)}`,
      );
      const body = (await response.json()) as Partial<DaoListResponse> & {
        error?: string;
      };

      if (!response.ok || body.ok === false || !Array.isArray(body.daos)) {
        throw new Error(body.error ?? 'DAO 목록을 불러오지 못했습니다.');
      }

      return body.daos;
    },

    async getDaoDetail(daoAddress: string, memberAddress: string) {
      const response = await fetch(
        `${normalizedBaseUrl}/daos/${encodeURIComponent(daoAddress)}?member=${encodeURIComponent(
          memberAddress,
        )}`,
      );
      const body = (await response.json()) as {
        ok?: boolean;
        dao?: DaoDetail;
        error?: string;
      };

      if (!response.ok || body.ok === false || !body.dao) {
        throw new Error(body.error ?? 'DAO 상세 정보를 불러오지 못했습니다.');
      }

      return body.dao;
    },

    async listBudgetHistory(daoAddress: string, memberAddress: string) {
      const response = await fetch(
        `${normalizedBaseUrl}/budget-history?daoAddress=${encodeURIComponent(
          daoAddress,
        )}&member=${encodeURIComponent(memberAddress)}`,
      );
      const body = (await response.json()) as {
        ok?: boolean;
        transactions?: TransactionLog[];
        error?: string;
      };

      if (!response.ok || body.ok === false || !Array.isArray(body.transactions)) {
        throw new Error(body.error ?? '예산 내역을 불러오지 못했습니다.');
      }

      return body.transactions;
    },

    async hashProposal(input: ProposalHashInput) {
      const response = await fetch(`${normalizedBaseUrl}/proposal-details/hash`, {
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body = (await response.json()) as Partial<ProposalHashResult> & {
        error?: string;
        ok?: boolean;
      };

      if (!response.ok || body.ok === false || !body.canonicalJson || !body.contentHash) {
        throw new Error(body.error ?? '제안 해시를 생성하지 못했습니다.');
      }

      return {
        canonicalJson: body.canonicalJson,
        contentHash: body.contentHash,
      };
    },

    async saveProposalDetail(input) {
      const response = await fetch(`${normalizedBaseUrl}/proposal-details`, {
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body = (await response.json()) as {
        error?: string;
        ok?: boolean;
      };

      if (!response.ok || body.ok === false) {
        throw new Error(body.error ?? '제안 상세 정보를 저장하지 못했습니다.');
      }
    },

    async hashCancelReason(cancelReason: string) {
      const response = await fetch(`${normalizedBaseUrl}/cancel-reasons/hash`, {
        body: JSON.stringify({ cancelReason }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body = (await response.json()) as {
        cancelReasonHash?: string;
        error?: string;
        ok?: boolean;
      };

      if (!response.ok || body.ok === false || !body.cancelReasonHash) {
        throw new Error(body.error ?? '취소 사유 해시를 생성하지 못했습니다.');
      }

      return body.cancelReasonHash;
    },
  };
}

export function filterDaosByStatus(daos: DaoSummary[], filter: 'active' | 'terminated') {
  return daos.filter((dao) =>
    filter === 'active' ? dao.status !== DaoStatus.Terminated : dao.status === DaoStatus.Terminated,
  );
}

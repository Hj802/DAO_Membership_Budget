import { DaoStatus } from '@dao-budget/shared';

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
  proposalId: string;
  title: string;
  amountWei: string | null;
  status?: number;
  deadline: number;
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
  };
}

export function filterDaosByStatus(daos: DaoSummary[], filter: 'active' | 'terminated') {
  return daos.filter((dao) =>
    filter === 'active' ? dao.status !== DaoStatus.Terminated : dao.status === DaoStatus.Terminated,
  );
}

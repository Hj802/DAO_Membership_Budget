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

export type ApiClient = {
  listMyDaos(memberAddress: string): Promise<DaoSummary[]>;
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
  };
}

export function filterDaosByStatus(daos: DaoSummary[], filter: 'active' | 'terminated') {
  return daos.filter((dao) =>
    filter === 'active' ? dao.status !== DaoStatus.Terminated : dao.status === DaoStatus.Terminated,
  );
}

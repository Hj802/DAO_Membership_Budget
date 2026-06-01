import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaoStatus, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';
import { createApiClient, filterDaosByStatus, type DaoSummary } from './api';
import { ConnectedLayout, DisconnectedView } from './App';
import { blockExplorerAddressUrl, formatAddress, isSepolia } from './wallet';

const memberAddress = '0xc000000000000000000000000000000000000001';

const daos: DaoSummary[] = [
  {
    daoAddress: '0xda00000000000000000000000000000000000001',
    name: '블록체인 스터디',
    status: DaoStatus.Active,
    memberCount: 12,
    approvalRule: 0,
    createdAt: '2026-06-02T00:00:00.000Z',
    balanceEth: '1.82',
    activeProposalCount: 2,
  },
  {
    daoAddress: '0xda00000000000000000000000000000000000002',
    name: '종료된 모임',
    status: DaoStatus.Terminated,
    memberCount: 5,
    approvalRule: 1,
    createdAt: '2026-06-02T00:00:00.000Z',
    balanceEth: '0',
    activeProposalCount: 0,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('phase 10 web UI', () => {
  it('renders the wallet connection gate without DAO details before connection', () => {
    const html = renderToStaticMarkup(
      <DisconnectedView error={null} isConnecting={false} onConnect={() => undefined} />,
    );

    expect(html).toContain('지갑 연결');
    expect(html).toContain('비구성원은 DAO 상세');
    expect(html).not.toContain('내 DAO 목록');
    expect(html).not.toContain('블록체인 스터디');
  });

  it('renders connected wallet state, Sepolia status, and only the active DAO filter result', () => {
    const html = renderToStaticMarkup(
      <ConnectedLayout
        address={memberAddress}
        chainId={SEPOLIA_CHAIN_ID}
        daos={daos}
        daoError={null}
        daoFilter="active"
        isLoadingDaos={false}
        onFilterChange={() => undefined}
        onSwitchNetwork={() => undefined}
        selectedDao={daos[0]}
        walletError={null}
      />,
    );

    expect(html).toContain('내 DAO 목록');
    expect(html).toContain('Sepolia');
    expect(html).toContain(formatAddress(memberAddress));
    expect(html).toContain('블록체인 스터디');
    expect(html).not.toContain('종료된 모임');
  });

  it('renders a clear network warning when the connected chain is not Sepolia', () => {
    const html = renderToStaticMarkup(
      <ConnectedLayout
        address={memberAddress}
        chainId={1}
        daos={daos}
        daoError={null}
        daoFilter="active"
        isLoadingDaos={false}
        onFilterChange={() => undefined}
        onSwitchNetwork={() => undefined}
        selectedDao={daos[0]}
        walletError={null}
      />,
    );

    expect(html).toContain('현재 네트워크가 Sepolia가 아닙니다');
    expect(html).toContain(String(SEPOLIA_CHAIN_ID));
    expect(html).toContain('네트워크 변경');
  });

  it('filters DAO summaries by active and terminated status', () => {
    expect(filterDaosByStatus(daos, 'active').map((dao) => dao.name)).toEqual(['블록체인 스터디']);
    expect(filterDaosByStatus(daos, 'terminated').map((dao) => dao.name)).toEqual(['종료된 모임']);
  });

  it('builds Sepolia block explorer links for wallet and DAO addresses', () => {
    expect(isSepolia(SEPOLIA_CHAIN_ID)).toBe(true);
    expect(isSepolia(1)).toBe(false);
    expect(blockExplorerAddressUrl(memberAddress)).toBe(
      `https://sepolia.etherscan.io/address/${memberAddress}`,
    );
  });

  it('loads the connected member DAO list from the API client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, daos: [daos[0]] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );

    await expect(
      createApiClient('https://api.example.test').listMyDaos(memberAddress),
    ).resolves.toEqual([daos[0]]);
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example.test/daos?member=${memberAddress}`);
  });
});

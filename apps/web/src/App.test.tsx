import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalRule, DaoStatus, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';
import { createApiClient, filterDaosByStatus, type DaoSummary } from './api';
import { ConnectedLayout, DisconnectedView } from './App';
import {
  createDaoSelector,
  depositSelector,
  encodeCreateDaoCall,
  toQuantityHex,
  validateCreateDaoInput,
  validateDepositEth,
} from './transactions';
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

function renderConnectedLayout(overrides: Partial<Parameters<typeof ConnectedLayout>[0]> = {}) {
  return renderToStaticMarkup(
    <ConnectedLayout
      address={memberAddress}
      budgetHistory={[]}
      chainId={SEPOLIA_CHAIN_ID}
      daoDetail={null}
      daoError={null}
      daoFilter="active"
      daos={daos}
      isLoadingDaos={false}
      isLoadingDetail={false}
      onCreateDao={async () => undefined}
      onDeposit={async () => undefined}
      onFilterChange={() => undefined}
      onRefresh={() => undefined}
      onSelectDao={() => undefined}
      onSwitchNetwork={() => undefined}
      onViewChange={() => undefined}
      selectedDao={daos[0]}
      txState={{ status: 'idle', message: '' }}
      view="list"
      walletError={null}
      {...overrides}
    />,
  );
}

describe('phase 10 and 11 web UI', () => {
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
    const html = renderConnectedLayout();

    expect(html).toContain('내 DAO 목록');
    expect(html).toContain('Sepolia');
    expect(html).toContain(formatAddress(memberAddress));
    expect(html).toContain('블록체인 스터디');
    expect(html).not.toContain('종료된 모임');
  });

  it('renders a clear network warning when the connected chain is not Sepolia', () => {
    const html = renderConnectedLayout({ chainId: 1 });

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

  it('renders the DAO creation form with creator auto-inclusion and approval rule choices', () => {
    const html = renderConnectedLayout({ view: 'create' });

    expect(html).toContain('DAO 생성');
    expect(html).toContain('생성자 자동 포함');
    expect(html).toContain(formatAddress(memberAddress));
    expect(html).toContain('과반 찬성');
    expect(html).toContain('2/3 찬성');
  });

  it('validates DAO creation form inputs, duplicate members, and the 20 member limit', () => {
    expect(
      validateCreateDaoInput({
        creatorAddress: memberAddress,
        name: '',
        additionalMembers: [],
        approvalRule: ApprovalRule.Majority,
      }),
    ).toMatchObject({ ok: false, error: '조직명을 입력하세요.' });

    expect(
      validateCreateDaoInput({
        creatorAddress: memberAddress,
        name: 'Duplicate Creator',
        additionalMembers: [memberAddress],
        approvalRule: ApprovalRule.Majority,
      }),
    ).toMatchObject({ ok: false });

    expect(
      validateCreateDaoInput({
        creatorAddress: memberAddress,
        name: 'Too Many',
        additionalMembers: Array.from(
          { length: 20 },
          (_, index) => `0x${(100 + index).toString(16).padStart(40, '0')}`,
        ),
        approvalRule: ApprovalRule.Majority,
      }),
    ).toMatchObject({ ok: false });
  });

  it('encodes createDAO and deposit transaction payloads without an external wallet library', () => {
    const encoded = encodeCreateDaoCall(
      '블록체인 스터디',
      ['0xc000000000000000000000000000000000000002'],
      ApprovalRule.TwoThirds,
    );

    expect(encoded.startsWith(createDaoSelector)).toBe(true);
    expect(encoded).toContain('c000000000000000000000000000000000000002');
    expect(depositSelector).toBe('0xd0e30db0');
  });

  it('validates deposit amounts and converts ETH to transaction quantity hex', () => {
    expect(validateDepositEth('0')).toMatchObject({ ok: false });
    const result = validateDepositEth('0.1');

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && toQuantityHex(result.wei)).toBe('0x16345785d8a0000');
  });

  it('renders the dashboard and hides deposit action for terminated DAOs', () => {
    const html = renderConnectedLayout({
      selectedDao: daos[1],
      view: 'dashboard',
    });

    expect(html).toContain('종료 상태의 DAO에서는 입금할 수 없습니다.');
    expect(html).toContain('disabled=""');
  });
});

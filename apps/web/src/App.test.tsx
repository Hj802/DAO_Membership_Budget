import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApprovalRule,
  ApprovalType,
  DaoStatus,
  ProposalStatus,
  ProposalType,
  SEPOLIA_CHAIN_ID,
} from '@dao-budget/shared';
import {
  createApiClient,
  filterDaosByStatus,
  type DaoDetail,
  type EvidenceFileRecord,
  type DaoSummary,
  type TransactionLog,
} from './api';
import { ConnectedLayout, DisconnectedView } from './App';
import {
  cancelProposalSelector,
  createDaoSelector,
  createProposalSelector,
  depositSelector,
  encodeCancelProposalCall,
  encodeCreateDaoCall,
  encodeCreateSpendingProposalCall,
  encodeCreateTerminationProposalCall,
  encodeExecuteProposalCall,
  encodeExecuteTerminationCall,
  encodeFinalizeProposalCall,
  encodeRegisterEvidenceHashCall,
  encodeVoteCall,
  executeProposalSelector,
  executeTerminationSelector,
  finalizeProposalSelector,
  registerEvidenceHashSelector,
  toQuantityHex,
  validateCreateDaoInput,
  validateDepositEth,
  validateEvidenceRegistration,
  validateSpendingProposalInput,
  validateTerminationProposalInput,
  voteSelector,
} from './transactions';
import { blockExplorerAddressUrl, blockExplorerTxUrl, formatAddress, isSepolia } from './wallet';

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

const votingDeadline = Math.floor(Date.now() / 1000) + 3600;
const closedDeadline = Math.floor(Date.now() / 1000) - 3600;

const daoDetail: DaoDetail = {
  ...daos[0],
  members: [memberAddress, '0xc000000000000000000000000000000000000002'],
  proposals: [
    {
      proposalId: '1',
      title: 'MT 숙소 예약비',
      description: '숙소 예약금을 지출합니다.',
      proposalType: ProposalType.Spending,
      amountWei: '500000000000000000',
      recipient: '0xc000000000000000000000000000000000000002',
      proposer: memberAddress,
      status: ProposalStatus.Voting,
      deadline: votingDeadline,
      approvalType: ApprovalType.Unanimous,
      contentHash: `0x${'a'.repeat(64)}`,
    },
    {
      proposalId: '2',
      title: '서버비',
      description: '클라우드 서버비를 지출합니다.',
      proposalType: ProposalType.Spending,
      amountWei: '100000000000000000',
      recipient: '0xc000000000000000000000000000000000000002',
      proposer: '0xc000000000000000000000000000000000000002',
      status: ProposalStatus.Executable,
      deadline: closedDeadline,
      approvalType: ApprovalType.Default,
      contentHash: `0x${'b'.repeat(64)}`,
    },
  ],
};

const terminationDaoDetail: DaoDetail = {
  ...daos[0],
  status: DaoStatus.TerminationVoting,
  proposals: [
    {
      proposalId: '5',
      title: 'DAO termination',
      description: 'Return remaining vault balance to members and close the DAO.',
      proposalType: ProposalType.Termination,
      amountWei: null,
      recipient: null,
      proposer: memberAddress,
      status: ProposalStatus.Executable,
      deadline: closedDeadline,
      approvalType: ApprovalType.Default,
      contentHash: `0x${'f'.repeat(64)}`,
    },
  ],
  members: [memberAddress, '0xc000000000000000000000000000000000000002'],
};

const emptyProposalDaoDetail: DaoDetail = {
  ...daos[0],
  activeProposalCount: 0,
  proposals: [],
  members: [memberAddress, '0xc000000000000000000000000000000000000002'],
};

const voteHistory: TransactionLog[] = [
  {
    txHash: '0xvote',
    logIndex: 0,
    daoAddress: daos[0].daoAddress,
    proposalId: '1',
    eventType: 'VoteCast',
    actor: memberAddress,
    amountWei: null,
    status: 'vote:yes',
    blockNumber: '1',
    createdAt: '2026-06-02T00:00:00.000Z',
  },
];

const phase13History: TransactionLog[] = [
  {
    txHash: '0xdeposit',
    logIndex: 0,
    daoAddress: daos[0].daoAddress,
    proposalId: null,
    eventType: 'DepositReceived',
    actor: memberAddress,
    amountWei: '1000000000000000000',
    status: 'deposit',
    blockNumber: '1',
    createdAt: '2026-06-02T00:00:00.000Z',
  },
  {
    txHash: '0xfailed',
    logIndex: 1,
    daoAddress: daos[0].daoAddress,
    proposalId: '3',
    eventType: 'ProposalExecutionFailed',
    actor: memberAddress,
    amountWei: '300000000000000000',
    status: 'execution_failed:1',
    blockNumber: '2',
    createdAt: '2026-06-02T00:01:00.000Z',
  },
  {
    txHash: '0xevidence',
    logIndex: 2,
    daoAddress: daos[0].daoAddress,
    proposalId: '4',
    eventType: 'EvidenceHashRegistered',
    actor: memberAddress,
    amountWei: null,
    status: 'evidence',
    blockNumber: '3',
    createdAt: '2026-06-02T00:02:00.000Z',
  },
];

const phase15History: TransactionLog[] = [
  ...phase13History,
  {
    txHash: '0xtermination',
    logIndex: 3,
    daoAddress: daos[0].daoAddress,
    proposalId: '5',
    eventType: 'TerminationExecuted',
    actor: memberAddress,
    amountWei: '0',
    status: 'termination:executed',
    blockNumber: '4',
    createdAt: '2026-06-02T00:04:00.000Z',
  },
];

const evidenceFiles: EvidenceFileRecord[] = [
  {
    evidenceId: 'e1',
    daoAddress: daos[0].daoAddress,
    proposalId: '4',
    uploader: memberAddress,
    evidenceType: 'receipt',
    r2ObjectKey: 'dao/x/proposal/4/evidence/e1/receipt.png',
    mimeType: 'image/png',
    fileSize: 2048,
    description: '영수증 원본',
    contentHash: `0x${'e'.repeat(64)}`,
    createdAt: '2026-06-02T00:03:00.000Z',
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

function renderConnectedLayout(overrides: Record<string, unknown> = {}) {
  const props = {
    address: memberAddress,
    budgetFilter: 'all',
    budgetHistory: [],
    chainId: SEPOLIA_CHAIN_ID,
    daoDetail: null,
    daoError: null,
    daoFilter: 'active',
    daos,
    evidenceFiles: [],
    isLoadingDaos: false,
    isLoadingDetail: false,
    onCancelProposal: async () => undefined,
    onCreateDao: async () => undefined,
    onCreateProposal: async () => undefined,
    onCreateTerminationProposal: async () => undefined,
    onDeposit: async () => undefined,
    onBudgetFilterChange: () => undefined,
    onEvidenceSubmit: async () => undefined,
    onExecuteProposal: async () => undefined,
    onExecuteTermination: async () => undefined,
    onFilterChange: () => undefined,
    onFinalizeProposal: async () => undefined,
    onProposalFilterChange: () => undefined,
    onRefresh: () => undefined,
    onSelectDao: () => undefined,
    onSelectProposal: () => undefined,
    onSwitchNetwork: () => undefined,
    onViewChange: () => undefined,
    onVote: async () => undefined,
    proposalFilter: 'all',
    selectedDao: daos[0],
    selectedProposalId: null,
    txState: { status: 'idle', message: '' },
    view: 'list',
    walletError: null,
    ...overrides,
  } as Parameters<typeof ConnectedLayout>[0];

  return renderToStaticMarkup(<ConnectedLayout {...props} />);
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
    expect(blockExplorerTxUrl('0xtx')).toBe('https://sepolia.etherscan.io/tx/0xtx');
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

  it('renders the spending proposal creation screen and unanimous option', () => {
    const html = renderConnectedLayout({
      daoDetail,
      selectedDao: daos[0],
      view: 'proposal-create',
    });

    expect(html).toContain('지출 제안 생성');
    expect(html).toContain('canonical JSON');
    expect(html).toContain('이 제안은 만장일치 필요');
  });

  it('validates spending proposal form input and rejects past deadlines', () => {
    expect(
      validateSpendingProposalInput(
        {
          daoAddress: daos[0].daoAddress,
          proposer: memberAddress,
          title: '서버비',
          description: '클라우드 서버비',
          amountEth: '0.1',
          recipient: '0xc000000000000000000000000000000000000002',
          deadline: closedDeadline,
          approvalType: ApprovalType.Default,
        },
        Date.now(),
      ),
    ).toMatchObject({ ok: false });

    expect(
      validateSpendingProposalInput(
        {
          daoAddress: daos[0].daoAddress,
          proposer: memberAddress,
          title: '서버비',
          description: '클라우드 서버비',
          amountEth: '0.1',
          recipient: '0xc000000000000000000000000000000000000002',
          deadline: votingDeadline,
          approvalType: ApprovalType.Unanimous,
        },
        Date.now(),
      ),
    ).toMatchObject({ ok: true, approvalType: ApprovalType.Unanimous });
  });

  it('encodes proposal create, vote, finalize, and cancel transaction payloads', () => {
    expect(
      encodeCreateSpendingProposalCall({
        amountWei: '100000000000000000',
        recipient: '0xc000000000000000000000000000000000000002',
        deadline: votingDeadline,
        approvalType: ApprovalType.Unanimous,
        contentHash: `0x${'a'.repeat(64)}`,
      }).startsWith(createProposalSelector),
    ).toBe(true);
    expect(encodeVoteCall('1', true).startsWith(voteSelector)).toBe(true);
    expect(encodeFinalizeProposalCall('1').startsWith(finalizeProposalSelector)).toBe(true);
    expect(
      encodeCancelProposalCall('1', `0x${'b'.repeat(64)}`).startsWith(cancelProposalSelector),
    ).toBe(true);
  });

  it('renders proposal list filters and hides non-matching statuses', () => {
    const html = renderConnectedLayout({
      daoDetail,
      proposalFilter: 'executable',
      selectedDao: daos[0],
      view: 'proposals',
    });

    expect(html).toContain('제안 목록');
    expect(html).toContain('서버비');
    expect(html).not.toContain('MT 숙소 예약비');
  });

  it('renders vote state, duplicate vote warning, and proposer cancel button conditions', () => {
    const html = renderConnectedLayout({
      budgetHistory: voteHistory,
      daoDetail,
      selectedDao: daos[0],
      selectedProposalId: '1',
      view: 'proposal-detail',
    });

    expect(html).toContain('이미 이 제안에 투표했습니다.');
    expect(html).toContain('찬성');
    expect(html).toContain('제안 취소');
    expect(html).toContain('취소 실행');
  });

  it('renders finalize action after the voting deadline', () => {
    const html = renderConnectedLayout({
      daoDetail: {
        ...daoDetail,
        proposals: [{ ...daoDetail.proposals[0], deadline: closedDeadline }],
      },
      selectedDao: daos[0],
      selectedProposalId: '1',
      view: 'proposal-detail',
    });

    expect(html).toContain('투표 마감 시간이 지났습니다.');
    expect(html).toContain('결과 확정');
  });

  it('calls the proposal hash API with canonical proposal input', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          canonicalJson: '{"amountWei":"1"}',
          contentHash: `0x${'c'.repeat(64)}`,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );

    await expect(
      createApiClient('https://api.example.test').hashProposal({
        schemaVersion: 1,
        chainId: SEPOLIA_CHAIN_ID,
        daoAddress: daos[0].daoAddress,
        proposalType: 0,
        proposer: memberAddress,
        title: '서버비',
        description: '클라우드 서버비',
        amountWei: '1',
        recipient: '0xc000000000000000000000000000000000000002',
        deadline: votingDeadline,
        approvalType: ApprovalType.Default,
      }),
    ).resolves.toEqual({
      canonicalJson: '{"amountWei":"1"}',
      contentHash: `0x${'c'.repeat(64)}`,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/proposal-details/hash',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders execute action only for executable proposals and shows execution failure reason codes', () => {
    const html = renderConnectedLayout({
      daoDetail: {
        ...daoDetail,
        proposals: [
          ...daoDetail.proposals,
          {
            ...daoDetail.proposals[1],
            proposalId: '3',
            title: '잔액 초과 지출',
            proposer: memberAddress,
            status: ProposalStatus.ExecutionFailed,
          },
        ],
      },
      budgetHistory: phase13History,
      selectedDao: daos[0],
      selectedProposalId: '2',
      view: 'proposal-detail',
    });

    expect(html).toContain('지출 집행');
    expect(html).not.toContain('reasonCode 1');

    const failedHtml = renderConnectedLayout({
      daoDetail: {
        ...daoDetail,
        proposals: [
          {
            ...daoDetail.proposals[1],
            proposalId: '3',
            title: '잔액 초과 지출',
            proposer: memberAddress,
            status: ProposalStatus.ExecutionFailed,
          },
        ],
      },
      budgetHistory: phase13History,
      selectedDao: daos[0],
      selectedProposalId: '3',
      view: 'proposal-detail',
    });

    expect(failedHtml).toContain('지출 집행이 실패했습니다.');
    expect(failedHtml).toContain('reasonCode 1');
    expect(failedHtml).toContain('잔액 부족');
    expect(failedHtml).not.toContain('>지출 집행</button>');
  });

  it('allows evidence registration only for executed own spending proposals and renders evidence lookup', () => {
    expect(
      validateEvidenceRegistration({
        currentAddress: memberAddress,
        proposalType: ProposalType.Spending,
        proposalStatus: ProposalStatus.Executed,
        proposer: memberAddress,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateEvidenceRegistration({
        currentAddress: memberAddress,
        proposalType: ProposalType.Spending,
        proposalStatus: ProposalStatus.ExecutionFailed,
        proposer: memberAddress,
      }),
    ).toMatchObject({ ok: false });

    const html = renderConnectedLayout({
      daoDetail: {
        ...daoDetail,
        proposals: [
          {
            ...daoDetail.proposals[1],
            proposalId: '4',
            proposer: memberAddress,
            status: ProposalStatus.Executed,
          },
        ],
      },
      evidenceFiles,
      selectedDao: daos[0],
      selectedProposalId: '4',
      view: 'proposal-detail',
    });

    expect(html).toContain('증빙 조회');
    expect(html).toContain('영수증 원본');
    expect(html).toContain('증빙 해시 등록');
    expect(html).not.toContain('집행 완료된 제안에만 증빙을 등록할 수 있습니다.');
  });

  it('renders budget history filters for deposits, execution failures, and evidence events', () => {
    const html = renderConnectedLayout({
      budgetFilter: 'execution',
      budgetHistory: phase13History,
      daoDetail,
      selectedDao: daos[0],
      view: 'budget',
    });

    expect(html).toContain('예산 내역');
    expect(html).toContain('지출 집행 실패');
    expect(html).toContain('reasonCode 1');
    expect(html).not.toContain('회비 입금');

    const evidenceHtml = renderConnectedLayout({
      budgetFilter: 'evidence',
      budgetHistory: phase13History,
      daoDetail,
      selectedDao: daos[0],
      view: 'budget',
    });

    expect(evidenceHtml).toContain('증빙 등록');
    expect(evidenceHtml).not.toContain('회비 입금');
  });

  it('renders phase 15 polish for success notices, explorer links, and termination history', () => {
    const pendingHtml = renderConnectedLayout({
      txState: { status: 'pending', message: 'Waiting' },
    });
    const noticeHtml = renderConnectedLayout({
      txState: { status: 'success', message: 'Sent', txHash: '0xsent' },
    });

    expect(pendingHtml).toContain('alert warning');
    expect(noticeHtml).toContain('alert success');
    expect(noticeHtml).toContain('https://sepolia.etherscan.io/tx/0xsent');

    const historyHtml = renderConnectedLayout({
      budgetFilter: 'execution',
      budgetHistory: phase15History,
      daoDetail,
      selectedDao: daos[0],
      view: 'budget',
    });

    expect(historyHtml).toContain('DAO 종료 실행');
    expect(historyHtml).toContain('https://sepolia.etherscan.io/tx/0xtermination');
  });

  it('encodes execute and evidence hash registration transaction payloads', () => {
    expect(encodeExecuteProposalCall('2')).toBe(
      `${executeProposalSelector}${'2'.padStart(64, '0')}`,
    );
    expect(
      encodeRegisterEvidenceHashCall('4', `0x${'e'.repeat(64)}`).startsWith(
        registerEvidenceHashSelector,
      ),
    ).toBe(true);
  });

  it('renders termination proposal entry points only after blocking proposals are resolved', () => {
    const blockedHtml = renderConnectedLayout({
      daoDetail,
      selectedDao: daos[0],
      view: 'dashboard',
    });

    expect(blockedHtml).toContain('DAO 종료');
    expect(blockedHtml).toContain(
      '투표 중이거나 집행 가능한 제안을 먼저 처리해야 DAO 종료를 제안할 수 있습니다.',
    );

    const html = renderConnectedLayout({
      daoDetail: emptyProposalDaoDetail,
      selectedDao: daos[0],
      view: 'termination-create',
    });

    expect(html).toContain('DAO 종료 제안');
    expect(html).toContain('예상 1인 반환액');
    expect(html).toContain('proposalType=1, amountWei=0, recipient=address(0)');
  });

  it('allows termination voting/execution in termination-voting status', () => {
    const html = renderConnectedLayout({
      daoDetail: terminationDaoDetail,
      selectedDao: { ...daos[0], status: DaoStatus.TerminationVoting },
      selectedProposalId: '5',
      view: 'proposal-detail',
    });

    expect(html).toContain('DAO 종료 실행');
    expect(html).not.toContain('>吏異?吏묓뻾</button>');
  });

  it('validates and encodes termination proposal and execution payloads', () => {
    expect(
      validateTerminationProposalInput(
        {
          daoAddress: daos[0].daoAddress,
          proposer: memberAddress,
          title: 'DAO termination',
          description: 'Return remaining balance.',
          deadline: votingDeadline,
          approvalType: ApprovalType.Default,
        },
        Date.now(),
      ),
    ).toMatchObject({ ok: true });
    expect(
      encodeCreateTerminationProposalCall({
        deadline: votingDeadline,
        approvalType: ApprovalType.Default,
        contentHash: `0x${'f'.repeat(64)}`,
      }).startsWith(createProposalSelector),
    ).toBe(true);
    expect(
      encodeCreateTerminationProposalCall({
        deadline: votingDeadline,
        approvalType: ApprovalType.Default,
        contentHash: `0x${'f'.repeat(64)}`,
      }),
    ).toContain('1'.padStart(64, '0'));
    expect(encodeExecuteTerminationCall('5')).toBe(
      `${executeTerminationSelector}${'5'.padStart(64, '0')}`,
    );
  });

  it('calls evidence hash, proposal detail evidence, and evidence metadata APIs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/evidence/hash')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, contentHash: `0x${'e'.repeat(64)}` }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
        );
      }
      if (url.includes('/daos/') && url.includes('/proposals/4')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, proposal: daoDetail.proposals[1], evidence: evidenceFiles }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200,
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, record: evidenceFiles[0] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    });

    const client = createApiClient('https://api.example.test');
    await expect(client.hashEvidence('ZmFrZQ==')).resolves.toBe(`0x${'e'.repeat(64)}`);
    await expect(client.getProposalDetail(daos[0].daoAddress, '4', memberAddress)).resolves.toEqual(
      { proposal: daoDetail.proposals[1], evidence: evidenceFiles },
    );
    await expect(
      client.saveEvidenceFile({
        daoAddress: daos[0].daoAddress,
        proposalId: '4',
        uploader: memberAddress,
        evidenceType: 'receipt',
        fileName: 'receipt.png',
        mimeType: 'image/png',
        fileSize: 2048,
        description: '영수증 원본',
        contentHash: `0x${'e'.repeat(64)}`,
        fileBase64: 'ZmFrZQ==',
      }),
    ).resolves.toEqual(evidenceFiles[0]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/evidence/hash',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

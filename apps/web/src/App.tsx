import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ApprovalRule,
  ApprovalType,
  DaoStatus,
  MAX_DAO_MEMBER_COUNT,
  ProposalStatus,
  ProposalType,
  SEPOLIA_CHAIN_ID,
} from '@dao-budget/shared';
import {
  createApiClient,
  filterDaosByStatus,
  type ApiClient,
  type DaoDetail,
  type ProposalDetail,
  type DaoSummary,
  type TransactionLog,
} from './api';
import {
  blockExplorerAddressUrl,
  createInjectedWalletClient,
  formatAddress,
  isSepolia,
  type WalletClient,
} from './wallet';
import {
  depositSelector,
  encodeCancelProposalCall,
  encodeCreateDaoCall,
  encodeCreateSpendingProposalCall,
  encodeFinalizeProposalCall,
  encodeVoteCall,
  isAddress,
  normalizeAddress,
  toQuantityHex,
  validateCreateDaoInput,
  validateDepositEth,
  validateSpendingProposalInput,
} from './transactions';
import './styles.css';

type DaoFilter = 'active' | 'terminated';
type ProposalFilter = 'all' | 'voting' | 'executable' | 'closed';
type View =
  | 'list'
  | 'create'
  | 'dashboard'
  | 'deposit'
  | 'proposal-create'
  | 'proposals'
  | 'proposal-detail';
type TxState = {
  status: 'idle' | 'pending' | 'success' | 'error';
  message: string;
  txHash?: string;
};

type WalletState = {
  address: string | null;
  chainId: number | null;
  isConnecting: boolean;
  error: string | null;
};

type AppProps = {
  apiClient?: ApiClient;
  walletClient?: WalletClient;
};

const defaultWalletState: WalletState = {
  address: null,
  chainId: null,
  isConnecting: false,
  error: null,
};

const idleTx: TxState = { status: 'idle', message: '' };

const factoryAddress = import.meta.env.VITE_FACTORY_ADDRESS ?? '';

export function App({ apiClient, walletClient }: AppProps) {
  const api = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const wallet = useMemo(() => walletClient ?? createInjectedWalletClient(), [walletClient]);
  const [walletState, setWalletState] = useState<WalletState>(defaultWalletState);
  const [view, setView] = useState<View>('list');
  const [daos, setDaos] = useState<DaoSummary[]>([]);
  const [selectedDaoAddress, setSelectedDaoAddress] = useState<string | null>(null);
  const [daoDetail, setDaoDetail] = useState<DaoDetail | null>(null);
  const [budgetHistory, setBudgetHistory] = useState<TransactionLog[]>([]);
  const [daoFilter, setDaoFilter] = useState<DaoFilter>('active');
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('all');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [isLoadingDaos, setIsLoadingDaos] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [daoError, setDaoError] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxState>(idleTx);
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);

  const selectedDao = useMemo(
    () => daos.find((dao) => dao.daoAddress === selectedDaoAddress) ?? daos[0] ?? null,
    [daos, selectedDaoAddress],
  );

  useEffect(() => {
    let isMounted = true;

    wallet
      .getSnapshot()
      .then((snapshot) => {
        if (!isMounted) return;
        setWalletState((current) => ({ ...current, ...snapshot }));
      })
      .catch(() => {
        if (!isMounted) return;
        setWalletState((current) => ({ ...current, address: null, chainId: null }));
      });

    const removeAccountsChanged = wallet.onAccountsChanged((accounts) => {
      setWalletState((current) => ({
        ...current,
        address: accounts[0]?.toLowerCase() ?? null,
        error: null,
      }));
      setView('list');
      setSelectedDaoAddress(null);
      setSelectedProposalId(null);
    });
    const removeChainChanged = wallet.onChainChanged((chainId) => {
      setWalletState((current) => ({ ...current, chainId, error: null }));
    });

    return () => {
      isMounted = false;
      removeAccountsChanged();
      removeChainChanged();
    };
  }, [wallet]);

  useEffect(() => {
    if (!walletState.address) {
      setDaos([]);
      setSelectedDaoAddress(null);
      setDaoError(null);
      return;
    }

    void refreshDaos(walletState.address);
  }, [walletState.address]);

  useEffect(() => {
    if (!walletState.address || !selectedDaoAddress || view === 'list' || view === 'create') {
      setDaoDetail(null);
      setBudgetHistory([]);
      return;
    }

    let isMounted = true;
    setIsLoadingDetail(true);
    setDaoError(null);

    Promise.all([
      api.getDaoDetail(selectedDaoAddress, walletState.address),
      api.listBudgetHistory(selectedDaoAddress, walletState.address),
    ])
      .then(([detail, history]) => {
        if (!isMounted) return;
        setDaoDetail(detail);
        setBudgetHistory(history);
      })
      .catch((error: Error) => {
        if (!isMounted) return;
        setDaoError(error.message);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoadingDetail(false);
      });

    return () => {
      isMounted = false;
    };
  }, [api, detailRefreshNonce, selectedDaoAddress, view, walletState.address]);

  async function refreshDaos(address = walletState.address) {
    if (!address) return;

    setIsLoadingDaos(true);
    setDaoError(null);
    try {
      const myDaos = await api.listMyDaos(address);
      setDaos(myDaos);
      setSelectedDaoAddress((current) => {
        if (current && myDaos.some((dao) => dao.daoAddress === current)) return current;
        return myDaos[0]?.daoAddress ?? null;
      });
    } catch (error) {
      setDaos([]);
      setDaoError(error instanceof Error ? error.message : 'DAO 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoadingDaos(false);
    }
  }

  async function connectWallet() {
    if (!wallet.isAvailable()) {
      setWalletState((current) => ({
        ...current,
        error: 'MetaMask 같은 브라우저 지갑을 설치한 뒤 다시 시도하세요.',
      }));
      return;
    }

    setWalletState((current) => ({ ...current, isConnecting: true, error: null }));
    try {
      const snapshot = await wallet.requestConnection();
      setWalletState({ ...snapshot, isConnecting: false, error: null });
    } catch (error) {
      setWalletState((current) => ({
        ...current,
        isConnecting: false,
        error: error instanceof Error ? error.message : '지갑 연결 요청이 거부되었습니다.',
      }));
    }
  }

  async function switchToSepolia() {
    try {
      await wallet.switchToSepolia();
    } catch {
      setWalletState((current) => ({
        ...current,
        error: '지갑에서 Sepolia 테스트넷으로 직접 변경해 주세요.',
      }));
    }
  }

  async function submitCreateDao(input: CreateDaoFormData) {
    if (!walletState.address) return;

    const validation = validateCreateDaoInput({
      creatorAddress: walletState.address,
      name: input.name,
      additionalMembers: input.additionalMembers,
      approvalRule: input.approvalRule,
    });
    if (!validation.ok) {
      setTxState({ status: 'error', message: validation.error });
      return;
    }
    if (!isAddress(factoryAddress)) {
      setTxState({
        status: 'error',
        message: 'VITE_FACTORY_ADDRESS가 설정되어야 DAO 생성 트랜잭션을 보낼 수 있습니다.',
      });
      return;
    }

    setTxState({ status: 'pending', message: 'DAO 생성 트랜잭션 승인을 기다리는 중입니다.' });
    try {
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: normalizeAddress(factoryAddress),
        data: encodeCreateDaoCall(
          validation.name,
          validation.additionalMembers,
          validation.approvalRule,
        ),
      });
      setTxState({
        status: 'success',
        message: 'DAO 생성 트랜잭션이 전송되었습니다. 이벤트 동기화 후 목록에 반영됩니다.',
        txHash,
      });
      await refreshDaos(walletState.address);
      setView('dashboard');
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : 'DAO 생성 트랜잭션이 실패했습니다.',
      });
    }
  }

  async function submitDeposit(amountEth: string) {
    if (!walletState.address || !selectedDao) return;

    const validation = validateDepositEth(amountEth);
    if (!validation.ok) {
      setTxState({ status: 'error', message: validation.error });
      return;
    }
    if (selectedDao.status !== DaoStatus.Active) {
      setTxState({ status: 'error', message: '활성 DAO에서만 회비를 입금할 수 있습니다.' });
      return;
    }

    setTxState({ status: 'pending', message: '회비 입금 트랜잭션 승인을 기다리는 중입니다.' });
    try {
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: selectedDao.daoAddress,
        data: depositSelector,
        value: toQuantityHex(validation.wei),
      });
      setTxState({
        status: 'success',
        message: '회비 입금 트랜잭션이 전송되었습니다. 이벤트 동기화 후 잔액과 내역에 반영됩니다.',
        txHash,
      });
      await refreshDaos(walletState.address);
      setView('dashboard');
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : '회비 입금 트랜잭션이 실패했습니다.',
      });
    }
  }

  async function submitSpendingProposal(input: SpendingProposalFormData) {
    if (!walletState.address || !selectedDao) return;
    if (selectedDao.status !== DaoStatus.Active) {
      setTxState({ status: 'error', message: '활성 DAO에서만 지출 제안을 생성할 수 있습니다.' });
      return;
    }

    const validation = validateSpendingProposalInput({
      daoAddress: selectedDao.daoAddress,
      proposer: walletState.address,
      title: input.title,
      description: input.description,
      amountEth: input.amountEth,
      recipient: input.recipient,
      deadline: input.deadline,
      approvalType: input.approvalType,
    });
    if (!validation.ok) {
      setTxState({ status: 'error', message: validation.error });
      return;
    }

    setTxState({
      status: 'pending',
      message: '제안 원문 해시 생성 및 트랜잭션 승인을 기다리는 중입니다.',
    });
    try {
      const hash = await api.hashProposal({
        schemaVersion: 1,
        chainId: SEPOLIA_CHAIN_ID,
        daoAddress: selectedDao.daoAddress,
        proposalType: ProposalType.Spending,
        proposer: walletState.address,
        title: validation.title,
        description: validation.description,
        amountWei: validation.amountWei,
        recipient: validation.recipient,
        deadline: validation.deadline,
        approvalType: validation.approvalType,
      });
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: selectedDao.daoAddress,
        data: encodeCreateSpendingProposalCall({
          amountWei: validation.amountWei,
          recipient: validation.recipient,
          deadline: validation.deadline,
          approvalType: validation.approvalType,
          contentHash: hash.contentHash,
        }),
      });
      const proposalId = getNextProposalId(daoDetail?.proposals ?? []);
      await api.saveProposalDetail({
        schemaVersion: 1,
        chainId: SEPOLIA_CHAIN_ID,
        daoAddress: selectedDao.daoAddress,
        proposalType: ProposalType.Spending,
        proposer: walletState.address,
        title: validation.title,
        description: validation.description,
        amountWei: validation.amountWei,
        recipient: validation.recipient,
        deadline: validation.deadline,
        approvalType: validation.approvalType,
        proposalId,
        contentHash: hash.contentHash,
      });
      setTxState({
        status: 'success',
        message: '지출 제안 트랜잭션이 전송되었고 제안 상세가 저장되었습니다.',
        txHash,
      });
      setView('proposals');
      setDetailRefreshNonce((value) => value + 1);
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : '지출 제안 생성이 실패했습니다.',
      });
    }
  }

  async function submitVote(proposalId: string, support: boolean) {
    if (!walletState.address || !selectedDao) return;

    setTxState({ status: 'pending', message: '투표 트랜잭션 승인을 기다리는 중입니다.' });
    try {
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: selectedDao.daoAddress,
        data: encodeVoteCall(proposalId, support),
      });
      setTxState({
        status: 'success',
        message: '투표 트랜잭션이 전송되었습니다. 이벤트 동기화 후 투표 현황에 반영됩니다.',
        txHash,
      });
      setDetailRefreshNonce((value) => value + 1);
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : '투표 트랜잭션이 실패했습니다.',
      });
    }
  }

  async function submitFinalize(proposalId: string) {
    if (!walletState.address || !selectedDao) return;

    setTxState({ status: 'pending', message: '결과 확정 트랜잭션 승인을 기다리는 중입니다.' });
    try {
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: selectedDao.daoAddress,
        data: encodeFinalizeProposalCall(proposalId),
      });
      setTxState({
        status: 'success',
        message: '결과 확정 트랜잭션이 전송되었습니다. 이벤트 동기화 후 상태가 반영됩니다.',
        txHash,
      });
      setDetailRefreshNonce((value) => value + 1);
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : '결과 확정 트랜잭션이 실패했습니다.',
      });
    }
  }

  async function submitCancelProposal(proposalId: string, cancelReason: string) {
    if (!walletState.address || !selectedDao) return;
    if (!cancelReason.trim()) {
      setTxState({ status: 'error', message: '취소 사유를 입력하세요.' });
      return;
    }

    setTxState({
      status: 'pending',
      message: '취소 사유 해시 생성 및 트랜잭션 승인을 기다리는 중입니다.',
    });
    try {
      const cancelReasonHash = await api.hashCancelReason(cancelReason);
      const txHash = await wallet.sendTransaction({
        from: walletState.address,
        to: selectedDao.daoAddress,
        data: encodeCancelProposalCall(proposalId, cancelReasonHash),
      });
      setTxState({
        status: 'success',
        message: '제안 취소 트랜잭션이 전송되었습니다. 이벤트 동기화 후 상태가 반영됩니다.',
        txHash,
      });
      setDetailRefreshNonce((value) => value + 1);
    } catch (error) {
      setTxState({
        status: 'error',
        message: error instanceof Error ? error.message : '제안 취소 트랜잭션이 실패했습니다.',
      });
    }
  }

  if (!walletState.address) {
    return (
      <DisconnectedView
        error={walletState.error}
        isConnecting={walletState.isConnecting}
        onConnect={connectWallet}
      />
    );
  }

  return (
    <ConnectedLayout
      address={walletState.address}
      budgetHistory={budgetHistory}
      chainId={walletState.chainId}
      daoDetail={daoDetail}
      daoError={daoError}
      daoFilter={daoFilter}
      daos={daos}
      isLoadingDaos={isLoadingDaos}
      isLoadingDetail={isLoadingDetail}
      onCreateDao={submitCreateDao}
      onDeposit={submitDeposit}
      onFilterChange={setDaoFilter}
      onProposalFilterChange={setProposalFilter}
      onRefresh={() => refreshDaos()}
      onCancelProposal={submitCancelProposal}
      onCreateProposal={submitSpendingProposal}
      onFinalizeProposal={submitFinalize}
      onVote={submitVote}
      onSelectDao={(daoAddress) => {
        setSelectedDaoAddress(daoAddress);
        setView('dashboard');
        setSelectedProposalId(null);
        setTxState(idleTx);
      }}
      onSelectProposal={(proposalId) => {
        setSelectedProposalId(proposalId);
        setView('proposal-detail');
        setTxState(idleTx);
      }}
      onSwitchNetwork={switchToSepolia}
      onViewChange={(nextView) => {
        setView(nextView);
        setTxState(idleTx);
      }}
      proposalFilter={proposalFilter}
      selectedProposalId={selectedProposalId}
      selectedDao={selectedDao}
      txState={txState}
      view={view}
      walletError={walletState.error}
    />
  );
}

export function DisconnectedView({
  error,
  isConnecting,
  onConnect,
}: {
  error: string | null;
  isConnecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◇
          </span>
          <span>DAO Vault</span>
        </div>
        <button className="primary-button" disabled={isConnecting} onClick={onConnect}>
          {isConnecting ? '연결 대기 중' : '지갑 연결'}
        </button>
      </header>
      <main className="hero" data-testid="disconnected-view">
        <section className="hero-copy">
          <p className="eyebrow">Sepolia 테스트넷 MVP</p>
          <h1>스마트컨트랙트 금고로 회비를 보관하고 구성원 투표로 지출합니다.</h1>
          <p>
            지갑을 연결하면 내가 구성원으로 등록된 DAO만 표시됩니다. 비구성원은 DAO 상세, 제안,
            증빙, 예산 내역을 볼 수 없습니다.
          </p>
          <div className="hero-actions">
            <button className="primary-button large" disabled={isConnecting} onClick={onConnect}>
              {isConnecting ? '지갑 응답 대기' : '지갑 연결'}
            </button>
            <span className="network-note">MVP는 Sepolia 테스트넷 ETH만 사용합니다.</span>
          </div>
          {error ? <p className="alert danger">{error}</p> : null}
        </section>
        <section className="value-grid" aria-label="핵심 가치">
          <ValueCard title="회비 금고" body="개인 계좌 대신 컨트랙트에 회비를 보관합니다." />
          <ValueCard title="구성원 투표" body="구성원 1인 1표로 승인 없는 지출을 방지합니다." />
          <ValueCard
            title="온체인 집행"
            body="승인 조건을 만족하면 컨트랙트가 송금을 실행합니다."
          />
        </section>
      </main>
    </div>
  );
}

type ConnectedLayoutProps = {
  address: string;
  budgetHistory: TransactionLog[];
  chainId: number | null;
  daoDetail: DaoDetail | null;
  daoError: string | null;
  daoFilter: DaoFilter;
  daos: DaoSummary[];
  isLoadingDaos: boolean;
  isLoadingDetail: boolean;
  onCreateDao: (input: CreateDaoFormData) => Promise<void>;
  onCreateProposal: (input: SpendingProposalFormData) => Promise<void>;
  onCancelProposal: (proposalId: string, cancelReason: string) => Promise<void>;
  onDeposit: (amountEth: string) => Promise<void>;
  onFilterChange: (filter: DaoFilter) => void;
  onFinalizeProposal: (proposalId: string) => Promise<void>;
  onProposalFilterChange: (filter: ProposalFilter) => void;
  onRefresh: () => void;
  onSelectDao: (daoAddress: string) => void;
  onSelectProposal: (proposalId: string) => void;
  onSwitchNetwork: () => void;
  onViewChange: (view: View) => void;
  onVote: (proposalId: string, support: boolean) => Promise<void>;
  proposalFilter: ProposalFilter;
  selectedProposalId: string | null;
  selectedDao: DaoSummary | null;
  txState: TxState;
  view: View;
  walletError: string | null;
};

export function ConnectedLayout(props: ConnectedLayoutProps) {
  const onSepolia = isSepolia(props.chainId);

  return (
    <div className="app-shell">
      <Topbar
        address={props.address}
        chainId={props.chainId}
        onSwitchNetwork={props.onSwitchNetwork}
        onViewChange={props.onViewChange}
        selectedDao={props.selectedDao}
        view={props.view}
      />
      <main className="content" data-testid="connected-view">
        {!onSepolia ? (
          <div className="alert warning" data-testid="network-warning">
            현재 네트워크가 Sepolia가 아닙니다. 지갑 네트워크를 Sepolia({SEPOLIA_CHAIN_ID})로 변경해
            주세요.
          </div>
        ) : null}
        {props.walletError ? <div className="alert danger">{props.walletError}</div> : null}
        {props.daoError ? <div className="alert danger">{props.daoError}</div> : null}
        <TransactionNotice txState={props.txState} />

        {props.view === 'list' ? (
          <DaoListView
            daoFilter={props.daoFilter}
            daos={props.daos}
            isLoadingDaos={props.isLoadingDaos}
            onCreate={() => props.onViewChange('create')}
            onFilterChange={props.onFilterChange}
            onRefresh={props.onRefresh}
            onSelectDao={props.onSelectDao}
          />
        ) : null}
        {props.view === 'create' ? (
          <CreateDaoView
            creatorAddress={props.address}
            isPending={props.txState.status === 'pending'}
            onCancel={() => props.onViewChange('list')}
            onSubmit={props.onCreateDao}
          />
        ) : null}
        {props.view === 'dashboard' ? (
          <DashboardView
            budgetHistory={props.budgetHistory}
            dao={props.daoDetail ?? props.selectedDao}
            isLoading={props.isLoadingDetail}
            onDeposit={() => props.onViewChange('deposit')}
            onCreateProposal={() => props.onViewChange('proposal-create')}
            onOpenProposals={() => props.onViewChange('proposals')}
          />
        ) : null}
        {props.view === 'deposit' ? (
          <DepositView
            budgetHistory={props.budgetHistory}
            dao={props.daoDetail ?? props.selectedDao}
            isPending={props.txState.status === 'pending'}
            onBack={() => props.onViewChange('dashboard')}
            onDeposit={props.onDeposit}
          />
        ) : null}
        {props.view === 'proposal-create' ? (
          <SpendingProposalCreateView
            dao={props.daoDetail ?? props.selectedDao}
            isPending={props.txState.status === 'pending'}
            onBack={() => props.onViewChange('dashboard')}
            onSubmit={props.onCreateProposal}
          />
        ) : null}
        {props.view === 'proposals' ? (
          <ProposalListView
            dao={props.daoDetail ?? props.selectedDao}
            filter={props.proposalFilter}
            onCreate={() => props.onViewChange('proposal-create')}
            onFilterChange={props.onProposalFilterChange}
            onOpen={props.onSelectProposal}
          />
        ) : null}
        {props.view === 'proposal-detail' ? (
          <ProposalDetailView
            budgetHistory={props.budgetHistory}
            currentAddress={props.address}
            dao={props.daoDetail ?? props.selectedDao}
            isPending={props.txState.status === 'pending'}
            onBack={() => props.onViewChange('proposals')}
            onCancel={props.onCancelProposal}
            onFinalize={props.onFinalizeProposal}
            onVote={props.onVote}
            proposalId={props.selectedProposalId}
          />
        ) : null}
      </main>
    </div>
  );
}

function Topbar({
  address,
  chainId,
  onSwitchNetwork,
  onViewChange,
  selectedDao,
  view,
}: {
  address: string;
  chainId: number | null;
  onSwitchNetwork: () => void;
  onViewChange: (view: View) => void;
  selectedDao: DaoSummary | null;
  view: View;
}) {
  return (
    <header className="topbar connected">
      <div className="brand">
        <span className="brand-icon" aria-hidden="true">
          ◇
        </span>
        <span>DAO Vault</span>
      </div>
      <nav className="nav-tabs" aria-label="전역 메뉴">
        <button
          aria-current={view === 'list' ? 'page' : undefined}
          onClick={() => onViewChange('list')}
        >
          내 DAO
        </button>
        <button
          aria-current={view === 'dashboard' ? 'page' : undefined}
          disabled={!selectedDao}
          onClick={() => onViewChange('dashboard')}
        >
          대시보드
        </button>
        <button
          aria-current={view === 'proposals' || view === 'proposal-detail' ? 'page' : undefined}
          disabled={!selectedDao}
          onClick={() => onViewChange('proposals')}
        >
          제안
        </button>
        <button disabled>예산 내역</button>
      </nav>
      <div className="topbar-actions">
        <button
          className="dao-select"
          disabled={!selectedDao}
          onClick={() => onViewChange('dashboard')}
        >
          <span>{selectedDao?.name ?? 'DAO 선택'}</span>
          <span className="count-badge">투표 중 {selectedDao?.activeProposalCount ?? 0}</span>
        </button>
        <NetworkBadge chainId={chainId} onSwitchNetwork={onSwitchNetwork} />
        <ExplorerLink address={address} />
        <button className="primary-button" onClick={() => onViewChange('create')}>
          DAO 생성
        </button>
      </div>
    </header>
  );
}

function DaoListView({
  daoFilter,
  daos,
  isLoadingDaos,
  onCreate,
  onFilterChange,
  onRefresh,
  onSelectDao,
}: {
  daoFilter: DaoFilter;
  daos: DaoSummary[];
  isLoadingDaos: boolean;
  onCreate: () => void;
  onFilterChange: (filter: DaoFilter) => void;
  onRefresh: () => void;
  onSelectDao: (daoAddress: string) => void;
}) {
  const filteredDaos = filterDaosByStatus(daos, daoFilter);

  return (
    <>
      <div className="content-header" id="my-daos">
        <div>
          <h1>내 DAO 목록</h1>
          <p>연결된 지갑이 구성원으로 등록된 DAO만 표시됩니다.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={onRefresh}>
            동기화
          </button>
          <div className="segmented-control" role="tablist" aria-label="DAO 상태 필터">
            <button
              aria-selected={daoFilter === 'active'}
              role="tab"
              onClick={() => onFilterChange('active')}
            >
              활성 DAO
            </button>
            <button
              aria-selected={daoFilter === 'terminated'}
              role="tab"
              onClick={() => onFilterChange('terminated')}
            >
              종료 DAO
            </button>
          </div>
        </div>
      </div>

      <section className="dao-grid" aria-label="내 DAO">
        {isLoadingDaos ? <DaoSkeleton /> : null}
        {!isLoadingDaos &&
          filteredDaos.map((dao) => (
            <DaoCard dao={dao} key={dao.daoAddress} onOpen={() => onSelectDao(dao.daoAddress)} />
          ))}
        {!isLoadingDaos && filteredDaos.length === 0 ? (
          <div className="empty-state">
            <h2>{daoFilter === 'active' ? '활성 DAO가 없습니다.' : '종료 DAO가 없습니다.'}</h2>
            <p>DAO를 새로 만들거나, 다른 사용자가 내 지갑 주소를 구성원으로 등록하면 표시됩니다.</p>
          </div>
        ) : null}
        <button className="create-card" onClick={onCreate}>
          <span aria-hidden="true">＋</span>
          <strong>새 DAO 생성</strong>
          <small>새 회비 금고와 구성원 목록을 생성하세요.</small>
        </button>
      </section>
    </>
  );
}

type CreateDaoFormData = {
  name: string;
  additionalMembers: string[];
  approvalRule: ApprovalRule;
};

function CreateDaoView({
  creatorAddress,
  isPending,
  onCancel,
  onSubmit,
}: {
  creatorAddress: string;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateDaoFormData) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [additionalMembers, setAdditionalMembers] = useState<string[]>([]);
  const [approvalRule, setApprovalRule] = useState<ApprovalRule>(ApprovalRule.Majority);
  const [formError, setFormError] = useState<string | null>(null);
  const totalMemberCount = additionalMembers.length + 1;

  function addMember() {
    const validation = validateCreateDaoInput({
      creatorAddress,
      name: name || 'draft',
      additionalMembers: [...additionalMembers, memberInput],
      approvalRule,
    });
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    setAdditionalMembers(validation.additionalMembers);
    setMemberInput('');
    setFormError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateCreateDaoInput({
      creatorAddress,
      name,
      additionalMembers,
      approvalRule,
    });
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }
    setFormError(null);
    void onSubmit(validation);
  }

  return (
    <form className="form-page" onSubmit={submit}>
      <div className="content-header">
        <div>
          <h1>DAO 생성</h1>
          <p>조직명, 추가 구성원 주소, 기본 승인 기준을 입력합니다.</p>
        </div>
      </div>
      {formError ? <div className="alert danger">{formError}</div> : null}
      <section className="form-grid">
        <div className="form-panel wide">
          <label htmlFor="dao-name">조직명</label>
          <input
            id="dao-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="블록체인 스터디"
            value={name}
          />
          <p>이 이름은 온체인에 기록되고 모든 구성원에게 표시됩니다.</p>
        </div>
        <div className="info-panel">
          <strong>생성자 자동 포함</strong>
          <code>{formatAddress(creatorAddress)}</code>
        </div>
      </section>
      <section className="form-panel">
        <div className="panel-title">
          <div>
            <h2>구성원 관리</h2>
            <p>생성자를 제외한 추가 구성원 주소를 등록하세요.</p>
          </div>
          <span className="count-badge">
            {totalMemberCount} / {MAX_DAO_MEMBER_COUNT}
          </span>
        </div>
        <div className="member-row fixed">
          <span>생성자</span>
          <code>{creatorAddress}</code>
        </div>
        {additionalMembers.map((member) => (
          <div className="member-row" key={member}>
            <span>구성원</span>
            <code>{member}</code>
            <button
              className="text-button danger"
              onClick={() =>
                setAdditionalMembers((members) => members.filter((item) => item !== member))
              }
              type="button"
            >
              삭제
            </button>
          </div>
        ))}
        <div className="inline-form">
          <input
            className="mono-input"
            onChange={(event) => setMemberInput(event.target.value)}
            placeholder="0x..."
            value={memberInput}
          />
          <button className="secondary-button" onClick={addMember} type="button">
            추가
          </button>
        </div>
      </section>
      <section className="form-panel">
        <h2>기본 승인 기준</h2>
        <div className="radio-grid">
          <label>
            <input
              checked={approvalRule === ApprovalRule.Majority}
              name="approvalRule"
              onChange={() => setApprovalRule(ApprovalRule.Majority)}
              type="radio"
            />
            <span>과반 찬성</span>
            <small>전체 구성원 50% 초과 찬성</small>
          </label>
          <label>
            <input
              checked={approvalRule === ApprovalRule.TwoThirds}
              name="approvalRule"
              onChange={() => setApprovalRule(ApprovalRule.TwoThirds)}
              type="radio"
            />
            <span>2/3 찬성</span>
            <small>전체 구성원 66.7% 이상 찬성</small>
          </label>
        </div>
      </section>
      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          취소
        </button>
        <button className="primary-button" disabled={isPending} type="submit">
          {isPending ? '트랜잭션 대기 중' : 'DAO 생성'}
        </button>
      </div>
    </form>
  );
}

function DashboardView({
  budgetHistory,
  dao,
  isLoading,
  onCreateProposal,
  onDeposit,
  onOpenProposals,
}: {
  budgetHistory: TransactionLog[];
  dao: DaoSummary | DaoDetail | null;
  isLoading: boolean;
  onCreateProposal: () => void;
  onDeposit: () => void;
  onOpenProposals: () => void;
}) {
  if (!dao) {
    return (
      <div className="empty-state">
        <h1>선택된 DAO가 없습니다.</h1>
        <p>내 DAO 목록에서 DAO를 선택하거나 새 DAO를 생성하세요.</p>
      </div>
    );
  }

  const metrics = summarizeBudget(budgetHistory);
  const disabled = dao.status !== DaoStatus.Active;
  const recentProposals = 'proposals' in dao ? dao.proposals.slice(0, 3) : [];

  return (
    <section className="dashboard" data-testid="dashboard-view">
      <div className="dashboard-header">
        <div>
          <h1>{dao.name}</h1>
          <p>
            상태: {daoStatusLabel(dao.status)} · 구성원 {dao.memberCount}명 · 기준:{' '}
            {dao.approvalRule === ApprovalRule.TwoThirds ? '2/3 찬성' : '과반 찬성'}
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="secondary-button" disabled={disabled} onClick={onDeposit}>
            회비 입금
          </button>
          <button className="primary-button" disabled={disabled} onClick={onCreateProposal}>
            지출 제안
          </button>
          <button className="secondary-button" onClick={onOpenProposals}>
            제안 목록
          </button>
        </div>
      </div>
      {disabled ? (
        <div className="alert warning">종료 상태의 DAO에서는 입금할 수 없습니다.</div>
      ) : null}
      {isLoading ? <div className="alert warning">DAO 상세 정보를 불러오는 중입니다.</div> : null}
      <div className="metric-grid">
        <MetricCard
          label="현재 금고 잔액"
          value={`${dao.balanceEth ?? '-'} ETH`}
          note="온체인 금고 기준"
        />
        <MetricCard label="총 입금" value={`${metrics.totalDepositsEth} ETH`} />
        <MetricCard label="총 집행" value={`${metrics.totalExecutedEth} ETH`} />
        <MetricCard label="집행 가능" value={`${metrics.executableCount}건`} />
      </div>
      <section className="panel-table">
        <div className="panel-title">
          <h2>최근 제안</h2>
          <button className="text-button" onClick={onOpenProposals}>
            전체 보기
          </button>
        </div>
        {recentProposals.length > 0 ? (
          recentProposals.map((proposal) => (
            <div className="list-row" key={proposal.proposalId}>
              <div>
                <strong>{proposal.title}</strong>
                <span>
                  {proposal.amountWei ? `${formatWeiToEth(proposal.amountWei)} ETH` : '금액 없음'}
                </span>
              </div>
              <span className="status-badge">{proposalStatusLabel(proposal.status)}</span>
            </div>
          ))
        ) : (
          <p className="muted">최근 제안이 없습니다.</p>
        )}
      </section>
      <section className="verification-panel">
        <div>
          <h2>온체인 검증 정보</h2>
          <p>입금 → 제안 → 투표 → 집행 → 증빙 흐름을 온체인 이벤트와 해시로 확인합니다.</p>
        </div>
        <a href={blockExplorerAddressUrl(dao.daoAddress)} rel="noreferrer" target="_blank">
          {formatAddress(dao.daoAddress)}
        </a>
      </section>
    </section>
  );
}

function DepositView({
  budgetHistory,
  dao,
  isPending,
  onBack,
  onDeposit,
}: {
  budgetHistory: TransactionLog[];
  dao: DaoSummary | DaoDetail | null;
  isPending: boolean;
  onBack: () => void;
  onDeposit: (amountEth: string) => Promise<void>;
}) {
  const [amountEth, setAmountEth] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  if (!dao) {
    return (
      <div className="empty-state">
        <h1>입금할 DAO를 선택하세요.</h1>
        <button className="secondary-button" onClick={onBack}>
          대시보드로 돌아가기
        </button>
      </div>
    );
  }

  const disabled = dao.status !== DaoStatus.Active;
  const depositRows = budgetHistory
    .filter((log) => log.eventType === 'DepositReceived')
    .slice(0, 5);

  function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateDepositEth(amountEth);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }
    setFormError(null);
    void onDeposit(amountEth);
  }

  return (
    <form className="deposit-page" onSubmit={submit}>
      <button className="text-button" onClick={onBack} type="button">
        대시보드로 돌아가기
      </button>
      <div className="dashboard-header">
        <div>
          <h1>회비 입금</h1>
          <p>
            {dao.name} · 금고 주소{' '}
            <a href={blockExplorerAddressUrl(dao.daoAddress)} rel="noreferrer" target="_blank">
              {formatAddress(dao.daoAddress)}
            </a>
          </p>
        </div>
      </div>
      {disabled ? (
        <div className="alert warning">활성 DAO에서만 회비를 입금할 수 있습니다.</div>
      ) : null}
      {formError ? <div className="alert danger">{formError}</div> : null}
      <section className="deposit-grid">
        <div className="form-panel">
          <label htmlFor="deposit-amount">금액 (ETH)</label>
          <div className="amount-input">
            <input
              disabled={disabled || isPending}
              id="deposit-amount"
              inputMode="decimal"
              onChange={(event) => setAmountEth(event.target.value)}
              placeholder="0.00"
              value={amountEth}
            />
            <span>ETH</span>
          </div>
          <button className="primary-button full" disabled={disabled || isPending} type="submit">
            {isPending ? '입금 대기 중' : '회비 입금'}
          </button>
        </div>
        <div className="form-panel">
          <h2>트랜잭션 요약</h2>
          <dl className="summary-list">
            <div>
              <dt>입금 금액</dt>
              <dd>{amountEth || '0'} ETH</dd>
            </div>
            <div>
              <dt>호출 함수</dt>
              <dd>deposit()</dd>
            </div>
            <div>
              <dt>네트워크</dt>
              <dd>Sepolia</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="panel-table">
        <div className="panel-title">
          <h2>최근 입금 내역</h2>
        </div>
        {depositRows.length > 0 ? (
          depositRows.map((log) => (
            <div className="list-row" key={`${log.txHash}:${log.logIndex}`}>
              <div>
                <strong>{log.actor ? formatAddress(log.actor) : '-'}</strong>
                <span>{log.amountWei ? `${formatWeiToEth(log.amountWei)} ETH` : '-'}</span>
              </div>
              <a
                href={`https://sepolia.etherscan.io/tx/${log.txHash}`}
                rel="noreferrer"
                target="_blank"
              >
                확인됨
              </a>
            </div>
          ))
        ) : (
          <p className="muted">아직 입금 내역이 없습니다.</p>
        )}
      </section>
    </form>
  );
}

type SpendingProposalFormData = {
  title: string;
  description: string;
  amountEth: string;
  recipient: string;
  deadline: number;
  approvalType: ApprovalType;
};

function SpendingProposalCreateView({
  dao,
  isPending,
  onBack,
  onSubmit,
}: {
  dao: DaoSummary | DaoDetail | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (input: SpendingProposalFormData) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amountEth, setAmountEth] = useState('');
  const [recipient, setRecipient] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [unanimous, setUnanimous] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const disabled = !dao || dao.status !== DaoStatus.Active;

  function submit(event: FormEvent) {
    event.preventDefault();
    const deadline = Math.floor(new Date(deadlineLocal).getTime() / 1000);
    if (!Number.isFinite(deadline)) {
      setFormError('투표 마감일을 입력하세요.');
      return;
    }

    setFormError(null);
    void onSubmit({
      title,
      description,
      amountEth,
      recipient,
      deadline,
      approvalType: unanimous ? ApprovalType.Unanimous : ApprovalType.Default,
    });
  }

  return (
    <form className="form-page" onSubmit={submit}>
      <button className="text-button" onClick={onBack} type="button">
        대시보드로 돌아가기
      </button>
      <div className="content-header">
        <div>
          <h1>지출 제안 생성</h1>
          <p>제안 원문은 canonical JSON으로 해시되어 온체인 contentHash와 연결됩니다.</p>
        </div>
      </div>
      {disabled ? (
        <div className="alert warning">활성 DAO에서만 지출 제안을 생성할 수 있습니다.</div>
      ) : null}
      {formError ? <div className="alert danger">{formError}</div> : null}
      <section className="form-grid">
        <div className="form-panel wide">
          <label htmlFor="proposal-title">제안 제목</label>
          <input
            id="proposal-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
          <label htmlFor="proposal-description">설명</label>
          <textarea
            id="proposal-description"
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            value={description}
          />
        </div>
        <div className="form-panel">
          <label htmlFor="proposal-amount">금액 (ETH)</label>
          <input
            id="proposal-amount"
            inputMode="decimal"
            onChange={(event) => setAmountEth(event.target.value)}
            placeholder="0.10"
            value={amountEth}
          />
          <label htmlFor="proposal-recipient">수신자 주소</label>
          <input
            className="mono-input"
            id="proposal-recipient"
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x..."
            value={recipient}
          />
          <label htmlFor="proposal-deadline">투표 마감</label>
          <input
            id="proposal-deadline"
            onChange={(event) => setDeadlineLocal(event.target.value)}
            type="datetime-local"
            value={deadlineLocal}
          />
          <label className="checkbox-row">
            <input
              checked={unanimous}
              onChange={(event) => setUnanimous(event.target.checked)}
              type="checkbox"
            />
            <span>이 제안은 만장일치 필요</span>
          </label>
        </div>
      </section>
      <div className="form-actions">
        <button className="secondary-button" onClick={onBack} type="button">
          취소
        </button>
        <button className="primary-button" disabled={disabled || isPending} type="submit">
          {isPending ? '트랜잭션 대기 중' : '제안 생성'}
        </button>
      </div>
    </form>
  );
}

function ProposalListView({
  dao,
  filter,
  onCreate,
  onFilterChange,
  onOpen,
}: {
  dao: DaoSummary | DaoDetail | null;
  filter: ProposalFilter;
  onCreate: () => void;
  onFilterChange: (filter: ProposalFilter) => void;
  onOpen: (proposalId: string) => void;
}) {
  const proposals = filterProposals(
    'proposals' in (dao ?? {}) ? (dao as DaoDetail).proposals : [],
    filter,
  );

  return (
    <section className="dashboard">
      <div className="content-header">
        <div>
          <h1>제안 목록</h1>
          <p>DAO 구성원이 등록한 지출 제안을 상태별로 확인합니다.</p>
        </div>
        <div className="header-actions">
          <div className="segmented-control" role="tablist" aria-label="제안 상태 필터">
            <button
              aria-selected={filter === 'all'}
              role="tab"
              onClick={() => onFilterChange('all')}
            >
              전체
            </button>
            <button
              aria-selected={filter === 'voting'}
              role="tab"
              onClick={() => onFilterChange('voting')}
            >
              투표 중
            </button>
            <button
              aria-selected={filter === 'executable'}
              role="tab"
              onClick={() => onFilterChange('executable')}
            >
              집행 가능
            </button>
            <button
              aria-selected={filter === 'closed'}
              role="tab"
              onClick={() => onFilterChange('closed')}
            >
              종료됨
            </button>
          </div>
          <button
            className="primary-button"
            disabled={dao?.status !== DaoStatus.Active}
            onClick={onCreate}
          >
            지출 제안
          </button>
        </div>
      </div>
      <section className="panel-table">
        {proposals.length > 0 ? (
          proposals.map((proposal) => (
            <button
              className="list-row proposal-row"
              key={proposal.proposalId}
              onClick={() => onOpen(proposal.proposalId)}
            >
              <div>
                <strong>{proposal.title}</strong>
                <span>
                  {proposal.amountWei ? `${formatWeiToEth(proposal.amountWei)} ETH` : '-'} ·{' '}
                  {proposal.recipient ? formatAddress(proposal.recipient) : '-'}
                </span>
              </div>
              <span className="status-badge">{proposalStatusLabel(proposal.status)}</span>
            </button>
          ))
        ) : (
          <p className="muted">표시할 제안이 없습니다.</p>
        )}
      </section>
    </section>
  );
}

function ProposalDetailView({
  budgetHistory,
  currentAddress,
  dao,
  isPending,
  onBack,
  onCancel,
  onFinalize,
  onVote,
  proposalId,
}: {
  budgetHistory: TransactionLog[];
  currentAddress: string;
  dao: DaoSummary | DaoDetail | null;
  isPending: boolean;
  onBack: () => void;
  onCancel: (proposalId: string, reason: string) => Promise<void>;
  onFinalize: (proposalId: string) => Promise<void>;
  onVote: (proposalId: string, support: boolean) => Promise<void>;
  proposalId: string | null;
}) {
  const [cancelReason, setCancelReason] = useState('');
  const proposal =
    dao && 'proposals' in dao
      ? (dao.proposals.find((item) => item.proposalId === proposalId) ?? null)
      : null;

  if (!dao || !proposal) {
    return (
      <div className="empty-state">
        <h1>제안을 찾을 수 없습니다.</h1>
        <button className="secondary-button" onClick={onBack}>
          제안 목록으로 돌아가기
        </button>
      </div>
    );
  }

  const votes = summarizeVotes(budgetHistory, proposal.proposalId, dao.memberCount);
  const now = Math.floor(Date.now() / 1000);
  const isVoting = (proposal.status ?? ProposalStatus.Voting) === ProposalStatus.Voting;
  const isBeforeDeadline = now < proposal.deadline;
  const hasVoted = votes.voters.has(normalizeAddress(currentAddress));
  const canVote = isVoting && isBeforeDeadline && !hasVoted && dao.status === DaoStatus.Active;
  const canFinalize = isVoting && !isBeforeDeadline;
  const canCancel =
    isVoting &&
    isBeforeDeadline &&
    proposal.proposer?.toLowerCase() === currentAddress.toLowerCase();

  return (
    <section className="dashboard">
      <button className="text-button" onClick={onBack}>
        제안 목록으로 돌아가기
      </button>
      <div className="dashboard-header">
        <div>
          <h1>{proposal.title}</h1>
          <p>
            {proposal.amountWei ? `${formatWeiToEth(proposal.amountWei)} ETH` : '-'} · 수신자{' '}
            {proposal.recipient ? formatAddress(proposal.recipient) : '-'} ·{' '}
            {proposalStatusLabel(proposal.status)}
          </p>
        </div>
      </div>
      {!isBeforeDeadline && isVoting ? (
        <div className="alert warning">
          투표 마감 시간이 지났습니다. 결과 확정을 실행할 수 있습니다.
        </div>
      ) : null}
      {hasVoted ? <div className="alert warning">이미 이 제안에 투표했습니다.</div> : null}
      <section className="form-grid">
        <div className="form-panel wide">
          <h2>제안 상세</h2>
          <p>{proposal.description ?? '설명이 없습니다.'}</p>
          <dl className="summary-list">
            <div>
              <dt>제안자</dt>
              <dd>{proposal.proposer ? formatAddress(proposal.proposer) : '-'}</dd>
            </div>
            <div>
              <dt>마감</dt>
              <dd>{new Date(proposal.deadline * 1000).toLocaleString('ko-KR')}</dd>
            </div>
            <div>
              <dt>승인 조건</dt>
              <dd>
                {proposal.approvalType === ApprovalType.Unanimous ? '만장일치' : 'DAO 기본 기준'}
              </dd>
            </div>
            <div>
              <dt>contentHash</dt>
              <dd>{proposal.contentHash ? formatAddress(proposal.contentHash) : '-'}</dd>
            </div>
          </dl>
        </div>
        <div className="form-panel">
          <h2>투표 현황</h2>
          <dl className="summary-list">
            <div>
              <dt>찬성</dt>
              <dd>{votes.yes}명</dd>
            </div>
            <div>
              <dt>반대</dt>
              <dd>{votes.no}명</dd>
            </div>
            <div>
              <dt>미투표</dt>
              <dd>{votes.notVoted}명</dd>
            </div>
          </dl>
          <div className="action-stack">
            <button
              className="primary-button"
              disabled={!canVote || isPending}
              onClick={() => onVote(proposal.proposalId, true)}
            >
              찬성
            </button>
            <button
              className="secondary-button"
              disabled={!canVote || isPending}
              onClick={() => onVote(proposal.proposalId, false)}
            >
              반대
            </button>
            <button
              className="secondary-button"
              disabled={!canFinalize || isPending}
              onClick={() => onFinalize(proposal.proposalId)}
            >
              결과 확정
            </button>
          </div>
        </div>
      </section>
      {canCancel ? (
        <section className="form-panel">
          <h2>제안 취소</h2>
          <div className="inline-form">
            <input
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="취소 사유"
              value={cancelReason}
            />
            <button
              className="secondary-button"
              disabled={isPending}
              onClick={() => onCancel(proposal.proposalId, cancelReason)}
              type="button"
            >
              취소 실행
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function ValueCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="value-card">
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}

function NetworkBadge({
  chainId,
  onSwitchNetwork,
}: {
  chainId: number | null;
  onSwitchNetwork: () => void;
}) {
  if (isSepolia(chainId)) {
    return (
      <div className="network-badge success">
        <span aria-hidden="true" />
        Sepolia
      </div>
    );
  }

  return (
    <button className="network-badge warning" onClick={onSwitchNetwork}>
      <span aria-hidden="true" />
      네트워크 변경
    </button>
  );
}

function ExplorerLink({ address }: { address: string }) {
  return (
    <a
      className="address-link"
      href={blockExplorerAddressUrl(address)}
      rel="noreferrer"
      target="_blank"
      title="Sepolia Etherscan에서 지갑 주소 열기"
    >
      {formatAddress(address)}
    </a>
  );
}

function DaoCard({ dao, onOpen }: { dao: DaoSummary; onOpen: () => void }) {
  const proposalCount = dao.activeProposalCount ?? 0;

  return (
    <article className="dao-card">
      <div className="dao-card-header">
        <div>
          <h2>{dao.name}</h2>
          <a
            className="contract-link"
            href={blockExplorerAddressUrl(dao.daoAddress)}
            rel="noreferrer"
            target="_blank"
            title="Sepolia Etherscan에서 DAO 컨트랙트 열기"
          >
            {formatAddress(dao.daoAddress)}
          </a>
        </div>
        <span
          className={dao.status === DaoStatus.Terminated ? 'status-badge ended' : 'status-badge'}
        >
          {dao.status === DaoStatus.Terminated ? '종료' : '활성'}
        </span>
      </div>
      <dl className="dao-stats">
        <div>
          <dt>잔액</dt>
          <dd>{dao.balanceEth ?? '-'} ETH</dd>
        </div>
        <div>
          <dt>구성원</dt>
          <dd>{dao.memberCount}명</dd>
        </div>
        <div>
          <dt>제안</dt>
          <dd>{proposalCount}</dd>
        </div>
      </dl>
      <div className="dao-card-footer">
        <span>
          투표 기준 {dao.approvalRule === ApprovalRule.TwoThirds ? '2/3 찬성' : '과반 찬성'}
        </span>
        <button onClick={onOpen}>대시보드 열기</button>
      </div>
    </article>
  );
}

function MetricCard({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function TransactionNotice({ txState }: { txState: TxState }) {
  if (txState.status === 'idle') return null;

  return (
    <div className={`alert ${txState.status === 'error' ? 'danger' : 'warning'}`}>
      {txState.message}{' '}
      {txState.txHash ? (
        <a
          href={`https://sepolia.etherscan.io/tx/${txState.txHash}`}
          rel="noreferrer"
          target="_blank"
        >
          트랜잭션 보기
        </a>
      ) : null}
    </div>
  );
}

function DaoSkeleton() {
  return (
    <article className="dao-card skeleton" aria-label="DAO 목록 불러오는 중">
      <div />
      <div />
      <div />
    </article>
  );
}

function summarizeBudget(history: TransactionLog[]) {
  const totalDeposits = history
    .filter((log) => log.eventType === 'DepositReceived' && log.amountWei)
    .reduce((sum, log) => sum + BigInt(log.amountWei ?? '0'), 0n);
  const totalExecuted = history
    .filter((log) => log.eventType === 'ProposalExecuted' && log.amountWei)
    .reduce((sum, log) => sum + BigInt(log.amountWei ?? '0'), 0n);
  const executableCount = history.filter((log) => log.status === 'proposal:3').length;

  return {
    executableCount,
    totalDepositsEth: formatWeiToEth(totalDeposits.toString()),
    totalExecutedEth: formatWeiToEth(totalExecuted.toString()),
  };
}

function summarizeVotes(history: TransactionLog[], proposalId: string, memberCount: number) {
  const votes = history.filter(
    (log) => log.eventType === 'VoteCast' && log.proposalId === proposalId && log.actor,
  );
  const voters = new Set(votes.map((vote) => normalizeAddress(vote.actor ?? '')));
  const yes = votes.filter(
    (vote) => vote.status === 'vote:yes' || vote.status === 'support:true',
  ).length;
  const no = votes.filter(
    (vote) => vote.status === 'vote:no' || vote.status === 'support:false',
  ).length;

  return {
    no,
    notVoted: Math.max(memberCount - voters.size, 0),
    voters,
    yes,
  };
}

function filterProposals(proposals: ProposalDetail[], filter: ProposalFilter) {
  if (filter === 'all') return proposals;
  if (filter === 'voting') {
    return proposals.filter(
      (proposal) => (proposal.status ?? ProposalStatus.Voting) === ProposalStatus.Voting,
    );
  }
  if (filter === 'executable') {
    return proposals.filter((proposal) => proposal.status === ProposalStatus.Executable);
  }

  return proposals.filter((proposal) =>
    [
      ProposalStatus.Canceled,
      ProposalStatus.Rejected,
      ProposalStatus.Executed,
      ProposalStatus.ExecutionFailed,
    ].includes(proposal.status ?? ProposalStatus.Voting),
  );
}

function getNextProposalId(proposals: ProposalDetail[]) {
  const maxProposalId = proposals.reduce((max, proposal) => {
    const id = Number(proposal.proposalId);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, 0);

  return String(maxProposalId + 1);
}

function formatWeiToEth(wei: string) {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').slice(0, 4);
  const trimmedFraction = fraction.replace(/0+$/, '');

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

function daoStatusLabel(status: number) {
  if (status === DaoStatus.Terminated) return '종료';
  if (status === DaoStatus.TerminationVoting) return '종료 투표 중';
  return '활성';
}

function proposalStatusLabel(status: number | undefined) {
  if (status === ProposalStatus.Executable) return '집행 가능';
  if (status === ProposalStatus.Executed) return '집행 완료';
  if (status === ProposalStatus.Rejected) return '부결';
  if (status === ProposalStatus.Canceled) return '취소됨';
  if (status === ProposalStatus.ExecutionFailed) return '집행 실패';
  return '투표 중';
}

import { useEffect, useMemo, useState } from 'react';
import { DaoStatus, SEPOLIA_CHAIN_ID } from '@dao-budget/shared';
import { createApiClient, filterDaosByStatus, type ApiClient, type DaoSummary } from './api';
import {
  blockExplorerAddressUrl,
  createInjectedWalletClient,
  formatAddress,
  isSepolia,
  type WalletClient,
} from './wallet';
import './styles.css';

type DaoFilter = 'active' | 'terminated';

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

export function App({ apiClient, walletClient }: AppProps) {
  const api = useMemo(() => apiClient ?? createApiClient(), [apiClient]);
  const wallet = useMemo(() => walletClient ?? createInjectedWalletClient(), [walletClient]);
  const [walletState, setWalletState] = useState<WalletState>(defaultWalletState);
  const [daos, setDaos] = useState<DaoSummary[]>([]);
  const [daoFilter, setDaoFilter] = useState<DaoFilter>('active');
  const [isLoadingDaos, setIsLoadingDaos] = useState(false);
  const [daoError, setDaoError] = useState<string | null>(null);

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
      setDaoError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingDaos(true);
    setDaoError(null);

    api
      .listMyDaos(walletState.address)
      .then((myDaos) => {
        if (!isMounted) return;
        setDaos(myDaos);
      })
      .catch((error: Error) => {
        if (!isMounted) return;
        setDaos([]);
        setDaoError(error.message);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoadingDaos(false);
      });

    return () => {
      isMounted = false;
    };
  }, [api, walletState.address]);

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
      chainId={walletState.chainId}
      daos={daos}
      daoError={daoError}
      daoFilter={daoFilter}
      isLoadingDaos={isLoadingDaos}
      onFilterChange={setDaoFilter}
      onSwitchNetwork={switchToSepolia}
      selectedDao={filterDaosByStatus(daos, 'active')[0] ?? daos[0] ?? null}
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

export function ConnectedLayout({
  address,
  chainId,
  daos,
  daoError,
  daoFilter,
  isLoadingDaos,
  onFilterChange,
  onSwitchNetwork,
  selectedDao,
  walletError,
}: {
  address: string;
  chainId: number | null;
  daos: DaoSummary[];
  daoError: string | null;
  daoFilter: DaoFilter;
  isLoadingDaos: boolean;
  onFilterChange: (filter: DaoFilter) => void;
  onSwitchNetwork: () => void;
  selectedDao: DaoSummary | null;
  walletError: string | null;
}) {
  const filteredDaos = filterDaosByStatus(daos, daoFilter);
  const onSepolia = isSepolia(chainId);

  return (
    <div className="app-shell">
      <header className="topbar connected">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◇
          </span>
          <span>DAO Vault</span>
        </div>
        <nav className="nav-tabs" aria-label="전역 메뉴">
          <a aria-current="page" href="#my-daos">
            내 DAO
          </a>
          <a aria-disabled="true" href="#dashboard">
            대시보드
          </a>
          <a aria-disabled="true" href="#proposals">
            제안
          </a>
          <a aria-disabled="true" href="#budget">
            예산 내역
          </a>
        </nav>
        <div className="topbar-actions">
          <button className="dao-select" disabled={!selectedDao}>
            <span>{selectedDao?.name ?? 'DAO 선택'}</span>
            <span className="count-badge">투표 중 {selectedDao?.activeProposalCount ?? 0}</span>
          </button>
          <NetworkBadge chainId={chainId} onSwitchNetwork={onSwitchNetwork} />
          <ExplorerLink address={address} />
          <button className="primary-button">DAO 생성</button>
        </div>
      </header>
      <main className="content" id="my-daos" data-testid="connected-view">
        <div className="content-header">
          <div>
            <h1>내 DAO 목록</h1>
            <p>연결된 지갑이 구성원으로 등록된 DAO만 표시됩니다.</p>
          </div>
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

        {!onSepolia ? (
          <div className="alert warning" data-testid="network-warning">
            현재 네트워크가 Sepolia가 아닙니다. 지갑 네트워크를 Sepolia({SEPOLIA_CHAIN_ID})로 변경해
            주세요.
          </div>
        ) : null}
        {walletError ? <div className="alert danger">{walletError}</div> : null}
        {daoError ? <div className="alert danger">{daoError}</div> : null}

        <section className="dao-grid" aria-label="내 DAO">
          {isLoadingDaos ? <DaoSkeleton /> : null}
          {!isLoadingDaos && filteredDaos.map((dao) => <DaoCard dao={dao} key={dao.daoAddress} />)}
          {!isLoadingDaos && filteredDaos.length === 0 ? (
            <div className="empty-state">
              <h2>{daoFilter === 'active' ? '활성 DAO가 없습니다.' : '종료 DAO가 없습니다.'}</h2>
              <p>이 지갑이 구성원으로 등록된 DAO만 이 목록에 표시됩니다.</p>
            </div>
          ) : null}
          <button className="create-card">
            <span aria-hidden="true">＋</span>
            <strong>새 DAO 생성</strong>
            <small>새 회비 금고와 구성원 목록을 생성하세요.</small>
          </button>
        </section>
      </main>
    </div>
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

function DaoCard({ dao }: { dao: DaoSummary }) {
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
        <span>투표 기준 {dao.approvalRule === 1 ? '2/3 찬성' : '과반 찬성'}</span>
        <button>대시보드 열기</button>
      </div>
    </article>
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

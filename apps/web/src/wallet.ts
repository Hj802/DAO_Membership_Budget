import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

export type WalletSnapshot = {
  address: string | null;
  chainId: number | null;
};

export type WalletClient = {
  isAvailable(): boolean;
  requestConnection(): Promise<WalletSnapshot>;
  getSnapshot(): Promise<WalletSnapshot>;
  switchToSepolia(): Promise<void>;
  onAccountsChanged(listener: (accounts: string[]) => void): () => void;
  onChainChanged(listener: (chainId: number) => void): () => void;
};

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: 'accountsChanged', listener: (accounts: string[]) => void): void;
  on?(event: 'chainChanged', listener: (chainId: string) => void): void;
  removeListener?(event: 'accountsChanged', listener: (accounts: string[]) => void): void;
  removeListener?(event: 'chainChanged', listener: (chainId: string) => void): void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const sepoliaChainHex = `0x${SEPOLIA_CHAIN_ID.toString(16)}`;

export function isSepolia(chainId: number | null) {
  return chainId === SEPOLIA_CHAIN_ID;
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function blockExplorerAddressUrl(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`;
}

function parseChainId(value: unknown) {
  if (typeof value === 'string') {
    return value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
  }

  return typeof value === 'number' ? value : null;
}

function firstAddress(value: unknown) {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0].toLowerCase() : null;
}

export function createInjectedWalletClient(): WalletClient {
  const provider = () => window.ethereum;

  return {
    isAvailable() {
      return Boolean(provider());
    },

    async requestConnection() {
      const ethereum = provider();
      if (!ethereum) {
        throw new Error('브라우저 지갑을 찾을 수 없습니다.');
      }

      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const chainId = await ethereum.request({ method: 'eth_chainId' });

      return {
        address: firstAddress(accounts),
        chainId: parseChainId(chainId),
      };
    },

    async getSnapshot() {
      const ethereum = provider();
      if (!ethereum) {
        return { address: null, chainId: null };
      }

      const accounts = await ethereum.request({ method: 'eth_accounts' });
      const chainId = await ethereum.request({ method: 'eth_chainId' });

      return {
        address: firstAddress(accounts),
        chainId: parseChainId(chainId),
      };
    },

    async switchToSepolia() {
      const ethereum = provider();
      if (!ethereum) {
        throw new Error('브라우저 지갑을 찾을 수 없습니다.');
      }

      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: sepoliaChainHex }],
      });
    },

    onAccountsChanged(listener) {
      const ethereum = provider();
      if (!ethereum?.on) return () => undefined;

      ethereum.on('accountsChanged', listener);
      return () => ethereum.removeListener?.('accountsChanged', listener);
    },

    onChainChanged(listener) {
      const ethereum = provider();
      if (!ethereum?.on) return () => undefined;

      const wrapped = (chainId: string) => listener(parseChainId(chainId) ?? 0);
      ethereum.on('chainChanged', wrapped);
      return () => ethereum.removeListener?.('chainChanged', wrapped);
    },
  };
}

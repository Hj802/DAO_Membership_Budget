import '@nomicfoundation/hardhat-toolbox';
import type { HardhatUserConfig } from 'hardhat/config';

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? '';
const sepoliaPrivateKey = process.env.SEPOLIA_PRIVATE_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia:
      sepoliaRpcUrl && sepoliaPrivateKey
        ? {
            url: sepoliaRpcUrl,
            accounts: [sepoliaPrivateKey],
            chainId: 11155111,
          }
        : {
            url: 'http://127.0.0.1:8545',
            accounts: [],
            chainId: 11155111,
          },
  },
};

export default config;

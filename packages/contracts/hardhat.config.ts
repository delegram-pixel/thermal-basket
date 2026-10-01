import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Single source of truth for RPC endpoints and deployer keys. Every network
// entry below is environment-driven: no address, URL or key is hardcoded, and a
// missing variable degrades to an empty value rather than a wrong default.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const {
  BSC_TESTNET_RPC_URL,
  BSC_MAINNET_RPC_URL,
  DEPLOYER_PRIVATE_KEY,
  BSCSCAN_API_KEY,
  REPORT_GAS,
} = process.env;

// Hardhat rejects an accounts array containing an empty string, so only include
// the deployer when it is actually configured. Read-only tasks keep working
// without a key.
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        // Baskets loop over their components on deposit and redemption, so the
        // optimizer runs are tuned for runtime cost rather than deploy cost.
        runs: 200,
      },
      // The basket's valuation and swap loops hold more live values than the
      // legacy code generator can keep on the stack. viaIR compiles the same
      // source without that ceiling. It costs compile time, not runtime or
      // auditability: the deployed bytecode is verified against this source
      // either way.
      viaIR: true,
      // Revert strings are replaced by custom errors throughout the contracts,
      // so metadata can be trimmed without losing diagnostics.
      metadata: { bytecodeHash: 'none' },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // The mock DEX router prices swaps from a seeded reserve model, so the
      // local chain needs no forking to exercise the full deposit/redeem path.
      allowUnlimitedContractSize: false,
      // Hardhat 2.29 defaults this to 60 000 000, but its EDR node enforces the
      // EIP-7825 per-transaction gas cap of 2^24 (16 777 216). Worse,
      // hardhat-ethers copies this value onto every transaction when it talks to
      // a Hardhat node over localhost, so at the default *every* transaction is
      // rejected before it runs. Local development cannot work until the block
      // limit sits under the cap.
      //
      // 16 000 000 is chosen to stay clear of the cap while leaving three times
      // the headroom the largest transaction needs: deploying the factory costs
      // ~5.0M gas and creating a basket ~2.7M. Do not raise this to the cap
      // itself — the boundary is not worth the risk, and nothing here needs it.
      blockGasLimit: 16_000_000,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    bscTestnet: {
      url: BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      chainId: 97,
      accounts,
    },
    bscMainnet: {
      url: BSC_MAINNET_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org',
      chainId: 56,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: BSCSCAN_API_KEY ?? '',
      bsc: BSCSCAN_API_KEY ?? '',
    },
  },
  gasReporter: {
    enabled: REPORT_GAS === 'true',
    currency: 'USD',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;

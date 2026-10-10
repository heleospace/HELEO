// Reown configuration - Read from environment or use default
export const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || '1be41507b1e49aba1030c3d5d8bdefcd';

// Public source code repository (footer "Open Source" link)
export const REPO_URL = 'https://github.com/heleospace/HELEO';

// Wallet allowed to access the /deploy page and nav item
export const DEPLOYER_WALLET = import.meta.env.VITE_DEPLOYER_WALLET || '';

// Token decimals
export const TOKEN_DECIMALS = 18;

// Formatting
export const DISPLAY_DECIMALS = 2;

// Network
export const SUPPORTED_CHAINS = [
  1, // Ethereum mainnet
  11155111, // Sepolia testnet
];

// Contract constants — these mirror the compiled constants in LEO.sol /
// Staking.sol.
export const MAX_SUPPLY = '42000000'; // 42M LEO
export const GENESIS_ALLOCATION = '21000000'; // minted at deploy to the 9 contributor wallets
export const EMISSION_ALLOCATION = '21000000'; // released by the halving schedule
export const FIRST_EPOCH_EMISSION = '10500000'; // EMISSION_ALLOCATION / 2
export const TOTAL_EMISSION = '21000000'; // matches EMISSION_ALLOCATION
export const BUCKET_COUNT = 5; // stakers + Builder + Coder + Compute + Research
export const EMISSION_DELAY_SECONDS = 24 * 60 * 60; // emission starts 24h after deploy
export const CONTRIBUTOR_COUNT = 9;

# HELEO (LEO)

HELEO token ecosystem on Ethereum: a 42,000,000 LEO fixed-supply token, staking with a
4-year halving emission split five ways, and cross-chain OFT (LayerZero).

Forked from Algeba.

## Tokenomics

| | |
|---|---|
| Max supply | 42,000,000 LEO |
| Genesis | 21,000,000 LEO minted at deploy, split equally across 9 contributor wallets |
| Emission | 21,000,000 LEO, halving every 4 years (10.5M in the first 4 years) |
| Emission start | Automatically 24 hours after Staking is deployed (staking is open immediately) |
| Emission split | 20% each: Stakers · Builder · Coder · Compute · Research |
| Idle staker share | Never minted when nobody is staked |
| Bucket wallets | Set at deploy; each wallet can hand off its own bucket (two-step) |
| Admin keys | None after `setStaking()` + `renounceOwnership()` |

## Structure

| Folder | Description |
|---|---|
| `Contracts/` | Solidity contracts (Foundry): `LEO`, `Staking`, `LEOOFT`, `LEOOFTAdapter` |
| `frontend/` | React + Vite + TypeScript dApp (Reown / wagmi / viem) |

## Getting started

```bash
# Frontend (also provides OpenZeppelin & LayerZero deps for the contracts)
cd frontend
npm install
cp .env.example .env   # fill in addresses, RPC URLs, Reown project ID
npm run dev

# Contracts
cd ../Contracts
forge build
forge test
```

> `Contracts/foundry.toml` remaps `@openzeppelin` and `@layerzerolabs` to `../frontend/node_modules`,
> so run `npm install` in `frontend/` before building the contracts. After changing a contract, run
> `npm run compile-contracts` in `frontend/` to refresh the ABIs/bytecode used by the Deploy page.

## Deploying

From the `/deploy` page (visible only to `VITE_DEPLOYER_WALLET`):

1. Deploy `LEO` with the 9 contributor wallets.
2. Deploy `Staking` with the halving period (4 years) and the Builder, Coder, Compute and Research wallets. The 24-hour clock starts here.
3. Call `LEO.setStaking(staking)` — within 24 hours, before emission starts.
4. Renounce `LEO` ownership.

## Status

Not yet independently audited. See the Security page.

# HELEO (LEO)

A fixed-supply ERC-20 on Ethereum whose emission is split equally, every second, between
stakers and the four groups who build the ecosystem.

| | |
|---|---|
| Network | Ethereum mainnet |
| Max supply | 42,000,000 LEO |
| Genesis | 21,000,000 LEO to 9 contributor wallets, minted at deploy |
| Emission | 21,000,000 LEO over a halving series |
| Halving | Every 4 years |
| Emission split | 5 × 20%: Stakers, Builder, Coder, Compute, Research |
| Emission start | 24 hours after the staking contract is deployed |
| Minimum stake | 1 LEO |
| Admin keys | None |

## 1. Supply

There will never be more than 42,000,000 LEO. It is a compiled constant, there is no public
mint, no owner who can raise it, and no upgrade proxy.

## 2. Genesis

The token constructor mints 21,000,000 LEO split equally across nine contributor wallets: the
core developers building the Morpheus ecosystem (mor.org) who are extending that work into
HELEO. Each receives ≈ 2,333,333.33 LEO (the first also gets the 3-wei rounding remainder).
Addresses must be non-zero and distinct. The allocation is unlocked at mint; there is no vesting.

## 3. The Series

The other 21,000,000 LEO are emitted continuously. Term T₀ (years 0–4) emits 10,500,000 LEO;
every following four-year Term emits half the previous one.

| Term | Years | Emission | Per bucket | Cumulative |
|---|---|---|---|---|
| T₀ | 0 – 4 | 10,500,000 | 2,100,000 | 10,500,000 |
| T₁ | 4 – 8 | 5,250,000 | 1,050,000 | 15,750,000 |
| T₂ | 8 – 12 | 2,625,000 | 525,000 | 18,375,000 |
| T₃ | 12 – 16 | 1,312,500 | 262,500 | 19,687,500 |
| … | | halves | halves | → 21,000,000 |

## 4. Five buckets

| Bucket | For | Paid how |
|---|---|---|
| Stakers | Everyone who stakes LEO | Pro rata, every second |
| Builder | Community building | One wallet claims |
| Coder | Developers | One wallet claims |
| Compute | GPU providers | One wallet claims |
| Research | Research | One wallet claims |

- The four ecosystem buckets accrue on schedule regardless of staking. Only each bucket's own
  wallet can call `claimBucket()`.
- A bucket wallet can hand its bucket to a new address in two steps
  (`proposeBucketRecipient()` → `acceptBucketRecipient()`). No admin can change them.
- The stakers' share for any period with nobody staked is **never minted**, so the final supply
  may land slightly below 42,000,000.

## 5. Fair start

Staking is open from deployment. Emission starts automatically 24 hours later, so everyone who
stakes in that window starts earning at the same moment.

## 6. Staking

Stake, claim, compound, unstake — no lock, no cooldown, no exit fee. `emergencyWithdraw()`
returns principal only and never touches minting. Minimum position 1 LEO.

## 7. Immutability

`LEO.setStaking()` is the only privileged function: one-time, irreversible, then ownership is
renounced. Staking has no owner; token, halving period and emission start are immutable. The
only mutable settings are the four bucket wallets, changeable only by their own current wallet.

## 8. Risk

LEO has no issuer, redemption, backing or guaranteed value, and nothing here is financial
advice. The contracts are immutable and not yet independently audited. Half the supply is held
by nine contributor wallets from the start, and four wallets receive 80% of emission.

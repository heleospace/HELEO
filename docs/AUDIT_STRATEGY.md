# HELEO Smart Contract Audit Strategy

Reference for every audit of the HELEO contracts. Run it whenever `LEO.sol` or
`Staking.sol` changes, and before any mainnet deployment.

## Goals

1. **Immutability** — nobody (owner, deployer, recipient, user) can change the
   emission timing, the supply caps, or any reward calculation after deploy.
2. **Asset safety** — every staker can always withdraw their principal plus the
   rewards they earned; no one can take, freeze, or dilute another user's funds.
3. **Distribution math** — the tokenomics design is fixed and *not* critiqued.
   The audit only verifies that the code distributes exactly what the design says.
4. **Per-function rating** — every external/public function gets an
   exploit-resistance grade backed by evidence.

## Scope

| In scope | Notes |
|---|---|
| `Contracts/LEO.sol` | Cap, genesis mint, mint authority |
| `Contracts/Staking.sol` | Emission schedule, reward index, buckets, staking flows |
| `Contracts/flattened/*.flat.sol` | Must compile on its own with solc 0.8.24 and match the sources in logic (Etherscan copies). Regenerate with `scripts/flatten.py`. |

Out of scope: OpenZeppelin and LayerZero libraries (trusted; only their *usage*
is reviewed), frontend, deploy scripts. `LEOOFT.sol` / `LEOOFTAdapter.sol` are
out of scope but get one informational note on owner/peer-config risk.

## Passes

### 1. Access-control map
For every function: caller restrictions, state written, tokens moved. For every
privileged role (LEO owner, bucket recipients, pending recipients) state the
worst-case action if that key is compromised.

### 2. Time & supply immutability
- `startTime`, `halvingPeriod`, `emissionDelay`, `token`, `rewardToken` are
  immutable and set safely (including the chain-ID delay branch — mainnet must
  be forced to the 24h delay).
- `staking` in LEO is set exactly once.
- Enumerate every path to `_mint`; prove `totalSupply ≤ 42,000,000 LEO` and
  `emissionMinted ≤ 21,000,000 LEO` hold forever.
- No dependence on manipulable inputs (balances via donation, `block.number`).

### 3. Distribution math
Compute expected values independently and compare with the contract:
- Genesis: for every contributor count 1–21, `21M / n` each, remainder (< n wei)
  to `contributors[0]`, sum exactly 21M; 0 and 22+ wallets rejected.
- Halving: epoch 0 emits 10.5M, each later epoch half the previous, 256 epochs,
  cumulative ≤ 21M; quantify rounding dust and where it ends up.
- `scheduledEmission(t)` is monotonic, continuous at epoch boundaries, and
  `emissionBetween(a,b) == scheduledEmission(b) - scheduledEmission(a)`.
- 5-bucket split sums to 100% of each emission slice; stakers' share while
  nobody stakes is handled as designed (not silently lost or double-counted).
- Reward index: precision (`1e36`), rounding direction (must favour the
  contract), overflow headroom at extremes (`MIN_STAKE` total stake, full
  supply staked, latest epoch).

### 4. Attack catalogue (asset safety)
Check each, record "ruled out" or "finding":
reentrancy · stake/claim front-running around halvings · first-staker / dust
inflation · reward double-claim across claim/compound/unstake/emergencyWithdraw ·
reward loss on emergency paths · rounding leakage over many ops · behaviour
after emission ends / cap reached · `_capToMintable` truncation fairness ·
griefing or locking other users · bucket recipient hijack via propose/accept ·
token-donation effects · DoS via loops or reverts in other users' paths.

### 5. Proof by test
Every hypothesis becomes a Foundry test (PoC or disproof). Extend invariant
suite with at least:
- `token.balanceOf(staking) ≥ totalStaked` (principal always covered)
- `LEO.totalSupply() ≤ MAX_SUPPLY`
- `emissionMinted + unminted accrued ≤ scheduledEmission(now)`
- No account withdraws more than deposits + rewards
Run `forge test`, fuzz with high runs, and Slither on the flattened files
(see `audit/REPORT.md` → Reproducing). Triage every Slither result in
HELEO code as true positive, intentional or false positive.
A finding without a test is labelled PLAUSIBLE, not CONFIRMED.

### 6. Report
Write `audit/REPORT.md`: summary, scope + commit hash, findings by severity,
distribution-math verification table, per-function rating table, test list.

## Severity

| Severity | Meaning |
|---|---|
| Critical | Theft of funds or unbounded mint, no preconditions |
| High | Theft / permanent freeze / supply break under realistic conditions |
| Medium | Loss of rewards, temporary freeze, or trusted-role abuse that hurts users |
| Low | Edge-case misbehaviour, dust-level loss |
| Info | Code quality, gas, documentation |

## Per-function rating (exploit-resistance)

| Grade | Meaning |
|---|---|
| **A** | Proven safe — covered by invariant/fuzz test, no admin influence |
| **B** | Safe on review; only cosmetic or dust-level issues |
| **C** | Safe only if a trusted role behaves (owner / recipient key) |
| **D** | Exploitable in narrow conditions, or funds can get stuck |
| **F** | Exploitable — funds stolen or supply inflated |

Each row: function · grade · one-line justification · evidence (test name).

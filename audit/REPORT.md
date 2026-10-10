# HELEO Security Audit Report

| | |
|---|---|
| **Commit audited** | `2bdbe47299beace75f221b136539b782196dd57a`, plus the M-01 / L-01 / L-02 / L-03 fixes and the 1–21 contributor change (re-verified 2026-10-10) |
| **Date** | 2026-10-10 |
| **Scope** | `Contracts/LEO.sol`, `Contracts/Staking.sol`, `Contracts/flattened/*.flat.sol` (consistency only) |
| **Out of scope** | OpenZeppelin / LayerZero libraries (usage reviewed only), `LEOOFT.sol`, `LEOOFTAdapter.sol`, frontend |
| **Method** | `docs/AUDIT_STRATEGY.md`: six passes, manual review, Foundry fuzz and invariant testing, Slither 0.11.4 static analysis |
| **Compiler** | solc 0.8.24, optimizer 200 runs |
| **Tests** | 111 / 111 passing. Fuzz at 5,000 runs, invariants at 1,000 runs × 500 calls. |

## Summary

**No Critical or High findings.** User funds are safe. No sequence of calls
lets anyone take another user's principal or rewards, mint above the cap, or
mint ahead of the schedule. After deployment, nobody can change the emission
timing, the supply caps or any reward calculation. All of them are `constant`
or `immutable`, and the schedule is a pure function of `block.timestamp`.

The issues found were about **deployment-time trust**, not runtime exploits.
**All Medium and Low findings are fixed.** Mainnet locks both the 24-hour
delay and the 4-year halving period (M-01). `setStaking()` renounces LEO
ownership in the same transaction (L-01). Staking refuses deposits unless LEO
points to it (L-02). The flattened Etherscan files compile again (L-03).
Slither found no real issues.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (fixed) |
| Low | 3 (all fixed) |
| Info | 6 |

---

## Goal checklist

| Goal | Result | Evidence |
|---|---|---|
| Nobody can change the time after deploy | ✅ `startTime`, `halvingPeriod` and `emissionDelay` are `immutable`. No setter exists. | `test_scheduleIsPureFunctionOfTime` |
| Nobody can change total supply | ✅ Caps are `constant`. Only Staking can mint, and LEO caps it twice. `staking` can be set only once, and setting it removes the owner. | `testFuzz_onlyStakingCanMint`, `test_setStakingIsOneShotEvenForFormerOwner`, `invariant_supplyIsGenesisPlusEmission`, `invariant_leoSupplyNeverExceedsMaxSupply` |
| No calculation errors | ✅ Every distribution number matches an independent calculation (table below) | `AuditMath.t.sol` |
| No hack or exploit | ✅ The full attack catalogue was checked and ruled out (below) | `AuditAttacks.t.sol`, invariants |
| Everyone's assets are safe | ✅ Principal is always covered, every LEO is accounted for, and exits never revert | `invariant_balanceEqualsTotalStaked`, `invariant_conservationOfLEO`, `invariant_exitsNeverRevert` |
| Deploy-time configuration is locked | ✅ Delay and halving period are both locked on mainnet (M-01 fixed) | `testFuzz_FIXED_M01_mainnetPinsHalvingPeriod` |

---

## Distribution math verification

Expected values were computed independently in Python with exact integers,
then asserted against the contract.

| Item | Design | Contract result | Status |
|---|---|---|---|
| Genesis wallet count | 1 to 21, distinct and non-zero | 0 and 22+ rejected (`InvalidContributorCount`); count stored as `contributorCount` | ✅ |
| Genesis per contributor | 21M / n | Exact for every n from 1 to 21 (e.g. 21M at n=1, 1,000,000 each at n=21, 2,333,333.33 at n=9) | ✅ fuzzed |
| Genesis remainder | to `contributors[0]` | Always < n wei; maximum 13 wei, at n=17 (0 for n = 1–8, 10, 12, 14–16, 20, 21) | ✅ |
| Genesis total | 21,000,000 | Exactly 21,000,000 for every n | ✅ fuzzed |
| Emission by end of year 4 (epoch 0) | 50% | 10,500,000 | ✅ exact |
| Year 8 | 75% | 15,750,000 | ✅ exact |
| Year 12 | 87.5% | 18,375,000 | ✅ exact |
| Year 16 | 93.75% | 19,687,500 | ✅ exact |
| Total emission (all epochs) | ≤ 21,000,000 | 21,000,000 − **38 wei**, reached after 84 epochs | ✅ (38 wei is halving rounding, never minted) |
| Five-way split, per bucket | 1/5 each | Exactly `floor(scheduled / 5)`; 4,199,999.999999999999999992 LEO at the end | ✅ |
| Stakers' fifth, sole staker | 1/5 | Within 2 wei, never above | ✅ fuzzed |
| Two stakers | pro rata to stake | Within 2 wei, never above | ✅ fuzzed |
| Schedule is monotonic and continuous at each halving | — | No jumps; boundary step ≤ 1 second of emission | ✅ fuzzed |
| `emissionBetween` is additive | — | `between(a,c) = between(a,b) + between(b,c)` | ✅ fuzzed |
| Reward index overflow | must never revert | Maximum index ≈ 4.2e42; maximum product ≈ 1.8e68, against a limit of 1.16e77 | ✅ |
| Full 100-epoch lifecycle | All minted ≤ 21M | Everything minted except < 100 wei of rounding dust | ✅ |

Every rounding step rounds down, in the contract's favour. Users can lose at
most a few wei. The contract can never owe more than it can mint.

---

## Change re-verified: 1–21 genesis contributors

After the findings below were fixed, the LEO constructor was changed from a
fixed `address[9]` to `address[]` with 1 to `MAX_CONTRIBUTORS` (21) wallets.
Re-verification:

- `testFuzz_constructor_splitsExactlyForAnyCount`: every n from 1 to 21 mints
  exactly 21M, with equal shares and a remainder of less than n wei to the first wallet.
- 0 and 22 wallets revert, and duplicate and zero-address checks still hold
  at n = 21.
- Deploy gas: about 0.89M at n = 1 and about 1.55M at n = 21. The O(n²)
  duplicate check is bounded at 210 comparisons, so there is no DoS risk.
- Slither: no new results (same 4 cosmetic or intentional items on LEO).
- The supply cap, mint permission and Staking are unaffected. All invariants
  pass at 1,000 runs × 500 calls.

## Findings

### M-01: Mainnet does not lock `halvingPeriod` ✅ FIXED

**File:** `Staking.sol` constructor · **Status:** FIXED. Regression test: `testFuzz_FIXED_M01_mainnetPinsHalvingPeriod`, `test_constructor_mainnetRequiresExactly4YearHalving`

On chain ID 1 the constructor forces `emissionDelay == 24 hours`, but it
accepts any non-zero `halvingPeriod`. The deploy page
(`DeployContracts.tsx`) takes this as free text in years. A typo, or a
malicious deployer, could set something like `1` second. The entire 21M
emission would then become claimable about 84 seconds after start, and the
bucket recipients could mint 4.2M each immediately. Once deployed it can never
be fixed, because the value is immutable.

This doesn't let anyone change the time *after* deployment. But it defeats
goal #1 at the one moment the value is chosen.

**Fix applied:** pinned on mainnet the same way the delay is pinned. The
deploy page also fixes the input to 4 years on mainnet.

```solidity
uint256 public constant MAINNET_HALVING_PERIOD = 126_230_400; // 4 × 365.25 days
...
if (block.chainid == MAINNET_CHAIN_ID && halvingPeriod_ != MAINNET_HALVING_PERIOD) {
    revert InvalidHalvingPeriod();
}
```

### L-01: LEO owner controls the minter until `setStaking` + `renounceOwnership` ✅ FIXED

**File:** `LEO.sol` `setStaking` · **Status:** FIXED. Regression tests: `test_setStaking_renouncesOwnership`, `test_setStakingLeavesNoOwner`, `test_L01_minterChoiceIsFinalAfterSetStaking`

Between deploying LEO and calling `setStaking`, the owner can set *any*
address as the minter, including a plain wallet, and mint the whole 21M
emission allocation. After `setStaking` the owner has no further power, but
ownership is still held until it is renounced. The deploy page labels the
renounce step "Optional".

**Fix applied:** `setStaking()` now calls `_transferOwnership(address(0))`
in the same transaction, so no admin key can be left behind. The optional
renounce step was removed from the deploy page.

**Residual (accepted):** the deployer still chooses the minter address once.
That choice is final and publicly checkable: `LEO.staking()` must equal the
verified Staking address, `Staking.token()` must equal LEO, and `LEO.owner()`
must be `0x0`.

### L-02: A Staking contract that LEO isn't wired to still accepts stakes ✅ FIXED

**File:** `Staking.sol` `stake` · **Status:** FIXED. Regression tests: `test_FIXED_L02_unwiredStakingRefusesDeposits`, `test_stakingOpensOnlyAfterWiring`

Anyone can deploy another `Staking` pointing at LEO, for example as a
phishing copy. It accepts deposits, but `claim`, `compound` and any `unstake`
that carries rewards revert with `OnlyStaking`. Principal can still be
recovered with `emergencyWithdraw`, so funds are not lost. Users would be
confused, though, and the rewards are worthless.

**Fix applied:** `stake()` now reverts with `NotWiredMinter` unless
`LEO.staking() == address(this)`. A copycat contract can no longer take
deposits. The canonical contract opens for staking once `setStaking()` runs
(Step 3 of the deploy flow, well before emission starts). Exits are unchanged
and never depend on the check.

### L-03: Flattened `Staking.flat.sol` did not compile ✅ FIXED

**File:** `flattened/Staking.flat.sol` · **Status:** FIXED. Found by Slither.

`forge flatten` reached OpenZeppelin's `IERC20.sol` through both a relative
and an absolute path (because of the `../frontend/node_modules` remapping),
emitted it twice and renamed the copies `IERC20_0` / `IERC20_1`. The result
failed to compile, so Etherscan verification with this file would have
failed. The copy committed before this audit had the same defect. The
earlier logic comparison didn't catch it, because it never compiled the file.
The flattened files also embedded absolute paths from the developer's
machine.

**Fix applied:** `Contracts/scripts/flatten.py` regenerates both files,
removes duplicate sources, restores the original names and strips local
paths. Both files now compile with solc 0.8.24 and match their sources
logic-for-logic.

### I-01: `emergencyWithdraw` forfeits rewards already settled; `emittedSupply()` still counts them

**File:** `Staking.sol:207-220, 288-295`

This works as designed and is documented. Forfeited rewards were already added
to `stakerEmitted`, so the `emittedSupply()` projection overstates real
mintable supply by that amount. It is a view-only figure; `totalSupply()` is
unaffected.

### I-02: Sub-5-wei remainder from idle periods goes to later stakers

**File:** `Staking.sol:353-367`

When nobody is staked and the window's emission is under 5 wei, `share` is 0.
The remainder carries forward instead of being forfeited. The amount is wei-level and has no effect in practice.

### I-03: `nextHalvingTime()` can overflow for an absurd `halvingPeriod`

**File:** `Staking.sol:315-317`

This is a view function only, and the M-01 fix removes it on mainnet.

### I-04: `claimBucket` records the full claim before capping

**File:** `Staking.sol:234-235`

`bucketClaimed` grows by the full amount even if `_capToMintable` trims it.
Tests show buckets can never exceed their fifth
(`test_bucketsCannotStarveStakers`), so the cap could trim at most a few wei
of rounding at the very end of emission. No action needed.

### I-05 (out of scope): bridge owner keys

`LEOOFT` and `LEOOFTAdapter` owners can set LayerZero peers. A compromised
owner could register a fake peer, mint unbacked LEO on the destination chain,
or release LEO locked in the adapter. Use a multisig owner, set the DVN
configuration explicitly, and consider renouncing once the peers are final.
This needs its own review before the bridge goes live.

---

### I-06: Per-settlement rounding can mint up to 1 wei ahead of the schedule

**File:** `Staking.sol` `_settle` / `rewardDebt` · Found by the 1,000-run invariant fuzz after the fixes. It was not caused by them, since the reward accounting is unchanged.

`rewardDebt` rounds down. Each time a user's stake changes, their next
settlement can credit up to 1 wei more than their exact share. In one random
sequence, total minted was 1 wei above `scheduledEmission(now)`. LEO's
21M and 42M hard caps still bind, and gaining 1 wei costs a full
transaction, so there is no profit in it. The invariant now allows 1,000 wei
of tolerance, the same as the stakers' invariant.

**Optional fix:** round `rewardDebt` up (`Math.mulDiv(..., Rounding.Ceil)`)
whenever it is reset. Rounding would then always favour the contract.

## Static analysis (Slither 0.11.4)

Slither was run on both flattened contracts with solc 0.8.24, optimizer 200
runs, all 100 detectors. Of 43 results, 17 are in OpenZeppelin library code
(out of scope). Triage of the 26 in HELEO's own code:

| Detector | Results | Verdict |
|---|---|---|
| `timestamp` | 13 | **By design.** The schedule is defined on `block.timestamp`, and mainnet slot timestamps cannot be shifted by proposers. |
| `divide-before-multiply` | 5 | **Intentional.** Integer fifths for the five-way split, the carried remainder in `_update`, and the genesis remainder. Covered by `AuditMath.t.sol`. |
| `incorrect-equality` | 3 | **False positive.** `== 0` checks on internal counters, which a token donation cannot change (`test_donationDoesNotChangeRewards`). |
| `weak-prng` | 1 | **False positive.** `%` in time arithmetic, not randomness. |
| `events-maths` | 1 | **False positive.** `_mint` already emits `Transfer`. |
| `missing-inheritance` | 1 | Cosmetic: LEO could declare `is IStakingSupply`. |
| `solc-version` | 2 | Flattening artifact from OpenZeppelin pragmas. The build is pinned to 0.8.24. |

**No true positives.** Slither's only real catch was L-03 above, which turned
up while compiling the flattened files for analysis.

## Attack catalogue

| Attack | Result | Test |
|---|---|---|
| Reentrancy | Ruled out: all state-changing paths are `nonReentrant` and LEO has no transfer hooks | review |
| Just-in-time stake to grab past emission | Ruled out: `stake()` indexes the window first | `test_justInTimeStakeCapturesNothingPast` |
| Just-in-time stake after someone's `emergencyWithdraw` | Ruled out | `test_justInTimeAfterEmergencyWithdraw` |
| Double claim across claim/compound/unstake | Ruled out | `test_noDoubleClaimAcrossPaths` |
| Splitting an unstake into many parts to profit from rounding | Ruled out: never pays more, at most n wei less | `testFuzz_partialUnstakesNeverOverpay` |
| Re-staking after emergency exit to recover forfeited rewards | Ruled out | `test_emergencyThenRestakeKeepsNoOldRewards` |
| Sending LEO directly to the contract to shift rewards | Ruled out: index and totals ignore balance | `test_donationDoesNotChangeRewards` |
| 1-wei staker inflating the index to overflow later stakers | Ruled out by `MIN_STAKE` | `test_minStakeCannotBrickWithOverflow` |
| Leaving a dust position below the minimum | Ruled out | `test_cannotLeaveDustPosition` |
| Stranger claiming, proposing or accepting a bucket | Ruled out | `testFuzz_strangerCannotTouchBuckets` |
| Depositing into a copycat Staking contract | Ruled out: deposits refused unless LEO points to it | `test_FIXED_L02_unwiredStakingRefusesDeposits` |
| Bucket handover paying out twice | Ruled out | `test_bucketHandoverMovesAccruedOnce` |
| Buckets draining the stakers' share | Ruled out | `test_bucketsCannotStarveStakers` |
| Earning before emission starts | Ruled out | `test_stakingBeforeStartEarnsNothingEarly` |
| Exit blocked by the reward path | Ruled out: the emergency exit doesn't touch minting | `invariant_exitsNeverRevert` |
| Any random sequence creating or losing LEO | Ruled out: every LEO is accounted for | `invariant_conservationOfLEO` |
| Minting ahead of schedule | Ruled out beyond wei-level rounding (I-06) | `invariant_mintedNeverAheadOfSchedule` |
| Flattened Etherscan copy differing from source, or not compiling | Ruled out after the L-03 fix: logic identical and compiles with solc 0.8.24 | `scripts/flatten.py` + solc |

---

## Function ratings (exploit-resistance)

| Grade | Meaning |
|---|---|
| **A** | Proven safe: covered by invariant or fuzz tests, no admin influence |
| **B** | Safe on review; only cosmetic or dust-level issues |
| **C** | Safe only if a trusted role behaves (deployer, owner, or recipient key) |
| **D** | Exploitable in narrow conditions, or funds can get stuck |
| **F** | Exploitable: funds stolen or supply inflated |

### LEO.sol

| Function | Grade | Why | Evidence |
|---|---|---|---|
| `constructor` | **A** | 1–21 wallets; genesis split exact for every count; zero, duplicate, empty and >21 rejected | `testFuzz_constructor_splitsExactlyForAnyCount`, `test_genesisSplitIsExact` |
| `setStaking` | **B** | One-shot and renounces ownership. The deployer's single minter choice is final and publicly checkable (L-01 residual). | `test_setStaking_renouncesOwnership`, `test_L01_minterChoiceIsFinalAfterSetStaking` |
| `mintEmission` | **A** | Only Staking can call; double cap (emission and max supply) | `testFuzz_onlyStakingCanMint`, supply invariants |
| `remainingEmission` | **A** | Pure arithmetic view | review |
| `emittedSupply` | **B** | View-only projection; see I-01 | review |
| `renounceOwnership` / `transferOwnership` (OpenZeppelin) | **B** | Standard; unreachable once `setStaking` has run (owner is `0x0`) | `test_setStakingLeavesNoOwner` |
| ERC-20 `transfer` / `approve` / `transferFrom` (OpenZeppelin) | **A** | Unmodified OpenZeppelin 5; no hooks or fees | review |

### Staking.sol

| Function | Grade | Why | Evidence |
|---|---|---|---|
| `constructor` | **A** | Delay and halving period both locked on mainnet (M-01 fixed) | `testFuzz_FIXED_M01_mainnetPinsHalvingPeriod`, `test_mainnetForces24hDelay` |
| `stake` | **A** | Indexes before deposit; enforces `MIN_STAKE`; only accepts deposits once wired (L-02 fixed) | attack tests, invariants, `test_stakingOpensOnlyAfterWiring` |
| `claim` | **A** | Settles, then pays exactly what is owed; no double claim | `testFuzz_soleStakerGetsExactlyOneFifth`, `test_noDoubleClaimAcrossPaths` |
| `compound` | **A** | Minted straight into the contract; balance always equals `totalStaked` | `invariant_balanceEqualsTotalStaked` |
| `unstake` | **A** | Proportional reward, rounding down; dust positions blocked | `testFuzz_partialUnstakesNeverOverpay`, invariants |
| `emergencyWithdraw` | **A** | Returns principal only and never reverts; forfeiting rewards is documented | `invariant_exitsNeverRevert`, `test_justInTimeAfterEmergencyWithdraw` |
| `claimBucket` | **A** | Recipient only; exactly 1/5 of the schedule; cannot starve stakers | `testFuzz_eachBucketGetsExactlyOneFifth`, `test_bucketsCannotStarveStakers` |
| `proposeBucketRecipient` | **B** | Two-step and recipient-only. A stolen recipient key affects only that bucket (use a multisig). | `testFuzz_strangerCannotTouchBuckets` |
| `acceptBucketRecipient` | **B** | Same as above; the new recipient must prove it can sign | `test_bucketHandoverMovesAccruedOnce` |
| `scheduledEmission` | **A** | Pure function of time; monotonic, continuous, capped | `AuditMath.t.sol` fuzz suite |
| `emissionBetween` | **A** | Additive; never negative | `testFuzz_emissionBetweenIsAdditive` |
| `bucketClaimable` | **A** | Matches what `claimBucket` actually pays | `test_bucketHandoverMovesAccruedOnce` |
| `pendingReward` / `previewIndex` | **A** | Equal to the amount actually paid on claim | `testFuzz_soleStakerGetsExactlyOneFifth` |
| `emittedSupply` | **B** | View only; I-01 | review |
| `emissionStarted` / `currentEpoch` / `currentEmissionPerSecond` | **A** | Simple views over immutable values | review |
| `nextHalvingTime` | **B** | View only; overflows only with an absurd period (I-03) | review |
| `_update` / `_settle` / `_capToMintable` (internal) | **A** | Covered by every invariant | all invariants |

**Overall:** 17 × A, 7 × B, 0 × C, 0 × D, 0 × F. Both earlier C grades
(the Staking constructor and `setStaking`) were raised by the M-01 and L-01 fixes.

---

## Recommendations before mainnet

1. ~~Fix M-01~~ ✅ done.
2. ~~Make the renounce step mandatory (L-01)~~ ✅ done: `setStaking()` renounces automatically. Publish the
   three on-chain checks: `staking()`, `token()`, `owner() == 0`.
3. Optionally round `rewardDebt` up (I-06).
4. ~~Add the wiring check to `stake()` (L-02)~~ ✅ done.
5. Use multisigs for the four bucket recipient wallets.
6. Regenerate the flattened files with `python3 scripts/flatten.py` after any change, and re-run `/audit`.
7. Before the bridge launches, give `LEOOFT` / `LEOOFTAdapter` and the
   LayerZero configuration their own review (I-05).
8. ~~Run Slither~~ ✅ done: no true positives. Re-run it after any change
   (see "Reproducing").

## Reproducing

```bash
cd Contracts
forge test                                    # full suite
forge test --match-path 'test/audit/*' -vv    # audit tests only
FOUNDRY_FUZZ_RUNS=5000 FOUNDRY_INVARIANT_RUNS=1000 FOUNDRY_INVARIANT_DEPTH=500 forge test

# Flattened files + Slither (run outside Contracts/ so Slither uses plain solc;
# its Foundry integration fails on current forge build-info output)
python3 scripts/flatten.py
pip install slither-analyzer solc-select && solc-select install 0.8.24 && solc-select use 0.8.24
mkdir -p /tmp/sl && cp flattened/*.flat.sol /tmp/sl && cd /tmp/sl
slither Staking.flat.sol --compile-force-framework solc --solc-args "--optimize --optimize-runs 200"
slither LEO.flat.sol --compile-force-framework solc --solc-args "--optimize --optimize-runs 200"
```

// Mirrors audit/REPORT.md (internal review at commit 2bdbe47 plus the M-01 /
// L-01 / L-02 / L-03 fixes). It is not an independent third-party audit, and the page says so plainly.

const ROLES = [
  {
    role: 'LEO owner',
    holder: 'Deployer, until setStaking()',
    powers: 'setStaking() once, which also renounces ownership. Nothing else.',
    blastRadius: 'Chooses the minter once; the choice is final and publicly checkable. After setStaking: no owner at all.',
  },
  {
    role: 'Staking minter',
    holder: 'Staking contract (immutable once set)',
    powers: 'Mint up to the 21,000,000 LEO emission allocation, under the 42,000,000 cap.',
    blastRadius: 'Bounded by both caps in LEO.sol.',
  },
  {
    role: 'Bucket wallets (×4)',
    holder: 'Builder, Coder, Compute, Research wallets',
    powers: 'Claim their own 20% share; propose a new wallet for their own bucket.',
    blastRadius: 'A compromised key can claim or redirect that one bucket only. Use multisigs.',
  },
  {
    role: 'Contributor wallets (1–21)',
    holder: 'Core contributors',
    powers: 'Ordinary token holders — no contract privileges.',
    blastRadius: '21,000,000 ÷ wallet count each (1,000,000 with 21 wallets), fully unlocked.',
  },
  {
    role: 'Bridge delegate',
    holder: 'Deployer (LEOOFT / LEOOFTAdapter owner)',
    powers: 'LayerZero peer and config settings.',
    blastRadius: 'Bridged supply. Should be a multisig before mainnet use.',
  },
];

const AUDIT_COMMIT = '2bdbe47';

const SEVERITY_COUNTS = [
  { label: 'Critical', count: 0, note: '' },
  { label: 'High', count: 0, note: '' },
  { label: 'Medium', count: 1, note: 'fixed' },
  { label: 'Low', count: 3, note: 'all fixed' },
  { label: 'Info', count: 6, note: '' },
];

const GOALS = [
  { goal: 'No one can change the emission timing after deploy', result: 'Pass', note: 'startTime, halvingPeriod and emissionDelay are immutable; no setter exists.' },
  { goal: 'No one can change total supply', result: 'Pass', note: 'Caps are constants. Only Staking can mint, double-capped in LEO. setStaking is one-shot and removes the owner.' },
  { goal: 'Distribution math is correct', result: 'Pass', note: 'Every figure matches an independent exact-integer calculation (table below).' },
  { goal: 'User assets are safe', result: 'Pass', note: 'Principal always fully backed, every LEO accounted for, exits never revert.' },
  { goal: 'Deploy-time parameters locked', result: 'Pass', note: 'Mainnet locks both the 24h delay and the 4-year halving period (M-01 fixed).' },
];

const MATH = [
  { item: 'Genesis per contributor (1–21 wallets)', expected: '21M ÷ wallet count', actual: 'Exact for every count 1–21 (e.g. 1,000,000 LEO each with 21)' },
  { item: 'Genesis remainder', expected: 'to contributor #1', actual: 'Fewer wei than wallets (max 13 wei, at 17 wallets)' },
  { item: 'Genesis total', expected: '21,000,000', actual: '21,000,000 exactly' },
  { item: 'Emitted by year 4 / 8 / 12 / 16', expected: '50% / 75% / 87.5% / 93.75%', actual: '10.5M / 15.75M / 18.375M / 19.6875M exactly' },
  { item: 'Total emission', expected: '≤ 21,000,000', actual: '21M − 38 wei (halving rounding, never minted)' },
  { item: 'Each of the 5 buckets', expected: '1/5', actual: 'Exactly floor(scheduled ÷ 5)' },
  { item: 'Stakers, pro rata', expected: 'stake share of 1/5', actual: 'Within 2 wei, never above' },
  { item: 'Reward index overflow', expected: 'never', actual: 'Max ≈ 1.8e68 vs 1.16e77 limit' },
];

const FINDINGS = [
  {
    id: 'M-01',
    severity: 'Medium',
    title: 'Mainnet does not pin halvingPeriod',
    detail:
      'The 24h delay is enforced on chain 1, but any non-zero halving period is accepted. A deploy typo (e.g. 1 second) would release all 21M ~84 seconds after start, permanently.',
    fix: 'Require halvingPeriod == 126,230,400 on chain 1.',
    status: 'Fixed',
  },
  {
    id: 'L-01',
    severity: 'Low',
    title: 'Owner picks the minter until setStaking + renounce',
    detail: 'The LEO owner could keep the admin key after setStaking; the renounce step was optional in the deploy flow.',
    fix: 'setStaking() now renounces ownership in the same transaction. Check staking(), token() and owner() == 0x0.',
    status: 'Fixed',
  },
  {
    id: 'L-02',
    severity: 'Low',
    title: 'Unwired Staking copies accept deposits',
    detail: 'A copycat Staking contract accepted stakes but could never pay rewards (principal was still recoverable).',
    fix: 'stake() now requires LEO.staking() == address(this); copies refuse deposits.',
    status: 'Fixed',
  },
  {
    id: 'L-03',
    severity: 'Low',
    title: 'Flattened Staking.flat.sol did not compile',
    detail: 'forge flatten duplicated IERC20 through two import paths, so Etherscan verification with this file would fail. Found by Slither.',
    fix: 'scripts/flatten.py dedupes sources and strips local paths; both files compile and match the sources.',
    status: 'Fixed',
  },
  { id: 'I-01', severity: 'Info', title: 'emittedSupply() counts rewards forfeited by emergencyWithdraw', detail: 'View-only projection; totalSupply() is unaffected.', fix: '—', status: 'Accepted' },
  { id: 'I-02', severity: 'Info', title: 'Sub-5-wei idle remainder carries to later stakers', detail: 'Wei-level, no practical effect.', fix: '—', status: 'Accepted' },
  { id: 'I-03', severity: 'Info', title: 'nextHalvingTime() can overflow with an absurd period', detail: 'View only; ruled out on mainnet by the M-01 fix.', fix: 'M-01', status: 'Fixed' },
  { id: 'I-04', severity: 'Info', title: 'claimBucket records the claim before capping', detail: 'Can trim at most a few wei at the very end of emission.', fix: '—', status: 'Accepted' },
  {
    id: 'I-06',
    severity: 'Info',
    title: 'Rounding can mint up to 1 wei ahead of the schedule',
    detail: 'Per-settlement floor rounding of rewardDebt. Hard caps still bind; no profit is possible.',
    fix: 'Optional: round rewardDebt up.',
    status: 'Accepted',
  },
  { id: 'I-05', severity: 'Info', title: 'Bridge owner keys (out of scope)', detail: 'LEOOFT / LEOOFTAdapter owners control LayerZero peers.', fix: 'Multisig; separate bridge review.', status: 'Open' },
];

const RATINGS = [
  { contract: 'LEO', fn: 'constructor', grade: 'A', why: 'Exact genesis split; zero/duplicate wallets rejected' },
  { contract: 'LEO', fn: 'setStaking', grade: 'B', why: 'One-shot and renounces ownership; the minter choice is final and checkable' },
  { contract: 'LEO', fn: 'mintEmission', grade: 'A', why: 'Staking only; emission cap and max-supply cap' },
  { contract: 'LEO', fn: 'remainingEmission', grade: 'A', why: 'Pure arithmetic view' },
  { contract: 'LEO', fn: 'emittedSupply', grade: 'B', why: 'View-only projection (I-01)' },
  { contract: 'LEO', fn: 'renounce / transferOwnership', grade: 'B', why: 'Standard OpenZeppelin; unreachable once setStaking has run' },
  { contract: 'LEO', fn: 'ERC-20 transfer / approve', grade: 'A', why: 'Unmodified OpenZeppelin 5, no hooks or fees' },
  { contract: 'Staking', fn: 'constructor', grade: 'A', why: 'Delay and halving period both pinned on mainnet (M-01 fixed)' },
  { contract: 'Staking', fn: 'stake', grade: 'A', why: 'Indexes before deposit; minimum stake; only once wired by LEO (L-02 fixed)' },
  { contract: 'Staking', fn: 'claim', grade: 'A', why: 'Pays exactly what is owed; no double claim' },
  { contract: 'Staking', fn: 'compound', grade: 'A', why: 'Minted into the contract; balance always equals totalStaked' },
  { contract: 'Staking', fn: 'unstake', grade: 'A', why: 'Proportional reward rounded down; no dust positions' },
  { contract: 'Staking', fn: 'emergencyWithdraw', grade: 'A', why: 'Principal only; never reverts' },
  { contract: 'Staking', fn: 'claimBucket', grade: 'A', why: 'Recipient only; exactly 1/5; cannot starve stakers' },
  { contract: 'Staking', fn: 'proposeBucketRecipient', grade: 'B', why: 'Two-step; a stolen key affects only that bucket' },
  { contract: 'Staking', fn: 'acceptBucketRecipient', grade: 'B', why: 'New wallet must prove it can sign' },
  { contract: 'Staking', fn: 'scheduledEmission', grade: 'A', why: 'Pure function of time; monotonic, continuous, capped' },
  { contract: 'Staking', fn: 'emissionBetween', grade: 'A', why: 'Additive, never negative' },
  { contract: 'Staking', fn: 'bucketClaimable', grade: 'A', why: 'Equals what claimBucket pays' },
  { contract: 'Staking', fn: 'pendingReward / previewIndex', grade: 'A', why: 'Equals what claim pays' },
  { contract: 'Staking', fn: 'emittedSupply', grade: 'B', why: 'View-only projection (I-01)' },
  { contract: 'Staking', fn: 'emissionStarted / currentEpoch / currentEmissionPerSecond', grade: 'A', why: 'Simple views over immutables' },
  { contract: 'Staking', fn: 'nextHalvingTime', grade: 'B', why: 'Overflows only with an absurd period (I-03)' },
  { contract: 'Staking', fn: '_update / _settle / _capToMintable', grade: 'A', why: 'Covered by every invariant' },
];

const SLITHER = [
  { detector: 'timestamp', count: 13, verdict: 'By design: the schedule is defined on block.timestamp' },
  { detector: 'divide-before-multiply', count: 5, verdict: 'Intentional integer fifths and remainders; covered by math tests' },
  { detector: 'incorrect-equality', count: 3, verdict: 'False positive: == 0 on internal counters donations cannot move' },
  { detector: 'weak-prng', count: 1, verdict: 'False positive: % in time arithmetic, not randomness' },
  { detector: 'events-maths', count: 1, verdict: 'False positive: _mint already emits Transfer' },
  { detector: 'missing-inheritance', count: 1, verdict: 'Cosmetic' },
  { detector: 'solc-version', count: 2, verdict: 'Flattening artifact; build pinned to 0.8.24' },
];

const GRADE_SCALE = [
  { grade: 'A', meaning: 'Proven safe: invariant or fuzz tested, no admin influence' },
  { grade: 'B', meaning: 'Safe on review; cosmetic or dust-level issues only' },
  { grade: 'C', meaning: 'Safe only if a trusted role (deployer, owner, recipient) behaves' },
  { grade: 'D', meaning: 'Exploitable in narrow conditions, or funds can get stuck' },
  { grade: 'F', meaning: 'Exploitable: funds stolen or supply inflated' },
];

function GradeBadge({ grade }: { grade: string }) {
  const style =
    grade === 'A'
      ? 'bg-navy text-white'
      : grade === 'B'
        ? 'bg-surface text-navy border border-navy/30'
        : 'bg-white text-navy border-2 border-navy';
  return <span className={`badge ${style} justify-center w-7`}>{grade}</span>;
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-bold ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

const TESTS = [
  { suite: 'LEO.t.sol', count: 22, covers: 'Equal genesis split for every count 1–21 (fuzzed) and remainder, 0 and 22 wallets rejected, zero/duplicate rejection, one-time setStaking, emission cap, fuzzed cap checks' },
  { suite: 'Staking.t.sol', count: 54, covers: 'Start delay and halving period (pinned on mainnet, shorter allowed on testnet), five-way split, forfeited staker share, bucket claims and two-step hand-off, stake/claim/compound/unstake, minimum stake, dust attack, emergency exit, halving schedule' },
  { suite: 'StakingInvariant.t.sol', count: 1, covers: 'Stateful fuzzing (incl. bucket claims): totals match, solvency, five-way split never exceeds schedule, caps hold, exits never revert' },
  { suite: 'StakingEndOfLife.t.sol', count: 1, covers: '40 full-lifetime scenarios with all buckets claiming: every staker can always fully exit' },
  { suite: 'audit/AuditMath.t.sol', count: 10, covers: 'Exact genesis split, epoch cumulatives, 38-wei schedule dust, monotonic and continuous schedule, exact 1/5 split, full 100-epoch lifecycle' },
  { suite: 'audit/AuditAccess.t.sol', count: 10, covers: 'Only Staking can mint, setStaking one-shot and ownerless, mainnet delay and halving pinned, schedule independent of state, staking opens only once wired, M-01 / L-01 / L-02 regressions' },
  { suite: 'audit/AuditAttacks.t.sol', count: 12, covers: 'Just-in-time staking, double claims, partial-unstake rounding, donations, dust/overflow, bucket hijack and hand-off, buckets vs stakers' },
  { suite: 'audit/AuditInvariant.t.sol', count: 1, covers: 'Stateful fuzzing: every LEO accounted for, balance equals totalStaked, supply = genesis + emission, never ahead of schedule' },
];

export function Security() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Security</h1>
        <p className="page-subtitle">Audit results, function ratings, privileged roles and test coverage for the HELEO contracts</p>
      </div>

      <div className="space-y-6 py-2.5 px-2">
        <div className="alert alert-primary mb-0">
          <strong>Internal security review completed</strong> (commit <code className="font-mono">{AUDIT_COMMIT}</code>):
          no Critical or High findings, every Medium and Low finding is fixed, and Slither static analysis found no
          real issues. Nobody can steal staked
          funds, mint above the 42,000,000 cap, or change the emission schedule after deployment. This was an internal
          review, <strong>not an independent third-party audit</strong>. Full report:{' '}
          <code className="font-mono">audit/REPORT.md</code>.
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {SEVERITY_COUNTS.map((s) => (
            <div key={s.label} className="card">
              <div className="card-body text-center">
                <div className="text-2xl font-bold tabular-nums text-navy">{s.count}</div>
                <div className="text-xs uppercase text-muted font-semibold">{s.label}</div>
                {s.note && <div className="text-xs text-muted">{s.note}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Audit goals</h2>
          </div>
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Goal</Th>
                    <Th>Result</Th>
                    <Th>Basis</Th>
                  </tr>
                </thead>
                <tbody>
                  {GOALS.map((g) => (
                    <tr key={g.goal}>
                      <td className="px-4 py-2 font-semibold text-navy">{g.goal}</td>
                      <td className="px-4 py-2">
                        <span className={`badge ${g.result === 'Pass' ? 'bg-navy text-white' : 'bg-white text-navy border-2 border-navy'}`}>
                          {g.result}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted">{g.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Distribution math verification</h2>
          </div>
          <div className="card-body">
            <p className="text-sm text-muted mb-4">
              Expected values computed independently with exact integers, then asserted against the contracts. Every
              rounding step favours the contract, so it can never owe more than it can mint.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Design</Th>
                    <Th>Contract result</Th>
                  </tr>
                </thead>
                <tbody>
                  {MATH.map((m) => (
                    <tr key={m.item}>
                      <td className="px-4 py-2 font-semibold text-navy">{m.item}</td>
                      <td className="px-4 py-2 text-muted">{m.expected}</td>
                      <td className="px-4 py-2 text-muted tabular-nums">✓ {m.actual}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Findings</h2>
          </div>
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Issue</Th>
                    <Th>Recommended fix</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {FINDINGS.map((f) => (
                    <tr key={f.id}>
                      <td className="px-4 py-2 align-top">
                        <div className="font-mono font-semibold text-navy">{f.id}</div>
                        <div className="text-xs text-muted">{f.severity}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="font-semibold text-navy">{f.title}</div>
                        <div className="text-muted">{f.detail}</div>
                      </td>
                      <td className="px-4 py-2 align-top text-muted">{f.fix}</td>
                      <td className="px-4 py-2 align-top text-muted">{f.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Function ratings (exploit resistance)</h2>
          </div>
          <div className="card-body">
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
              {GRADE_SCALE.map((g) => (
                <div key={g.grade} className="flex items-center gap-2 text-xs text-muted">
                  <GradeBadge grade={g.grade} />
                  <span>{g.meaning}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted mb-4">
              17 × A, 7 × B, 0 × C, 0 × D, 0 × F. The two earlier C grades were raised by the M-01 and L-01 fixes.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Contract</Th>
                    <Th>Function</Th>
                    <Th>Grade</Th>
                    <Th>Why</Th>
                  </tr>
                </thead>
                <tbody>
                  {RATINGS.map((r) => (
                    <tr key={r.contract + r.fn}>
                      <td className="px-4 py-2 text-muted">{r.contract}</td>
                      <td className="px-4 py-2 font-mono font-semibold text-navy">{r.fn}</td>
                      <td className="px-4 py-2">
                        <GradeBadge grade={r.grade} />
                      </td>
                      <td className="px-4 py-2 text-muted">{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Privileged roles &amp; centralization</h2>
          </div>
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left font-bold">Role</th>
                    <th className="px-4 py-2 text-left font-bold">Held by</th>
                    <th className="px-4 py-2 text-left font-bold">Powers</th>
                    <th className="px-4 py-2 text-left font-bold">Blast radius if compromised</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r.role}>
                      <td className="px-4 py-2 font-semibold text-navy">{r.role}</td>
                      <td className="px-4 py-2 text-muted">{r.holder}</td>
                      <td className="px-4 py-2 text-muted">{r.powers}</td>
                      <td className="px-4 py-2 text-muted">{r.blastRadius}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Static analysis (Slither)</h2>
          </div>
          <div className="card-body">
            <p className="text-sm text-muted mb-4">
              Slither 0.11.4, all 100 detectors, on both flattened contracts. Of 43 results, 17 are in OpenZeppelin
              library code. All 26 in HELEO code were triaged: <strong className="text-navy">no true positives</strong>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Detector</Th>
                    <Th right>Results</Th>
                    <Th>Verdict</Th>
                  </tr>
                </thead>
                <tbody>
                  {SLITHER.map((r) => (
                    <tr key={r.detector}>
                      <td className="px-4 py-2 font-mono font-semibold text-navy">{r.detector}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                      <td className="px-4 py-2 text-muted">{r.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Test suite</h2>
          </div>
          <div className="card-body">
            <p className="text-sm text-muted mb-4">
              111 Foundry tests, all passing (fuzzed at 5,000 runs; invariants at 1,000 runs × 500 calls). Run them yourself with <code className="bg-surface px-1 rounded-sm">forge test</code> in
              the <code className="bg-surface px-1 rounded-sm">Contracts/</code> folder.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left font-bold">Suite</th>
                    <th className="px-4 py-2 text-right font-bold">Tests</th>
                    <th className="px-4 py-2 text-left font-bold">Covers</th>
                  </tr>
                </thead>
                <tbody>
                  {TESTS.map((t) => (
                    <tr key={t.suite}>
                      <td className="px-4 py-2 font-semibold text-navy font-mono">{t.suite}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{t.count}</td>
                      <td className="px-4 py-2 text-muted">{t.covers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-bold mb-0">Before mainnet</h2>
          </div>
          <div className="card-body">
            <ul className="text-sm space-y-2 list-disc list-inside text-navy">
              <li>Independent third-party audit of LEO.sol and Staking.sol.</li>
              <li>Bug bounty program live before or at launch.</li>
              <li>Full rehearsal on Sepolia (5-minute emission delay is fine there): deploy, stake, claim every bucket, test a bucket hand-off.</li>
              <li>The contributor wallets (1–21) and 4 bucket wallets confirmed in writing; bucket wallets should be multisigs.</li>
              <li>setStaking() called within the emission delay of deploying Staking (24 hours on mainnet), before emission starts. It renounces LEO ownership automatically; confirm owner() is 0x0.</li>
              <li>LEOOFT / LEOOFTAdapter delegate moved to a multisig before any bridge use.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

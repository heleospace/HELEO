// HELEO is a new codebase derived from the Algeba contracts. It has not been
// audited yet, so this page states that plainly instead of carrying over
// Algeba's audit score and findings, which describe different contracts.

const ROLES = [
  {
    role: 'LEO owner',
    holder: 'Deployer, until renounced',
    powers: 'setStaking() once. Nothing else.',
    blastRadius: 'Before setStaking: could wire a malicious minter. After setStaking + renounce: none.',
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
    role: 'Contributor wallets (×9)',
    holder: 'Core contributors',
    powers: 'Ordinary token holders — no contract privileges.',
    blastRadius: '≈ 2,333,333 LEO each, fully unlocked.',
  },
  {
    role: 'Bridge delegate',
    holder: 'Deployer (LEOOFT / LEOOFTAdapter owner)',
    powers: 'LayerZero peer and config settings.',
    blastRadius: 'Bridged supply. Should be a multisig before mainnet use.',
  },
];

const TESTS = [
  { suite: 'LEO.t.sol', count: 14, covers: 'Equal 9-way genesis mint and remainder, zero/duplicate rejection, one-time setStaking, emission cap, fuzzed cap checks' },
  { suite: 'Staking.t.sol', count: 53, covers: 'Start delay (exactly 24h on mainnet, shorter allowed on testnet), five-way split, forfeited staker share, bucket claims and two-step hand-off, stake/claim/compound/unstake, minimum stake, dust attack, emergency exit, halving schedule' },
  { suite: 'StakingInvariant.t.sol', count: 1, covers: 'Stateful fuzzing (incl. bucket claims): totals match, solvency, five-way split never exceeds schedule, caps hold, exits never revert' },
  { suite: 'StakingEndOfLife.t.sol', count: 1, covers: '40 full-lifetime scenarios with all buckets claiming: every staker can always fully exit' },
];

export function Security() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Security</h1>
        <p className="page-subtitle">Audit status, privileged roles and test coverage for the HELEO contracts</p>
      </div>

      <div className="space-y-6 py-2.5 px-2">
        <div className="alert alert-danger mb-0">
          <strong>Not yet audited.</strong> LEO.sol and Staking.sol are new contracts. They reuse the staking
          design of the Algeba contracts, but the genesis mint, 24-hour start and five-bucket emission are new
          code that has not had an independent audit. Do not deploy to mainnet with real value until it has.
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
            <h2 className="text-lg font-bold mb-0">Test suite</h2>
          </div>
          <div className="card-body">
            <p className="text-sm text-muted mb-4">
              69 Foundry tests. Run them yourself with <code className="bg-surface px-1 rounded-sm">forge test</code> in
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
              <li>The 9 contributor wallets and 4 bucket wallets confirmed in writing; bucket wallets should be multisigs.</li>
              <li>setStaking() called within the emission delay of deploying Staking (24 hours on mainnet) (before emission starts), then LEO ownership renounced.</li>
              <li>LEOOFT / LEOOFTAdapter delegate moved to a multisig before any bridge use.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

import { useState } from 'react';
import { createWalletClient, custom, isAddress, getAddress } from 'viem';
import LEOArtifact from '../../contracts-artifacts/LEO.json';
import StakingArtifact from '../../contracts-artifacts/Staking.json';
import { StepShell, CopyButton, AddressCard, TxLine, type StepStatus } from './shared';
import { useNetwork } from '../../context/NetworkContext';
import { ensureChain } from '../../utils/chainSwitch';
import { createNetworkPublicClient } from '../../utils/publicClient';
import { BUCKETS } from '../../config/contracts';
import { MIN_CONTRIBUTORS, MAX_CONTRIBUTORS, EMISSION_DELAY_SECONDS, TESTNET_EMISSION_DELAY_SECONDS } from '../../config/constants';

const ZERO = '0x0000000000000000000000000000000000000000';

// Staking's halving period is in seconds (block.timestamp based). A year here is
// 365.25 days, so 4 years = 126,230,400 seconds exactly.
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
// Staking.sol only accepts exactly this halving period on Ethereum mainnet.
const MAINNET_HALVING_YEARS = '4';

function yearsToSeconds(years: string): number {
  return Math.round(parseFloat(years) * SECONDS_PER_YEAR);
}

function formatHalvingPreview(years: string): string | null {
  const seconds = yearsToSeconds(years);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const days = seconds / 86400;
  const human = days < 1
    ? `${(seconds / 3600).toFixed(2)} hours`
    : days < 365.25
      ? `${days.toFixed(1)} days`
      : `${(days / 365.25).toFixed(2)} years`;
  return `${seconds.toLocaleString()} seconds (≈ ${human}) per halving epoch`;
}

function formatDelay(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} seconds`;
}

// One address per line (commas also accepted). Returns the parsed list plus the
// first problem found, mirroring LEO's constructor checks: 1 to 21 wallets,
// non-zero, no duplicates.
function parseContributors(text: string): { list: string[]; error: string | null } {
  const list = text.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean);
  if (list.length === 0) return { list, error: null };
  const bad = list.find((a) => !isAddress(a));
  if (bad) return { list, error: `Not a valid address: ${bad}` };
  if (list.some((a) => a.toLowerCase() === ZERO)) return { list, error: 'The zero address is not allowed.' };
  const seen = new Set<string>();
  for (const a of list) {
    const key = a.toLowerCase();
    if (seen.has(key)) return { list, error: `Duplicate address: ${a}` };
    seen.add(key);
  }
  if (list.length > MAX_CONTRIBUTORS) {
    return { list, error: `Enter at most ${MAX_CONTRIBUTORS} addresses (you have ${list.length}).` };
  }
  return { list: list.map((a) => getAddress(a)), error: null };
}

export function DeployContracts({ walletAddress }: { walletAddress: string }) {
  const { network } = useNetwork();
  const publicClient = createNetworkPublicClient(network);

  const [contributorsText, setContributorsText] = useState('');
  const [halvingInput, setHalvingInput] = useState(MAINNET_HALVING_YEARS);
  const [bucketWallets, setBucketWallets] = useState<string[]>(['', '', '', '']);
  // Staking.sol only accepts exactly 24 hours on Ethereum mainnet; testnets may
  // start emission sooner so a full test run doesn't wait a day.
  const isMainnet = network.key === 'mainnet';
  const halvingYears = isMainnet ? MAINNET_HALVING_YEARS : halvingInput;
  const [testnetDelayMinutes, setTestnetDelayMinutes] = useState(String(TESTNET_EMISSION_DELAY_SECONDS / 60));
  const delaySeconds = isMainnet ? EMISSION_DELAY_SECONDS : Math.round(parseFloat(testnetDelayMinutes) * 60);
  const delayValid = Number.isFinite(delaySeconds) && delaySeconds >= 0;

  const contributors = parseContributors(contributorsText);
  const contributorCount = contributors.list.length;
  const contributorsReady =
    contributorCount >= MIN_CONTRIBUTORS && contributorCount <= MAX_CONTRIBUTORS && contributors.error === null;
  const bucketsReady = bucketWallets.every((a) => isAddress(a) && a.toLowerCase() !== ZERO);

  const [leoAddress, setLeoAddress] = useState<string | null>(null);
  const [leoTx, setLeoTx] = useState<string | null>(null);
  const [leoStatus, setLeoStatus] = useState<StepStatus>('active');
  const [leoError, setLeoError] = useState<string | null>(null);

  const [stakingAddress, setStakingAddress] = useState<string | null>(null);
  const [stakingTx, setStakingTx] = useState<string | null>(null);
  const [stakingStatus, setStakingStatus] = useState<StepStatus>('locked');
  const [stakingError, setStakingError] = useState<string | null>(null);
  const [emissionStart, setEmissionStart] = useState<bigint | null>(null);

  const [authTx, setAuthTx] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<StepStatus>('locked');
  const [authError, setAuthError] = useState<string | null>(null);

  const getWalletClient = async () => {
    if (!window.ethereum) throw new Error('MetaMask not installed');
    await ensureChain(network.chain);
    return createWalletClient({ chain: network.chain, transport: custom(window.ethereum) });
  };

  const deployLeo = async () => {
    if (!walletAddress || !contributorsReady) return;
    setLeoStatus('pending');
    setLeoError(null);
    try {
      const walletClient = await getWalletClient();
      const hash = await walletClient.deployContract({
        account: walletAddress as `0x${string}`,
        abi: LEOArtifact.abi,
        bytecode: LEOArtifact.bytecode as `0x${string}`,
        args: [contributors.list],
      });
      setLeoTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('No contract address in receipt');
      setLeoAddress(receipt.contractAddress);
      setLeoStatus('done');
      setStakingStatus('active');
    } catch (err) {
      console.error('LEO deploy failed:', err);
      setLeoError(err instanceof Error ? err.message : 'Deployment failed');
      setLeoStatus('error');
    }
  };

  const deployStaking = async () => {
    const halvingSeconds = yearsToSeconds(halvingYears);
    if (!walletAddress || !leoAddress || !bucketsReady || !delayValid || !Number.isFinite(halvingSeconds) || halvingSeconds <= 0) return;
    setStakingStatus('pending');
    setStakingError(null);
    try {
      const walletClient = await getWalletClient();
      const hash = await walletClient.deployContract({
        account: walletAddress as `0x${string}`,
        abi: StakingArtifact.abi,
        bytecode: StakingArtifact.bytecode as `0x${string}`,
        args: [leoAddress, BigInt(halvingSeconds), bucketWallets.map((a) => getAddress(a)), BigInt(delaySeconds)],
      });
      setStakingTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('No contract address in receipt');
      setStakingAddress(receipt.contractAddress);
      const start = await publicClient.readContract({
        address: receipt.contractAddress,
        abi: StakingArtifact.abi,
        functionName: 'startTime',
      });
      setEmissionStart(start as bigint);
      setStakingStatus('done');
      setAuthStatus('active');
    } catch (err) {
      console.error('Staking deploy failed:', err);
      setStakingError(err instanceof Error ? err.message : 'Deployment failed');
      setStakingStatus('error');
    }
  };

  const authorizeStaking = async () => {
    if (!walletAddress || !leoAddress || !stakingAddress) return;
    setAuthStatus('pending');
    setAuthError(null);
    try {
      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        account: walletAddress as `0x${string}`,
        address: leoAddress as `0x${string}`,
        abi: LEOArtifact.abi,
        functionName: 'setStaking',
        args: [stakingAddress],
      });
      setAuthTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      setAuthStatus('done');
    } catch (err) {
      console.error('Authorizing staking failed:', err);
      setAuthError(err instanceof Error ? err.message : 'Transaction failed');
      setAuthStatus('error');
    }
  };

  const allDone = authStatus === 'done';
  // Exact wei math, mirroring LEO's constructor: equal shares, remainder to the first wallet.
  const GENESIS_WEI = 21_000_000n * 10n ** 18n;
  const shareWei = contributorCount > 0 ? GENESIS_WEI / BigInt(contributorCount) : 0n;
  const remainderWei = contributorCount > 0 ? GENESIS_WEI - shareWei * BigInt(contributorCount) : 0n;
  const perContributor = (Number(shareWei / 10n ** 12n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div className="space-y-6">
      <div className="alert alert-primary mb-0">
        Deploying as <strong>{walletAddress}</strong> on <strong>{network.label}</strong>. Each step sends a real transaction and unlocks the next once confirmed.
        {network.key === 'mainnet' && ' This is Ethereum Mainnet — transactions cost real ETH and are irreversible.'}
      </div>

      <StepShell number={1} title="Deploy LEO.sol" status={leoStatus}>
        <p className="text-muted">
          Mints the 21,000,000 LEO genesis allocation at deploy, split equally across {MIN_CONTRIBUTORS} to{' '}
          {MAX_CONTRIBUTORS} contributor wallets. If the split isn't exact, the first wallet also gets the few wei
          left over. The deployer receives nothing. Cannot be changed after deployment.
        </p>
        <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1">
          Contributor wallets ({MIN_CONTRIBUTORS}–{MAX_CONTRIBUTORS}, one per line)
        </label>
        <textarea
          rows={9}
          value={contributorsText}
          onChange={(e) => setContributorsText(e.target.value)}
          disabled={leoStatus === 'done' || leoStatus === 'pending'}
          placeholder={'0x...\n0x...\n...'}
          className="w-full px-3 py-2 font-mono text-xs"
        />
        {contributors.error ? (
          <p className="text-xs text-navy mt-1">{contributors.error}</p>
        ) : (
          contributorsReady && (
            <p className="text-xs text-muted mt-1">
              {contributorCount} valid, distinct wallet{contributorCount === 1 ? '' : 's'}: ≈ {perContributor} LEO each
              {remainderWei > 0n && ` (the first also gets the ${remainderWei.toString()}-wei remainder)`}.
            </p>
          )
        )}
        {leoStatus !== 'done' && (
          <button
            onClick={deployLeo}
            disabled={leoStatus === 'pending' || !contributorsReady}
            className="w-full btn btn-primary py-3 font-semibold disabled:opacity-50 mt-2"
          >
            {leoStatus === 'pending' ? 'Confirming...' : 'Deploy LEO'}
          </button>
        )}
        {leoError && <p className="text-xs text-navy mt-1">{leoError}</p>}
        {leoTx && <TxLine hash={leoTx} explorerBase={network.explorerUrl} />}
        {leoAddress && <AddressCard address={leoAddress} explorerBase={network.explorerUrl} />}
      </StepShell>

      <StepShell number={2} title="Deploy Staking.sol" status={stakingStatus}>
        <p className="text-muted">
          Constructor arguments: LEO address, the halving period, the wallets for the four ecosystem buckets, and
          the emission delay. Staking opens once Step 3 authorizes it; <strong>emission starts automatically{' '}
          {delayValid ? formatDelay(delaySeconds) : '…'} after this transaction</strong>.
        </p>
        <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1">
          Emission delay (minutes)
        </label>
        {isMainnet ? (
          <>
            <input type="text" value="1440 (24 hours)" disabled />
            <p className="text-xs text-muted">Fixed on Ethereum mainnet — the contract rejects any other value.</p>
          </>
        ) : (
          <>
            <input
              type="number"
              step="any"
              min="0"
              value={testnetDelayMinutes}
              onChange={(e) => setTestnetDelayMinutes(e.target.value)}
              disabled={stakingStatus === 'done' || stakingStatus === 'pending'}
              placeholder="e.g. 5"
            />
            <p className="text-xs text-muted">
              Testnet only. Mainnet always uses 24 hours (1440 minutes).
            </p>
            {!delayValid && testnetDelayMinutes && <p className="text-xs text-navy mt-1">Enter 0 or more minutes.</p>}
          </>
        )}
        <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1">
          Halving Period (years)
        </label>
        {isMainnet ? (
          <input type="text" value="4 (fixed on Ethereum mainnet)" disabled />
        ) : (
          <input
            type="number"
            step="any"
            min="0"
            value={halvingInput}
            onChange={(e) => setHalvingInput(e.target.value)}
            disabled={stakingStatus === 'done' || stakingStatus === 'pending'}
            placeholder="e.g. 4"
          />
        )}
        {formatHalvingPreview(halvingYears) ? (
          <p className="text-xs text-muted">
            {formatHalvingPreview(halvingYears)}. Timestamp-based: each halving lands exactly this long after
            emission starts, regardless of Ethereum block time. Immutable after deployment.
            {isMainnet && ' Fixed on Ethereum mainnet — the contract rejects any other value.'}
          </p>
        ) : (
          halvingYears && <p className="text-xs text-navy mt-1">Enter a period greater than 0.</p>
        )}

        {BUCKETS.map((bucket, i) => (
          <div key={bucket.key}>
            <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1 mt-2">
              {bucket.name} wallet ({bucket.description})
            </label>
            <input
              type="text"
              value={bucketWallets[i]}
              onChange={(e) => setBucketWallets(bucketWallets.map((v, j) => (j === i ? e.target.value.trim() : v)))}
              disabled={stakingStatus === 'done' || stakingStatus === 'pending'}
              placeholder="0x..."
            />
            {bucketWallets[i] && !isAddress(bucketWallets[i]) && (
              <p className="text-xs text-navy mt-1">Not a valid address.</p>
            )}
          </div>
        ))}
        <p className="text-xs text-muted">
          Each wallet claims its own 20% of emission. A wallet can later hand its bucket to a new address (two-step:
          propose, then the new wallet accepts). No admin can change them.
        </p>

        {stakingStatus !== 'done' && stakingStatus !== 'locked' && (
          <button
            onClick={deployStaking}
            disabled={stakingStatus === 'pending' || !(yearsToSeconds(halvingYears) > 0) || !bucketsReady || !delayValid}
            className="w-full btn btn-primary py-3 font-semibold disabled:opacity-50 mt-2"
          >
            {stakingStatus === 'pending' ? 'Confirming...' : 'Deploy Staking'}
          </button>
        )}
        {stakingError && <p className="text-xs text-navy mt-1">{stakingError}</p>}
        {stakingTx && <TxLine hash={stakingTx} explorerBase={network.explorerUrl} />}
        {stakingAddress && <AddressCard address={stakingAddress} explorerBase={network.explorerUrl} />}
        {emissionStart !== null && (
          <p className="text-xs text-muted">
            Emission starts: <strong>{new Date(Number(emissionStart) * 1000).toLocaleString()}</strong>
          </p>
        )}
      </StepShell>

      <StepShell number={3} title="Authorize Staking as Minter" status={authStatus}>
        <p className="text-muted">
          Calls <code className="bg-surface px-1 rounded-sm">LEO.setStaking(stakingAddress)</code> so Staking can mint
          emission. Do this before emission starts (within the emission delay of Step 2).
        </p>
        <div className="alert alert-primary mt-2">
          This is final. The same transaction renounces LEO ownership, so the minter can never be changed and LEO has
          no owner afterwards. Check that the Staking address above is correct before confirming.
        </div>
        {authStatus !== 'done' && authStatus !== 'locked' && (
          <button
            onClick={authorizeStaking}
            disabled={authStatus === 'pending'}
            className="w-full btn btn-primary py-3 font-semibold disabled:opacity-50 mt-2"
          >
            {authStatus === 'pending' ? 'Confirming...' : 'Set Staking on LEO'}
          </button>
        )}
        {authError && <p className="text-xs text-navy mt-1">{authError}</p>}
        {authTx && <TxLine hash={authTx} explorerBase={network.explorerUrl} />}
        {authStatus === 'done' && (
          <p className="text-xs text-muted mt-1">Staking authorized and LEO ownership renounced — LEO now has no owner.</p>
        )}
      </StepShell>


      {allDone && (() => {
        const suffix = network.key === 'mainnet' ? 'MAINNET' : 'SEPOLIA';
        const envSnippet = `VITE_LEO_ADDRESS_${suffix}=${leoAddress}\nVITE_STAKING_ADDRESS_${suffix}=${stakingAddress}`;
        return (
          <div className="card">
            <div className="card-header flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold mb-0">Deployment Complete</h2>
              <CopyButton text={envSnippet} />
            </div>
            <div className="card-body space-y-3">
              <p className="text-sm text-muted">Update your frontend <code className="bg-surface px-1 rounded-sm">.env</code> with these addresses:</p>
              <pre className="bg-surface border border-platinum-dark rounded-md p-4 overflow-x-auto text-xs">
                <code>{envSnippet}</code>
              </pre>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { createWalletClient, custom, isAddress, getAddress } from 'viem';
import LEOArtifact from '../../contracts-artifacts/LEO.json';
import StakingArtifact from '../../contracts-artifacts/Staking.json';
import { StepShell, CopyButton, AddressCard, TxLine, type StepStatus } from './shared';
import { useNetwork } from '../../context/NetworkContext';
import { ensureChain } from '../../utils/chainSwitch';
import { createNetworkPublicClient } from '../../utils/publicClient';
import { BUCKETS } from '../../config/contracts';
import { CONTRIBUTOR_COUNT } from '../../config/constants';

const ZERO = '0x0000000000000000000000000000000000000000';

// Staking's halving period is in seconds (block.timestamp based). A year here is
// 365.25 days, so 4 years = 126,230,400 seconds exactly.
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

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

// One address per line (commas also accepted). Returns the parsed list plus the
// first problem found, mirroring LEO's constructor checks: exactly 9, non-zero,
// no duplicates.
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
  if (list.length !== CONTRIBUTOR_COUNT) {
    return { list, error: `Enter exactly ${CONTRIBUTOR_COUNT} addresses (you have ${list.length}).` };
  }
  return { list: list.map((a) => getAddress(a)), error: null };
}

export function DeployContracts({ walletAddress }: { walletAddress: string }) {
  const { network } = useNetwork();
  const publicClient = createNetworkPublicClient(network);

  const [contributorsText, setContributorsText] = useState('');
  const [halvingYears, setHalvingYears] = useState('4');
  const [bucketWallets, setBucketWallets] = useState<string[]>(['', '', '', '']);

  const contributors = parseContributors(contributorsText);
  const contributorsReady = contributors.list.length === CONTRIBUTOR_COUNT && contributors.error === null;
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

  const [renounceTx, setRenounceTx] = useState<string | null>(null);
  const [renounceStatus, setRenounceStatus] = useState<StepStatus>('active');
  const [renounceError, setRenounceError] = useState<string | null>(null);
  const [renounceConfirmed, setRenounceConfirmed] = useState(false);
  const [renounceAddressInput, setRenounceAddressInput] = useState('');
  const [renounceOwner, setRenounceOwner] = useState<string | null>(null);
  const [renounceOwnerError, setRenounceOwnerError] = useState<string | null>(null);
  const [checkingOwner, setCheckingOwner] = useState(false);

  // Defaults to whatever Step 1 deployed this session; falls back to manual
  // entry so this step works standalone for a contract deployed earlier.
  const renounceTargetAddress = renounceAddressInput || leoAddress || '';

  useEffect(() => {
    if (!isAddress(renounceTargetAddress)) {
      setRenounceOwner(null);
      setRenounceOwnerError(null);
      return;
    }
    let cancelled = false;
    setCheckingOwner(true);
    setRenounceOwnerError(null);
    publicClient
      .readContract({
        address: renounceTargetAddress as `0x${string}`,
        abi: LEOArtifact.abi,
        functionName: 'owner',
      })
      .then((result) => {
        if (!cancelled) setRenounceOwner(result as string);
      })
      .catch(() => {
        if (!cancelled) {
          setRenounceOwner(null);
          setRenounceOwnerError('Could not read owner() — is this a LEO contract on the selected network?');
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingOwner(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renounceTargetAddress, network.key]);

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
    if (!walletAddress || !leoAddress || !bucketsReady || !Number.isFinite(halvingSeconds) || halvingSeconds <= 0) return;
    setStakingStatus('pending');
    setStakingError(null);
    try {
      const walletClient = await getWalletClient();
      const hash = await walletClient.deployContract({
        account: walletAddress as `0x${string}`,
        abi: StakingArtifact.abi,
        bytecode: StakingArtifact.bytecode as `0x${string}`,
        args: [leoAddress, BigInt(halvingSeconds), bucketWallets.map((a) => getAddress(a))],
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
      setRenounceStatus('active');
    } catch (err) {
      console.error('Authorizing staking failed:', err);
      setAuthError(err instanceof Error ? err.message : 'Transaction failed');
      setAuthStatus('error');
    }
  };

  // setStaking() is a one-time setter (reverts once staking != address(0)), so
  // once Step 3 has run, owner has no remaining capability on LEO at all —
  // renouncing here gives up nothing functional, only proves it publicly.
  const renounceLeo = async () => {
    if (!walletAddress || !isAddress(renounceTargetAddress) || !renounceConfirmed) return;
    setRenounceStatus('pending');
    setRenounceError(null);
    try {
      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        account: walletAddress as `0x${string}`,
        address: renounceTargetAddress as `0x${string}`,
        abi: LEOArtifact.abi,
        functionName: 'renounceOwnership',
        args: [],
      });
      setRenounceTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      setRenounceStatus('done');
    } catch (err) {
      console.error('Renouncing LEO ownership failed:', err);
      setRenounceError(err instanceof Error ? err.message : 'Transaction failed');
      setRenounceStatus('error');
    }
  };

  const allDone = authStatus === 'done';
  const perContributor = (21_000_000 / CONTRIBUTOR_COUNT).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div className="space-y-6">
      <div className="alert alert-primary mb-0">
        Deploying as <strong>{walletAddress}</strong> on <strong>{network.label}</strong>. Each step sends a real transaction and unlocks the next once confirmed.
        {network.key === 'mainnet' && ' This is Ethereum Mainnet — transactions cost real ETH and are irreversible.'}
      </div>

      <StepShell number={1} title="Deploy LEO.sol" status={leoStatus}>
        <p className="text-muted">
          Mints the 21,000,000 LEO genesis allocation at deploy, split equally across {CONTRIBUTOR_COUNT} contributor
          wallets (≈ {perContributor} LEO each; the first wallet also gets the 3-wei rounding remainder). The deployer
          receives nothing. Cannot be changed after deployment.
        </p>
        <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1">
          Contributor wallets ({CONTRIBUTOR_COUNT}, one per line)
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
          contributorsReady && <p className="text-xs text-muted mt-1">{CONTRIBUTOR_COUNT} valid, distinct wallets.</p>
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
          Constructor arguments: LEO address, the halving period, and the wallets for the four ecosystem buckets.
          Staking opens immediately; <strong>emission starts automatically 24 hours after this transaction</strong>.
        </p>
        <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1">
          Halving Period (years)
        </label>
        <input
          type="number"
          step="any"
          min="0"
          value={halvingYears}
          onChange={(e) => setHalvingYears(e.target.value)}
          disabled={stakingStatus === 'done' || stakingStatus === 'pending'}
          placeholder="e.g. 4"
        />
        {formatHalvingPreview(halvingYears) ? (
          <p className="text-xs text-muted">
            {formatHalvingPreview(halvingYears)}. Timestamp-based: each halving lands exactly this long after
            emission starts, regardless of Ethereum block time. Immutable after deployment.
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
            disabled={stakingStatus === 'pending' || !(yearsToSeconds(halvingYears) > 0) || !bucketsReady}
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
          emission. Do this before emission starts (within 24 hours of Step 2).
        </p>
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
      </StepShell>

      <StepShell number={4} title="Renounce LEO Ownership (Optional)" status={renounceStatus}>
        <p className="text-muted">
          <code className="bg-surface px-1 rounded-sm">setStaking()</code> can only ever be called once, so after it has
          run the owner key has no remaining capability on LEO — no mint switch, no pause, nothing. Renouncing here
          gives up no real power; it just proves that publicly on-chain. Works standalone: defaults to the address from
          Step 1 above if you deployed it this session, or enter any LEO address you own below.
        </p>
        {renounceStatus !== 'done' && (
          <>
            <label className="text-xs text-muted uppercase font-medium tracking-wide block mb-1 mt-2">
              LEO Address
            </label>
            <input
              type="text"
              value={renounceAddressInput}
              onChange={(e) => setRenounceAddressInput(e.target.value)}
              disabled={renounceStatus === 'pending'}
              placeholder={leoAddress || '0x...'}
            />

            {renounceTargetAddress && !isAddress(renounceTargetAddress) && (
              <p className="text-xs text-navy mt-1">Not a valid address.</p>
            )}
            {isAddress(renounceTargetAddress) && checkingOwner && (
              <p className="text-xs text-muted mt-1">Checking current owner…</p>
            )}
            {isAddress(renounceTargetAddress) && renounceOwnerError && (
              <p className="text-xs text-navy mt-1">{renounceOwnerError}</p>
            )}
            {isAddress(renounceTargetAddress) && renounceOwner && (
              renounceOwner === ZERO ? (
                <p className="text-xs text-muted mt-1">Already renounced — owner is the zero address.</p>
              ) : (
                <>
                  <p className="text-xs text-muted mt-1">
                    Current owner: <span className="text-navy font-semibold">{renounceOwner}</span>
                  </p>
                  {walletAddress && renounceOwner.toLowerCase() !== walletAddress.toLowerCase() && (
                    <p className="text-xs text-navy mt-1">
                      Your connected wallet ({walletAddress}) does not match this owner — the transaction will revert.
                    </p>
                  )}
                </>
              )
            )}

            {renounceOwner && renounceOwner !== ZERO && (
              <>
                <div className="alert alert-primary mt-2">
                  This is permanent and cannot be undone. Only do this once you're certain LEO is configured correctly.
                </div>
                <label className="flex items-center gap-2 text-xs text-muted mt-2">
                  <input
                    type="checkbox"
                    checked={renounceConfirmed}
                    onChange={(e) => setRenounceConfirmed(e.target.checked)}
                    disabled={renounceStatus === 'pending'}
                  />
                  I understand this is irreversible and want to renounce ownership of LEO.
                </label>
                <button
                  onClick={renounceLeo}
                  disabled={renounceStatus === 'pending' || !renounceConfirmed}
                  className="w-full btn btn-primary py-3 font-semibold disabled:opacity-50 mt-2"
                >
                  {renounceStatus === 'pending' ? 'Confirming...' : 'Renounce LEO Ownership'}
                </button>
              </>
            )}
          </>
        )}
        {renounceError && <p className="text-xs text-navy mt-1">{renounceError}</p>}
        {renounceTx && <TxLine hash={renounceTx} explorerBase={network.explorerUrl} />}
        {renounceStatus === 'done' && (
          <p className="text-xs text-muted mt-1">Ownership renounced — LEO now has no owner.</p>
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

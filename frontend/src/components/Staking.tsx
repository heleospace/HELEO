import { useCallback, useEffect, useMemo, useState } from 'react';
import { getUserData } from '../utils/web3';
import { formatBigInt } from '../utils/formatting';
import { useWallet } from '../context/WalletContext';
import { useNetwork } from '../context/NetworkContext';
import { ensureChain } from '../utils/chainSwitch';
import { createNetworkPublicClient } from '../utils/publicClient';
import { createWalletClient, custom, maxUint256, parseEther, formatEther, type Address, type Hash } from 'viem';
import { STAKING_ABI, LEO_ABI } from '../config/contracts';
import leoIcon from '../assets/icon-heleo.png';

// Mirrors Staking.MIN_STAKE: a position must be 0 or at least 1 LEO.
const MIN_STAKE = 10n ** 18n;

// Exact decimal-string -> wei. Float math (parseFloat * 1e18) loses precision on
// larger amounts, which could leave a few wei staked on "unstake ALL" — and the
// contract rejects any leftover below MIN_STAKE.
function toWei(value: string): bigint | null {
  if (!value || !value.trim()) return null;
  try {
    const wei = parseEther(value.trim() as `${number}`);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

type Tab = 'stake' | 'manage';
type Action = 'approve' | 'stake' | 'unstake' | 'claim' | 'compound' | 'emergency';

// Wallet rejections and reverts arrive as long viem errors; show the short reason.
function errorMessage(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return e?.shortMessage || e?.message || 'Transaction failed';
}

function PercentButtons({ onPick }: { onPick: (pct: number) => void }) {
  return (
    <div className="flex gap-1">
      {[25, 50, 75].map((pct) => (
        <button key={pct} type="button" onClick={() => onPick(pct)} className="btn btn-secondary text-xs py-1 px-2">
          {pct}%
        </button>
      ))}
      <button type="button" onClick={() => onPick(100)} className="btn btn-primary text-xs py-1 px-2">
        ALL
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-md border border-platinum bg-surface">
      <p className="text-xs text-muted uppercase font-medium tracking-wide">{label}</p>
      <p className="text-lg font-bold text-navy tabular-nums mt-1 break-all">{value}</p>
    </div>
  );
}

export function Staking() {
  const { walletAddress: address, isConnected, isConnecting, connect } = useWallet();
  const { network } = useNetwork();

  const [tab, setTab] = useState<Tab>('stake');
  const [loaded, setLoaded] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pendingReward, setPendingReward] = useState(0n);
  const [stakedAmount, setStakedAmount] = useState(0n);
  const [leoBalance, setLeoBalance] = useState(0n);
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [emergencyConfirmed, setEmergencyConfirmed] = useState(false);
  const [emissionStart, setEmissionStart] = useState<bigint | null>(null);

  const publicClient = useMemo(() => createNetworkPublicClient(network), [network]);
  const contractsConfigured = Boolean(network.contracts.LEO && network.contracts.STAKING);

  const refresh = useCallback(async () => {
    if (!address || !contractsConfigured) return;
    try {
      const [userData, balance] = await Promise.all([
        getUserData(publicClient, address, network.contracts),
        publicClient.readContract({
          address: network.contracts.LEO as Address,
          abi: LEO_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
      ]);
      // On a failed read keep the numbers already on screen.
      if (userData) {
        setPendingReward(userData.pendingReward || 0n);
        setStakedAmount(userData.stakingInfo?.amount || 0n);
      }
      setLeoBalance(balance || 0n);
      setLoaded(true);
    } catch (error) {
      console.error('Error fetching staking data:', error);
    }
  }, [address, contractsConfigured, publicClient, network.contracts]);

  // Emission starts 24h after deploy on mainnet (Staking.startTime). Until then staking is
  // open but nothing accrues, so every early staker starts at the same moment.
  useEffect(() => {
    setEmissionStart(null);
    if (!contractsConfigured) return;
    publicClient
      .readContract({
        address: network.contracts.STAKING as Address,
        abi: STAKING_ABI,
        functionName: 'startTime',
      })
      .then(setEmissionStart)
      .catch((error) => console.error('Error fetching emission start:', error));
  }, [contractsConfigured, publicClient, network.contracts]);

  useEffect(() => {
    setLoaded(false);
    setPendingReward(0n);
    setStakedAmount(0n);
    setLeoBalance(0n);
    if (!isConnected || !address) return;
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, refresh]);

  const sendTx = async (
    kind: Action,
    request: (wallet: ReturnType<typeof createWalletClient>, account: Address) => Promise<Hash>,
  ) => {
    if (!window.ethereum) throw new Error('No wallet extension detected');
    await ensureChain(network.chain);
    const wallet = createWalletClient({ chain: network.chain, transport: custom(window.ethereum) });
    setAction(kind);
    const hash = await request(wallet, address as Address);
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const run = async (label: string, first: Action, steps: () => Promise<void>) => {
    // Mark busy immediately so a double click can't start a second transaction
    // while the chain switch / allowance read is still in flight.
    setAction(first);
    setNotice(null);
    try {
      await steps();
      setNotice({ kind: 'ok', text: `${label} confirmed.` });
    } catch (error) {
      console.error(`${label} failed:`, error);
      setNotice({ kind: 'error', text: `${label} failed: ${errorMessage(error)}` });
    } finally {
      setAction(null);
      await refresh();
    }
  };

  const setStakePercentage = (pct: number) => setStakeAmount(formatEther((leoBalance * BigInt(pct)) / 100n));
  const setUnstakePercentage = (pct: number) => setUnstakeAmount(formatEther((stakedAmount * BigInt(pct)) / 100n));

  const stakeWei = toWei(stakeAmount);
  const stakeError = !stakeAmount
    ? null
    : stakeWei === null
      ? 'Enter a valid amount.'
      : stakeWei > leoBalance
        ? 'Amount exceeds your LEO balance.'
        : stakedAmount + stakeWei < MIN_STAKE
          ? 'Minimum stake is 1 LEO.'
          : null;

  const unstakeWei = toWei(unstakeAmount);
  const unstakeRemaining = unstakeWei !== null && unstakeWei <= stakedAmount ? stakedAmount - unstakeWei : null;
  const unstakeError = !unstakeAmount
    ? null
    : unstakeWei === null
      ? 'Enter a valid amount.'
      : unstakeWei > stakedAmount
        ? 'Amount exceeds your staked position.'
        : unstakeRemaining !== null && unstakeRemaining > 0n && unstakeRemaining < MIN_STAKE
          ? `This would leave ${formatEther(unstakeRemaining)} LEO staked, below the 1 LEO minimum. Unstake everything, or leave at least 1 LEO.`
          : null;

  const busy = action !== null;

  const handleStake = () => {
    if (stakeWei === null || stakeError) return;
    const amount = stakeWei;
    return run('Stake', 'stake', async () => {
      // stake() pulls LEO via transferFrom; without approval gas estimation
      // fails with a confusing error instead of "insufficient allowance".
      const allowance = await publicClient.readContract({
        address: network.contracts.LEO as Address,
        abi: LEO_ABI,
        functionName: 'allowance',
        args: [address as Address, network.contracts.STAKING as Address],
      });
      if (allowance < amount) {
        await sendTx('approve', (wallet, account) =>
          wallet.writeContract({
            account,
            chain: network.chain,
            address: network.contracts.LEO as Address,
            abi: LEO_ABI,
            functionName: 'approve',
            args: [network.contracts.STAKING as Address, maxUint256],
          }),
        );
      }
      await sendTx('stake', (wallet, account) =>
        wallet.writeContract({
          account,
          chain: network.chain,
          address: network.contracts.STAKING as Address,
          abi: STAKING_ABI,
          functionName: 'stake',
          args: [amount],
        }),
      );
      setStakeAmount('');
    });
  };

  const handleUnstake = () => {
    if (unstakeWei === null || unstakeError) return;
    const amount = unstakeWei;
    return run('Unstake', 'unstake', async () => {
      await sendTx('unstake', (wallet, account) =>
        wallet.writeContract({
          account,
          chain: network.chain,
          address: network.contracts.STAKING as Address,
          abi: STAKING_ABI,
          functionName: 'unstake',
          args: [amount],
        }),
      );
      setUnstakeAmount('');
    });
  };

  const handleReward = (kind: 'claim' | 'compound') =>
    run(kind === 'claim' ? 'Claim' : 'Compound', kind, () =>
      sendTx(kind, (wallet, account) =>
        wallet.writeContract({
          account,
          chain: network.chain,
          address: network.contracts.STAKING as Address,
          abi: STAKING_ABI,
          functionName: kind,
          args: [],
        }),
      ),
    );

  const handleEmergencyWithdraw = () => {
    if (!emergencyConfirmed) return;
    return run('Emergency withdraw', 'emergency', async () => {
      await sendTx('emergency', (wallet, account) =>
        wallet.writeContract({
          account,
          chain: network.chain,
          address: network.contracts.STAKING as Address,
          abi: STAKING_ABI,
          functionName: 'emergencyWithdraw',
          args: [],
        }),
      );
      setEmergencyConfirmed(false);
    });
  };

  const handleAddToWallet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: network.contracts.LEO,
            symbol: 'LEO',
            decimals: 18,
            image: new URL(leoIcon, window.location.origin).toString(),
          },
        },
      });
    } catch (error) {
      console.error('Error adding token to wallet:', error);
    }
  };

  if (!contractsConfigured) {
    return (
      <div className="card">
        <p className="text-muted text-center py-12">
          No Staking contract configured for {network.label}. Switch networks above or deploy from the Deploy page.
        </p>
      </div>
    );
  }

  const header = (
    <div className="card-header">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h3 className="text-lg font-bold mb-0">Staking</h3>
        {isConnected && (
          <div className="tabs" role="tablist" aria-label="Staking actions">
            <button role="tab" aria-selected={tab === 'stake'} className={`tab${tab === 'stake' ? ' active' : ''}`} onClick={() => setTab('stake')}>
              Stake
            </button>
            <button role="tab" aria-selected={tab === 'manage'} className={`tab${tab === 'manage' ? ' active' : ''}`} onClick={() => setTab('manage')}>
              Unstake · Claim · Compound
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="card">
        {header}
        <div className="card-body text-center py-12 space-y-4">
          <p className="text-muted">Connect your wallet to stake, unstake, claim and compound.</p>
          <button onClick={() => connect().catch((e) => console.error(e))} disabled={isConnecting} className="btn btn-primary px-6 py-2.5 font-semibold disabled:opacity-50">
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </div>
      </div>
    );
  }

  const show = (value: bigint) => (loaded ? formatBigInt(value) : '…');
  const beforeStart = emissionStart !== null && BigInt(Math.floor(Date.now() / 1000)) < emissionStart;

  return (
    <div className="card">
      {header}
      <div className="card-body space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Metric label="Wallet Balance" value={`${show(leoBalance)} LEO`} />
          <Metric label="Your Stake" value={`${show(stakedAmount)} LEO`} />
          <Metric label="Pending Rewards" value={`${show(pendingReward)} LEO`} />
        </div>

        {beforeStart && emissionStart !== null && (
          <div className="alert alert-primary mb-0" role="status">
            Staking is open. Rewards start{' '}
            <strong>{new Date(Number(emissionStart) * 1000).toLocaleString()}</strong>. Everyone staked by then
            starts earning at the same moment.
          </div>
        )}

        {notice && (
          <div className={`alert mb-0 ${notice.kind === 'error' ? 'alert-danger' : 'alert-primary'}`} role="status">
            {notice.text}
          </div>
        )}

        {tab === 'stake' ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
                <label htmlFor="stake-amount" className="text-xs text-muted uppercase font-medium tracking-wide">Amount to Stake</label>
                <PercentButtons onPick={setStakePercentage} />
              </div>
              <input
                id="stake-amount"
                type="number"
                min="0"
                placeholder="Enter amount (LEO)"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="w-full px-4 py-3"
              />
              <p className="text-xs text-muted mt-2">Minimum position: 1 LEO. First stake asks you to approve LEO, then to stake.</p>
              {stakeError && <p className="text-xs text-navy font-semibold mt-1">{stakeError}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={handleAddToWallet} type="button" className="btn btn-secondary py-3 text-sm font-medium flex items-center justify-center gap-2">
                <img src={leoIcon} alt="" className="w-4 h-4 rounded-full flex-shrink-0" />
                Add LEO to Wallet
              </button>
              <button
                onClick={handleStake}
                disabled={busy || stakeWei === null || stakeError !== null}
                className="btn btn-primary py-3 font-semibold disabled:opacity-50"
              >
                {action === 'approve' ? 'Approving LEO...' : action === 'stake' ? 'Staking...' : 'Stake'}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-sm font-bold mb-0">Unstake</h4>
              <div>
                <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
                  <label htmlFor="unstake-amount" className="text-xs text-muted uppercase font-medium tracking-wide">Amount to Unstake</label>
                  <PercentButtons onPick={setUnstakePercentage} />
                </div>
                <input
                  id="unstake-amount"
                  type="number"
                  min="0"
                  placeholder="Enter amount (LEO)"
                  value={unstakeAmount}
                  onChange={(e) => setUnstakeAmount(e.target.value)}
                  className="w-full px-4 py-3"
                />
                <p className="text-xs text-muted mt-2">Unstaking also pays out the matching share of your pending rewards.</p>
                {unstakeError && <p className="text-xs text-navy font-semibold mt-1">{unstakeError}</p>}
              </div>
              <button
                onClick={handleUnstake}
                disabled={busy || unstakeWei === null || unstakeError !== null}
                className="w-full btn btn-primary py-3 font-semibold disabled:opacity-50"
              >
                {action === 'unstake' ? 'Unstaking...' : 'Unstake'}
              </button>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold mb-0">Rewards</h4>
              <div className="p-4 rounded-md border border-navy bg-navy/5">
                <p className="text-xs text-muted uppercase font-medium tracking-wide">Pending Rewards</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{show(pendingReward)} LEO</p>
                <p className="text-xs text-muted mt-2">
                  <strong>Claim</strong> sends rewards to your wallet. <strong>Compound</strong> adds them to your stake.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleReward('claim')}
                  disabled={busy || pendingReward === 0n}
                  className="btn btn-primary py-3 font-semibold disabled:opacity-50 text-sm"
                >
                  {action === 'claim' ? 'Claiming...' : 'Claim'}
                </button>
                <button
                  onClick={() => handleReward('compound')}
                  disabled={busy || pendingReward === 0n || stakedAmount === 0n}
                  className="btn btn-ghost py-3 font-semibold disabled:opacity-50 text-sm"
                >
                  {action === 'compound' ? 'Compounding...' : 'Compound'}
                </button>
              </div>
            </div>

            {stakedAmount > 0n && (
              <details className="lg:col-span-2 rounded-md border border-platinum-dark p-3">
                <summary className="text-sm font-bold cursor-pointer">Emergency withdraw</summary>
                <div className="space-y-3 mt-3">
                  <p className="text-xs text-muted">
                    Returns your full staked principal ({formatBigInt(stakedAmount)} LEO) without touching rewards.
                    Use it only if a normal Unstake fails. Any pending rewards are forfeited permanently.
                  </p>
                  <div className="alert alert-primary mb-0 text-xs">
                    You will forfeit <strong>{formatBigInt(pendingReward)} LEO</strong> in pending rewards. This cannot be undone.
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={emergencyConfirmed}
                      onChange={(e) => setEmergencyConfirmed(e.target.checked)}
                      disabled={busy}
                      style={{ width: 'auto' }}
                    />
                    I understand I will lose all pending rewards.
                  </label>
                  <button
                    onClick={handleEmergencyWithdraw}
                    disabled={busy || !emergencyConfirmed}
                    className="w-full btn btn-secondary py-3 font-semibold disabled:opacity-50"
                  >
                    {action === 'emergency' ? 'Withdrawing...' : 'Emergency Withdraw Principal'}
                  </button>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

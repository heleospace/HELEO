import { useCallback, useEffect, useMemo, useState } from 'react';
import { createWalletClient, custom, isAddress, type Address, type Hash } from 'viem';
import { getBuckets } from '../utils/web3';
import { formatBigInt, formatAddress } from '../utils/formatting';
import { useWallet } from '../context/WalletContext';
import { useNetwork } from '../context/NetworkContext';
import { ensureChain } from '../utils/chainSwitch';
import { createNetworkPublicClient } from '../utils/publicClient';
import { explorerAddressUrl } from '../config/networks';
import { BUCKETS, STAKING_ABI } from '../config/contracts';
import type { BucketInfo } from '../types/index';

const ZERO = '0x0000000000000000000000000000000000000000';

type Action = { kind: 'claim' | 'propose' | 'accept'; bucket: number };

function errorMessage(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return e?.shortMessage || e?.message || 'Transaction failed';
}

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function Buckets() {
  const { walletAddress: address, isConnected } = useWallet();
  const { network } = useNetwork();

  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null);
  const [stakerEmitted, setStakerEmitted] = useState<bigint | null>(null);
  const [stakerForfeited, setStakerForfeited] = useState<bigint | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [handoffTo, setHandoffTo] = useState<Record<number, string>>({});

  const publicClient = useMemo(() => createNetworkPublicClient(network), [network]);
  const stakingAddress = network.contracts.STAKING as Address;

  const refresh = useCallback(async () => {
    if (!network.contracts.STAKING) return;
    try {
      const [data, emitted, forfeited] = await Promise.all([
        getBuckets(publicClient, network.contracts),
        publicClient.readContract({ address: stakingAddress, abi: STAKING_ABI, functionName: 'stakerEmitted' }),
        publicClient.readContract({ address: stakingAddress, abi: STAKING_ABI, functionName: 'stakerForfeited' }),
      ]);
      // Keep the last good numbers on a failed poll.
      if (data) setBuckets(data);
      setStakerEmitted(emitted);
      setStakerForfeited(forfeited);
    } catch (error) {
      console.error('Error fetching buckets:', error);
    }
  }, [publicClient, network.contracts, stakingAddress]);

  useEffect(() => {
    setBuckets(null);
    setStakerEmitted(null);
    setStakerForfeited(null);
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  const send = async (
    next: Action,
    label: string,
    request: (wallet: ReturnType<typeof createWalletClient>, account: Address) => Promise<Hash>,
  ) => {
    setAction(next);
    setNotice(null);
    try {
      if (!window.ethereum) throw new Error('No wallet extension detected');
      await ensureChain(network.chain);
      const wallet = createWalletClient({ chain: network.chain, transport: custom(window.ethereum) });
      const hash = await request(wallet, address as Address);
      await publicClient.waitForTransactionReceipt({ hash });
      setNotice({ kind: 'ok', text: `${label} confirmed.` });
    } catch (error) {
      console.error(`${label} failed:`, error);
      setNotice({ kind: 'error', text: `${label} failed: ${errorMessage(error)}` });
    } finally {
      setAction(null);
      await refresh();
    }
  };

  const claim = (bucket: number) =>
    send({ kind: 'claim', bucket }, 'Claim', (wallet, account) =>
      wallet.writeContract({
        account,
        chain: network.chain,
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: 'claimBucket',
        args: [bucket],
      }),
    );

  const propose = (bucket: number, to: string) =>
    send({ kind: 'propose', bucket }, to === ZERO ? 'Cancel hand-off' : 'Hand-off proposal', (wallet, account) =>
      wallet.writeContract({
        account,
        chain: network.chain,
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: 'proposeBucketRecipient',
        args: [bucket, to as Address],
      }),
    );

  const accept = (bucket: number) =>
    send({ kind: 'accept', bucket }, 'Accept hand-off', (wallet, account) =>
      wallet.writeContract({
        account,
        chain: network.chain,
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: 'acceptBucketRecipient',
        args: [bucket],
      }),
    );

  if (!network.contracts.STAKING) return null;

  const busy = action !== null;
  const show = (value: bigint | null | undefined) => (value === null || value === undefined ? '…' : formatBigInt(value));

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text-lg font-bold mb-0">Ecosystem Buckets</h3>
        <p className="text-xs text-muted mt-1">
          Every second of emission is split equally five ways. Stakers share their fifth pro rata; each of the
          other four buckets is claimed by its own wallet.
        </p>
      </div>
      <div className="card-body space-y-4">
        {notice && (
          <div className={`alert mb-0 ${notice.kind === 'error' ? 'alert-danger' : 'alert-primary'}`} role="status">
            {notice.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-md border border-navy bg-navy/5">
            <p className="text-xs text-muted uppercase font-medium tracking-wide">Stakers · 20%</p>
            <p className="text-xs text-muted">Everyone who stakes LEO</p>
            <p className="text-lg font-bold text-navy tabular-nums mt-2 break-all">{show(stakerEmitted)} LEO</p>
            <p className="text-xs text-muted">distributed so far</p>
            {stakerForfeited !== null && stakerForfeited > 0n && (
              <p className="text-xs text-muted mt-1">{formatBigInt(stakerForfeited)} LEO never minted (no stakers)</p>
            )}
          </div>

          {BUCKETS.map((meta) => {
            const b = buckets?.find((x) => x.id === meta.id);
            const isRecipient = isConnected && same(address, b?.recipient);
            const isPending = isConnected && same(address, b?.pendingRecipient);
            const hasPending = Boolean(b && b.pendingRecipient !== ZERO);
            const target = handoffTo[meta.id] ?? '';
            const targetValid = isAddress(target) && target !== ZERO;
            const actingHere = action?.bucket === meta.id;

            return (
              <div key={meta.id} className="p-3 rounded-md border border-platinum bg-surface space-y-2">
                <div>
                  <p className="text-xs text-muted uppercase font-medium tracking-wide">{meta.name} · 20%</p>
                  <p className="text-xs text-muted">{meta.description}</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-navy tabular-nums break-all">{show(b?.claimable)} LEO</p>
                  <p className="text-xs text-muted">claimable · {show(b?.claimed)} claimed</p>
                </div>
                {b && (
                  <p className="text-xs text-muted">
                    Wallet:{' '}
                    <a href={explorerAddressUrl(network, b.recipient)} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline" title={b.recipient}>
                      {formatAddress(b.recipient)}
                    </a>
                    {hasPending && (
                      <>
                        <br />
                        Pending:{' '}
                        <a href={explorerAddressUrl(network, b.pendingRecipient)} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline" title={b.pendingRecipient}>
                          {formatAddress(b.pendingRecipient)}
                        </a>
                      </>
                    )}
                  </p>
                )}

                {isRecipient && (
                  <div className="space-y-2 pt-1">
                    <button
                      onClick={() => claim(meta.id)}
                      disabled={busy || !b || b.claimable === 0n}
                      className="w-full btn btn-primary py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {actingHere && action?.kind === 'claim' ? 'Claiming...' : 'Claim'}
                    </button>
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold">Hand off to a new wallet</summary>
                      <div className="space-y-2 mt-2">
                        <input
                          type="text"
                          placeholder="0x… new wallet"
                          value={target}
                          onChange={(e) => setHandoffTo({ ...handoffTo, [meta.id]: e.target.value.trim() })}
                          className="w-full px-2 py-1.5 text-xs"
                        />
                        <p className="text-muted">The new wallet must then accept. Unclaimed LEO moves with the bucket.</p>
                        <button
                          onClick={() => propose(meta.id, target)}
                          disabled={busy || !targetValid}
                          className="w-full btn btn-secondary py-1.5 text-xs disabled:opacity-50"
                        >
                          {actingHere && action?.kind === 'propose' ? 'Proposing...' : 'Propose'}
                        </button>
                        {hasPending && (
                          <button
                            onClick={() => propose(meta.id, ZERO)}
                            disabled={busy}
                            className="w-full btn btn-ghost py-1.5 text-xs disabled:opacity-50"
                          >
                            Cancel pending hand-off
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                )}

                {isPending && (
                  <button
                    onClick={() => accept(meta.id)}
                    disabled={busy}
                    className="w-full btn btn-primary py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {actingHere && action?.kind === 'accept' ? 'Accepting...' : `Accept ${meta.name} bucket`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

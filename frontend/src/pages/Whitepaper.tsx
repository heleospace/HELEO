import { useEffect, useState } from 'react';
import { useNetwork } from '../context/NetworkContext';
import { createNetworkPublicClient } from '../utils/publicClient';
import { LEO_ABI, STAKING_ABI } from '../config/contracts';
import { formatBigIntNoFloat } from '../utils/formatting';
import './whitepaper.css';

// Figures that are compiled constants in the contracts and therefore cannot
// change — safe to render statically. Anything that moves is read on-chain below.
const TERMS = [
  { t: '0', years: '0 – 4', emission: '10,500,000', bucket: '2,100,000', perDay: '7,186.9', cum: '10,500,000' },
  { t: '1', years: '4 – 8', emission: '5,250,000', bucket: '1,050,000', perDay: '3,593.4', cum: '15,750,000' },
  { t: '2', years: '8 – 12', emission: '2,625,000', bucket: '525,000', perDay: '1,796.7', cum: '18,375,000' },
  { t: '3', years: '12 – 16', emission: '1,312,500', bucket: '262,500', perDay: '898.4', cum: '19,687,500' },
  { t: '4', years: '16 – 20', emission: '656,250', bucket: '131,250', perDay: '449.2', cum: '20,343,750' },
  { t: '5', years: '20 – 24', emission: '328,125', bucket: '65,625', perDay: '224.6', cum: '20,671,875' },
  { t: '6', years: '24 – 28', emission: '164,062.5', bucket: '32,812.5', perDay: '112.3', cum: '20,835,937.5' },
  { t: '7', years: '28 – 32', emission: '82,031.25', bucket: '16,406.25', perDay: '56.1', cum: '20,917,968.8' },
];

// Each Term is half the one before, so each bar is half the width of its
// predecessor. Widths are the real proportions of the 21M emission allocation.
const BARS = [
  { w: 50, shade: 1.0, label: 'T₀', value: '10,500,000', sub: 'year 0–4' },
  { w: 25, shade: 0.88, label: 'T₁', value: '5,250,000', sub: 'year 4–8' },
  { w: 12.5, shade: 0.76, label: 'T₂', value: '2,625,000' },
  { w: 6.25, shade: 0.64, label: 'T₃' },
  { w: 3.125, shade: 0.54 },
  { w: 1.5625, shade: 0.46 },
  { w: 0.78125, shade: 0.38 },
  { w: 0.390625, shade: 0.32 },
  { w: 0.390625, shade: 0.24 },
];

const BUCKET_ROWS = [
  { name: 'Stakers', who: 'Everyone who stakes LEO, pro rata', how: 'Accrues every second to open positions; claim, compound or unstake any time' },
  { name: 'Builder', who: 'Community building', how: 'One wallet, claims its accrued share' },
  { name: 'Coder', who: 'Developers', how: 'One wallet, claims its accrued share' },
  { name: 'Compute', who: 'GPU providers', how: 'One wallet, claims its accrued share' },
  { name: 'Research', who: 'Research', how: 'One wallet, claims its accrued share' },
];

// Navy, lightened toward the page ground as the Terms shrink.
function shadeOf(k: number) {
  const [r, g, b] = [26, 31, 61];
  const mix = (c: number) => Math.round(c * k + 255 * (1 - k));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

interface LiveState {
  totalSupply?: bigint;
  totalStaked?: bigint;
  nextHalving?: bigint;
  currentEpoch?: bigint;
  startTime?: bigint;
  failed?: boolean;
}

function formatDate(seconds: bigint, withTime = false) {
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function Whitepaper() {
  const { network } = useNetwork();
  const [live, setLive] = useState<LiveState>({});

  const { LEO, STAKING } = network.contracts;
  const explorer = network.explorerUrl;

  useEffect(() => {
    if (!LEO || !STAKING) {
      setLive({ failed: true });
      return;
    }

    let cancelled = false;
    const client = createNetworkPublicClient(network);

    (async () => {
      try {
        const [totalSupply, totalStaked, nextHalving, currentEpoch, startTime] = await Promise.all([
          client.readContract({ address: LEO as `0x${string}`, abi: LEO_ABI, functionName: 'totalSupply' }),
          client.readContract({ address: STAKING as `0x${string}`, abi: STAKING_ABI, functionName: 'totalStaked' }),
          client.readContract({ address: STAKING as `0x${string}`, abi: STAKING_ABI, functionName: 'nextHalvingTime' }),
          client.readContract({ address: STAKING as `0x${string}`, abi: STAKING_ABI, functionName: 'currentEpoch' }),
          client.readContract({ address: STAKING as `0x${string}`, abi: STAKING_ABI, functionName: 'startTime' }),
        ]);
        if (cancelled) return;
        setLive({ totalSupply, totalStaked, nextHalving, currentEpoch, startTime });
      } catch {
        // A dead RPC must not blank the document — the prose stands on its own
        // and these cells fall back to "unavailable" rather than a wrong number.
        if (!cancelled) setLive({ failed: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [LEO, STAKING, network]);

  const label = (value: bigint | undefined, format: (v: bigint) => string) =>
    live.failed ? 'Unavailable' : value === undefined ? '—' : format(value);

  const supplyLabel = label(live.totalSupply, formatBigIntNoFloat);
  const stakedLabel = label(live.totalStaked, formatBigIntNoFloat);
  const halvingLabel = label(live.nextHalving, (v) => formatDate(v));
  const startLabel = label(live.startTime, (v) => formatDate(v, true));
  const termLabel = live.failed || live.currentEpoch === undefined ? 'T₀' : `T${live.currentEpoch.toString()}`;

  const addr = (a: string) => `${explorer}/address/${a}#readContract`;

  return (
    <div className="wp-doc">
      {/* ---------------- masthead ---------------- */}
      <header className="wp-masthead">
        <div className="wp-sigil">
          <span className="wp-live">Ethereum · ERC-20</span>
          <span>Emission for the people who grow the ecosystem</span>
        </div>

        <h1 className="wp-title">
          <em>HELEO</em>
        </h1>

        <p className="wp-identity" role="img" aria-label="Ticker LEO">
          <span>LEO</span>
        </p>
        <p className="wp-identity-note">42,000,000 maximum. Half at genesis, half by a halving series.</p>

        <p className="wp-standfirst">
          A fixed-supply token whose emission is split equally, every second, between the people who
          stake it and the four groups who build what it is for: community builders, developers,
          GPU compute providers and researchers.
        </p>

        <dl className="wp-colophon">
          <div><dt>Network</dt><dd>Ethereum mainnet</dd></div>
          <div><dt>Max supply</dt><dd>42,000,000 LEO</dd></div>
          <div><dt>Halving</dt><dd>Every 4 years</dd></div>
          <div><dt>Emission split</dt><dd>5 × 20%</dd></div>
          <div><dt>Admin keys</dt><dd>None</dd></div>
        </dl>
      </header>

      {/* ---------------- state ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 0</b>
          <span>State</span>
          <p className="wp-gloss">What the chain says right now.</p>
        </div>
        <div className="wp-body">
          <div className="wp-state">
            <div className="wp-state-head">
              <span><b>State of the network</b></span>
              <span>{network.label}</span>
            </div>
            <dl className="wp-grid">
              <div className="wp-cell">
                <dt><span className="wp-tag">live</span>Emission start</dt>
                <dd className={live.startTime === undefined ? 'wp-pending' : undefined}>
                  {startLabel}<small>24 hours after deployment on mainnet</small>
                </dd>
              </div>
              <div className="wp-cell"><dt>Current Term</dt><dd>{termLabel}<small>Of 256</small></dd></div>
              <div className="wp-cell">
                <dt><span className="wp-tag">live</span>Total supply</dt>
                <dd className={live.totalSupply === undefined ? 'wp-pending' : undefined}>
                  {supplyLabel}<small>LEO minted so far</small>
                </dd>
              </div>
              <div className="wp-cell">
                <dt><span className="wp-tag">live</span>Total staked</dt>
                <dd className={live.totalStaked === undefined ? 'wp-pending' : undefined}>
                  {stakedLabel}<small>Sharing the stakers' fifth</small>
                </dd>
              </div>
              <div className="wp-cell">
                <dt><span className="wp-tag">live</span>Next halving</dt>
                <dd className={live.nextHalving === undefined ? 'wp-pending' : undefined}>
                  {halvingLabel}<small>When the rate halves</small>
                </dd>
              </div>
              <div className="wp-cell"><dt>T₀ rate</dt><dd>0.0832 /s<small>≈ 7,187 LEO per day, all buckets</small></dd></div>
            </dl>
            <p className="wp-state-note">
              Cells marked <span className="wp-tag">live</span> are read from the chain when this page
              loads; the rest are compiled constants and cannot change. The contract addresses in{' '}
              <strong>§ 7</strong> outrank this page.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- § 1 supply ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 1</b>
          <span>Supply</span>
          <p className="wp-gloss">42,000,000 — a compiled constant with two halves.</p>
        </div>
        <div className="wp-body">
          <h2>A ceiling that cannot move</h2>
          <p>
            There will never be more than <strong>42,000,000 LEO</strong>. The figure is a compiled
            constant, both paths that create tokens check against it before minting, and there is no
            public mint, no owner who can raise it, and no upgrade proxy.
          </p>
          <dl className="wp-grid">
            <div className="wp-cell"><dt>Max supply</dt><dd>42,000,000<small>Hard cap, compiled</small></dd></div>
            <div className="wp-cell"><dt>Genesis</dt><dd>21,000,000<small>Minted at deploy, 1–21 contributors</small></dd></div>
            <div className="wp-cell"><dt>Emission</dt><dd>21,000,000<small>Halving series, 5 buckets</small></dd></div>
            <div className="wp-cell"><dt>Discretionary</dt><dd>0<small>No other mint path</small></dd></div>
          </dl>
        </div>
      </section>

      {/* ---------------- § 2 genesis ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 2</b>
          <span>Genesis</span>
          <p className="wp-gloss">Half the supply, to the people who built the foundation.</p>
        </div>
        <div className="wp-body">
          <h2>21,000,000 LEO to the core contributors</h2>
          <p>
            The token contract mints <strong>21,000,000 LEO</strong> in its constructor, split equally
            across <strong>1 to 21 contributor wallets</strong>: the core developers building the
            Morpheus ecosystem (mor.org) who are extending that work into HELEO. With 21 wallets each
            receives exactly <strong>1,000,000 LEO</strong>; with fewer, each receives 21,000,000 ÷ the
            number of wallets. When that doesn't divide evenly, the first wallet also receives the few
            wei left over (at most 13), so exactly 21,000,000 is minted. The number is fixed at
            deployment and readable on-chain as <code>contributorCount()</code>.
          </p>
          <p>
            The addresses are passed at deployment and checked on-chain: there must be between 1 and
            21, none may be the zero address and none may repeat. The deployer receives nothing. The genesis allocation is
            unlocked at mint — there is no vesting contract — and this is stated plainly so anyone
            can weigh it.
          </p>
        </div>
      </section>

      {/* ---------------- § 3 the series ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 3</b>
          <span>The Series</span>
          <p className="wp-gloss">Half in the first four years, then half again, forever.</p>
        </div>
        <div className="wp-body">
          <h2>The emission schedule</h2>
          <p>
            The other 21,000,000 LEO are <em>emitted</em> continuously by a geometric series. Time is
            divided into <strong>Terms</strong> of four years. The first, T₀, emits 10,500,000 LEO —
            half the emission allocation — and every Term after emits exactly half of the one before.
            The halving is a right-shift on a compiled constant; nobody triggers it and nobody can
            stop it.
          </p>
          <dl className="wp-grid">
            <div className="wp-cell"><dt>Term length</dt><dd>126,230,400 s<small>4 years, by timestamp</small></dd></div>
            <div className="wp-cell"><dt>T₀ emission</dt><dd>10,500,000<small>2,100,000 per bucket</small></dd></div>
            <div className="wp-cell"><dt>Terms defined</dt><dd>256<small>1,024 years of schedule</small></dd></div>
            <div className="wp-cell"><dt>Series ratio</dt><dd>1 / 2<small>Applied per Term</small></dd></div>
          </dl>
        </div>

        <figure className="wp-figure">
          <figcaption className="wp-fig-head">
            <span>Figure 1 — <b>The Series, drawn to scale</b></span>
            <span>Each Term is half the one before it</span>
          </figcaption>
          <div
            className="wp-bisection"
            role="img"
            aria-label="A bar representing the 21,000,000 LEO emission allocation divided into halving terms: T-zero is 10.5 million filling half the bar, T-one 5.25 million a quarter, each later term halving again toward a right edge that is never reached."
          >
            {BARS.map((b, i) => (
              <div key={i} className="wp-term" style={{ width: `${b.w}%`, background: shadeOf(b.shade) }}>
                {b.label && (
                  <span>
                    <b>{b.label}</b>
                    {b.value}
                    {b.sub && <><br />{b.sub}</>}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="wp-scale">
            <span>0</span>
            <span className="wp-bound">21,000,000 — approached, never quite reached ▸</span>
          </div>
        </figure>

        <div className="wp-body">
          <h3>The schedule</h3>
          <div className="wp-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Years</th>
                  <th scope="col">Emission</th>
                  <th scope="col">Per bucket</th>
                  <th scope="col">Per day</th>
                  <th scope="col">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {TERMS.map((r) => (
                  <tr key={r.t}>
                    <td>T<sub>{r.t}</sub></td>
                    <td>{r.years}</td>
                    <td>{r.emission}</td>
                    <td>{r.bucket}</td>
                    <td>{r.perDay}</td>
                    <td>{r.cum}</td>
                  </tr>
                ))}
                <tr>
                  <td>⋮</td><td>⋮</td><td>halves</td><td>halves</td><td>halves</td><td>→ 21,000,000</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Years count from the emission start, not from deployment. The series approaches
            21,000,000 without reaching it exactly, and the contract additionally clamps at that
            figure, so the emission allocation can never be exceeded.
          </p>
        </div>
      </section>

      {/* ---------------- § 4 the five buckets ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 4</b>
          <span>Five Buckets</span>
          <p className="wp-gloss">Every second of emission, split five equal ways.</p>
        </div>
        <div className="wp-body">
          <h2>Emission funds the whole ecosystem</h2>
          <p>
            Each second's emission is divided equally into five buckets of <strong>20%</strong>.
            Stakers are one bucket; the other four each belong to a single wallet set at deployment.
          </p>
          <div className="wp-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">For</th>
                  <th scope="col">Share</th>
                  <th scope="col">How it is paid</th>
                </tr>
              </thead>
              <tbody>
                {BUCKET_ROWS.map((b) => (
                  <tr key={b.name}>
                    <td>{b.name}</td>
                    <td>{b.who}</td>
                    <td>20%</td>
                    <td>{b.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>The four ecosystem wallets</h3>
          <p>
            The Builder, Coder, Compute and Research shares accrue on schedule from the emission start
            regardless of how much is staked. Only that bucket's own wallet can call{' '}
            <code>claimBucket()</code>, which mints everything accrued and not yet claimed straight to
            it. There is no deadline: an unclaimed share simply waits.
          </p>
          <p>
            No administrator can change these wallets. Each wallet can hand its own bucket to a new
            address in two steps — the current wallet calls <code>proposeBucketRecipient()</code>, then
            the new wallet calls <code>acceptBucketRecipient()</code> — so a team can move to a new
            multisig, but nobody can redirect a bucket they do not control, and a typo cannot lose one.
            Anything accrued but unclaimed moves with the bucket.
          </p>
          <h3>When nobody is staking</h3>
          <p className="wp-axiom">
            The stakers' fifth for any second in which nobody is staked is never minted. It does not
            roll forward to the next staker and it is not given to the other buckets.
          </p>
          <p>
            As a result the final supply may land slightly below 42,000,000. That is deliberate: it
            stops a lone first staker from collecting an idle backlog, and it keeps every other bucket
            at exactly 20%.
          </p>
        </div>
      </section>

      {/* ---------------- § 5 fair start ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 5</b>
          <span>Fair Start</span>
          <p className="wp-gloss">Staking opens at setup; emission waits 24 hours.</p>
        </div>
        <div className="wp-body">
          <h2>A 24-hour window before the first second counts</h2>
          <p>
            Staking opens as soon as LEO wires in the staking contract (right after it is deployed,
            and the contract refuses deposits until then), but emission begins
            automatically <strong>24 hours later</strong> (<code>startTime</code> = deployment +{' '}
            <code>emissionDelay</code>). On Ethereum mainnet the contract refuses any delay other than
            exactly 24 hours; only test networks may use a shorter one. Nothing accrues during that window, so everyone who stakes
            within it starts earning at exactly the same moment — staking in the first block gives no
            advantage over staking in the last minute.
          </p>
          <p>
            No transaction is needed to start emission. It is a timestamp fixed at deployment; the
            first interaction after it simply finds the clock already running.
          </p>
        </div>
      </section>

      {/* ---------------- § 6 staking ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 6</b>
          <span>Staking</span>
          <p className="wp-gloss">One LEO opens a position. Nothing smaller does.</p>
        </div>
        <div className="wp-body">
          <h2>How stakers earn their fifth</h2>
          <p>
            The stakers' bucket is shared pro rata: your share of every second is your share of the
            total staked. The minimum position is <strong>1 LEO</strong>. The rule is load-bearing — a
            one-wei sole staker could otherwise inflate the reward index until ordinary positions
            overflow.
          </p>
          <ul>
            <li><strong>Stake</strong> — deposit LEO.</li>
            <li><strong>Claim</strong> — mint what has accrued to you, any time.</li>
            <li><strong>Compound</strong> — mint it straight back into your position.</li>
            <li>
              <strong>Unstake</strong> — withdraw principal plus the proportional accrued reward. No
              lock, no cooldown, no exit fee.
            </li>
          </ul>
          <p>
            <code>emergencyWithdraw()</code> returns principal alone, forfeits unclaimed reward, and
            touches no part of the minting path, so nothing in the reward machinery can ever trap a
            position. The schedule is measured in seconds (<code>block.timestamp</code>), not blocks,
            so halvings land on fixed wall-clock dates.
          </p>
        </div>
      </section>

      {/* ---------------- § 7 immutability ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 7</b>
          <span>Immutability</span>
          <p className="wp-gloss">What is fixed, and how to check it.</p>
        </div>
        <div className="wp-body">
          <h2>Nobody is in charge, and this is verifiable</h2>

          <h3>The addresses</h3>
          <div className="wp-contracts">
            {LEO && (
              <a href={addr(LEO)} target="_blank" rel="noopener noreferrer">
                <span className="wp-lbl">LEO — the token</span>
                <span className="wp-addr">{LEO}</span>
              </a>
            )}
            {STAKING && (
              <a href={addr(STAKING)} target="_blank" rel="noopener noreferrer">
                <span className="wp-lbl">Staking — the Series and the buckets</span>
                <span className="wp-addr">{STAKING}</span>
              </a>
            )}
            {!LEO && !STAKING && (
              <div className="wp-norepo">
                <span className="wp-lbl">Contracts</span>
                <span className="wp-addr">Not yet deployed on {network.label}</span>
              </div>
            )}
          </div>

          <h3>The token</h3>
          <p>
            One privileged function exists: <code>setStaking()</code>, a one-time, irreversible call
            that wires in the staking contract. After it, ownership is renounced and{' '}
            <code>owner()</code> returns the zero address. Minting is reachable only by the staking
            contract, only within the 21,000,000 emission allocation, and only under the cap.
          </p>
          <h3>Staking</h3>
          <p>
            No owner. The token, halving period and emission start are immutable. The only mutable
            settings are the four bucket wallets, and each can be changed only by that bucket's own
            current wallet.
          </p>
        </div>
      </section>

      {/* ---------------- § 8 risk ---------------- */}
      <section className="wp-section">
        <div className="wp-rail">
          <b>§ 8</b>
          <span>Risk</span>
        </div>
        <div className="wp-notice">
          <h3>Read this carefully</h3>
          <p>
            LEO has no issuer, no redemption, no backing and no guaranteed value. It is not an
            investment, a security, a deposit, or a claim on anything. Nothing in this document is
            financial advice or an offer of any kind.
          </p>
          <p>
            The contracts are immutable, so any defect in them is also immutable — it cannot be
            patched, paused or rescued. Half the supply is held by the contributor wallets (1 to 21) from the
            start, and four wallets receive 80% of all emission. Verify the deployed source yourself
            rather than relying on this summary, and participate only if you accept that LEO may be
            worth nothing.
          </p>
        </div>
      </section>

      <footer className="wp-end">
        <span>HELEO · LEO · ERC-20 · Ethereum</span>
        <span>Max 42,000,000 · Halving every 4 years · 5 × 20%</span>
        <span>Open source · No admin keys</span>
      </footer>
    </div>
  );
}

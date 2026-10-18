/**
 * Offline audit of Signal Lab results.
 *
 *   npm run audit -- signal-audit-XXXX.json [--all-sources] [--out report]
 *
 * Input: the file produced by the "Audit export" button on the Signal Lab page.
 *
 * Answers two separate questions:
 *   A) TRACKING  - were the paper trades recorded/resolved correctly?  (re-runs the server logic on real candles)
 *   B) STRATEGY  - if tracking is right, did trades fail because the stop was too small, or because the
 *                  entry direction has no edge?  (what-if stops, mirror test, time-matched random baseline)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  analyzeCore,
  atr,
  resolveTrade,
  EXPIRY_BARS,
  TRADE_COST_PCT,
  type Candle,
  type Direction,
} from '../supabase/functions/_shared/engine.ts';

// ---------------------------------------------------------------- types / loading
interface Outcome {
  id: string;
  symbol: string;
  timeframe: string;
  signal_type: 'BUY' | 'SELL';
  score: number;
  price_at_signal: number;
  stop_loss: number;
  target1: number;
  signal_at: string;
  candle_close_time: string | null;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'CANCELLED';
  exit_price: number | null;
  exit_at: string | null;
  pnl_pct: number | null;
  r_multiple: number | null;
  bars_held: number | null;
  source: string;
}
interface Exported {
  format: string;
  outcomes: Outcome[];
  candles: Record<string, { complete: boolean; rows: number[][] }>;
  app: { tradeCostPct: number; engineWindow: number };
  warnings: string[];
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: npm run audit -- <signal-audit.json> [--all-sources] [--out report-prefix]');
  process.exit(1);
}
const allSources = args.includes('--all-sources');
const outIdx = args.indexOf('--out');
const outPrefix = outIdx >= 0 ? args[outIdx + 1] : 'audit-report';

const data = JSON.parse(readFileSync(file, 'utf8')) as Exported;
if (data.format !== 'signal-audit/v1') throw new Error(`unsupported format: ${data.format}`);
const COST = data.app?.tradeCostPct ?? TRADE_COST_PCT;
const WINDOW = data.app?.engineWindow ?? 300;

const candleMap = new Map<string, Candle[]>();
for (const [key, v] of Object.entries(data.candles)) {
  candleMap.set(
    key,
    v.rows.map((r) => ({ openTime: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], closeTime: r[6] })),
  );
}

const outcomes = data.outcomes
  .filter((o) => o.status !== 'CANCELLED')
  .filter((o) => allSources || o.source === 'auto_scan')
  .map((o) => ({
    ...o,
    price_at_signal: Number(o.price_at_signal),
    stop_loss: Number(o.stop_loss),
    target1: Number(o.target1),
  }));

// ---------------------------------------------------------------- helpers
const pct = (x: number) => `${x.toFixed(1)}%`;
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);
const dirOf = (o: { signal_type: string }): Direction => (o.signal_type === 'BUY' ? 'LONG' : 'SHORT');
const near = (a: number, b: number, rel = 1e-6) => Math.abs(a - b) <= Math.abs(b) * rel + 1e-12;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  o: (typeof outcomes)[number];
  key: string;
  idx: number; // index of the signal candle in the candle array
  atr: number | null;
  stopAtr: number | null; // stop distance in ATRs
  riskPct: number;
  costR: number;
  issues: string[];
}

const lines: string[] = [];
const out = (s = '') => {
  lines.push(s);
  console.log(s);
};
const table = (head: string[], rows: (string | number)[][]) => {
  out(`| ${head.join(' | ')} |`);
  out(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out(`| ${r.join(' | ')} |`);
  out();
};

// ---------------------------------------------------------------- prepare rows
const rows: Row[] = [];
const missing: string[] = [];
for (const o of outcomes) {
  const key = `${o.symbol}|${o.timeframe}`;
  const cs = candleMap.get(key);
  const base = Date.parse(o.candle_close_time ?? o.signal_at);
  if (!cs || !data.candles[key]) {
    missing.push(`${key} (no candles in export)`);
    continue;
  }
  const idx = cs.findIndex((c) => Math.abs(c.closeTime - base) < 1500);
  const issues: string[] = [];
  if (idx < 0) {
    missing.push(`${key} @ ${o.candle_close_time} (signal candle not in export)`);
    continue;
  }
  const slice = cs.slice(Math.max(0, idx - WINDOW + 1), idx + 1);
  const a = atr(slice, 14);
  const lastAtr = a[a.length - 1];
  const risk = Math.abs(o.price_at_signal - o.stop_loss);
  rows.push({
    o,
    key,
    idx,
    atr: lastAtr,
    stopAtr: lastAtr ? risk / lastAtr : null,
    riskPct: (risk / o.price_at_signal) * 100,
    costR: ((o.price_at_signal * COST) / 100) / risk,
    issues,
  });
}

out(`# Signal audit`);
out();
out(`File: ${file}`);
out(`Signals audited: ${rows.length} of ${outcomes.length} (${allSources ? 'all sources' : 'auto_scan only'}). Cost per trade: ${COST}%.`);
if (missing.length) out(`Skipped (no candle data): ${missing.length}  e.g. ${missing.slice(0, 3).join('; ')}`);
if (data.warnings?.length) out(`Export warnings: ${data.warnings.length}  e.g. ${data.warnings.slice(0, 2).join('; ')}`);
out();

// ================================================================ A) TRACKING
out(`## A) Tracking: were trades recorded and resolved correctly?`);
out();

let entryMismatch = 0;
let geometry = 0;
let sigChecked = 0;
let sigMismatch = 0;
const sigDetails: string[] = [];
const resolveCounts: Record<string, number> = {};
const resolveBad: string[] = [];
let exitTimeOff = 0;
let exitPriceOff = 0;
const stored = { WIN: 0, LOSS: 0, EXPIRED: 0, OPEN: 0 };
const redo = { WIN: 0, LOSS: 0, EXPIRED: 0, OPEN: 0 };

for (const r of rows) {
  const o = r.o;
  const cs = candleMap.get(r.key)!;
  const sigCandle = cs[r.idx];

  // A1: entry price must equal the close of the signal candle
  if (!near(sigCandle.close, o.price_at_signal, 1e-6)) {
    entryMismatch++;
    r.issues.push('entry!=close');
  }
  // A2: stop/target geometry (target1 = entry +/- 2 x stop distance)
  const risk = Math.abs(o.price_at_signal - o.stop_loss);
  const tdist = Math.abs(o.target1 - o.price_at_signal);
  const sideOk = dirOf(o) === 'LONG' ? o.stop_loss < o.price_at_signal && o.target1 > o.price_at_signal : o.stop_loss > o.price_at_signal && o.target1 < o.price_at_signal;
  if (!sideOk || Math.abs(tdist / risk - 2) > 0.02) {
    geometry++;
    r.issues.push('geometry');
  }

  // A3: recompute the signal from the candles that existed at that time
  const slice = cs.slice(Math.max(0, r.idx - WINDOW + 1), r.idx + 1);
  if (slice.length >= WINDOW) {
    sigChecked++;
    const core = analyzeCore(slice, { timeframe: o.timeframe });
    const want = o.signal_type;
    const ok =
      core !== null &&
      core.signalType === want &&
      core.score === o.score &&
      near(core.risk?.stopLoss ?? NaN, o.stop_loss, 1e-5) &&
      near(core.risk?.target1 ?? NaN, o.target1, 1e-5);
    if (!ok) {
      sigMismatch++;
      r.issues.push('signal-not-reproducible');
      if (sigDetails.length < 8)
        sigDetails.push(`${r.key} ${o.candle_close_time}: stored ${want}/${o.score}, recomputed ${core?.signalType}/${core?.score}`);
    }
  }

  // A4: re-resolve the trade exactly like the server does
  const base = Date.parse(o.candle_close_time ?? o.signal_at);
  const after = cs.filter((c) => c.closeTime > base);
  const res = resolveTrade(
    { direction: dirOf(o), entry: o.price_at_signal, stop: o.stop_loss, target: o.target1, maxBars: EXPIRY_BARS[o.timeframe] ?? 40 },
    after,
    COST,
  );
  const redoStatus = res ? res.status : 'OPEN';
  stored[o.status as keyof typeof stored]++;
  redo[redoStatus]++;
  const k = `${o.status} -> ${redoStatus}`;
  resolveCounts[k] = (resolveCounts[k] ?? 0) + 1;
  if (o.status !== redoStatus) {
    r.issues.push(`resolve:${k}`);
    if (resolveBad.length < 12) resolveBad.push(`${r.key} ${o.candle_close_time}: stored ${o.status}, recomputed ${redoStatus}`);
  } else if (res && o.exit_at) {
    if (Math.abs(Date.parse(o.exit_at) - res.exitTime) > 1500) exitTimeOff++;
    if (o.exit_price != null && !near(Number(o.exit_price), res.exitPrice, 1e-5)) exitPriceOff++;
  }
}

table(
  ['check', 'result'],
  [
    ['entry price == close of signal candle', entryMismatch === 0 ? 'OK (all)' : `${entryMismatch} mismatches`],
    ['stop/target geometry (target = 2 x stop distance, right side)', geometry === 0 ? 'OK (all)' : `${geometry} deviations`],
    [`signal reproducible from candles (${sigChecked} checkable)`, sigMismatch === 0 ? 'OK (all)' : `${sigMismatch} NOT reproducible`],
    ['stored status == recomputed status', `${rows.length - Object.entries(resolveCounts).filter(([k]) => k.split(' -> ')[0] !== k.split(' -> ')[1]).reduce((s, [, v]) => s + v, 0)} / ${rows.length}`],
    ['exit time differs from recomputed', String(exitTimeOff)],
    ['exit price differs from recomputed', String(exitPriceOff)],
  ],
);
out(`Status transitions (stored -> recomputed): ${Object.entries(resolveCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
if (resolveBad.length) {
  out();
  out('Examples of disagreement:');
  for (const s of resolveBad) out(`- ${s}`);
}
if (sigDetails.length) {
  out();
  out('Examples of signals that could not be reproduced:');
  for (const s of sigDetails) out(`- ${s}`);
}
const trackingBroken = entryMismatch + geometry + sigMismatch + Object.entries(resolveCounts).filter(([k]) => k.split(' -> ')[0] !== k.split(' -> ')[1]).reduce((s, [, v]) => s + v, 0);
out();
out(trackingBroken === 0 ? '**Verdict A: tracking is correct.** Every stored result matches a fresh recomputation from real candles.' : `**Verdict A: ${trackingBroken} discrepancies found** - see the lists above before trusting any statistic.`);
out();

// ================================================================ B) STRATEGY
out(`## B) Strategy: stop too small, or no directional edge?`);
out();

const decided = rows.filter((r) => r.o.status === 'WIN' || r.o.status === 'LOSS');
const wins = decided.filter((r) => r.o.status === 'WIN').length;
out(`Stored result: ${wins} wins / ${decided.length - wins} losses = ${pct((100 * wins) / decided.length)} win rate. A 1:2 trade with zero skill wins ~33.3%.`);
out();

// ---- B1 stop distance in ATR and how losses happen
const stopAtrs = rows.map((r) => r.stopAtr).filter((x): x is number => x !== null);
out(`### B1) How tight are the stops? (stop distance in ATR14 at signal time)`);
out();
const buckets: [string, number, number][] = [['<0.9', 0, 0.9], ['0.9-1.1', 0.9, 1.1], ['1.1-1.5', 1.1, 1.5], ['1.5-2', 1.5, 2], ['>=2', 2, 99]];
table(
  ['stop (ATR)', 'n', 'wins', 'losses', 'win rate', 'avg R', 'avg cost (R)'],
  buckets
    .map(([label, lo, hi]) => {
      const g = rows.filter((r) => r.stopAtr !== null && r.stopAtr >= lo && r.stopAtr < hi && (r.o.status === 'WIN' || r.o.status === 'LOSS'));
      const w = g.filter((r) => r.o.status === 'WIN').length;
      return [label, g.length, w, g.length - w, g.length ? pct((100 * w) / g.length) : '-', f2(mean(g.map((r) => Number(r.o.r_multiple ?? 0)))), f2(mean(g.map((r) => r.costR)))];
    })
    .filter((r) => (r[1] as number) > 0),
);
out(`Median stop = ${f2(stopAtrs.sort((a, b) => a - b)[Math.floor(stopAtrs.length / 2)])} ATR. Median cost = ${f2(mean(rows.map((r) => r.costR)))} R per trade (average).`);
out();

// ---- B2 wick-only stop-outs & recovery after the stop
let wickOnly = 0;
let lossN = 0;
let quickLoss = 0;
let recovered = 0;
let hadHalfWayR = 0;
for (const r of rows) {
  if (r.o.status !== 'LOSS') continue;
  lossN++;
  const cs = candleMap.get(r.key)!;
  const base = Date.parse(r.o.candle_close_time ?? r.o.signal_at);
  const after = cs.filter((c) => c.closeTime > base);
  const dir = dirOf(r.o);
  const stop = r.o.stop_loss;
  const max = EXPIRY_BARS[r.o.timeframe] ?? 40;
  const risk = Math.abs(r.o.price_at_signal - stop);
  let hit = -1;
  for (let i = 0; i < Math.min(after.length, max); i++) {
    const c = after[i];
    if (dir === 'LONG' ? c.low <= stop : c.high >= stop) {
      hit = i;
      break;
    }
  }
  if (hit < 0) continue;
  if (hit === 0) quickLoss++;
  const c = after[hit];
  if (dir === 'LONG' ? c.close > stop : c.close < stop) wickOnly++;
  // did price reach +0.5R / the target AFTER the stop would have been hit, within the same expiry window?
  let favBefore = 0;
  for (let i = 0; i < hit; i++) favBefore = Math.max(favBefore, dir === 'LONG' ? after[i].high - r.o.price_at_signal : r.o.price_at_signal - after[i].low);
  if (favBefore >= 0.5 * risk) hadHalfWayR++;
  const target = r.o.target1;
  for (let i = hit; i < Math.min(after.length, max); i++) {
    if (dir === 'LONG' ? after[i].high >= target : after[i].low <= target) {
      recovered++;
      break;
    }
  }
}
out(`### B2) Anatomy of the ${lossN} losses`);
out();
table(
  ['question', 'count', 'share of losses'],
  [
    ['stopped out in the very next candle', quickLoss, pct((100 * quickLoss) / lossN)],
    ['stop touched by a wick but the candle CLOSED back on the right side', wickOnly, pct((100 * wickOnly) / lossN)],
    ['went at least +0.5R in favour before being stopped', hadHalfWayR, pct((100 * hadHalfWayR) / lossN)],
    ['price still reached the TARGET later (inside the same expiry window) - a wider stop would have survived', recovered, pct((100 * recovered) / lossN)],
  ],
);

// ---- B3 what-if grid
out(`### B3) What-if: same entries, different stop width and target (real candles, cost ${COST}% per trade)`);
out();
const stopMults = [0.8, 1, 1.5, 2, 3];
const targetRs = [1, 1.5, 2, 3];
const usable = rows.filter((r) => r.atr);
const grid: string[][] = [];
for (const sm of stopMults) {
  const cells: string[] = [`${sm} ATR`];
  for (const tr of targetRs) {
    const rs: number[] = [];
    let w = 0;
    let l = 0;
    for (const r of usable) {
      const cs = candleMap.get(r.key)!;
      const dir = dirOf(r.o);
      const sign = dir === 'LONG' ? 1 : -1;
      const entry = r.o.price_at_signal;
      const risk = r.atr! * sm;
      const res = resolveTrade(
        { direction: dir, entry, stop: entry - sign * risk, target: entry + sign * risk * tr, maxBars: EXPIRY_BARS[r.o.timeframe] ?? 40 },
        cs.slice(r.idx + 1),
        COST,
      );
      if (!res) continue;
      rs.push(res.rMultiple);
      if (res.status === 'WIN') w++;
      if (res.status === 'LOSS') l++;
    }
    cells.push(`${pct((100 * w) / Math.max(1, w + l))} / ${f2(mean(rs))}R`);
  }
  grid.push(cells);
}
table(['stop \\ target', ...targetRs.map((t) => `${t}R (win% / avgR)`)], grid);
out('Reading: if a wider stop turns the avg R positive, tight stops were the problem. If avg R stays negative everywhere, the entries have no edge.');
out();

// ---- B4 mirror test and time-matched random baseline
out(`### B4) Does the entry direction carry any information?`);
out();
const rand = rng(12345);
let sigW = 0;
let sigL = 0;
let mirW = 0;
let mirL = 0;
let baseW = 0;
let baseL = 0;
const sigR: number[] = [];
const mirR: number[] = [];
const baseR: number[] = [];
const BASE_SAMPLES = 40;
for (const r of usable) {
  if (r.o.status === 'OPEN') continue;
  const cs = candleMap.get(r.key)!;
  const dir = dirOf(r.o);
  const sign = dir === 'LONG' ? 1 : -1;
  const entry = r.o.price_at_signal;
  const risk = Math.abs(entry - r.o.stop_loss);
  const maxBars = EXPIRY_BARS[r.o.timeframe] ?? 40;
  const real = resolveTrade({ direction: dir, entry, stop: r.o.stop_loss, target: r.o.target1, maxBars }, cs.slice(r.idx + 1), COST);
  if (real) {
    sigR.push(real.rMultiple);
    if (real.status === 'WIN') sigW++;
    if (real.status === 'LOSS') sigL++;
  }
  // mirror: opposite direction, same distances
  const mir = resolveTrade(
    { direction: dir === 'LONG' ? 'SHORT' : 'LONG', entry, stop: entry + sign * risk, target: entry - sign * risk * 2, maxBars },
    cs.slice(r.idx + 1),
    COST,
  );
  if (mir) {
    mirR.push(mir.rMultiple);
    if (mir.status === 'WIN') mirW++;
    if (mir.status === 'LOSS') mirL++;
  }
  // baseline: same pair, same direction, same stop/target distances (in %), random entry candle inside the audited period
  // (same pair, only inside the period in which this pair produced signals -> same market regime)
  const idxs = rows.filter((x) => x.key === r.key).map((x) => x.idx);
  const lo = Math.max(WINDOW, Math.min(...idxs) - 24);
  const hi = Math.min(cs.length - maxBars - 2, Math.max(...idxs) + 24);
  const stopPct = risk / entry;
  for (let s = 0; s < BASE_SAMPLES && hi > lo; s++) {
    const j = lo + Math.floor(rand() * (hi - lo));
    const e = cs[j].close;
    const res = resolveTrade(
      { direction: dir, entry: e, stop: e * (1 - sign * stopPct), target: e * (1 + sign * stopPct * 2), maxBars },
      cs.slice(j + 1, j + 1 + maxBars),
      COST,
    );
    if (!res) continue;
    baseR.push(res.rMultiple);
    if (res.status === 'WIN') baseW++;
    if (res.status === 'LOSS') baseL++;
  }
}
const wr = (w: number, l: number) => (w + l ? (100 * w) / (w + l) : NaN);
table(
  ['strategy', 'win rate', 'avg R (net)'],
  [
    ['actual signals', `${pct(wr(sigW, sigL))}  (n=${sigW + sigL})`, f2(mean(sigR))],
    ['mirror (opposite direction, same stop/target)', `${pct(wr(mirW, mirL))}  (n=${mirW + mirL})`, f2(mean(mirR))],
    ['random entries (same pair, period, direction, stop, target)', `${pct(wr(baseW, baseL))}  (n=${baseW + baseL})`, f2(mean(baseR))],
  ],
);
out('Reading: signals ~ random baseline => no timing skill (stop size is not the main problem). Signals clearly BELOW baseline / mirror above it => the entries tend to be late/contrarian. Signals clearly ABOVE baseline => real edge; then look at stops and costs.');
out();

// ---- B5 clustering
out(`### B5) How independent are the signals?`);
out();
const byCandle = new Map<string, Row[]>();
for (const r of rows) {
  if (r.o.status === 'OPEN') continue;
  const k = `${r.o.timeframe}|${r.o.candle_close_time}|${r.o.signal_type}`;
  byCandle.set(k, [...(byCandle.get(k) ?? []), r]);
}
const groups = [...byCandle.values()];
const big = groups.filter((g) => g.length >= 5);
const bigRows = big.flat();
const bw = bigRows.filter((r) => r.o.status === 'WIN').length;
const bl = bigRows.filter((r) => r.o.status === 'LOSS').length;
out(`${rows.filter((r) => r.o.status !== 'OPEN').length} closed signals sit on ${groups.length} distinct (candle, direction) groups. Groups with >=5 same-direction signals on one candle: ${big.length}, holding ${bigRows.length} signals, win rate ${pct(wr(bw, bl))}. Mean of per-group avg R: ${f2(mean(groups.map((g) => mean(g.map((r) => Number(r.o.r_multiple ?? 0))))))}.`);
out();

// ---------------------------------------------------------------- csv + report
const csv = ['id,symbol,tf,dir,score,status,r,stop_atr,risk_pct,cost_r,issues'];
for (const r of rows)
  csv.push([r.o.id, r.o.symbol, r.o.timeframe, r.o.signal_type, r.o.score, r.o.status, r.o.r_multiple ?? '', r.stopAtr?.toFixed(3) ?? '', r.riskPct.toFixed(3), r.costR.toFixed(3), `"${r.issues.join(';')}"`].join(','));
writeFileSync(`${outPrefix}.csv`, csv.join('\n'));
writeFileSync(`${outPrefix}.md`, lines.join('\n'));
console.log(`\nWritten: ${outPrefix}.md, ${outPrefix}.csv`);

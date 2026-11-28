// Reverse Plus evaluator harness — runs the ORIGINAL and the OPTIMISED evaluator on the same in-memory database with a
// deterministic fake Binance and a controllable clock, then compares
//   (1) the data they leave behind (must be identical, except bookkeeping timestamps / ids), and
//   (2) the number and size of database requests (what Supabase would count as GET / POST / PATCH and Egress).
//
//   node scripts/eval-harness/run.mjs            # default scenario
//   SIGNALS_LIVE=400 SIGNALS_HIST=1500 RUNS=14 node scripts/eval-harness/run.mjs
//
// No network, no credentials. It exercises the real Edge Function source (bundled with esbuild), only the two
// imports `jsr:@supabase/functions-js/...` and `npm:@supabase/supabase-js` are replaced by the mock below.

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const N_LIVE = Number(process.env.SIGNALS_LIVE ?? 300);
const N_HIST = Number(process.env.SIGNALS_HIST ?? 900);
const RUNS = Number(process.env.RUNS ?? 14);
const MIN = 60_000, H = 3_600_000, D = 24 * H;
const RealDate = Date;

// ------------------------------------------------------------------------------------------------ clock
let fakeNow = RealDate.parse('2026-11-26T10:03:00Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
  static now() { return fakeNow; }
};

// ------------------------------------------------------------------------------------------------ mock database
const TF_MS = { '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': H, '4h': 4 * H, '1d': D };
const UNIQUE = {
  reverse_plus_evaluations: ['owner_key', 'reverse_outcome_id', 'eval_kind'],
  reverse_plus_trades: ['owner_key', 'mode', 'reverse_outcome_id'],
  reverse_plus_backtests: ['reverse_outcome_id', 'engine_version'],
};
const MAX_ROWS = 1000;

class Db {
  constructor() { this.t = {}; this.reset(); }
  reset() { this.t = { reverse_plus_public_config: [], reverse_signal_outcomes: [], reverse_plus_evaluations: [], reverse_plus_trades: [], reverse_plus_backtests: [] }; this.log = []; }
  count(kind) { return this.log.filter((l) => l.method === kind).length; }
}

function project(row, cols) {
  if (!cols || cols === '*') return row;
  const o = {};
  for (const c of cols.split(',').map((x) => x.trim()).filter(Boolean)) o[c] = row[c] ?? null;
  return o;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ts = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? RealDate.parse(v) : v);

class Q {
  constructor(db, table) { this.db = db; this.table = table; this.f = []; this.cols = '*'; this.op = 'select'; this.ord = []; this.rng = null; this.single = false; this.payload = null; this.opts = {}; this.ret = false; }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else { this.ret = true; this.cols = cols; } return this; }
  upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.opts = opts; return this; }
  update(obj) { this.op = 'update'; this.payload = obj; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  not(c, o, v) { if (o === 'is' && v === null) this.f.push((r) => r[c] !== null && r[c] !== undefined); return this; }
  gte(c, v) { this.f.push((r) => ts(r[c]) >= ts(v)); return this; }
  or(expr) {
    const parts = expr.split(',').map((p) => p.split('.'));
    this.f.push((r) => parts.some(([c, o, ...v]) => (o === 'is' && v[0] === 'null' ? r[c] === null || r[c] === undefined : o === 'gte' ? ts(r[c]) >= ts(v.join('.')) : false)));
    return this;
  }
  order(c, o = {}) { this.ord.push([c, o.ascending === false ? -1 : 1]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }

  run() {
    const rows = this.db.t[this.table];
    const match = (r) => this.f.every((fn) => fn(r));
    let data = null;
    const method = this.op === 'select' ? 'GET' : this.op === 'upsert' ? 'POST' : 'PATCH';
    if (this.op === 'select') {
      let out = rows.filter(match);
      for (const [c, d] of [...this.ord].reverse()) out = [...out].sort((a, b) => d * cmp(ts(a[c]), ts(b[c])));
      const [a, b] = this.rng ?? [0, MAX_ROWS - 1];
      out = out.slice(a, Math.min(b, a + MAX_ROWS - 1) + 1);
      out = out.map((r) => project(r, this.cols));
      if (this.single) { if (out.length > 1) return this.fin(method, { data: null, error: { message: 'multiple rows' } }); data = out[0] ?? null; } else data = out;
    } else if (this.op === 'upsert') {
      const keys = this.opts.onConflict ? this.opts.onConflict.split(',') : UNIQUE[this.table];
      const ret = [];
      for (const p of this.payload) {
        const hit = keys ? rows.find((r) => keys.every((k) => r[k] === p[k])) : null;
        if (hit) { if (!this.opts.ignoreDuplicates) { Object.assign(hit, p); ret.push(hit); } } else { const row = { id: randomUUID(), created_at: new RealDate(fakeNow).toISOString(), updated_at: new RealDate(fakeNow).toISOString(), ...p }; rows.push(row); ret.push(row); }
      }
      data = this.ret ? ret.map((r) => project(r, this.cols)) : null;
    } else {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      data = null;
    }
    return this.fin(method, { data, error: null });
  }
  fin(method, res) {
    const bytes = res.data ? JSON.stringify(res.data).length : 0;
    const reqBytes = this.payload ? JSON.stringify(this.payload).length : 0;
    this.db.log.push({ method, table: this.table, bytes, reqBytes, run: this.db.run });
    return res;
  }
}
const db = new Db();
const mockClient = { from: (t) => new Q(db, t) };

// ------------------------------------------------------------------------------------------------ fake Binance
const binanceLog = { klines: 0, other: 0 };
const closeOf = (open, ms) => open + ms - 1;
function candleAt(sym, open, ms) {
  const idx = Math.floor(open / ms);
  const base = 100 + (sym.charCodeAt(0) % 7) * 10;
  const mid = (i) => base * (1 + 0.03 * Math.sin(i / 17) + 0.008 * Math.cos(i / 5));
  const o = mid(idx), c = mid(idx + 1);
  return [open, String(o), String(Math.max(o, c) * 1.002), String(Math.min(o, c) * 0.998), String(c), String(1000 + (idx % 13) * 37), closeOf(open, ms), '0', 0, '0', '0', '0'];
}
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/exchangeInfo')) {
    binanceLog.other++;
    return new Response(JSON.stringify({ symbols: ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'EEEUSDT'].map((symbol) => ({ symbol, contractType: 'PERPETUAL', status: 'TRADING', quoteAsset: 'USDT', filters: [{ filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' }, { filterType: 'PRICE_FILTER', tickSize: '0.0001' }, { filterType: 'MIN_NOTIONAL', notional: '5' }] })) }));
  }
  binanceLog.klines++;
  const sym = u.searchParams.get('symbol');
  const ms = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': H, '4h': 4 * H, '1d': D }[u.searchParams.get('interval')];
  const limit = Number(u.searchParams.get('limit') ?? 500);
  const st = u.searchParams.get('startTime'), en = u.searchParams.get('endTime');
  let first, out = [];
  if (st !== null) {
    first = Math.ceil(Number(st) / ms) * ms;
    for (let o = first; out.length < limit && o <= fakeNow && (en === null || o <= Number(en)); o += ms) out.push(candleAt(sym, o, ms));
  } else {
    const last = Math.floor((en === null ? fakeNow : Math.min(Number(en), fakeNow)) / ms) * ms;
    for (let o = last; out.length < limit; o -= ms) out.unshift(candleAt(sym, o, ms));
  }
  return new Response(JSON.stringify(out));
};

// ------------------------------------------------------------------------------------------------ bundle helper
const outDir = mkdtempSync(join(tmpdir(), 'eval-harness-'));
const mockPlugin = {
  name: 'mock-supabase',
  setup(b) {
    b.onResolve({ filter: /^jsr:/ }, () => ({ path: 'edge-runtime', namespace: 'mock' }));
    b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: 'supabase-js', namespace: 'mock' }));
    b.onLoad({ filter: /^edge-runtime$/, namespace: 'mock' }, () => ({ contents: '' }));
    b.onLoad({ filter: /^supabase-js$/, namespace: 'mock' }, () => ({ contents: 'export const createClient = () => globalThis.__mockClient;' }));
  },
};
globalThis.__mockClient = mockClient;
let bundleSeq = 0;
async function load(entry, env) {
  const out = join(outDir, `ev-${bundleSeq++}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [mockPlugin], logLevel: 'error' });
  let handler = null;
  const envMap = { CRON_SECRET: 's', SUPABASE_URL: 'http://mock', SUPABASE_SERVICE_ROLE_KEY: 'k', ...env };
  globalThis.Deno = { env: { get: (k) => envMap[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(out).href);
  return async (qs = '', body = '{}') => {
    const res = await handler(new Request(`http://mock/functions/v1/reverse-plus-eval${qs}`, { method: 'POST', headers: { 'x-cron-secret': 's' }, body }));
    return res.json();
  };
}

// ------------------------------------------------------------------------------------------------ scenario
function seed(startMs) {
  db.reset();
  const publicSince = new RealDate(startMs - 10 * D).toISOString();
  db.t.reverse_plus_public_config.push({
    id: true, public_since: publicSince, updated_at: new RealDate(startMs - 20 * D).toISOString(),
    account_balance: 1000, risk_pct: 1, max_risk_per_trade: 10, leverage: 10, margin_mode: 'ISOLATED', fee_pct: 0.05, slippage_pct: 0.02,
    max_entries: 3, max_margin_pct: 50, min_rr: 0.4, assumed_mmr_pct: 0.5, liq_safety_factor: 1.5, approach_pct: 0.3,
  });
  const tfs = ['5m', '15m', '30m', '1h', '4h', '1d'];
  const syms = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'EEEUSDT'];
  let seq = 0;
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const mk = (i, atMs) => {
    const tf = tfs[i % tfs.length], ms = TF_MS[tf], sym = syms[i % syms.length];
    const close = Math.floor(atMs / ms) * ms - 1; // close time of a candle that has already closed
    const idx = Math.floor((close + 1) / ms);
    const base = 100 + (sym.charCodeAt(0) % 7) * 10;
    const px = base * (1 + 0.03 * Math.sin(idx / 17) + 0.008 * Math.cos(idx / 5));
    const sell = i % 2 === 0;
    return {
      id: uid(++seq), origin_outcome_id: uid(100000 + seq), symbol: sym, timeframe: ms < H ? tf.toUpperCase() : tf, signal_type: sell ? 'SELL' : 'BUY',
      price_at_signal: px, entry_low: px * 0.999, entry_high: px * 1.003, stop_loss: px * (sell ? 1.03 : 0.97), target1: px * (sell ? 0.985 : 1.015),
      signal_at: new RealDate(close).toISOString(), candle_close_time: new RealDate(close).toISOString(), status: 'OPEN',
    };
  };
  for (let i = 0; i < N_LIVE; i++) db.t.reverse_signal_outcomes.push(mk(i, startMs - Math.floor((i * 5 * D) / N_LIVE) - 6 * MIN)); // last ~5 days
  for (let i = 0; i < N_HIST; i++) db.t.reverse_signal_outcomes.push(mk(i + 7, startMs - 12 * D - Math.floor((i * 60 * D) / N_HIST))); // before public_since
}

const clean = (rows) => rows.map(({ id, created_at, updated_at, evaluation_id, ...r }) => r);
const keyed = (rows, k) => new Map(rows.map((r) => [k(r), r]));
function snapshot() {
  const ev = clean(db.t.reverse_plus_evaluations), tr = clean(db.t.reverse_plus_trades), bt = clean(db.t.reverse_plus_backtests);
  return { ev, tr, bt };
}
function diff(a, b, label, k) {
  const A = keyed(a, k), B = keyed(b, k);
  let bad = 0; const sample = [];
  for (const key of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(key), y = B.get(key);
    if (JSON.stringify(x) !== JSON.stringify(y)) { bad++; if (sample.length < 3) sample.push(key); }
  }
  return { label, a: A.size, b: B.size, bad, sample };
}

async function runScenario(name, entry, env, startMs, qs = '') {
  seed(startMs);
  fakeNow = startMs;
  const handler = await load(entry, env);
  const perRun = [];
  const b0 = { ...binanceLog };
  for (let r = 0; r < RUNS; r++) {
    db.run = r;
    const before = db.log.length;
    const k0 = binanceLog.klines;
    const res = await handler(qs);
    const L = db.log.slice(before);
    perRun.push({
      run: r, ok: res.ok, GET: L.filter((l) => l.method === 'GET').length, POST: L.filter((l) => l.method === 'POST').length, PATCH: L.filter((l) => l.method === 'PATCH').length,
      respKB: L.reduce((s, l) => s + l.bytes, 0) / 1024, reqKB: L.reduce((s, l) => s + l.reqBytes, 0) / 1024, binance: binanceLog.klines - k0, errors: res.errors?.length ?? 0,
    });
    fakeNow += 5 * MIN;
  }
  return { name, perRun, snap: snapshot(), binance: binanceLog.klines - b0.klines };
}

const fmt = (n, d = 0) => n.toFixed(d).padStart(8);
function report(r) {
  console.log(`\n=== ${r.name} ===`);
  console.log('run     GET    POST   PATCH  respKB   reqKB  binanceKlines  errors');
  for (const p of r.perRun) console.log(`${String(p.run).padStart(3)} ${fmt(p.GET)} ${fmt(p.POST)} ${fmt(p.PATCH)} ${fmt(p.respKB, 1)} ${fmt(p.reqKB, 1)} ${fmt(p.binance)} ${fmt(p.errors)}`);
  const steady = r.perRun.slice(2);
  const avg = (f) => steady.reduce((s, p) => s + f(p), 0) / steady.length;
  const sum = { GET: avg((p) => p.GET), POST: avg((p) => p.POST), PATCH: avg((p) => p.PATCH), respKB: avg((p) => p.respKB), reqKB: avg((p) => p.reqKB), binance: avg((p) => p.binance) };
  console.log(`steady-state average per run (runs 2..${RUNS - 1}): GET ${sum.GET.toFixed(1)}  POST ${sum.POST.toFixed(1)}  PATCH ${sum.PATCH.toFixed(1)}  response ${sum.respKB.toFixed(1)} KB  request-body ${sum.reqKB.toFixed(1)} KB  Binance klines ${sum.binance.toFixed(1)}`);
  return sum;
}

const BASE = join(HERE, 'baseline-reverse-plus-eval.ts');
const NEW = join(ROOT, 'supabase/functions/reverse-plus-eval/index.ts');
const start = fakeNow;

const base = await runScenario('BASELINE (original evaluator)', BASE, {}, start);
const bSum = report(base);
const neu = await runScenario('OPTIMISED (defaults)', NEW, {}, start);
const nSum = report(neu);

const checks = [
  diff(base.snap.ev, neu.snap.ev, 'evaluations (SIGNAL_TIME + LIVE)', (r) => `${r.reverse_outcome_id}|${r.eval_kind}`),
  diff(base.snap.tr, neu.snap.tr, 'paper trades', (r) => r.reverse_outcome_id),
  diff(base.snap.bt, neu.snap.bt, 'backtests', (r) => r.reverse_outcome_id),
];
// signal ids differ between the two seeds -> compare by the signal's natural key instead
function natural(snapRows) { return snapRows; }
void natural;
console.log('\n=== DATA EQUALITY after', RUNS, 'runs (ids/timestamps excluded) ===');
let failed = false;
for (const c of checks) { console.log(`${c.label}: baseline=${c.a} optimised=${c.b} differing=${c.bad}${c.sample.length ? ' e.g. ' + c.sample.join(', ') : ''}`); if (c.bad || c.a !== c.b) failed = true; }

console.log('\n=== REDUCTION (steady-state, per 5-minute run) ===');
const red = (a, b) => (a === 0 ? 'n/a' : `${((1 - b / a) * 100).toFixed(0)}%`);
console.log(`GET requests : ${bSum.GET.toFixed(1)} -> ${nSum.GET.toFixed(1)}  (-${red(bSum.GET, nSum.GET)})`);
console.log(`POST requests: ${bSum.POST.toFixed(1)} -> ${nSum.POST.toFixed(1)}  (-${red(bSum.POST, nSum.POST)})`);
console.log(`DB response  : ${bSum.respKB.toFixed(1)} KB -> ${nSum.respKB.toFixed(1)} KB  (-${red(bSum.respKB, nSum.respKB)})`);
console.log(`DB request body: ${bSum.reqKB.toFixed(1)} KB -> ${nSum.reqKB.toFixed(1)} KB  (-${red(bSum.reqKB, nSum.reqKB)})`);
console.log(`Binance klines calls: ${bSum.binance.toFixed(1)} -> ${nSum.binance.toFixed(1)}  (-${red(bSum.binance, nSum.binance)})`);

{
  // opt-in switch: must store the same data as the baseline as well (it is OFF by default)
  const skip = await runScenario('OPTIMISED + REVERSE_PLUS_LIVE_SKIP_UNCHANGED=true (opt-in)', NEW, { REVERSE_PLUS_LIVE_SKIP_UNCHANGED: 'true' }, start);
  const sSum = report(skip);
  const c = diff(base.snap.ev, skip.snap.ev, 'evaluations (live-skip opt-in)', (r) => `${r.reverse_outcome_id}|${r.eval_kind}`);
  console.log(`live-skip opt-in: GET ${sSum.GET.toFixed(1)} POST ${sSum.POST.toFixed(1)} Binance ${sSum.binance.toFixed(1)}; evaluations differing from baseline: ${c.bad}`);
  if (c.bad || c.a !== c.b) failed = true;
}

if (process.env.HOT === '1') {
  const hot = await runScenario('OPTIMISED + REVERSE_PLUS_HOT_ONLY=true', NEW, { REVERSE_PLUS_HOT_ONLY: 'true' }, start);
  const hSum = report(hot);
  console.log(`GET requests (hot-only): ${hSum.GET.toFixed(1)}  response ${hSum.respKB.toFixed(1)} KB`);
  const c = diff(base.snap.ev, hot.snap.ev, 'evaluations (hot-only)', (r) => `${r.reverse_outcome_id}|${r.eval_kind}`);
  console.log(`hot-only evaluations differing from baseline: ${c.bad}`);
}

if (process.env.EDGE === '1') {
  // single-signal (immediate) mode must produce the same rows as the baseline for that signal
  for (const [label, entry] of [['baseline', BASE], ['optimised', NEW]]) {
    seed(start); fakeNow = start; db.run = 0;
    const h = await load(entry, {});
    const id = db.t.reverse_signal_outcomes[0].id;
    const res = await h('', JSON.stringify({ reverse_outcome_id: id }));
    const rows = db.t.reverse_plus_evaluations.map((r) => `${r.eval_kind}:${r.reverse_outcome_id === id}`);
    console.log(`single-signal ${label}: ok=${res.ok} mode=${res.mode} evaluations=${rows.join(',')} trades=${db.t.reverse_plus_trades.length} GET=${db.count('GET')} POST=${db.count('POST')}`);
  }
  // bulk read failure -> per-id fallback must still give the complete, identical result
  const realOr = Q.prototype.or;
  Q.prototype.or = () => { throw new Error('simulated PostgREST failure'); };
  seed(start); fakeNow = start; db.run = 0;
  const hf = await load(NEW, {});
  let r1 = await hf(); fakeNow += 5 * MIN; r1 = await hf();
  Q.prototype.or = realOr;
  console.log(`fallback: run ok=${r1.ok} evaluations=${db.t.reverse_plus_evaluations.length} (expected ${base.snap.ev.length - 0 >= 0 ? 'same order as baseline run 1' : ''}) errors=${JSON.stringify(r1.errors?.slice(0, 1))}`);
}
writeFileSync(join(outDir, 'done'), '');
process.exit(failed ? 1 : 0);

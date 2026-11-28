// Verifies the REAL `market-data` Edge Function cache behaviour with an in-memory market_data_cache and a fake Binance
// (no network, no credentials):
//   node scripts/eval-harness/market-data-check.mjs        (npm run check:market-data)
//
// What it proves (see docs/USAGE_OPTIMIZATION_REPORT.md section "market-data cache"):
//   1. live windows without endTime share ONE cache row and really hit the cache;
//   2. the old Date.now()-based endTime created one new row per call (the accumulation bug);
//   3. different symbols / intervals / limits / starts / historical endTimes NEVER share an entry and return their own candles;
//   4. `maxAge` only shortens the TTL (live freshness), it never extends it and never changes the key;
//   5. concurrent identical requests share one upstream call.

import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RealDate = Date;
let fakeNow = RealDate.parse('2026-11-27T10:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
  static now() { return fakeNow; }
};

// ---- in-memory market_data_cache (only the calls market-data makes) ---------------------------------------------------
const cache = new Map(); // `${provider}|${cache_key}` -> row
const fakeClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  from: () => {
    const f = {}; let op = 'select'; let payload;
    const b = {
      select: () => b,
      eq: (c, v) => { f[c] = v; return b; },
      maybeSingle: () => { const r = cache.get(`${f.provider}|${f.cache_key}`); return Promise.resolve({ data: r ?? null, error: null }); },
      upsert: (row) => { op = 'upsert'; payload = row; cache.set(`${row.provider}|${row.cache_key}`, { id: randomUUID(), ...row }); return Promise.resolve({ error: null }); },
    };
    void op; void payload;
    return b;
  },
};
globalThis.__client = fakeClient;

// ---- fake Binance: deterministic candles that depend on the exact parameters ------------------------------------------
const upstream = [];
const MS = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  upstream.push(u.search);
  const ms = MS[u.searchParams.get('interval')];
  const sym = u.searchParams.get('symbol');
  const limit = Number(u.searchParams.get('limit'));
  const st = u.searchParams.get('startTime'), en = u.searchParams.get('endTime');
  const px = (t) => 100 + (sym.charCodeAt(0) % 9) * 7 + Math.sin(t / ms / 9) * 3;
  const out = [];
  if (st !== null) {
    for (let o = Math.ceil(Number(st) / ms) * ms; out.length < limit && o <= fakeNow && (en === null || o <= Number(en)); o += ms) out.push([o, px(o), px(o) + 1, px(o) - 1, px(o + ms), 10, o + ms - 1]);
  } else {
    const last = Math.floor((en === null ? fakeNow : Math.min(Number(en), fakeNow)) / ms) * ms;
    for (let o = last - (limit - 1) * ms; o <= last; o += ms) out.push([o, px(o), px(o) + 1, px(o) - 1, px(o + ms), 10, o + ms - 1]);
  }
  return new Response(JSON.stringify(out));
};

// ---- load the real function ---------------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'md-check-'));
const out = join(dir, 'md.mjs');
await build({
  entryPoints: [join(ROOT, 'supabase/functions/market-data/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{ name: 'mock', setup(b) {
    b.onResolve({ filter: /^jsr:/ }, () => ({ path: 'edge', namespace: 'mock' }));
    b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: 'sb', namespace: 'mock' }));
    b.onLoad({ filter: /^edge$/, namespace: 'mock' }, () => ({ contents: '' }));
    b.onLoad({ filter: /^sb$/, namespace: 'mock' }, () => ({ contents: 'export const createClient = () => globalThis.__client;' }));
  } }],
});
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://mock', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(out).href);

const call = async (params) => {
  const qs = new URLSearchParams({ action: 'klines', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await handler(new Request(`http://mock/functions/v1/market-data?${qs}`, { headers: { Authorization: 'Bearer t' } }));
  return res.json();
};

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };
const reset = () => { cache.clear(); upstream.length = 0; };
const H = 36e5;
const start = Math.floor(fakeNow / H) * H - 100 * H;

// 1 ----------------------------------------------------------------------------------------------------------------------
reset();
for (let i = 0; i < 10; i++) { await call({ symbol: 'BTCUSDT', interval: '1h', startTime: start, limit: 1000 }); fakeNow += 2000; } // 10 polls in 20 s, live window (no endTime)
check('live window (no endTime): 10 polls inside the TTL -> 1 cache row, 1 upstream call', cache.size === 1 && upstream.length === 1, `rows=${cache.size} upstream=${upstream.length}`);

// 2 ----------------------------------------------------------------------------------------------------------------------
reset();
for (let i = 0; i < 10; i++) { await call({ symbol: 'BTCUSDT', interval: '1h', startTime: start, endTime: Date.now() - 1, limit: 1000 }); fakeNow += 2000; }
check('OLD behaviour (endTime = Date.now()-1) created one row per call and never hit the cache (the bug)', cache.size === 10 && upstream.length === 10, `rows=${cache.size} upstream=${upstream.length}`);

// 3 ----------------------------------------------------------------------------------------------------------------------
reset();
const base = { symbol: 'BTCUSDT', interval: '1h', startTime: start, endTime: start + 50 * H, limit: 500 };
const variants = {
  base, 'other end (historical)': { ...base, endTime: start + 60 * H }, 'other start': { ...base, startTime: start + H },
  'other symbol': { ...base, symbol: 'ETHUSDT' }, 'other interval': { ...base, interval: '4h' }, 'other limit': { ...base, limit: 20 },
  'live (no end)': { symbol: 'BTCUSDT', interval: '1h', startTime: start, limit: 500 },
};
const results = {};
for (const [name, p] of Object.entries(variants)) results[name] = await call(p);
check('7 different requests -> 7 different cache rows (no accidental sharing)', cache.size === 7 && upstream.length === 7, `rows=${cache.size} upstream=${upstream.length}`);
const first = (n) => results[n].candles[0]?.openTime, last = (n) => results[n].candles.at(-1)?.openTime;
check('explicit historical range returns exactly that range', first('base') === start && last('base') === start + 50 * H, `${first('base')}..${last('base')}`);
check('a different historical end returns different candles', last('other end (historical)') === start + 60 * H && last('base') !== last('other end (historical)'));
check('different start/symbol/interval/limit return their own data', first('other start') === start + H && results['other symbol'].candles[0].open !== results.base.candles[0].open && results['other interval'].candles.length < results.base.candles.length && results['other limit'].candles.length === 20);
check('live window (no end) reaches the present; the historical one stops at its end', last('live (no end)') > last('base') && last('live (no end)') <= fakeNow);
// the same historical request again is a cache hit and returns the same payload
const again = await call(variants['other end (historical)']);
check('repeating a historical request is a cache hit with identical candles', upstream.length === 7 && JSON.stringify(again.candles) === JSON.stringify(results['other end (historical)'].candles));

// 4 ----------------------------------------------------------------------------------------------------------------------
reset();
const live = { symbol: 'BTCUSDT', interval: '1h', startTime: start, limit: 100 };
await call(live); fakeNow += 10_000;
await call(live);                                        // no maxAge: 10 s old <= 30 s TTL -> hit
check('no maxAge: a 10 s old row is served (TTL 30 s unchanged)', upstream.length === 1);
await call({ ...live, maxAge: 5 });                      // live poller: needs <= 5 s -> miss, refresh the SAME row
check('maxAge=5: a 10 s old row is NOT served (fresh data fetched)', upstream.length === 2);
check('maxAge does not change the key (still one row)', cache.size === 1);
fakeNow += 2000;
await call({ ...live, maxAge: 5 });
check('maxAge=5: a 2 s old row IS served', upstream.length === 2);
fakeNow += 100_000;
await call({ ...live, maxAge: 9999 });
check('maxAge can never extend the TTL (expired row is refetched)', upstream.length === 3);
await call({ ...live, maxAge: 'abc' });
check('garbage maxAge is ignored (falls back to the TTL)', upstream.length === 3);

// 5 ----------------------------------------------------------------------------------------------------------------------
reset();
const burst = await Promise.all(Array.from({ length: 8 }, () => call({ symbol: 'SOLUSDT', interval: '15m', limit: 50 })));
check('8 concurrent identical requests -> 1 upstream call', upstream.length === 1 && burst.every((r) => r.candles.length === burst[0].candles.length), `upstream=${upstream.length}`);

console.log(failures === 0 ? '\nALL market-data checks passed' : `\n${failures} market-data check(s) FAILED`);
process.exit(failures ? 1 : 0);

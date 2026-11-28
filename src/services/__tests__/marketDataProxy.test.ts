import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The proxy path (the production path): the gateway receives stable query strings and the freshness hint.
vi.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));

const candle = { openTime: 1, closeTime: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 };
/** gateway -> { candles }, direct Binance -> raw kline rows (the two shapes the client really receives) */
const answer = (url: string) => new Response(JSON.stringify(url.includes('/functions/v1/') ? { candles: [candle] } : [[1, '1', '1', '1', '1', '1', 2]]), { status: 200 });

type MarketData = typeof import('../marketData');
type PowerMix = typeof import('../powerMixService');

describe('market-data via the Edge Function proxy', () => {
  const urls: string[] = [];
  let md: MarketData;

  beforeEach(async () => {
    urls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return answer(String(u)); }));
    vi.resetModules();
    md = await import('../marketData');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const q = (u: string) => new URL(u).searchParams;

  it('a live window: no endTime, a freshness hint, and the SAME query string on every poll', async () => {
    await md.fetchKlinesRange('BTCUSDT', '1h', 1_799_000_000_000, Date.now() - 1, 1000);
    vi.setSystemTime(1_800_000_020_000);
    await md.fetchKlinesRange('BTCUSDT', '1h', 1_799_000_000_000, Date.now() - 1, 1000);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(urls[1]);
    expect(q(urls[0]).get('action')).toBe('klines');
    expect(q(urls[0]).has('endTime')).toBe(false);
    expect(q(urls[0]).get('maxAge')).toBe(String(md.LIVE_MAX_AGE_SECONDS));
  });

  it('a historical window keeps its exact endTime and sends NO freshness hint (immutable data may use the full TTL)', async () => {
    await md.fetchKlinesRange('ETHUSDT', '4h', 1_790_000_000_000, 1_790_500_000_000, 500);
    expect(q(urls[0]).get('endTime')).toBe('1790500000000');
    expect(q(urls[0]).has('maxAge')).toBe(false);
  });

  it('fetchKlines (last N candles) is unchanged unless a freshness hint is asked for', async () => {
    await md.fetchKlines('BTCUSDT', '1h', 300);
    await md.fetchKlines('BTCUSDT', '1h', 4, { maxAgeSeconds: 5 });
    expect(q(urls[0]).has('maxAge')).toBe(false);
    expect(q(urls[0]).get('limit')).toBe('300');
    expect(q(urls[1]).get('maxAge')).toBe('5');
    expect(q(urls[1]).get('limit')).toBe('4');
  });

  it('maxAge is a gateway-only hint: it is never forwarded to Binance on the direct fallback', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SUPABASE_URL', ''); // no gateway configured -> direct Binance
    vi.resetModules();
    const direct = await import('../marketData');
    await direct.fetchKlinesRange('BTCUSDT', '1h', 1_799_000_000_000, Date.now(), 1000);
    expect(urls[urls.length - 1]).toContain('/api/binance');
    expect(urls[urls.length - 1]).not.toContain('maxAge');
    expect(urls[urls.length - 1]).not.toContain('endTime');
  });
});

describe('PowerMix BTC candles (chart replay range)', () => {
  const urls: string[] = [];
  let pm: PowerMix;
  beforeEach(async () => {
    urls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    // every upstream call takes 3 s: a slow batch must not turn the "now" chunk into an exact-timestamp request
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); vi.setSystemTime(Date.now() + 3000); return answer(String(u)); }));
    vi.resetModules();
    pm = await import('../powerMixService');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('past chunks keep their exact end; only the chunk that ends at "now" is a live window', async () => {
    const now = Date.now();
    const from = now - 90 * 24 * 3_600_000; // ~4 chunks of 1000 x 30 m
    await pm.fetchBtcCandles(from, now).catch(() => undefined);
    const ends = urls.map((u) => new URL(u).searchParams.get('endTime'));
    const live = urls.filter((u) => !new URL(u).searchParams.has('endTime'));
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(live).toHaveLength(1);                 // exactly one live (tail) chunk, even though earlier batches were slow
    expect(ends.filter(Boolean).every((e) => Number(e) < now)).toBe(true);
    // chunk starts are aligned and distinct: no two chunks share a request
    expect(new Set(urls).size).toBe(urls.length);
  });
});

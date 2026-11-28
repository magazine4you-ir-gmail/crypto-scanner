import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { fetchKlinesRange, isLiveEnd, LIVE_END_TOLERANCE_MS } from '../marketData';

describe('market-data requests are stable (cache keys must be reusable)', () => {
  const urls: string[] = [];
  beforeEach(() => {
    urls.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return new Response('[]', { status: 200 }); }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const params = (u: string) => new URL(u, 'http://x').searchParams;

  it('isLiveEnd: "now" (with a tiny tolerance) means up to the present', () => {
    expect(isLiveEnd(1000, 1000)).toBe(true);
    expect(isLiveEnd(1000 - LIVE_END_TOLERANCE_MS, 1000)).toBe(true);
    expect(isLiveEnd(1000 - LIVE_END_TOLERANCE_MS - 1, 1000)).toBe(false);
    expect(isLiveEnd(5000, 1000)).toBe(true);
  });

  it('a window ending at Date.now() sends NO endTime: two calls at different moments are the SAME request', async () => {
    vi.setSystemTime(1_800_000_000_000);
    await fetchKlinesRange('BTCUSDT', '1h', 1_799_000_000_000, Date.now() - 1, 1000);
    vi.setSystemTime(1_800_000_020_000); // 20 s later (next poll)
    await fetchKlinesRange('BTCUSDT', '1h', 1_799_000_000_000, Date.now() - 1, 1000);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(urls[1]);                       // identical -> one cache key
    expect(params(urls[0]).has('endTime')).toBe(false);
    expect(params(urls[0]).get('startTime')).toBe('1799000000000');
    expect(params(urls[0]).get('limit')).toBe('1000');
  });

  it('a historical window keeps its exact endTime (different ranges are never merged)', async () => {
    vi.setSystemTime(1_800_000_000_000);
    await fetchKlinesRange('ETHUSDT', '30m', 1_790_000_000_000, 1_790_500_000_000, 500);
    await fetchKlinesRange('ETHUSDT', '30m', 1_790_000_000_000, 1_790_600_000_000, 500);
    expect(params(urls[0]).get('endTime')).toBe('1790500000000');
    expect(params(urls[1]).get('endTime')).toBe('1790600000000');
    expect(urls[0]).not.toBe(urls[1]);
  });

  it('different symbols / intervals / starts stay different requests', async () => {
    vi.setSystemTime(1_800_000_000_000);
    const now = Date.now();
    await fetchKlinesRange('AAAUSDT', '1h', 1, now);
    await fetchKlinesRange('BBBUSDT', '1h', 1, now);
    await fetchKlinesRange('AAAUSDT', '4h', 1, now);
    await fetchKlinesRange('AAAUSDT', '1h', 2, now);
    expect(new Set(urls).size).toBe(4);
  });
});

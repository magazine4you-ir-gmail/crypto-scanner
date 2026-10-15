import type { Candle, Timeframe, SymbolInfo, TickerStat, CoinMarketData, ProviderStatus } from '@/types/market';
import { validateCandles, type DataValidationResult } from '@/engine/dataValidation';
import { pickScanTargets, type QuoteMode, type ScanTarget } from '@/engine/scanTargets';

export type { QuoteMode, ScanTarget };
import { supabase } from './supabaseClient';

const isDev = import.meta.env.DEV;

const BINANCE_BASE = isDev ? '/api/binance' : 'https://data-api.binance.vision';
const COINGECKO_BASE = isDev ? '/api/coingecko' : 'https://api.coingecko.com/api/v3';

/** Set VITE_MARKET_PROXY=off to always call Binance/CoinGecko directly from the browser. */
const PROXY_ENABLED = import.meta.env.VITE_MARKET_PROXY !== 'off';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Calls the cached `market-data` Edge Function (needs a signed-in user). Returns null when the proxy is
 * unavailable so callers can fall back to the direct request. This avoids CoinGecko's strict per-IP limits
 * and works for users whose network cannot reach Binance/CoinGecko directly.
 */
async function viaProxy<T>(action: string, params: Record<string, string | number> = {}): Promise<T | null> {
  if (!PROXY_ENABLED || !SUPABASE_URL || !ANON_KEY) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const qs = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/market-data?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function parseKlines(rows: unknown[][]): Candle[] {
  return rows.map((row) => ({
    openTime: row[0] as number,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6] as number,
    takerBuyVolume: row[9] === undefined ? undefined : Number(row[9]),
  }));
}

/** Raw klines INCLUDING the forming candle (charts need it). The engine drops it before analysing. */
export async function fetchKlines(symbol: string, interval: Timeframe, limit = 300): Promise<Candle[]> {
  const proxied = await viaProxy<{ candles: Candle[] }>('klines', { symbol, interval, limit });
  if (proxied?.candles?.length) return proxied.candles;
  const data = await fetchJson<unknown[][]>(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return parseKlines(data);
}

export async function fetchKlinesValidated(
  symbol: string,
  interval: Timeframe,
  limit = 300,
): Promise<{ candles: Candle[]; validation: DataValidationResult }> {
  const candles = await fetchKlines(symbol, interval, limit);
  const validation = validateCandles(candles);
  return { candles, validation };
}

export async function fetchTickers(symbols: string[]): Promise<TickerStat[]> {
  if (symbols.length === 0) return [];
  const proxied = await viaProxy<{ tickers: TickerStat[] }>('ticker', { symbols: symbols.join(',') });
  if (proxied?.tickers) return proxied.tickers;
  return fetchJson<TickerStat[]>(`${BINANCE_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`);
}

let exchangeInfoCache: { at: number; list: SymbolInfo[] } | null = null;

const SCAN_QUOTES = new Set<string>(['USDT', 'BTC']);

function toPairs(raw: Record<string, unknown>[]): SymbolInfo[] {
  return raw
    .filter((s) => s.status === 'TRADING' && SCAN_QUOTES.has(String(s.quoteAsset)) && s.isSpotTradingAllowed)
    .map((s) => ({ symbol: String(s.symbol), baseAsset: String(s.baseAsset), quoteAsset: String(s.quoteAsset) }));
}

/** Tradable Binance spot pairs quoted in USDT or BTC (cached for 1 hour in memory). */
export async function fetchExchangeInfo(): Promise<SymbolInfo[]> {
  if (exchangeInfoCache && Date.now() - exchangeInfoCache.at < 3_600_000) return exchangeInfoCache.list;
  let list: SymbolInfo[] | null = null;
  const proxied = await viaProxy<{ symbols: SymbolInfo[] }>('exchange-info');
  if (proxied?.symbols?.length) list = proxied.symbols;

  // An older `market-data` function only lists USDT pairs. Try to complete the list directly; if Binance is
  // not reachable from this network the scan simply stays USDT-only (the UI says so).
  if (!list || !list.some((s) => s.quoteAsset === 'BTC')) {
    try {
      const data = await fetchJson<{ symbols: Record<string, unknown>[] }>(`${BINANCE_BASE}/api/v3/exchangeInfo`);
      list = toPairs(data.symbols);
    } catch {
      /* keep whatever the proxy returned */
    }
  }
  if (!list) throw new Error('Could not load the Binance pair list');
  exchangeInfoCache = { at: Date.now(), list };
  return list;
}

export async function fetchCoinGeckoMarkets(perPage = 50, page = 1): Promise<CoinMarketData[]> {
  const proxied = await viaProxy<{ markets: CoinMarketData[] }>('coingecko-markets', { perPage, page });
  if (proxied?.markets) return proxied.markets;
  return fetchJson<CoinMarketData[]>(
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`,
  );
}

export async function fetchProviderStatus(): Promise<ProviderStatus> {
  const proxied = await viaProxy<ProviderStatus>('status');
  if (proxied?.binance) return proxied;
  const [binancePing, coingeckoPing] = await Promise.allSettled([
    fetchJson(`${BINANCE_BASE}/api/v3/ping`),
    fetchJson(`${COINGECKO_BASE}/ping`),
  ]);
  return {
    binance: { configured: true, reachable: binancePing.status === 'fulfilled' },
    coingecko: { configured: true, reachable: coingeckoPing.status === 'fulfilled' },
    coinmarketcap: { configured: false, reachable: false },
    checkedAt: new Date().toISOString(),
  };
}

/** Top-N coins by market cap, as scan targets in the requested quote currency(ies). */
export async function fetchScanUniverse(
  count: number,
  mode: QuoteMode = 'USDT',
): Promise<{ targets: ScanTarget[]; btcListed: boolean }> {
  const [markets, pairs] = await Promise.all([fetchCoinGeckoMarkets(Math.min(250, count * 2 + 20), 1), fetchExchangeInfo()]);
  return {
    targets: pickScanTargets(markets, pairs, count, mode),
    btcListed: pairs.some((p) => p.quoteAsset === 'BTC'),
  };
}

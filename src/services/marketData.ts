import type { Candle, Timeframe, SymbolInfo, TickerStat, CoinMarketData, ProviderStatus } from '@/types/market';
import { validateCandles, type DataValidationResult } from '@/engine/dataValidation';

const isDev = import.meta.env.DEV;

const BINANCE_BASE = isDev ? '/api/binance' : 'https://data-api.binance.vision';
const COINGECKO_BASE = isDev ? '/api/coingecko' : 'https://api.coingecko.com/api/v3';

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchKlines(symbol: string, interval: Timeframe, limit = 300): Promise<Candle[]> {
  const data = await fetchJson(
    `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  return (data as unknown[][]).map((row) => ({
    openTime: row[0] as number,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6] as number,
  }));
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
  const data = await fetchJson(
    `${BINANCE_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
  );
  return data as TickerStat[];
}

export async function fetchExchangeInfo(): Promise<SymbolInfo[]> {
  const data = await fetchJson(`${BINANCE_BASE}/api/v3/exchangeInfo`);
  return (data as any).symbols
    .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
    .map((s: any) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));
}

export async function fetchCoinGeckoMarkets(perPage = 50, page = 1): Promise<CoinMarketData[]> {
  const data = await fetchJson(
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`,
  );
  return data as CoinMarketData[];
}

export async function fetchProviderStatus(): Promise<ProviderStatus> {
  const [binancePing, coingeckoPing] = await Promise.allSettled([
    fetchJson(`${BINANCE_BASE}/api/v3/ping`),
    fetchJson(`${COINGECKO_BASE}/ping`),
  ]);

  return {
    binance: {
      configured: true,
      reachable: binancePing.status === 'fulfilled',
    },
    coingecko: {
      configured: true,
      reachable: coingeckoPing.status === 'fulfilled',
    },
    coinmarketcap: {
      configured: false,
      reachable: false,
    },
    checkedAt: new Date().toISOString(),
  };
}

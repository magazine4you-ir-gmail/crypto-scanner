import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BINANCE_BASE = "https://data-api.binance.vision";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CMC_BASE = "https://pro-api.coinmarketcap.com/v1";

const INTERVAL_ALLOWLIST = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

const TTL = {
  klines: 30,
  ticker: 15,
  exchangeInfo: 86400,
  coingeckoMarkets: 120,
  coingeckoCoin: 300,
  cmcQuotes: 300,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function badRequest(message: string) {
  return jsonResponse({ error: message }, 400);
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function readCache(provider: string, cacheKey: string) {
  const { data } = await supabase
    .from("market_data_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("provider", provider)
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (!data) return null;
  const ageSeconds = (Date.now() - new Date(data.fetched_at).getTime()) / 1000;
  if (ageSeconds > data.ttl_seconds) return null;
  return data.payload;
}

async function writeCache(provider: string, cacheKey: string, payload: unknown, ttlSeconds: number) {
  await supabase
    .from("market_data_cache")
    .upsert(
      { provider, cache_key: cacheKey, payload, fetched_at: new Date().toISOString(), ttl_seconds: ttlSeconds },
      { onConflict: "provider,cache_key" },
    );
}

async function fetchWithBackoff(url: string, init?: RequestInit, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 418) return res;
    if (attempt >= maxRetries) return res;
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
    const backoffMs = Math.max(retryAfterMs, 500 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    attempt += 1;
  }
}

async function cachedFetch(provider: string, cacheKey: string, ttlSeconds: number, url: string) {
  const cached = await readCache(provider, cacheKey);
  if (cached !== null) return { data: cached, fromCache: true };

  const res = await fetchWithBackoff(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider} request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  await writeCache(provider, cacheKey, data, ttlSeconds);
  return { data, fromCache: false };
}

function validateSymbol(symbol: string | null): string {
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    throw new Error("invalid symbol");
  }
  return symbol;
}

function validateInterval(interval: string | null): string {
  if (!interval || !INTERVAL_ALLOWLIST.has(interval)) {
    throw new Error("invalid interval");
  }
  return interval;
}

async function handleKlines(params: URLSearchParams) {
  const symbol = validateSymbol(params.get("symbol"));
  const interval = validateInterval(params.get("interval"));
  const limitRaw = Number(params.get("limit") ?? "300");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 1000) : 300;

  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const cacheKey = `klines:${symbol}:${interval}:${limit}`;
  const { data, fromCache } = await cachedFetch("binance", cacheKey, TTL.klines, url);

  const candles = (data as unknown[][]).map((row) => ({
    openTime: row[0] as number,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6] as number,
  }));

  return jsonResponse({ provider: "binance", symbol, interval, candles, fromCache });
}

async function handleTicker(params: URLSearchParams) {
  const symbolsParam = params.get("symbols");
  if (!symbolsParam) throw new Error("symbols required");
  const symbols = symbolsParam.split(",").map((s) => validateSymbol(s.trim()));

  const url = `${BINANCE_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const cacheKey = `ticker:${symbols.sort().join(",")}`;
  const { data, fromCache } = await cachedFetch("binance", cacheKey, TTL.ticker, url);

  return jsonResponse({ provider: "binance", tickers: data, fromCache });
}

async function handleExchangeInfo() {
  const cached = await readCache("binance", "exchangeInfoFiltered");
  if (cached !== null) {
    return jsonResponse({ provider: "binance", symbols: cached, fromCache: true });
  }

  const res = await fetchWithBackoff(`${BINANCE_BASE}/api/v3/exchangeInfo`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`binance request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();

  const symbols = (data as any).symbols
    .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed)
    .map((s: any) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));

  await writeCache("binance", "exchangeInfoFiltered", symbols, TTL.exchangeInfo);

  return jsonResponse({ provider: "binance", symbols, fromCache: false });
}

async function handleCoingeckoMarkets(params: URLSearchParams) {
  const perPageRaw = Number(params.get("perPage") ?? "20");
  const perPage = Number.isFinite(perPageRaw) ? Math.min(Math.max(Math.trunc(perPageRaw), 1), 250) : 20;
  const page = Math.max(Math.trunc(Number(params.get("page") ?? "1")), 1);

  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`;
  const cacheKey = `markets:${perPage}:${page}`;
  const { data, fromCache } = await cachedFetch("coingecko", cacheKey, TTL.coingeckoMarkets, url);

  return jsonResponse({ provider: "coingecko", markets: data, fromCache });
}

async function handleCoingeckoCoin(params: URLSearchParams) {
  const id = params.get("id");
  if (!id || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("invalid coin id");

  const url = `${COINGECKO_BASE}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
  const cacheKey = `coin:${id}`;
  const { data, fromCache } = await cachedFetch("coingecko", cacheKey, TTL.coingeckoCoin, url);

  return jsonResponse({ provider: "coingecko", coin: data, fromCache });
}

async function handleCmcQuotes(params: URLSearchParams) {
  const apiKey = Deno.env.get("COINMARKETCAP_API_KEY");
  if (!apiKey) {
    return jsonResponse({ provider: "coinmarketcap", configured: false });
  }

  const symbolsParam = params.get("symbols");
  if (!symbolsParam) throw new Error("symbols required");
  const symbols = symbolsParam.split(",").map((s) => validateSymbol(s.trim()));

  const cacheKey = `quotes:${symbols.sort().join(",")}`;
  const cached = await readCache("coinmarketcap", cacheKey);
  if (cached !== null) {
    return jsonResponse({ provider: "coinmarketcap", configured: true, data: cached, fromCache: true });
  }

  const url = `${CMC_BASE}/cryptocurrency/quotes/latest?symbol=${symbols.join(",")}`;
  const res = await fetchWithBackoff(url, { headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`coinmarketcap request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  await writeCache("coinmarketcap", cacheKey, body.data, TTL.cmcQuotes);

  return jsonResponse({ provider: "coinmarketcap", configured: true, data: body.data, fromCache: false });
}

async function handleStatus() {
  const cmcConfigured = Boolean(Deno.env.get("COINMARKETCAP_API_KEY"));

  const [binancePing, coingeckoPing] = await Promise.allSettled([
    fetch(`${BINANCE_BASE}/api/v3/ping`),
    fetch(`${COINGECKO_BASE}/ping`),
  ]);

  return jsonResponse({
    binance: {
      configured: true,
      reachable: binancePing.status === "fulfilled" && binancePing.value.ok,
    },
    coingecko: {
      configured: true,
      reachable: coingeckoPing.status === "fulfilled" && coingeckoPing.value.ok,
    },
    coinmarketcap: {
      configured: cmcConfigured,
      reachable: false,
    },
    checkedAt: new Date().toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    switch (action) {
      case "klines":
        return await handleKlines(url.searchParams);
      case "ticker":
        return await handleTicker(url.searchParams);
      case "exchange-info":
        return await handleExchangeInfo();
      case "coingecko-markets":
        return await handleCoingeckoMarkets(url.searchParams);
      case "coingecko-coin":
        return await handleCoingeckoCoin(url.searchParams);
      case "cmc-quotes":
        return await handleCmcQuotes(url.searchParams);
      case "status":
        return await handleStatus();
      default:
        return badRequest("unknown or missing action");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return jsonResponse({ error: message }, message.includes("invalid") || message.includes("required") ? 400 : 502);
  }
});

// supabase/functions/scheduled-scan/index.ts
//
// اسکن خودکار ساعتی ۱۰۰ ارز برتر (Buy / Short / Wait) — اجرا با pg_cron.
// Hourly server-side scan of the top-100 coins, called by pg_cron.
//
// Flow:
//   1. Build the universe: top-N by market cap (CoinGecko) restricted to coins that
//      trade as <COIN>USDT on Binance spot. If CoinGecko is unavailable (rate limit),
//      fall back to ranking Binance USDT pairs by 24h quote volume.
//   2. Fetch CLOSED candles from Binance for each coin x timeframe and score them.
//   3. Upsert the latest result per (symbol, timeframe) into `scan_results`
//      and write one summary row per run into `scan_runs`.
//
// Auth: no JWT. The caller (pg_cron) must send the header  x-cron-secret: <CRON_SECRET>
//   supabase secrets set CRON_SECRET=<long-random-string>
// Writes use the service-role key (bypasses RLS). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.
// Optional secret: COINGECKO_API_KEY (demo key) to reduce rate-limit failures.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// ---------------------------------------------------------------------
// Settings — edit these constants to change what the scan does
// ---------------------------------------------------------------------
const TIMEFRAMES = ["1h", "4h", "1d"]; // each coin is analysed on every timeframe listed
const TOP_N = 100; // number of coins
const CANDLE_LIMIT = 300; // candles requested per call (EMA200 needs 200+)
const CONCURRENCY = 8; // parallel Binance requests
const TIME_BUDGET_MS = 110_000; // stop starting new work after this (Supabase wall-clock limit ~150s on free plan)

const BINANCE_BASE = "https://data-api.binance.vision";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// Stablecoins and wrapped/staked tokens are not useful to scan.
const EXCLUDED_BASES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "USDS", "PYUSD", "USD1", "USDD",
  "GUSD", "FRAX", "LUSD", "EURC", "EURI", "AEUR", "XUSD", "RLUSD", "BFUSD", "USDG", "USDY", "SUSDE",
  "WBTC", "WETH", "STETH", "WSTETH", "WEETH", "WBETH", "BETH", "CBBTC", "CBETH", "RETH", "METH",
  "EZETH", "RSETH", "BNSOL", "JITOSOL", "MSOL",
]);

// =====================================================================
// Types (mirrors src/types/market.ts / src/types/signal.ts)
// =====================================================================

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

type SignalType = "BUY" | "SELL" | "WAIT" | "EXIT" | "NO_TRADE";
type StructureLabel =
  | "HH_HL" | "LH_LL" | "RANGING" | "BOS_BULLISH" | "BOS_BEARISH"
  | "CHOCH_BULLISH" | "CHOCH_BEARISH" | "UNDEFINED";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type MarketRegime = "BULLISH_TREND" | "BEARISH_TREND" | "RANGE" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "TRANSITION" | "UNCLEAR";
type TrendDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

interface SwingPoint { index: number; time: number; price: number; type: "HIGH" | "LOW" }
interface SRLevel { price: number; type: "SUPPORT" | "RESISTANCE"; strength: number; touches: number }
interface RiskPlan {
  entryLow: number; entryHigh: number; invalidation: number; stopLoss: number;
  target1: number; target2: number; target3: number; riskReward: number;
  riskLevel: RiskLevel; positionSize: number;
}

// =====================================================================
// Indicators (ported from src/engine/indicators/*.ts — logic unchanged)
// =====================================================================

function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = values[i] * k + prev * (1 - k);
  }
  return result;
}

function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change; else lossSum += -change;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  const computeRsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  result[period] = computeRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = computeRsi(avgGain, avgLoss);
  }
  return result;
}

interface MacdResult { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] }
function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) => {
    const f = fastEma[i], s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const firstValidIndex = macdLine.findIndex((v) => v !== null);
  const signalEma = firstValidIndex >= 0 ? ema(macdValues, signalPeriod) : [];
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValidIndex >= 0) {
    for (let i = 0; i < signalEma.length; i++) signalLine[firstValidIndex + i] = signalEma[i];
  }
  const histogram = closes.map((_, i) => {
    const m = macdLine[i], s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

function atr(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  result[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = (prev * (period - 1) + tr[i]) / period;
  }
  return result;
}

function adx(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period * 2) return result;
  const plusDm = [0], minusDm = [0];
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }
  function wilderSmooth(values: number[]): (number | null)[] {
    const r: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < period) return r;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    r[period - 1] = sum / period; // average seed (equivalent to sum-seed after ratio cancellation)
    for (let i = period; i < values.length; i++) {
      const prev = r[i - 1] as number;
      r[i] = prev - prev / period + values[i] / period;
    }
    return r;
  }
  const sTr = wilderSmooth(tr), sP = wilderSmooth(plusDm), sM = wilderSmooth(minusDm);
  const dx = candles.map((_, i) => {
    const t = sTr[i], p = sP[i], m = sM[i];
    if (t === null || p === null || m === null || t === 0) return null;
    const pdi = (p / t) * 100, mdi = (m / t) * 100, s = pdi + mdi;
    return s === 0 ? 0 : (Math.abs(pdi - mdi) / s) * 100;
  });
  const dxValues = dx.filter((v): v is number => v !== null);
  const firstValidIndex = dx.findIndex((v) => v !== null);
  if (firstValidIndex < 0 || dxValues.length <= period) return result;
  const seed = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[firstValidIndex + period - 1] = seed;
  let prev = seed;
  for (let i = period; i < dxValues.length; i++) {
    prev = (prev * (period - 1) + dxValues[i]) / period;
    result[firstValidIndex + i] = prev;
  }
  return result;
}

function relativeVolume(volumes: number[], period = 20): (number | null)[] {
  const result: (number | null)[] = new Array(volumes.length).fill(null);
  for (let i = period; i < volumes.length; i++) {
    const slice = volumes.slice(i - period, i);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    result[i] = avg > 0 ? volumes[i] / avg : null;
  }
  return result;
}

// =====================================================================
// Market structure / support-resistance / regime (ported, unchanged)
// =====================================================================

function findSwingPoints(candles: Candle[], lookback = 2): SwingPoint[] {
  const points: SwingPoint[] = [];
  if (candles.length < lookback * 2 + 1) return points;
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ index: i, time: candles[i].openTime, price: candles[i].high, type: "HIGH" });
    if (isLow) points.push({ index: i, time: candles[i].openTime, price: candles[i].low, type: "LOW" });
  }
  return points;
}

function detectStructure(swings: SwingPoint[]): StructureLabel {
  if (swings.length < 4) return "UNDEFINED";
  const highs = swings.filter((s) => s.type === "HIGH").slice(-3);
  const lows = swings.filter((s) => s.type === "LOW").slice(-3);
  if (highs.length < 2 || lows.length < 2) return "UNDEFINED";
  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const higherHigh = lastHigh.price > prevHigh.price;
  const higherLow = lastLow.price > prevLow.price;
  const lowerHigh = lastHigh.price < prevHigh.price;
  const lowerLow = lastLow.price < prevLow.price;
  if (higherHigh && higherLow) return "HH_HL";
  if (lowerHigh && lowerLow) return "LH_LL";
  const recentSwings = swings.slice(-6).map((s) => s.price);
  const maxPrice = Math.max(...recentSwings), minPrice = Math.min(...recentSwings);
  if ((maxPrice - minPrice) / minPrice < 0.05) return "RANGING";
  if (higherHigh && !higherLow) return "BOS_BULLISH";
  if (lowerLow && !lowerHigh) return "BOS_BEARISH";
  return "RANGING";
}

function findSupportResistance(candles: Candle[], swings: SwingPoint[]): SRLevel[] {
  const levels: SRLevel[] = [];
  const tolerance = 0.015;
  const cluster = (points: SwingPoint[], type: "SUPPORT" | "RESISTANCE") => {
    const sorted = [...points].sort((a, b) => a.price - b.price);
    let group: SwingPoint[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const avgPrice = group.reduce((s, p) => s + p.price, 0) / group.length;
      levels.push({ price: avgPrice, type, strength: group.length, touches: group.length });
      group = [];
    };
    for (const p of sorted) {
      if (group.length === 0) { group.push(p); continue; }
      const last = group[group.length - 1];
      if (Math.abs(p.price - last.price) / last.price <= tolerance) group.push(p);
      else { flush(); group.push(p); }
    }
    flush();
  };
  cluster(swings.filter((s) => s.type === "LOW"), "SUPPORT");
  cluster(swings.filter((s) => s.type === "HIGH"), "RESISTANCE");
  return levels;
}

function nearestResistance(levels: SRLevel[], price: number): number | null {
  const above = levels.filter((l) => l.type === "RESISTANCE" && l.price > price);
  if (above.length === 0) return null;
  return above.reduce((a, b) => (a.price < b.price ? a : b)).price;
}

function nearestSupport(levels: SRLevel[], price: number): number | null {
  const below = levels.filter((l) => l.type === "SUPPORT" && l.price < price);
  if (below.length === 0) return null;
  return below.reduce((a, b) => (a.price > b.price ? a : b)).price;
}

interface RegimeResult { regime: MarketRegime; trend: TrendDirection }
function detectRegime(candles: Candle[]): RegimeResult {
  if (candles.length < 50) return { regime: "UNCLEAR", trend: "NEUTRAL" };
  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20), ema50 = ema(closes, 50), ema200 = ema(closes, 200);
  const atrValues = atr(candles, 14), adxValues = adx(candles, 14);
  const lastClose = closes[closes.length - 1];
  const lastEma20 = ema20[ema20.length - 1], lastEma50 = ema50[ema50.length - 1], lastEma200 = ema200[ema200.length - 1];
  const lastAtr = atrValues[atrValues.length - 1], lastAdx = adxValues[adxValues.length - 1];
  if (lastEma20 === null || lastEma50 === null || lastEma200 === null || lastAtr === null) {
    return { regime: "UNCLEAR", trend: "NEUTRAL" };
  }
  const atrPct = (lastAtr / lastClose) * 100;
  const isHighVolatility = atrPct > 6;
  const isLowVolatility = atrPct < 1.5;
  let trend: TrendDirection = "NEUTRAL";
  if (lastEma20 > lastEma50 && lastEma50 > lastEma200 && lastClose > lastEma200) trend = "BULLISH";
  else if (lastEma20 < lastEma50 && lastEma50 < lastEma200 && lastClose < lastEma200) trend = "BEARISH";
  const adxStrong = lastAdx !== null && lastAdx > 25;
  const adxWeak = lastAdx !== null && lastAdx < 20;
  let regime: MarketRegime = "UNCLEAR";
  if (isHighVolatility) regime = "HIGH_VOLATILITY";
  else if (trend === "BULLISH" && adxStrong) regime = "BULLISH_TREND";
  else if (trend === "BEARISH" && adxStrong) regime = "BEARISH_TREND";
  else if (trend === "NEUTRAL" || adxWeak) regime = "RANGE";
  else if (isLowVolatility) regime = "LOW_VOLATILITY";
  else if ((trend === "BULLISH" || trend === "BEARISH") && !adxStrong && !adxWeak) regime = "TRANSITION";
  return { regime, trend };
}

// =====================================================================
// Risk plans (ported from src/engine/risk.ts, including the support/
// resistance stop-tightening fix)
// =====================================================================

interface RiskConfig { minRiskReward: number; riskPercent: number; capital: number; atrMultiplier: number }

function classifyRiskLevel(atrValue: number, lastClose: number): RiskLevel {
  const atrPct = (atrValue / lastClose) * 100;
  if (atrPct < 2) return "LOW";
  if (atrPct < 4) return "MEDIUM";
  return "HIGH";
}

function computeRiskPlan(candles: Candle[], levels: SRLevel[], atrValue: number | null, config: RiskConfig): RiskPlan | null {
  if (candles.length === 0 || atrValue === null || atrValue <= 0) return null;
  const lastClose = candles[candles.length - 1].close;
  const support = nearestSupport(levels, lastClose);
  const stopDistance = atrValue * config.atrMultiplier;
  const entryLow = lastClose, entryHigh = lastClose + atrValue * 0.3;
  let invalidation = lastClose - stopDistance;
  if (support !== null && support > invalidation && support < lastClose) invalidation = support * 0.998;
  const stopLoss = invalidation;
  const riskPerUnit = lastClose - stopLoss;
  if (riskPerUnit <= 0) return null;
  const target1 = lastClose + riskPerUnit * 2, target2 = lastClose + riskPerUnit * 3, target3 = lastClose + riskPerUnit * 5;
  const riskReward = (target1 - lastClose) / riskPerUnit;
  const riskAmount = config.capital * (config.riskPercent / 100);
  return { entryLow, entryHigh, invalidation, stopLoss, target1, target2, target3, riskReward, riskLevel: classifyRiskLevel(atrValue, lastClose), positionSize: riskAmount / riskPerUnit };
}

function computeShortRiskPlan(candles: Candle[], levels: SRLevel[], atrValue: number | null, config: RiskConfig): RiskPlan | null {
  if (candles.length === 0 || atrValue === null || atrValue <= 0) return null;
  const lastClose = candles[candles.length - 1].close;
  const resistance = nearestResistance(levels, lastClose);
  const stopDistance = atrValue * config.atrMultiplier;
  const entryHigh = lastClose, entryLow = lastClose - atrValue * 0.3;
  let invalidation = lastClose + stopDistance;
  if (resistance !== null && resistance < invalidation && resistance > lastClose) invalidation = resistance * 1.002;
  const stopLoss = invalidation;
  const riskPerUnit = stopLoss - lastClose;
  if (riskPerUnit <= 0) return null;
  const target1 = lastClose - riskPerUnit * 2, target2 = lastClose - riskPerUnit * 3, target3 = lastClose - riskPerUnit * 5;
  const riskReward = (lastClose - target1) / riskPerUnit;
  const riskAmount = config.capital * (config.riskPercent / 100);
  return { entryLow, entryHigh, invalidation, stopLoss, target1, target2, target3, riskReward, riskLevel: classifyRiskLevel(atrValue, lastClose), positionSize: riskAmount / riskPerUnit };
}

function isResistanceTooClose(levels: SRLevel[], price: number, threshold = 0.02): boolean {
  const r = nearestResistance(levels, price);
  if (r === null) return false;
  const d = (r - price) / price;
  return d > 0 && d < threshold;
}

function isSupportTooClose(levels: SRLevel[], price: number, threshold = 0.02): boolean {
  const s = nearestSupport(levels, price);
  if (s === null) return false;
  const d = (price - s) / price;
  return d > 0 && d < threshold;
}

const WEIGHTS = { trend: 20, structure: 20, momentum: 15, volume: 15, volatility: 10, supportResistance: 10, riskReward: 10 };
const THRESHOLDS = { strong: 80, buy: 70, watch: 60 };
const RISK_CONFIG: RiskConfig = { minRiskReward: 2, riskPercent: 1, capital: 10000, atrMultiplier: 1.5 };

// =====================================================================
// Scoring engine — same weights/conditions as src/engine/signalEngine.ts,
// extended with a mirrored bearish side (SELL = Short signal).
// =====================================================================

interface ScanResult {
  signalType: SignalType;
  bias: "LONG" | "SHORT";
  score: number;
  bullScore: number;
  bearScore: number;
  regime: MarketRegime;
  trend: TrendDirection;
  structure: StructureLabel;
  riskLevel: RiskLevel;
  price: number;
  rsi: number | null;
  atrPct: number | null;
  relVolume: number | null;
  risk: RiskPlan | null;
}

function analyze(candles: Candle[]): ScanResult | null {
  if (candles.length < 50) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastClose = closes[closes.length - 1];

  const ema20 = ema(closes, 20), ema50 = ema(closes, 50), ema200 = ema(closes, 200);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes);
  const atrValues = atr(candles, 14);
  const relVol = relativeVolume(volumes, 20);

  const lastEma20 = ema20[ema20.length - 1], lastEma50 = ema50[ema50.length - 1], lastEma200 = ema200[ema200.length - 1];
  const lastRsi = rsiValues[rsiValues.length - 1];
  const lastMacd = macdResult.macd[macdResult.macd.length - 1];
  const lastSignal = macdResult.signal[macdResult.signal.length - 1];
  const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
  const lastAtr = atrValues[atrValues.length - 1];
  const lastRelVol = relVol[relVol.length - 1];

  const swings = findSwingPoints(candles, 2);
  const structure = detectStructure(swings);
  const levels = findSupportResistance(candles, swings);
  const regimeResult = detectRegime(candles);

  // Trend
  let trendScore = 0;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 > lastEma50) trendScore += 40;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 > lastEma200) trendScore += 30;
  if (lastEma20 !== null && lastClose > lastEma20) trendScore += 30;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 < lastEma50) trendScore -= 20;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 < lastEma200) trendScore -= 20;
  trendScore = Math.max(0, Math.min(100, trendScore));
  const trendBullish = (lastEma20 ?? 0) > (lastEma50 ?? 0) && (lastEma50 ?? 0) > (lastEma200 ?? 0);

  // Structure
  let structureScore = structure === "HH_HL" || structure === "BOS_BULLISH" ? 80
    : structure === "LH_LL" || structure === "BOS_BEARISH" ? 20
    : structure === "RANGING" ? 40 : 30;
  const structureBullish = structure === "HH_HL" || structure === "BOS_BULLISH";

  // Momentum
  let momentumScore = 0;
  if (lastRsi !== null) {
    if (lastRsi > 50 && lastRsi < 70) momentumScore += 50;
    else if (lastRsi >= 70) momentumScore += 30;
    else if (lastRsi < 30) momentumScore += 20;
    else momentumScore += 35;
  }
  if (lastMacd !== null && lastSignal !== null && lastMacd > lastSignal) momentumScore += 30; else momentumScore -= 10;
  if (lastHist !== null && lastHist > 0) momentumScore += 20; else momentumScore -= 10;
  momentumScore = Math.max(0, Math.min(100, momentumScore));
  const momentumBullish = lastRsi !== null && lastRsi > 50 && lastMacd !== null && lastSignal !== null && lastMacd > lastSignal;

  // Volume (direction-agnostic)
  let volumeScore = 0;
  if (lastRelVol !== null) {
    volumeScore = lastRelVol > 1.5 ? 80 : lastRelVol > 1.0 ? 60 : lastRelVol > 0.7 ? 40 : 20;
  }
  const volumeConfirming = lastRelVol !== null && lastRelVol > 1.0;

  // Volatility (direction-agnostic)
  const atrPct = lastAtr !== null ? (lastAtr / lastClose) * 100 : null;
  let volatilityScore = 0;
  if (atrPct !== null) volatilityScore = atrPct < 2 ? 80 : atrPct < 4 ? 60 : atrPct < 6 ? 40 : 20;
  const volatilityOk = atrPct !== null && atrPct < 5;

  // Bullish support/resistance + risk/reward
  const resistance = nearestResistance(levels, lastClose);
  let srScore = 50;
  if (resistance !== null) {
    const d = (resistance - lastClose) / lastClose;
    srScore = d > 0.05 ? 80 : d > 0.02 ? 60 : 30;
  }
  const riskPlan = computeRiskPlan(candles, levels, lastAtr, RISK_CONFIG);
  let rrScore = 0;
  if (riskPlan !== null) rrScore = riskPlan.riskReward >= 3 ? 100 : riskPlan.riskReward >= 2 ? 80 : riskPlan.riskReward >= 1.5 ? 50 : 20;
  const rrOk = riskPlan !== null && riskPlan.riskReward >= RISK_CONFIG.minRiskReward;

  const bullTotal = Math.round(
    (trendScore / 100) * WEIGHTS.trend + (structureScore / 100) * WEIGHTS.structure +
    (momentumScore / 100) * WEIGHTS.momentum + (volumeScore / 100) * WEIGHTS.volume +
    (volatilityScore / 100) * WEIGHTS.volatility + (srScore / 100) * WEIGHTS.supportResistance +
    (rrScore / 100) * WEIGHTS.riskReward,
  );

  // Bearish mirror
  let trendScoreBear = 0;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 < lastEma50) trendScoreBear += 40;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 < lastEma200) trendScoreBear += 30;
  if (lastEma20 !== null && lastClose < lastEma20) trendScoreBear += 30;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 > lastEma50) trendScoreBear -= 20;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 > lastEma200) trendScoreBear -= 20;
  trendScoreBear = Math.max(0, Math.min(100, trendScoreBear));
  const trendBearish = (lastEma20 ?? 0) < (lastEma50 ?? 0) && (lastEma50 ?? 0) < (lastEma200 ?? 0);

  const structureScoreBear = structure === "LH_LL" || structure === "BOS_BEARISH" ? 80
    : structure === "HH_HL" || structure === "BOS_BULLISH" ? 20
    : structure === "RANGING" ? 40 : 30;
  const structureBearish = structure === "LH_LL" || structure === "BOS_BEARISH";

  let momentumScoreBear = 0;
  if (lastRsi !== null) {
    if (lastRsi < 50 && lastRsi > 30) momentumScoreBear += 50;
    else if (lastRsi <= 30) momentumScoreBear += 30;
    else if (lastRsi >= 70) momentumScoreBear += 20;
    else momentumScoreBear += 35;
  }
  if (lastMacd !== null && lastSignal !== null && lastMacd < lastSignal) momentumScoreBear += 30; else momentumScoreBear -= 10;
  if (lastHist !== null && lastHist < 0) momentumScoreBear += 20; else momentumScoreBear -= 10;
  momentumScoreBear = Math.max(0, Math.min(100, momentumScoreBear));
  const momentumBearish = lastRsi !== null && lastRsi < 50 && lastMacd !== null && lastSignal !== null && lastMacd < lastSignal;

  const shortRiskPlan = computeShortRiskPlan(candles, levels, lastAtr, RISK_CONFIG);
  let rrScoreBear = 0;
  if (shortRiskPlan !== null) rrScoreBear = shortRiskPlan.riskReward >= 3 ? 100 : shortRiskPlan.riskReward >= 2 ? 80 : shortRiskPlan.riskReward >= 1.5 ? 50 : 20;
  const rrOkShort = shortRiskPlan !== null && shortRiskPlan.riskReward >= RISK_CONFIG.minRiskReward;

  const support = nearestSupport(levels, lastClose);
  let srScoreBear = 50;
  if (support !== null) {
    const d = (lastClose - support) / lastClose;
    srScoreBear = d > 0.05 ? 80 : d > 0.02 ? 60 : 30;
  }

  const bearTotal = Math.round(
    (trendScoreBear / 100) * WEIGHTS.trend + (structureScoreBear / 100) * WEIGHTS.structure +
    (momentumScoreBear / 100) * WEIGHTS.momentum + (volumeScore / 100) * WEIGHTS.volume +
    (volatilityScore / 100) * WEIGHTS.volatility + (srScoreBear / 100) * WEIGHTS.supportResistance +
    (rrScoreBear / 100) * WEIGHTS.riskReward,
  );

  const bullSetupOk = riskPlan !== null && rrOk && bullTotal >= THRESHOLDS.buy && trendBullish && structureBullish && momentumBullish && volumeConfirming;
  const bearSetupOk = shortRiskPlan !== null && rrOkShort && bearTotal >= THRESHOLDS.buy && trendBearish && structureBearish && momentumBearish && volumeConfirming;

  // --- Final decision (mirrors the original engine's hard blocks, per direction) ---
  const longSide = bullTotal >= bearTotal;
  let signalType: SignalType;
  let score: number;
  let plan: RiskPlan | null = null;

  const blocked =
    regimeResult.regime === "UNCLEAR" || regimeResult.regime === "HIGH_VOLATILITY" || !volatilityOk;

  if (blocked) {
    signalType = "NO_TRADE";
    score = Math.max(bullTotal, bearTotal);
  } else if (bullSetupOk && !isResistanceTooClose(levels, lastClose)) {
    signalType = "BUY";
    score = bullTotal;
    plan = riskPlan;
  } else if (bearSetupOk && !isSupportTooClose(levels, lastClose)) {
    signalType = "SELL";
    score = bearTotal;
    plan = shortRiskPlan;
  } else {
    // No full setup: decide between WAIT (forming) and NO_TRADE using the dominant side.
    score = longSide ? bullTotal : bearTotal;
    const planOk = longSide ? riskPlan !== null && rrOk : shortRiskPlan !== null && rrOkShort;
    const tooClose = longSide ? isResistanceTooClose(levels, lastClose) : isSupportTooClose(levels, lastClose);
    signalType = planOk && !tooClose && score >= THRESHOLDS.watch ? "WAIT" : "NO_TRADE";
  }

  return {
    signalType,
    bias: longSide ? "LONG" : "SHORT",
    score,
    bullScore: bullTotal,
    bearScore: bearTotal,
    regime: regimeResult.regime,
    trend: regimeResult.trend,
    structure,
    riskLevel: plan?.riskLevel ?? (lastAtr !== null ? classifyRiskLevel(lastAtr, lastClose) : "HIGH"),
    price: lastClose,
    rsi: lastRsi,
    atrPct,
    relVolume: lastRelVol,
    risk: plan,
  };
}

// =====================================================================
// Data layer (Binance / CoinGecko) with timeout + retry
// =====================================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url: string, headers: Record<string, string> = {}, tries = 3): Promise<unknown> {
  let lastError: Error = new Error("request failed");
  for (let attempt = 0; attempt < tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...headers } });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status === 418 || res.status >= 500;
      lastError = new Error(`HTTP ${res.status}`);
      if (!retryable) break;
      const retryAfter = Number(res.headers.get("Retry-After") || 0) * 1000;
      await sleep(Math.max(retryAfter, 600 * 2 ** attempt));
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      await sleep(600 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

interface Coin { symbol: string; base: string; name: string; rank: number }

/** Map of TRADING spot USDT pairs on Binance: symbol -> base asset */
async function getTradableUsdtPairs(): Promise<Map<string, string>> {
  const data = (await fetchJson(`${BINANCE_BASE}/api/v3/exchangeInfo`)) as { symbols?: Record<string, unknown>[] };
  const map = new Map<string, string>();
  for (const s of data.symbols ?? []) {
    if (s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed !== false) {
      map.set(String(s.symbol), String(s.baseAsset).toUpperCase());
    }
  }
  return map;
}

async function buildUniverse(n: number): Promise<{ coins: Coin[]; source: string }> {
  const tradable = await getTradableUsdtPairs();
  const coins: Coin[] = [];
  const seen = new Set<string>();

  // 1) Preferred: top by market cap (CoinGecko)
  try {
    const key = Deno.env.get("COINGECKO_API_KEY");
    const headers: Record<string, string> = key ? { "x-cg-demo-api-key": key } : {};
    const cg = (await fetchJson(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
      headers,
      2,
    )) as { symbol: string; name: string; market_cap_rank: number | null }[];
    for (const c of cg) {
      const base = String(c.symbol).toUpperCase();
      const symbol = `${base}USDT`;
      if (EXCLUDED_BASES.has(base) || seen.has(symbol) || !tradable.has(symbol)) continue;
      seen.add(symbol);
      coins.push({ symbol, base, name: c.name, rank: c.market_cap_rank ?? coins.length + 1 });
      if (coins.length >= n) break;
    }
    if (coins.length >= Math.min(n, 50)) return { coins, source: "coingecko-marketcap" };
  } catch {
    // fall through to Binance volume ranking
  }

  // 2) Fallback: rank Binance USDT pairs by 24h quote volume
  const tickers = (await fetchJson(`${BINANCE_BASE}/api/v3/ticker/24hr`)) as { symbol: string; quoteVolume: string }[];
  const ranked = tickers
    .filter((t) => tradable.has(t.symbol) && !EXCLUDED_BASES.has(tradable.get(t.symbol)!))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, n);
  return {
    coins: ranked.map((t, i) => ({ symbol: t.symbol, base: tradable.get(t.symbol)!, name: tradable.get(t.symbol)!, rank: i + 1 })),
    source: "binance-volume",
  };
}

/** Closed candles only: the still-forming last candle is dropped so signals don't repaint. */
async function fetchClosedCandles(symbol: string, interval: string): Promise<Candle[]> {
  const rows = (await fetchJson(
    `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${CANDLE_LIMIT}`,
  )) as unknown[][];
  const now = Date.now();
  return rows
    .map((row) => ({
      openTime: row[0] as number,
      open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
      volume: Number(row[5]), closeTime: row[6] as number,
    }))
    .filter((c) => c.closeTime < now && Number.isFinite(c.close));
}

/** Runs `worker` over items with limited concurrency; stops starting new items after `deadline`. */
async function mapPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>, deadline: number): Promise<number> {
  let next = 0;
  let skipped = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (Date.now() > deadline) { skipped++; continue; }
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return skipped;
}

const num = (v: number | null | undefined): number | null => (v !== null && v !== undefined && Number.isFinite(v) ? v : null);

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// =====================================================================
// Entry point
// =====================================================================

Deno.serve(async (req: Request) => {
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !safeEqual(provided, expected)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Don't start a second scan while one is running (a stuck 'running' row older than 10 min is ignored)
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: running } = await supabase.from("scan_runs").select("id").eq("status", "running").gte("started_at", tenMinAgo).limit(1);
  if (running && running.length > 0) return json({ ok: false, skipped: "another scan is still running" }, 409);

  const t0 = Date.now();
  const { data: run, error: runError } = await supabase
    .from("scan_runs")
    .insert({ status: "running", timeframes: TIMEFRAMES })
    .select("id")
    .single();
  if (runError || !run) return json({ ok: false, error: `cannot create scan_runs row: ${runError?.message}` }, 500);
  const runId = run.id as string;

  try {
    const { coins, source } = await buildUniverse(TOP_N);
    if (coins.length === 0) throw new Error("empty universe");

    // Previous state, used to know since when the current signal has been active
    const { data: previous } = await supabase.from("scan_results").select("symbol, timeframe, signal_type, signal_since");
    const prev = new Map<string, { signal_type: string; signal_since: string }>();
    for (const p of previous ?? []) prev.set(`${p.symbol}|${p.timeframe}`, p);

    const tasks = TIMEFRAMES.flatMap((tf) => coins.map((coin) => ({ coin, tf })));
    const nowIso = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let failed = 0;

    const skipped = await mapPool(tasks, CONCURRENCY, async ({ coin, tf }) => {
      try {
        const candles = await fetchClosedCandles(coin.symbol, tf);
        const r = analyze(candles);
        if (!r) { failed++; return; }
        const before = prev.get(`${coin.symbol}|${tf}`);
        rows.push({
          run_id: runId,
          symbol: coin.symbol,
          base_asset: coin.base,
          market_rank: coin.rank,
          timeframe: tf,
          signal_type: r.signalType,
          bias: r.bias,
          score: r.score,
          bull_score: r.bullScore,
          bear_score: r.bearScore,
          regime: r.regime,
          trend: r.trend,
          structure: r.structure,
          risk_level: r.riskLevel,
          price: r.price,
          rsi: num(r.rsi),
          atr_pct: num(r.atrPct),
          rel_volume: num(r.relVolume),
          entry_low: num(r.risk?.entryLow),
          entry_high: num(r.risk?.entryHigh),
          stop_loss: num(r.risk?.stopLoss),
          target1: num(r.risk?.target1),
          target2: num(r.risk?.target2),
          target3: num(r.risk?.target3),
          risk_reward: num(r.risk?.riskReward),
          candle_close_time: new Date(candles[candles.length - 1].closeTime).toISOString(),
          signal_since: before && before.signal_type === r.signalType ? before.signal_since : nowIso,
          scanned_at: nowIso,
        });
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(`${coin.symbol} ${tf}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, t0 + TIME_BUDGET_MS);

    // Save results (chunked upsert: one row per symbol+timeframe)
    for (let i = 0; i < rows.length; i += 150) {
      const { error } = await supabase.from("scan_results").upsert(rows.slice(i, i + 150), { onConflict: "symbol,timeframe" });
      if (error) throw new Error(`saving results failed: ${error.message}`);
    }
    // ----- Signal Lab: register new BUY/SELL outcomes -----
    const actionable = rows.filter(
      (r) =>
        (r.signal_type === "BUY" || r.signal_type === "SELL") &&
        r.stop_loss != null &&
        r.target1 != null,
    );

    if (actionable.length > 0) {
      // load currently OPEN outcomes to avoid duplicates
      const { data: openRows } = await supabase
        .from("signal_outcomes")
        .select("symbol, timeframe, signal_type")
        .eq("status", "OPEN");

      const openSet = new Set(
        (openRows ?? []).map((o) => `${o.symbol}|${o.timeframe}|${o.signal_type}`),
      );

      const toInsert: Record<string, unknown>[] = [];

      for (const r of actionable) {
        const key = `${r.symbol}|${r.timeframe}|${r.signal_type}`;
        if (openSet.has(key)) continue;

        // cancel opposite OPEN signal on same symbol+tf
        const opposite = r.signal_type === "BUY" ? "SELL" : "BUY";
        const oppKey = `${r.symbol}|${r.timeframe}|${opposite}`;
        if (openSet.has(oppKey)) {
          await supabase
            .from("signal_outcomes")
            .update({ status: "CANCELLED", exit_at: nowIso, notes: "opposite signal" })
            .eq("symbol", r.symbol)
            .eq("timeframe", r.timeframe)
            .eq("signal_type", opposite)
            .eq("status", "OPEN");
        }

        toInsert.push({
          symbol: r.symbol,
          base_asset: r.base_asset,
          timeframe: r.timeframe,
          signal_type: r.signal_type,
          score: r.score,
          price_at_signal: r.price,
          entry_low: r.entry_low,
          entry_high: r.entry_high,
          stop_loss: r.stop_loss,
          target1: r.target1,
          target2: r.target2,
          risk_reward: r.risk_reward,
          signal_at: nowIso,
          status: "OPEN",
          source: "auto_scan",
        });
        openSet.add(key);
      }

      for (let i = 0; i < toInsert.length; i += 100) {
        const { error: insErr } = await supabase
          .from("signal_outcomes")
          .insert(toInsert.slice(i, i + 100));
        if (insErr) {
          // non-fatal: scan results already saved
          console.error("signal_outcomes insert:", insErr.message);
        }
      }
    }
    // ----- end Signal Lab -----
    // Remove coins that dropped out of the universe, and timeframes no longer scanned
    const symbolList = coins.map((c) => c.symbol).join(",");
    await supabase.from("scan_results").delete().not("symbol", "in", `(${symbolList})`);
    await supabase.from("scan_results").delete().not("timeframe", "in", `(${TIMEFRAMES.join(",")})`);

    const count = (type: string) => rows.filter((r) => r.signal_type === type).length;
    const status = rows.length === 0 ? "failed" : skipped > 0 ? "partial" : "ok";
    await supabase.from("scan_runs").update({
      finished_at: new Date().toISOString(),
      status,
      universe_source: source,
      symbols_total: coins.length,
      scanned: rows.length,
      failed,
      buy_count: count("BUY"),
      sell_count: count("SELL"),
      wait_count: count("WAIT"),
      error: errors.length ? errors.join(" | ") : skipped > 0 ? `time budget reached, ${skipped} tasks skipped` : null,
    }).eq("id", runId);

    // Housekeeping: keep 14 days of run history
    await supabase.from("scan_runs").delete().lt("started_at", new Date(Date.now() - 14 * 86_400_000).toISOString());

    return json({
      ok: status !== "failed",
      status,
      run_id: runId,
      universe: { count: coins.length, source },
      timeframes: TIMEFRAMES,
      scanned: rows.length,
      failed,
      skipped,
      buy: count("BUY"),
      sell: count("SELL"),
      wait: count("WAIT"),
      duration_ms: Date.now() - t0,
      sample_errors: errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("scan_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: message }).eq("id", runId);
    return json({ ok: false, error: message }, 500);
  }
});

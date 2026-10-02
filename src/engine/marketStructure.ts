import type { Candle } from '@/types/market';
import type { SwingPoint, StructureLabel } from '@/types/signal';

export function findSwingPoints(candles: Candle[], lookback = 2): SwingPoint[] {
  const points: SwingPoint[] = [];
  if (candles.length < lookback * 2 + 1) return points;

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
      }
    }
    if (isHigh) {
      points.push({ index: i, time: candles[i].openTime, price: candles[i].high, type: 'HIGH' });
    }
    if (isLow) {
      points.push({ index: i, time: candles[i].openTime, price: candles[i].low, type: 'LOW' });
    }
  }
  return points;
}

export function findSupportResistance(candles: Candle[], swings: SwingPoint[]): SwingPoint[] {
  return swings;
}

export interface StructureResult {
  label: StructureLabel;
  swingPoints: SwingPoint[];
}

export function detectStructure(swings: SwingPoint[]): StructureResult {
  if (swings.length < 4) {
    return { label: 'UNDEFINED', swingPoints: swings };
  }

  const highs = swings.filter((s) => s.type === 'HIGH').slice(-3);
  const lows = swings.filter((s) => s.type === 'LOW').slice(-3);

  if (highs.length < 2 || lows.length < 2) {
    return { label: 'UNDEFINED', swingPoints: swings };
  }

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const higherHigh = lastHigh.price > prevHigh.price;
  const higherLow = lastLow.price > prevLow.price;
  const lowerHigh = lastHigh.price < prevHigh.price;
  const lowerLow = lastLow.price < prevLow.price;

  if (higherHigh && higherLow) {
    return { label: 'HH_HL', swingPoints: swings };
  }
  if (lowerHigh && lowerLow) {
    return { label: 'LH_LL', swingPoints: swings };
  }

  const recentSwings = swings.slice(-6);
  const range = recentSwings.map((s) => s.price);
  const maxPrice = Math.max(...range);
  const minPrice = Math.min(...range);
  const rangePct = (maxPrice - minPrice) / minPrice;

  if (rangePct < 0.05) {
    return { label: 'RANGING', swingPoints: swings };
  }

  if (higherHigh && !higherLow) {
    return { label: 'BOS_BULLISH', swingPoints: swings };
  }
  if (lowerLow && !lowerHigh) {
    return { label: 'BOS_BEARISH', swingPoints: swings };
  }

  return { label: 'RANGING', swingPoints: swings };
}

export function detectPullback(candles: Candle[], swings: SwingPoint[]): boolean {
  if (swings.length < 2) return false;
  const lastSwing = swings[swings.length - 1];
  const lastCandle = candles[candles.length - 1];
  const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-2);

  if (recentHighs.length < 1) return false;
  const recentHigh = recentHighs[recentHighs.length - 1];
  const pullbackPct = (recentHigh.price - lastCandle.close) / recentHigh.price;
  return pullbackPct > 0.02 && pullbackPct < 0.1 && lastSwing.type === 'LOW';
}

export function detectBreakout(candles: Candle[], swings: SwingPoint[]): 'BULLISH' | 'BEARISH' | null {
  if (swings.length < 3) return null;
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-2);
  const recentLows = swings.filter((s) => s.type === 'LOW').slice(-2);

  if (recentHighs.length >= 1) {
    const resistance = recentHighs[recentHighs.length - 1].price;
    if (prevCandle.close < resistance && lastCandle.close > resistance) {
      return 'BULLISH';
    }
  }
  if (recentLows.length >= 1) {
    const support = recentLows[recentLows.length - 1].price;
    if (prevCandle.close > support && lastCandle.close < support) {
      return 'BEARISH';
    }
  }
  return null;
}

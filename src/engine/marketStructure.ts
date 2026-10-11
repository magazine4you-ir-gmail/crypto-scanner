import type { Candle } from '@/types/market';
import type { SwingPoint, StructureLabel } from '@/types/signal';
import { findSwingPoints, detectStructure as detectStructureLabel } from '@engine';

export { findSwingPoints };

export interface StructureResult {
  label: StructureLabel;
  swingPoints: SwingPoint[];
}

export function detectStructure(swings: SwingPoint[]): StructureResult {
  return { label: detectStructureLabel(swings), swingPoints: swings };
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
  if (swings.length < 3 || candles.length < 2) return null;
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-2);
  const recentLows = swings.filter((s) => s.type === 'LOW').slice(-2);
  if (recentHighs.length >= 1) {
    const resistance = recentHighs[recentHighs.length - 1].price;
    if (prevCandle.close < resistance && lastCandle.close > resistance) return 'BULLISH';
  }
  if (recentLows.length >= 1) {
    const support = recentLows[recentLows.length - 1].price;
    if (prevCandle.close > support && lastCandle.close < support) return 'BEARISH';
  }
  return null;
}

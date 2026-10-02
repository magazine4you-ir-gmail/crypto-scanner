import type { Candle } from '@/types/market';
import type { MarketRegime, TrendDirection } from '@/types/signal';
import { ema } from './indicators/movingAverage';
import { atr } from './indicators/atr';
import { adx } from './indicators/adx';

export interface RegimeResult {
  regime: MarketRegime;
  trend: TrendDirection;
  confidence: number;
}

export function detectRegime(candles: Candle[]): RegimeResult {
  if (candles.length < 50) {
    return { regime: 'UNCLEAR', trend: 'NEUTRAL', confidence: 0 };
  }

  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrValues = atr(candles, 14);
  const adxValues = adx(candles, 14);

  const lastClose = closes[closes.length - 1];
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];
  const lastAtr = atrValues[atrValues.length - 1];
  const lastAdx = adxValues[adxValues.length - 1];

  if (lastEma20 === null || lastEma50 === null || lastEma200 === null || lastAtr === null) {
    return { regime: 'UNCLEAR', trend: 'NEUTRAL', confidence: 0 };
  }

  const atrPct = (lastAtr / lastClose) * 100;
  const isHighVolatility = atrPct > 6;
  const isLowVolatility = atrPct < 1.5;

  let trend: TrendDirection;
  if (lastEma20 > lastEma50 && lastEma50 > lastEma200 && lastClose > lastEma200) {
    trend = 'BULLISH';
  } else if (lastEma20 < lastEma50 && lastEma50 < lastEma200 && lastClose < lastEma200) {
    trend = 'BEARISH';
  } else {
    trend = 'NEUTRAL';
  }

  const adxStrong = lastAdx !== null && lastAdx > 25;
  const adxWeak = lastAdx !== null && lastAdx < 20;

  let regime: MarketRegime;
  let confidence = 50;

  if (isHighVolatility) {
    regime = 'HIGH_VOLATILITY';
    confidence = 60;
  } else if (trend === 'BULLISH' && adxStrong) {
    regime = 'BULLISH_TREND';
    confidence = 80;
  } else if (trend === 'BEARISH' && adxStrong) {
    regime = 'BEARISH_TREND';
    confidence = 80;
  } else if (trend === 'NEUTRAL' || adxWeak) {
    regime = 'RANGE';
    confidence = 60;
  } else if (isLowVolatility) {
    regime = 'LOW_VOLATILITY';
    confidence = 50;
  } else if ((trend === 'BULLISH' || trend === 'BEARISH') && !adxStrong && !adxWeak) {
    regime = 'TRANSITION';
    confidence = 40;
  } else {
    regime = 'UNCLEAR';
    confidence = 30;
  }

  return { regime, trend, confidence };
}

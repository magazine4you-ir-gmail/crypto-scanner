import { ema } from './movingAverage';

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });

  const macdValues = macdLine.filter((v): v is number => v !== null);
  const firstValidIndex = macdLine.findIndex((v) => v !== null);
  const signalEma = firstValidIndex >= 0 ? ema(macdValues, signalPeriod) : [];

  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValidIndex >= 0) {
    for (let i = 0; i < signalEma.length; i++) {
      signalLine[firstValidIndex + i] = signalEma[i];
    }
  }

  const histogram: (number | null)[] = closes.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

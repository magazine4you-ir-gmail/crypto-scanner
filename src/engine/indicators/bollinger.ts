import { sma } from './movingAverage';

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollingerBands(closes: number[], period = 20, stdDevMultiplier = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSquares += (closes[j] - mean) ** 2;
    }
    const stdDev = Math.sqrt(sumSquares / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { middle, upper, lower };
}

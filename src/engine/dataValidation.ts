import type { Candle } from '@/types/market';

export interface DataValidationResult {
  isValid: boolean;
  issues: string[];
  staleCandles: number;
  duplicateCount: number;
  gapCount: number;
}

export function validateCandles(candles: Candle[], maxAgeMs = 7 * 24 * 60 * 60 * 1000): DataValidationResult {
  const issues: string[] = [];
  let staleCandles = 0;
  let duplicateCount = 0;
  let gapCount = 0;

  if (candles.length === 0) {
    return { isValid: false, issues: ['No candle data'], staleCandles: 0, duplicateCount: 0, gapCount: 0 };
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // OHLC validation
    if (c.high < c.low) {
      issues.push(`Candle ${i}: high < low`);
    }
    if (c.open < 0 || c.close < 0 || c.high < 0 || c.low < 0) {
      issues.push(`Candle ${i}: negative price`);
    }
    if (c.volume < 0) {
      issues.push(`Candle ${i}: negative volume`);
    }
    if (!Number.isFinite(c.open) || !Number.isFinite(c.close) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
      issues.push(`Candle ${i}: non-finite price`);
    }

    // Timestamp validation
    if (!Number.isFinite(c.openTime) || c.openTime <= 0) {
      issues.push(`Candle ${i}: invalid timestamp`);
    }

    // Duplicate detection
    if (i > 0 && candles[i].openTime === candles[i - 1].openTime) {
      duplicateCount++;
    }

    // Gap detection
    if (i > 0 && candles[i].openTime > 0 && candles[i - 1].openTime > 0) {
      const expectedInterval = candles[i].openTime - candles[i - 1].openTime;
      if (i > 1) {
        const prevInterval = candles[i - 1].openTime - candles[i - 2].openTime;
        if (prevInterval > 0 && expectedInterval > prevInterval * 2) {
          gapCount++;
        }
      }
    }
  }

  // Staleness check
  const lastCandle = candles[candles.length - 1];
  const now = Date.now();
  const age = now - lastCandle.closeTime;
  if (age > maxAgeMs) {
    staleCandles = 1;
    issues.push(`Data is stale (age: ${Math.round(age / 3600000)}h)`);
  }

  if (duplicateCount > 0) {
    issues.push(`${duplicateCount} duplicate candles`);
  }
  if (gapCount > candles.length * 0.05) {
    issues.push(`${gapCount} gaps detected`);
  }

  return {
    isValid: issues.length === 0,
    issues,
    staleCandles,
    duplicateCount,
    gapCount,
  };
}

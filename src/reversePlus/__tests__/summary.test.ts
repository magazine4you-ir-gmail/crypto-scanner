import { describe, expect, it } from 'vitest';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusEvaluation, PlusPublicConfig } from '@/services/reversePlusService';
import { FALLBACK_PUBLIC_CONFIG } from '../fallbackConfig';
import { computeSignalSummary, entryOf } from '../summary';
import { defaultPrefs, parsePrefs, type ScenarioPrefs } from '../scenarioPrefs';

const cfg: PlusPublicConfig = FALLBACK_PUBLIC_CONFIG;
const base = {
  id: 'r1', symbol: 'BTCUSDT', base_asset: 'BTC', timeframe: '1h', signal_type: 'BUY', score: 70, price_at_signal: 100,
  entry_low: 99.7, entry_high: 100, stop_loss: 97, target1: 101.5, target2: null, risk_reward: null,
  signal_at: '2026-11-01T00:00:00Z', candle_close_time: '2026-11-01T01:00:00Z', status: 'OPEN', exit_price: null, exit_at: null,
  pnl_pct: null, pnl_gross_pct: null, r_multiple: null, bars_held: null, source: 'auto_scan', notes: null,
  origin_outcome_id: 'o1', origin_signal_type: 'SELL', origin: null,
} as unknown as ReverseOutcome;
const rev = (over: Partial<ReverseOutcome> = {}): ReverseOutcome => ({ ...base, ...over } as ReverseOutcome);
const ev = (over: Partial<PlusEvaluation> = {}): PlusEvaluation => ({
  recommended_entry: 99.7, quality_score: 71.6, current_price: 99.2, zone_low: 99.7, zone_high: 100, entry_status: 'WAITING', ...over,
} as unknown as PlusEvaluation);
const prefs = (over: Partial<ScenarioPrefs> = {}): ScenarioPrefs => ({ leverage: 10, sizing: 'FIXED_RISK', riskAmount: 10, notionalAmount: 1000, ...over });

describe('local scenario prefs', () => {
  it('accepts a well-formed stored value and rejects anything else (never throws)', () => {
    const ok = JSON.stringify(prefs({ leverage: 20 }));
    expect(parsePrefs(ok)?.leverage).toBe(20);
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs('not json')).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), leverage: 0 }))).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), leverage: 500 }))).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), sizing: 'X' }))).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), riskAmount: -1 }))).toBeNull();
  });
  it('defaults come from the public reference risk, capped', () => {
    const d = defaultPrefs({ account_balance: 1000, risk_pct: 2, max_risk_per_trade: 5 });
    expect(d.riskAmount).toBe(5);
    expect(d.sizing).toBe('FIXED_RISK');
  });
});

describe('signal summary (card = detail page numbers)', () => {
  it('uses the stored suggested entry, else the signal price (no invented level)', () => {
    expect(entryOf(rev(), ev())).toBe(99.7);
    expect(entryOf(rev(), null)).toBe(100);
  });

  it('FIXED_RISK: dollar risk follows the amount; leverage changes margin and liquidation only', () => {
    const a = computeSignalSummary({ rev: rev(), st: ev(), live: ev(), cfg, prefs: prefs({ leverage: 5 }) });
    const b = computeSignalSummary({ rev: rev(), st: ev(), live: ev(), cfg, prefs: prefs({ leverage: 20 }) });
    expect(a.riskUsd).toBeCloseTo(10, 4);
    expect(b.riskUsd).toBeCloseTo(10, 4);
    expect(a.notional).toBeCloseTo(b.notional as number, 6);
    expect((a.margin as number) / (b.margin as number)).toBeCloseTo(4, 3);
    expect(a.liq).not.toBe(b.liq);
    expect(a.entry).toBe(b.entry);
    expect(a.stop).toBe(97);
    expect(a.target).toBe(101.5);
    expect(a.leverage).toBe(5);
    expect(b.leverage).toBe(20);
  });

  it('FIXED_NOTIONAL: notional equals the amount', () => {
    const s = computeSignalSummary({ rev: rev(), st: ev(), live: null, cfg, prefs: prefs({ sizing: 'FIXED_NOTIONAL', notionalAmount: 2000 }) });
    expect(s.notional).toBeCloseTo(2000, 4);
    expect((s.margin as number)).toBeCloseTo(200, 3);
  });

  it('a low RR never hides the numbers (no invalid gate): RR is informational', () => {
    const s = computeSignalSummary({ rev: rev(), st: ev(), live: null, cfg, prefs: prefs() });
    expect(s.rrNet as number).toBeLessThan(cfg.min_rr);
    expect(s.margin).not.toBeNull();
    expect(s.riskUsd).not.toBeNull();
    expect(s.liq).not.toBeNull();
  });

  it('quality is a rounded percent; missing evaluation just means no percent', () => {
    expect(computeSignalSummary({ rev: rev(), st: ev(), live: null, cfg, prefs: prefs() }).qualityPct).toBe(72);
    expect(computeSignalSummary({ rev: rev(), st: null, live: null, cfg, prefs: prefs() }).qualityPct).toBeNull();
  });

  it('open signal shows the last known price + distance; closed signal shows the exit price and no distance', () => {
    const open = computeSignalSummary({ rev: rev(), st: ev(), live: ev({ current_price: 99.2 }), cfg, prefs: prefs() });
    expect(open.priceLabel).toBe('CURRENT');
    expect(open.price).toBe(99.2);
    expect(open.distancePct).toBeCloseTo((Math.abs(99.7 - 99.2) / 99.2) * 100, 6);
    const closed = computeSignalSummary({ rev: rev({ status: 'WIN', exit_price: 101.5 }), st: ev(), live: ev({ current_price: 50 }), cfg, prefs: prefs() });
    expect(closed.status).toBe('WIN');
    expect(closed.priceLabel).toBe('EXIT');
    expect(closed.price).toBe(101.5);
    expect(closed.distancePct).toBeNull();
  });

  it('keeps the status of the reverse outcome untouched (open / profit / loss / expired)', () => {
    for (const status of ['OPEN', 'WIN', 'LOSS', 'EXPIRED'] as const) {
      expect(computeSignalSummary({ rev: rev({ status }), st: null, live: null, cfg, prefs: prefs() }).status).toBe(status);
    }
  });

  it('an empty amount gives no sizing numbers instead of silently using a default', () => {
    const s = computeSignalSummary({ rev: rev(), st: ev(), live: null, cfg, prefs: prefs({ riskAmount: 0 }) });
    expect(s.margin).toBeNull();
    expect(s.notional).toBeNull();
    expect(s.riskUsd).toBeNull();
  });

  it('SELL side works the same way', () => {
    const s = computeSignalSummary({
      rev: rev({ signal_type: 'SELL', stop_loss: 103, target1: 98.5, entry_low: 100, entry_high: 100.3, price_at_signal: 100 }),
      st: ev({ recommended_entry: 100.3 }), live: null, cfg, prefs: prefs(),
    });
    expect(s.side).toBe('SELL');
    expect(s.riskUsd).toBeCloseTo(10, 4);
    expect(s.liq as number).toBeGreaterThan(100.3);
  });
});

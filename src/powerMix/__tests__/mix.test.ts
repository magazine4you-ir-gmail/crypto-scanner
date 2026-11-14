import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/supabaseClient', () => ({ supabase: {} }));

import { computeStats, type SignalOutcome } from '@/services/outcomeService';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import { createDayAnalyzer } from '../dayPower';
import { DEFAULT_POWER_MIX_CONFIG as cfg, sanitizeConfig } from '../config';
import { buildMixRows, buildViews, displaySide, matchesDayFilter, pickSide, type MixPair } from '../mix';
import { DAY0, dayWithMoves, tehran } from './helpers';

let n = 0;
function pair(signalMs: number, origStatus: 'WIN' | 'LOSS', over: Partial<SignalOutcome> = {}): MixPair {
  const id = `o${++n}`;
  const rStatus = origStatus === 'WIN' ? 'LOSS' : 'WIN'; // a mirrored trade wins exactly when the original loses
  const base = {
    symbol: 'ETHUSDT', base_asset: 'ETH', timeframe: '1h', score: 70, price_at_signal: 100, entry_low: null, entry_high: null,
    risk_reward: 2, signal_at: new Date(signalMs).toISOString(), candle_close_time: new Date(signalMs).toISOString(),
    exit_price: null, exit_at: null, pnl_gross_pct: null, bars_held: 3, source: 'auto_scan', notes: null, target2: null,
  };
  const original = { ...base, id, signal_type: 'BUY', stop_loss: 95, target1: 110, status: origStatus, pnl_pct: origStatus === 'WIN' ? 9 : -4.5, r_multiple: origStatus === 'WIN' ? 1.8 : -1 } as SignalOutcome;
  const reverse = { ...base, id: `r${n}`, origin_outcome_id: id, signal_type: 'SELL', origin_signal_type: 'BUY', stop_loss: 110, target1: 95, status: rStatus, pnl_pct: rStatus === 'WIN' ? 4.5 : -9, r_multiple: rStatus === 'WIN' ? 0.5 : -1, origin: { status: origStatus, pnl_pct: original.pnl_pct, r_multiple: original.r_multiple } } as unknown as ReverseOutcome;
  return { original, reverse, ...over && {} };
}

const NOW = tehran(DAY0, 23, 0);
const strongDay = dayWithMoves(DAY0, 3, 3);
const quietDay = dayWithMoves(DAY0 + 86_400_000, 0.2, 0.1);
const analyzer = (now = NOW + 86_400_000) => createDayAnalyzer([...strongDay, ...quietDay], cfg, now);

describe('smart mix selection', () => {
  const rows = buildMixRows([
    pair(tehran(DAY0, 12, 0), 'WIN'),                 // strong day -> original (WIN)
    pair(tehran(DAY0, 17, 0), 'WIN'),                 // strong day -> original (WIN)
    pair(tehran(DAY0 + 86_400_000, 12, 0), 'LOSS'),   // neutral day -> reverse (WIN)
  ], analyzer());

  it('power days use the original, neutral days use the reverse', () => {
    expect(rows.map((r) => pickSide(r.day, cfg, false))).toEqual(['original', 'original', 'reverse']);
    const v = buildViews(rows, cfg, false);
    expect(v.mix.map((x) => x.status)).toEqual(['WIN', 'WIN', 'WIN']);
    expect(computeStats(v.mix).winRate).toBe(100);
    expect(computeStats(v.original).wins).toBe(2);
    expect(computeStats(v.reverse).wins).toBe(1);
  });

  it('the verification switch shows the opposite logic', () => {
    const v = buildViews(rows, cfg, true);
    expect(v.mix.map((x) => x.status)).toEqual(['LOSS', 'LOSS', 'LOSS']);
  });

  it('selection is configurable per class', () => {
    const c = sanitizeConfig({ selection: { VERY_STRONG: 'none' } });
    const v = buildViews(rows, c, false);
    expect(v.mix).toHaveLength(1);
    expect(v.excluded.none).toBe(2);
  });

  it('pending signals are excluded from the mix but listed', () => {
    const live = createDayAnalyzer([...strongDay, ...quietDay], cfg, tehran(DAY0 + 86_400_000, 15, 0));
    const r = buildMixRows([pair(tehran(DAY0 + 86_400_000, 12, 0), 'LOSS')], live);
    expect(r[0].day.state).toBe('PENDING');
    expect(buildViews(r, cfg, false).mix).toHaveLength(0);
    expect(buildViews(r, cfg, false).excluded.pending).toBe(1);
    expect(displaySide(r[0], 'MIX', cfg, false)).toBe('original');
  });

  it('day filters', () => {
    expect(rows.filter((r) => matchesDayFilter(r, 'VERY_STRONG'))).toHaveLength(2);
    expect(rows.filter((r) => matchesDayFilter(r, 'NEUTRAL'))).toHaveLength(1);
    expect(rows.filter((r) => matchesDayFilter(r, 'PENDING'))).toHaveLength(0);
    expect(rows.filter((r) => matchesDayFilter(r, 'DEAD'))).toHaveLength(0);
  });

  it('views: original/reverse always show their own side', () => {
    expect(displaySide(rows[0], 'ORIGINAL', cfg, false)).toBe('original');
    expect(displaySide(rows[0], 'REVERSE', cfg, false)).toBe('reverse');
    expect(displaySide(rows[2], 'MIX', cfg, false)).toBe('reverse');
  });
});

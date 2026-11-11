import { describe, expect, it } from 'vitest';
import {
  D, backtestSignal, applyScenarioToBacktest, buildScenario, compareLeverages, computeBacktestStats, instructionFor, replayAt, replayEndCursor,
  toNumber, usableCandles, type BtCandle, type BacktestInput, type ScenarioParams, type StatInput,
} from '../../../supabase/functions/_shared/reversePlus/index';

const H = 3_600_000;
const T0 = 1_000 * H; // signal candle close time
const c = (i: number, o: number, h: number, l: number, cl: number): BtCandle => ({ openTime: T0 + 1 + i * H, closeTime: T0 + (i + 1) * H, open: o, high: h, low: l, close: cl });
const base = (side: 'BUY' | 'SELL', candles: BtCandle[], extra: Partial<BacktestInput> = {}): BacktestInput => ({
  side, entry: D(side === 'SELL' ? 100 : 100), stop: D(side === 'SELL' ? 102 : 98), target: D(side === 'SELL' ? 96 : 104),
  signalCloseTime: T0, candles, entryWindowBars: 10, maxHoldBars: 20, ...extra,
});

describe('backtest engine: entry', () => {
  it('SELL: not reached -> NO_ENTRY, never WIN/LOSS', () => {
    const r = backtestSignal(base('SELL', Array.from({ length: 10 }, (_, i) => c(i, 97, 99, 96.5, 97))));
    expect(r.outcome).toBe('NO_ENTRY'); expect(r.reason).toBe('ENTRY_NOT_REACHED'); expect(r.entryPrice).toBeNull();
  });
  it('target reached before entry -> NO_ENTRY (TARGET_BEFORE_ENTRY)', () => {
    const r = backtestSignal(base('SELL', [c(0, 98, 99, 95, 96), c(1, 96, 101, 95, 100)]));
    expect(r.outcome).toBe('NO_ENTRY'); expect(r.reason).toBe('TARGET_BEFORE_ENTRY');
  });
  it('entry is never recorded before the candle that touches it', () => {
    const r = backtestSignal(base('SELL', [c(0, 97, 99, 96.5, 98), c(1, 98, 100.5, 98, 99), c(2, 99, 99.5, 95, 96)]));
    expect(r.entryTime).toBe(T0 + 1 + 1 * H);
    expect(r.barsToEntry).toBe(2);
  });
  it('candles at/before the signal close are ignored (no look-back / no future shuffle)', () => {
    const early: BtCandle = { openTime: T0 - H, closeTime: T0, open: 99, high: 103, low: 95, close: 100 };
    expect(usableCandles([early, c(1, 1, 2, 0.5, 1), c(0, 1, 2, 0.5, 1), c(0, 1, 2, 0.5, 1)], T0).map((x) => x.openTime)).toEqual([T0 + 1, T0 + 1 + H]);
  });
});

describe('backtest engine: LONG and SHORT exits', () => {
  it('SELL: fill then target -> WIN at target price', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 99.5, 99.8, 95.9, 96.2)]));
    expect(r.outcome).toBe('WIN'); expect(toNumber(r.exitPrice!)).toBe(96); expect(r.exitReason).toBe('TARGET');
  });
  it('SELL: fill then stop -> LOSS at stop', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 99.5, 102)]));
    expect(r.outcome).toBe('LOSS'); expect(toNumber(r.exitPrice!)).toBe(102);
  });
  it('BUY: fill then target -> WIN; fill then stop -> LOSS', () => {
    const w = backtestSignal(base('BUY', [c(0, 101, 101, 99.5, 100), c(1, 100, 104.5, 99.9, 104)]));
    expect(w.outcome).toBe('WIN');
    const l = backtestSignal(base('BUY', [c(0, 101, 101, 99.5, 100), c(1, 100, 100.2, 97.5, 98)]));
    expect(l.outcome).toBe('LOSS');
  });
  it('stop gap exits at the (worse) open', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 103, 104, 102.5, 103.5)]));
    expect(r.reason).toBe('STOP_HIT_GAP'); expect(toNumber(r.exitPrice!)).toBe(103);
  });
  it('stop in the fill candle (entry crossed first) -> LOSS', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 102.5, 98.5, 102)]));
    expect(r.outcome).toBe('LOSS');
  });
});

describe('backtest engine: ambiguity and missing data are never optimistic', () => {
  it('TP and SL in one candle, no lower TF -> AMBIGUOUS (not a win)', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 95, 99)]));
    expect(r.outcome).toBe('AMBIGUOUS'); expect(r.reason).toBe('SAME_CANDLE_ORDER_UNKNOWN');
  });
  it('same candle resolved by lower-timeframe candles (stop first)', () => {
    const sub: BtCandle[] = [
      { openTime: T0 + 1 + H, closeTime: T0 + 1 + H + 59_999, open: 100, high: 102.4, low: 99.9, close: 102.3 }, // stop first
      { openTime: T0 + 1 + H + 60_000, closeTime: T0 + 1 + H + 119_999, open: 102.3, high: 102.3, low: 95, close: 96 },
    ];
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 95, 99)], { lowerTf: () => sub }));
    expect(r.outcome).toBe('LOSS'); expect(r.lowerTfUsed).toBe(true);
  });
  it('same candle resolved by lower-timeframe candles (target first)', () => {
    const sub: BtCandle[] = [
      { openTime: T0 + 1 + H, closeTime: T0 + 1 + H + 59_999, open: 100, high: 100, low: 95.5, close: 96 },
      { openTime: T0 + 1 + H + 60_000, closeTime: T0 + 1 + H + 119_999, open: 96, high: 102.5, low: 96, close: 102 },
    ];
    expect(backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 95, 99)], { lowerTf: () => sub })).outcome).toBe('WIN');
  });
  it('fill and target in the same candle, order unknown -> AMBIGUOUS', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 95, 97)]));
    expect(r.outcome).toBe('AMBIGUOUS'); expect(r.reason).toBe('FILL_CANDLE_ORDER_UNKNOWN');
  });
  it('no candles / short data -> UNKNOWN', () => {
    expect(backtestSignal(base('SELL', [])).outcome).toBe('UNKNOWN');
    expect(backtestSignal(base('SELL', [c(0, 97, 99, 96.5, 97), c(1, 97, 99, 96.5, 97)])).reason).toBe('INSUFFICIENT_DATA_ENTRY');
    expect(backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 99.5, 99.8, 98, 99)])).reason).toBe('INSUFFICIENT_DATA_POSITION_OPEN');
  });
  it('filled but neither TP nor SL within the hold window -> EXPIRED (no PnL)', () => {
    const cs = [c(0, 99, 100.5, 99, 100), ...Array.from({ length: 5 }, (_, i) => c(i + 1, 99.5, 100.5, 98, 99))];
    const r = backtestSignal(base('SELL', cs, { maxHoldBars: 4 }));
    expect(r.outcome).toBe('EXPIRED');
  });
  it('invalid geometry -> UNKNOWN', () => {
    expect(backtestSignal({ ...base('SELL', [c(0, 1, 2, 0, 1)]), stop: D(99) }).reason).toBe('INVALID_GEOMETRY');
  });
});

describe('leverage scenarios', () => {
  const p = (lev: number, mode: 'FIXED_RISK' | 'FIXED_NOTIONAL', amount = 10): ScenarioParams => ({
    side: 'SELL', entry: D(100), stop: D(102), target: D(96), leverage: D(lev), mode, amount: D(amount),
    cost: { feePct: D(0.05), slippagePct: D(0.02) }, assumedMmrPct: D(0.5), liqSafetyFactor: D(0.8),
  });
  it('FIXED_NOTIONAL: margin = notional / leverage', () => {
    const s = buildScenario(p(10, 'FIXED_NOTIONAL', 1000));
    expect(toNumber(s.notional)).toBe(1000); expect(toNumber(s.margin)).toBe(100);
  });
  it('FIXED_RISK: risk amount (net of costs) is independent of leverage, margin changes', () => {
    const a = buildScenario(p(5, 'FIXED_RISK', 10)); const b = buildScenario(p(20, 'FIXED_RISK', 10));
    expect(toNumber(a.riskAmount)).toBeCloseTo(10, 6); expect(toNumber(b.riskAmount)).toBeCloseTo(10, 6);
    expect(a.notional).toBe(b.notional);
    expect(toNumber(a.margin)).toBeCloseTo(toNumber(b.margin) * 4, 4);
  });
  it('leverage never changes entry / TP / SL; SELL liquidation is above entry and moves closer with leverage', () => {
    const a = buildScenario(p(10, 'FIXED_RISK')); const b = buildScenario(p(50, 'FIXED_RISK'));
    expect(toNumber(a.liqPrice)).toBeGreaterThan(100); expect(toNumber(b.liqPrice)).toBeLessThan(toNumber(a.liqPrice));
    expect(toNumber(a.rrNet)).toBeCloseTo(toNumber(b.rrNet), 10);
  });
  it('high leverage -> LIQ_BEFORE_STOP with explicit reason; low leverage valid; max safe leverage reported', () => {
    const hi = buildScenario(p(50, 'FIXED_RISK')); const lo = buildScenario(p(5, 'FIXED_RISK'));
    expect(hi.valid).toBe(false); expect(hi.issues).toContain('LIQ_BEFORE_STOP');
    expect(lo.valid).toBe(true);
    expect(toNumber(hi.maxSafeLeverage)).toBeLessThan(50);
  });
  it('margin above balance is invalid', () => {
    expect(buildScenario({ ...p(5, 'FIXED_NOTIONAL', 10000), accountBalance: D(100) }).issues).toContain('MARGIN_EXCEEDS_BALANCE');
  });
  it('compare: fixed-notional and fixed-risk give different (never mixed) numbers', () => {
    const fn = compareLeverages({ ...p(1, 'FIXED_NOTIONAL', 1000) });
    const fr = compareLeverages({ ...p(1, 'FIXED_RISK', 10) });
    expect(fn).toHaveLength(5);
    expect(toNumber(fn[0].scenario.notional)).toBe(1000);
    expect(toNumber(fr[0].scenario.notional)).not.toBe(1000);
    expect(fn.map((x) => x.leverage)).toEqual([5, 10, 20, 30, 50]);
  });
});

describe('PnL: SHORT and LONG formulas, ROI, R, liquidation', () => {
  const sellWin = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 99.5, 99.8, 95.9, 96.2)]));
  const sellLoss = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 99.5, 102)]));
  const buyWin = backtestSignal(base('BUY', [c(0, 101, 101, 99.5, 100), c(1, 100, 104.5, 99.9, 104)]));
  const sp = (side: 'BUY' | 'SELL', lev: number, fee = 0): ScenarioParams => ({
    side, entry: D(100), stop: D(side === 'SELL' ? 102 : 98), target: D(side === 'SELL' ? 96 : 104), leverage: D(lev), mode: 'FIXED_NOTIONAL', amount: D(1000),
    cost: { feePct: D(fee), slippagePct: D(0) }, assumedMmrPct: D(0.5), liqSafetyFactor: D(0.8),
  });
  it('SHORT win gross = qty * (entry - exit); LONG win gross = qty * (exit - entry)', () => {
    expect(toNumber(applyScenarioToBacktest(sellWin, sp('SELL', 5)).grossPnl!)).toBe(40);   // qty 10 * 4
    expect(toNumber(applyScenarioToBacktest(buyWin, sp('BUY', 5)).grossPnl!)).toBe(40);
    expect(toNumber(applyScenarioToBacktest(sellLoss, sp('SELL', 5)).grossPnl!)).toBe(-20); // qty 10 * -2
  });
  it('net = gross - fees - slippage; ROI is on MARGIN (not on notional) and differs by leverage', () => {
    const m5 = applyScenarioToBacktest(sellWin, sp('SELL', 5, 0.05)); const m10 = applyScenarioToBacktest(sellWin, sp('SELL', 10, 0.05));
    expect(toNumber(m5.fees!)).toBeCloseTo(10 * 100 * 0.0005 + 10 * 96 * 0.0005, 6);
    expect(toNumber(m5.netPnl!)).toBeCloseTo(40 - toNumber(m5.fees!), 6);
    expect(toNumber(m5.roiPct!)).toBeCloseTo((toNumber(m5.netPnl!) / 200) * 100, 4);
    expect(toNumber(m10.roiPct!)).toBeCloseTo(toNumber(m5.roiPct!) * 2, 3);
    expect(m5.netPnl).toBe(m10.netPnl); // same notional -> same dollar PnL regardless of leverage
  });
  it('R multiple = net / risk at stop', () => {
    const m = applyScenarioToBacktest(sellWin, sp('SELL', 5));
    expect(toNumber(m.rMultiple!)).toBeCloseTo(2, 6);  // +4 reward vs 2 risk
  });
  it('liquidation before the stop turns the result into a margin loss (high leverage only)', () => {
    const hi = applyScenarioToBacktest(sellWin, { ...sp('SELL', 100), liqSafetyFactor: D(1) }); // liq ~ 100.5, worst price 100.5+ reached
    expect(hi.liquidated).toBe(true); expect(toNumber(hi.netPnl!)).toBeCloseTo(-toNumber(hi.margin), 6);
    const lo = applyScenarioToBacktest(sellWin, sp('SELL', 5));
    expect(lo.liquidated).toBe(false);
  });
  it('NO_ENTRY / AMBIGUOUS carry no PnL', () => {
    const ne = backtestSignal(base('SELL', Array.from({ length: 10 }, (_, i) => c(i, 97, 99, 96.5, 97))));
    expect(applyScenarioToBacktest(ne, sp('SELL', 5)).netPnl).toBeNull();
    const am = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 95, 99)]));
    expect(applyScenarioToBacktest(am, sp('SELL', 5)).netPnl).toBeNull();
  });
  it('MFE / MAE are tracked from the fill', () => {
    const r = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 101, 98, 99), c(2, 99, 99.5, 95.9, 96)]));
    expect(toNumber(r.worstPrice!)).toBe(101); // adverse (highest high)
    const m = applyScenarioToBacktest(r, sp('SELL', 5));
    expect(toNumber(m.maeR!)).toBeCloseTo(0.5, 6);
  });
});

describe('statistics', () => {
  const mk = (bt: ReturnType<typeof backtestSignal>, side: 'BUY' | 'SELL', lev = 5, sym = 'BTCUSDT'): StatInput => ({
    m: applyScenarioToBacktest(bt, { side, entry: D(100), stop: D(side === 'SELL' ? 102 : 98), target: D(side === 'SELL' ? 96 : 104), leverage: D(lev), mode: 'FIXED_NOTIONAL', amount: D(1000),
      cost: { feePct: D(0), slippagePct: D(0) }, assumedMmrPct: D(0.5), liqSafetyFactor: D(0.8) }),
    symbol: sym, timeframe: '1h', side, signalAt: null, leverage: lev,
  });
  const win = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 99.5, 99.8, 95.9, 96.2)]));
  const loss = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 99.5, 102)]));
  const noEntry = backtestSignal(base('SELL', Array.from({ length: 10 }, (_, i) => c(i, 97, 99, 96.5, 97))));
  const amb = backtestSignal(base('SELL', [c(0, 99, 100.5, 99, 100), c(1, 100, 102.5, 95, 99)]));
  it('win rate excludes NO_ENTRY and AMBIGUOUS from the denominator and reports them separately', () => {
    const s = computeBacktestStats([mk(win, 'SELL'), mk(win, 'SELL'), mk(loss, 'SELL'), mk(noEntry, 'SELL'), mk(amb, 'SELL')]);
    expect(s.winRate).toBeCloseTo(66.667, 2); expect(s.noEntry).toBe(1); expect(s.ambiguous).toBe(1); expect(s.total).toBe(5);
    expect(toNumber(s.netPnl)).toBe(60); // 40 + 40 - 20
  });
  it('profit factor, average R, best / worst, drawdown', () => {
    const s = computeBacktestStats([mk(win, 'SELL'), mk(loss, 'SELL'), mk(loss, 'SELL'), mk(win, 'SELL')]);
    expect(s.profitFactor).toBeCloseTo(80 / 40, 6);
    expect(s.avgR).toBeCloseTo((2 - 1 - 1 + 2) / 4, 6);
    expect(toNumber(s.best!)).toBe(40); expect(toNumber(s.worst!)).toBe(-20);
    expect(s.lowSample).toBe(true);
  });
  it('no closed trades -> rates are null (not 0)', () => {
    const s = computeBacktestStats([mk(noEntry, 'SELL')]);
    expect(s.winRate).toBeNull(); expect(s.profitFactor).toBeNull();
  });
});

describe('replay and instructions', () => {
  const cs = [c(0, 99, 100.5, 99, 100), c(1, 99.5, 99.8, 98, 99), c(2, 99, 99.5, 95.9, 96)];
  const bt = backtestSignal(base('SELL', cs));
  it('replay reveals real candles and events step by step', () => {
    expect(replayAt(cs, bt, T0, 0).status).toBe('WAITING_FOR_ENTRY');
    const s1 = replayAt(cs, bt, T0, 1); expect(s1.status).toBe('POSITION_OPEN'); expect(s1.events.map((e) => e.kind)).toContain('ENTRY');
    const s2 = replayAt(cs, bt, T0, 2); expect(s2.status).toBe('POSITION_OPEN'); expect(s2.events.map((e) => e.kind)).not.toContain('TARGET');
    const s3 = replayAt(cs, bt, T0, 3); expect(s3.status).toBe('TP_HIT'); expect(s3.finished).toBe(true);
    expect(replayEndCursor(cs, bt)).toBe(3);
  });
  it('instructions: ENTRY_ALLOWED only when the evaluation is READY; a legacy stored INVALID is shown as waiting, never as a state', () => {
    expect(instructionFor({ mode: 'LIVE', evalStatus: 'READY' }).state).toBe('ENTRY_ALLOWED');
    expect(instructionFor({ mode: 'LIVE', evalStatus: 'INVALID' }).state).toBe('WAITING_FOR_ENTRY');
    expect(instructionFor({ mode: 'LIVE', evalStatus: 'WAITING' }).state).toBe('WAITING_FOR_ENTRY');
    expect(instructionFor({ mode: 'LIVE', evalStatus: 'READY', positionOpen: true, pctToTarget: 0.2, pctToStop: 3 }).state).toBe('APPROACHING_TP');
    expect(instructionFor({ mode: 'HISTORICAL', evalStatus: 'INVALID', backtest: 'WIN' }).state).toBe('TP_HIT');
    expect(instructionFor({ mode: 'HISTORICAL', evalStatus: 'READY', backtest: 'AMBIGUOUS' }).state).toBe('AMBIGUOUS');
    expect(instructionFor({ mode: 'HISTORICAL', evalStatus: 'READY', backtest: 'NO_ENTRY' }).state).toBe('NO_ENTRY');
  });
});

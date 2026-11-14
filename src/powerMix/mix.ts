// Power Mix — pairing, side selection and the three statistic sets (original only | reverse only | smart mix). PURE.
//
// Every Signal Lab trade has exactly ONE mirrored Reverse Lab trade (1:1), so a signal is a PAIR. The smart mix keeps, per signal,
// the side that the day class of ITS generation time selects. Nothing here changes how signals are generated or resolved.
import type { SignalOutcome } from '@/services/outcomeService';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { DayClass, PowerMixConfig, SidePick } from './config';
import type { DayAnalyzer, SignalDayInfo } from './dayPower';

export interface MixPair { reverse: ReverseOutcome; original: SignalOutcome }

export interface MixRow extends MixPair {
  id: string;
  signalMs: number;
  day: SignalDayInfo;
}

export type DayFilter = 'ALL' | DayClass | 'DEAD' | 'PENDING';
export type MixView = 'MIX' | 'ORIGINAL' | 'REVERSE';
export type Side = 'original' | 'reverse';

/** The moment the signal was generated: its candle close, falling back to the registration time. */
export function signalTimeMs(r: { candle_close_time: string | null; signal_at: string }): number {
  return Date.parse(r.candle_close_time ?? r.signal_at);
}

export function buildMixRows(pairs: MixPair[], analyzer: DayAnalyzer): MixRow[] {
  const out: MixRow[] = [];
  for (const p of pairs) {
    const ms = signalTimeMs(p.original);
    if (!Number.isFinite(ms)) continue;
    out.push({ ...p, id: p.reverse.id, signalMs: ms, day: analyzer.classify(ms) });
  }
  return out;
}

/** Side chosen by the day class; the "verification" switch flips original <-> reverse. Pending / no-data days pick nothing. */
export function pickSide(day: SignalDayInfo, cfg: PowerMixConfig, invert: boolean): SidePick {
  if (day.state !== 'FINAL' || !day.dayClass) return 'none';
  const p = cfg.selection[day.dayClass];
  if (!invert) return p;
  return p === 'original' ? 'reverse' : p === 'reverse' ? 'original' : 'none';
}

export function matchesDayFilter(row: MixRow, f: DayFilter): boolean {
  switch (f) {
    case 'ALL': return true;
    case 'DEAD': return row.day.deadHours;
    case 'PENDING': return row.day.state !== 'FINAL';
    default: return row.day.state === 'FINAL' && row.day.dayClass === f;
  }
}

export function outcomeOf(row: MixRow, side: Side): SignalOutcome {
  return side === 'original' ? row.original : row.reverse;
}

export interface MixViews {
  original: SignalOutcome[];
  reverse: SignalOutcome[];
  /** only signals whose day is final and whose class selects a side */
  mix: SignalOutcome[];
  /** signals left out of the mix: still pending / no BTC data / the class selects nothing */
  excluded: { pending: number; noData: number; none: number };
}

export function buildViews(rows: MixRow[], cfg: PowerMixConfig, invert: boolean): MixViews {
  const v: MixViews = { original: [], reverse: [], mix: [], excluded: { pending: 0, noData: 0, none: 0 } };
  for (const r of rows) {
    v.original.push(r.original);
    v.reverse.push(r.reverse);
    const p = pickSide(r.day, cfg, invert);
    if (p === 'original') v.mix.push(r.original);
    else if (p === 'reverse') v.mix.push(r.reverse);
    else if (r.day.state === 'PENDING') v.excluded.pending++;
    else if (r.day.state === 'NO_DATA') v.excluded.noData++;
    else v.excluded.none++;
  }
  return v;
}

/** Which side a row shows for the chosen view. Pending rows have no pick: they show the original so the card is never empty. */
export function displaySide(row: MixRow, view: MixView, cfg: PowerMixConfig, invert: boolean): Side | null {
  if (view === 'ORIGINAL') return 'original';
  if (view === 'REVERSE') return 'reverse';
  const p = pickSide(row.day, cfg, invert);
  if (p !== 'none') return p;
  return row.day.state === 'FINAL' ? null : 'original'; // class selects nothing -> hidden; pending / no data -> listed, clearly labelled
}

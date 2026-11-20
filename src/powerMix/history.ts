// Power Mix — day history: one record per trading day that has signals (thermometer reading, day class, mix result).
// Everything is derived from the loaded candles + signals, so it always follows the current settings. PURE.
import type { PowerMixConfig } from './config';
import type { DayAnalyzer, DayReport } from './dayPower';
import { buildViews, type MixMode, type MixRow } from './mix';
import { readThermo, type ThermoReading } from './thermo';
import { computeMixStats, type MixStats, type TradePair } from './tradeCalc';

export interface DayHistoryRow {
  dayKey: string;
  dayStart: number;
  report: DayReport;
  thermo: ThermoReading;
  signals: number;
  /** the smart mix of that day's signals */
  mix: MixStats;
}

export function buildDayHistory(
  rows: MixRow[], analyzer: DayAnalyzer, cfg: PowerMixConfig, invert: boolean, mode: MixMode, trades: (row: MixRow) => TradePair,
): DayHistoryRow[] {
  const byDay = new Map<string, MixRow[]>();
  for (const r of rows) {
    const key = (mode === 'executable' ? r.dayExec : r.day).dayKey;
    const list = byDay.get(key);
    if (list) list.push(r); else byDay.set(key, [r]);
  }
  const out: DayHistoryRow[] = [];
  for (const [dayKey, list] of byDay) {
    const dayStart = (mode === 'executable' ? list[0].dayExec : list[0].day).dayStart;
    const report = analyzer.dayReport(dayStart);
    out.push({
      dayKey, dayStart, report,
      thermo: readThermo({ londonPct: report.londonPct, usPct: report.usPct, dayMovePct: report.dayMovePct, deadHours: false }, cfg),
      signals: list.length,
      mix: computeMixStats(buildViews(list, cfg, invert, mode, trades).mix),
    });
  }
  return out.sort((a, b) => b.dayStart - a.dayStart);
}

// Power Mix — configuration model, validation and the browser-local override.
//
// GLOBAL defaults live in the table `power_mix_config` (one row, read-only for users, changed by the admin in the SQL editor).
// Any user can additionally override them for THEIR OWN view (stored in this browser only) to test other thresholds / windows /
// selection logic. Nothing a user changes here can alter shared data or the signals themselves.

export type DayClass = 'VERY_STRONG' | 'POWER' | 'MIXED' | 'NEUTRAL';
export type SidePick = 'original' | 'reverse' | 'none';

export const DAY_CLASSES: DayClass[] = ['VERY_STRONG', 'POWER', 'MIXED', 'NEUTRAL'];

/** All times are minutes since 00:00 Tehran. */
export interface TimeWindow { start: number; end: number }

export interface PowerMixConfig {
  /** |BTC move| (%) a key window needs to count as "strong" */
  thresholdPct: number;
  london: TimeWindow;
  us: TimeWindow;
  /** dead hours = [start, end) and [lateStart, 24:00) */
  dead: { start: number; end: number; lateStart: number };
  /** which side counts as the valid signal for each day class (Pending / no-data days are never selected) */
  selection: Record<DayClass, SidePick>;
  /** a day whose London+US volume is below this fraction of the recent median is labelled low-volume (0 = off) */
  lowVolumeRatio: number;
}

export const CONFIG_STEP_MIN = 30; // BTC candles used for the windows are 30 minutes long

export const DEFAULT_POWER_MIX_CONFIG: PowerMixConfig = {
  thresholdPct: 2,
  london: { start: 11 * 60 + 30, end: 14 * 60 + 30 },
  us: { start: 16 * 60 + 30, end: 19 * 60 + 30 },
  dead: { start: 2 * 60, end: 11 * 60, lateStart: 21 * 60 + 30 },
  selection: { VERY_STRONG: 'original', POWER: 'original', MIXED: 'original', NEUTRAL: 'reverse' },
  lowVolumeRatio: 0.5,
};

const snap = (n: number) => Math.round(n / CONFIG_STEP_MIN) * CONFIG_STEP_MIN;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const PICKS: SidePick[] = ['original', 'reverse', 'none'];

function readWindow(raw: unknown, base: TimeWindow): TimeWindow {
  const o = (raw ?? {}) as Partial<TimeWindow>;
  if (!isNum(o.start) || !isNum(o.end)) return base;
  const start = snap(clamp(o.start, 0, 1410));
  const end = snap(clamp(o.end, 30, 1440));
  return end > start ? { start, end } : base;
}

/**
 * Turns anything (a DB row, a stored override, garbage) into a VALID config. Invalid parts fall back to `base`; this never throws.
 * Rules: times snap to 30 minutes; London ends before US starts; dead.start < dead.end <= dead.lateStart <= 24:00.
 */
export function sanitizeConfig(raw: unknown, base: PowerMixConfig = DEFAULT_POWER_MIX_CONFIG): PowerMixConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const thresholdPct = isNum(o.thresholdPct) ? clamp(o.thresholdPct, 0.1, 20) : base.thresholdPct;

  let london = readWindow(o.london, base.london);
  let us = readWindow(o.us, base.us);
  if (london.end > us.start) { london = base.london; us = base.us; }

  const d = (o.dead ?? {}) as Partial<PowerMixConfig['dead']>;
  let dead = base.dead;
  if (isNum(d.start) && isNum(d.end) && isNum(d.lateStart)) {
    const cand = { start: snap(clamp(d.start, 0, 1410)), end: snap(clamp(d.end, 30, 1440)), lateStart: snap(clamp(d.lateStart, 30, 1440)) };
    if (cand.start < cand.end && cand.end <= cand.lateStart) dead = cand;
  }

  const sel = (o.selection ?? {}) as Partial<Record<DayClass, unknown>>;
  const selection = { ...base.selection };
  for (const c of DAY_CLASSES) {
    const v = sel[c];
    if (typeof v === 'string' && (PICKS as string[]).includes(v)) selection[c] = v as SidePick;
  }

  const lowVolumeRatio = isNum(o.lowVolumeRatio) ? clamp(o.lowVolumeRatio, 0, 1) : base.lowVolumeRatio;
  return { thresholdPct, london, us, dead, selection, lowVolumeRatio };
}

/** Row of the `power_mix_config` table -> config. */
export function configFromRow(row: Record<string, unknown> | null | undefined): PowerMixConfig {
  if (!row) return DEFAULT_POWER_MIX_CONFIG;
  const n = (v: unknown) => (v == null ? undefined : Number(v));
  return sanitizeConfig({
    thresholdPct: n(row.threshold_pct),
    london: { start: n(row.london_start_min), end: n(row.london_end_min) },
    us: { start: n(row.us_start_min), end: n(row.us_end_min) },
    dead: { start: n(row.dead_start_min), end: n(row.dead_end_min), lateStart: n(row.dead_late_start_min) },
    selection: { VERY_STRONG: row.sel_very_strong, POWER: row.sel_power, MIXED: row.sel_mixed, NEUTRAL: row.sel_neutral },
    lowVolumeRatio: n(row.low_volume_ratio),
  });
}

export function sameConfig(a: PowerMixConfig, b: PowerMixConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- browser-local override (never sent anywhere) ------------------------------------------------------------------
export const POWER_MIX_STORAGE_KEY = 'powerMix.config.v1';

export function loadLocalOverride(): PowerMixConfig | null {
  try {
    const raw = localStorage.getItem(POWER_MIX_STORAGE_KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null; // storage blocked / corrupted JSON
  }
}

export function saveLocalOverride(cfg: PowerMixConfig): void {
  try { localStorage.setItem(POWER_MIX_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* private mode / quota */ }
}

export function clearLocalOverride(): void {
  try { localStorage.removeItem(POWER_MIX_STORAGE_KEY); } catch { /* ignore */ }
}

/** Strict check used by the settings form (sanitizeConfig silently repairs; the form must tell the user instead). */
export function isValidConfig(c: PowerMixConfig): boolean {
  const ok = (n: number) => Number.isFinite(n);
  return (
    ok(c.thresholdPct) && c.thresholdPct >= 0.1 && c.thresholdPct <= 20 &&
    ok(c.lowVolumeRatio) && c.lowVolumeRatio >= 0 && c.lowVolumeRatio <= 1 &&
    0 <= c.london.start && c.london.start < c.london.end &&
    c.london.end <= c.us.start && c.us.start < c.us.end && c.us.end <= 1440 &&
    0 <= c.dead.start && c.dead.start < c.dead.end && c.dead.end <= c.dead.lateStart && c.dead.lateStart <= 1440
  );
}

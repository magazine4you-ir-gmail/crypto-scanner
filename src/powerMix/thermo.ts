// Power Mix — market "thermometer": ONE signed number that says where the market stands, plus the zone it falls in.
// negative = bearish (red), positive = bullish (green), around 0 = neutral. PURE (no network, no storage).
//
// Value (in %):
//   * both sessions known           -> London + US   (the two sessions agreeing push it to the edges, opposing ones cancel to ~0)
//   * one session known             -> that session
//   * dead hours / nothing closed   -> move since the crypto-day open
import type { PowerMixConfig } from './config';
import type { SignalDayInfo } from './dayPower';

export type ThermoZone = 'NEUTRAL' | 'MODERATE' | 'STRONG' | 'EXTREME';
export interface ThermoReading {
  /** signed %, null when there is no price data for the day */
  value: number | null;
  zone: ThermoZone;
  direction: 'BULL' | 'BEAR' | 'FLAT';
  /** the two sessions point in opposite directions and both are big: the value cancels out but the day is NOT quiet */
  conflict: boolean;
}

/** The levels drawn on the scale, always sorted: power, strong (or 2x power when the ladder is off), extreme. */
export function thermoLevels(cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>): { power: number; strong: number; extreme: number } {
  const power = cfg.thresholdPct;
  const strong = cfg.strongPct > 0 ? cfg.strongPct : power * 2;
  return { power, strong, extreme: strong * 1.5 };
}

export function marketValue(info: Pick<SignalDayInfo, 'londonPct' | 'usPct' | 'dayMovePct' | 'deadHours'>): number | null {
  const { londonPct: l, usPct: u, dayMovePct: d } = info;
  if (!info.deadHours && (l !== null || u !== null)) return (l ?? 0) + (u ?? 0);
  return d;
}

export function readThermo(
  info: Pick<SignalDayInfo, 'londonPct' | 'usPct' | 'dayMovePct' | 'deadHours'>,
  cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>,
): ThermoReading {
  const value = marketValue(info);
  const lv = thermoLevels(cfg);
  const l = info.londonPct, u = info.usPct;
  const conflict = !info.deadHours && l !== null && u !== null && Math.abs(l) >= lv.power && Math.abs(u) >= lv.power && Math.sign(l) !== Math.sign(u);
  if (value === null) return { value: null, zone: 'NEUTRAL', direction: 'FLAT', conflict: false };
  const a = Math.abs(value);
  const zone: ThermoZone = a >= lv.strong ? (a >= lv.extreme ? 'EXTREME' : 'STRONG') : a >= lv.power ? 'MODERATE' : 'NEUTRAL';
  const direction = zone === 'NEUTRAL' ? 'FLAT' : value > 0 ? 'BULL' : 'BEAR';
  return { value, zone, direction, conflict };
}

/** 0..1 position of the needle on a scale that runs from -extreme*1.15 to +extreme*1.15 (clamped). */
export function needlePosition(value: number | null, cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>): number {
  if (value === null) return 0.5;
  const span = thermoLevels(cfg).extreme * 1.15;
  return Math.min(1, Math.max(0, 0.5 + value / (2 * span)));
}

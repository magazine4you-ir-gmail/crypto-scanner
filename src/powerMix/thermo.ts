// Power Mix — market "thermometer"
// Primary value = BTC move from crypto-day open (03:30 Tehran) → simple & intuitive
// Analytical layer = London + US session sum + conflict
// PURE (no network, no storage).

import type { PowerMixConfig } from './config';
import type { SignalDayInfo } from './dayPower';

export type ThermoZone = 'NEUTRAL' | 'MODERATE' | 'STRONG' | 'EXTREME';

export interface ThermoReading {
  /** Primary: signed % move of BTC from crypto-day open (03:30 Tehran) */
  value: number | null;
  /** Analytical: London + US net % */
  sessionSum: number | null;
  zone: ThermoZone;
  direction: 'BULL' | 'BEAR' | 'FLAT';
  /** Both sessions strong and opposite direction */
  conflict: boolean;
}

export function thermoLevels(cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>): {
  power: number;
  strong: number;
  extreme: number;
} {
  const power = cfg.thresholdPct;
  const strong = cfg.strongPct > 0 ? cfg.strongPct : power * 2;
  return { power, strong, extreme: strong * 1.5 };
}

export function sessionSum(info: Pick<SignalDayInfo, 'londonPct' | 'usPct'>): number | null {
  const { londonPct: l, usPct: u } = info;
  if (l === null && u === null) return null;
  return (l ?? 0) + (u ?? 0);
}

export function primaryValue(info: Pick<SignalDayInfo, 'dayMovePct'>): number | null {
  return info.dayMovePct;
}

export function readThermo(
  info: Pick<SignalDayInfo, 'londonPct' | 'usPct' | 'dayMovePct' | 'deadHours'>,
  cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>,
): ThermoReading {
  const value = primaryValue(info);
  const sess = sessionSum(info);
  const lv = thermoLevels(cfg);

  const l = info.londonPct;
  const u = info.usPct;
  const conflict =
    !info.deadHours &&
    l !== null &&
    u !== null &&
    Math.abs(l) >= lv.power &&
    Math.abs(u) >= lv.power &&
    Math.sign(l) !== Math.sign(u);

  if (value === null) {
    return { value: null, sessionSum: sess, zone: 'NEUTRAL', direction: 'FLAT', conflict: false };
  }

  const a = Math.abs(value);
  const zone: ThermoZone =
    a >= lv.strong ? (a >= lv.extreme ? 'EXTREME' : 'STRONG') : a >= lv.power ? 'MODERATE' : 'NEUTRAL';

  const direction: ThermoReading['direction'] =
    zone === 'NEUTRAL' ? 'FLAT' : value > 0 ? 'BULL' : 'BEAR';

  return { value, sessionSum: sess, zone, direction, conflict };
}

export function needlePosition(
  value: number | null,
  cfg: Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>,
): number {
  if (value === null) return 0.5;
  const span = thermoLevels(cfg).extreme * 1.15;
  return Math.min(1, Math.max(0, 0.5 + value / (2 * span)));
}

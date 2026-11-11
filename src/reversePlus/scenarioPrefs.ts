// Reverse Plus — LOCAL scenario preferences (leverage + sizing). Browser-only: nothing is sent to the server and no
// per-user settings table is involved. A value is only stored when the user ticks "always calculate with these values".
import type { SizingMode } from '../../supabase/functions/_shared/reversePlus/index';
import type { PlusPublicConfig } from '@/services/reversePlusService';

export const SCENARIO_STORAGE_KEY = 'reversePlus.scenario.v1';
export const DEFAULT_LEVERAGE = 10;
export const DEFAULT_NOTIONAL = 1000;

export interface ScenarioPrefs {
  leverage: number;
  sizing: SizingMode;
  /** USDT lost at the stop (FIXED_RISK) */
  riskAmount: number;
  /** USDT position value (FIXED_NOTIONAL) */
  notionalAmount: number;
}

/** Default risk amount = the public reference risk (balance × risk %, capped), only a starting point. */
export function defaultRiskAmount(cfg: Pick<PlusPublicConfig, 'account_balance' | 'risk_pct' | 'max_risk_per_trade'>): number {
  const v = Math.min((cfg.account_balance * cfg.risk_pct) / 100, cfg.max_risk_per_trade);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function defaultPrefs(cfg: Pick<PlusPublicConfig, 'account_balance' | 'risk_pct' | 'max_risk_per_trade'>): ScenarioPrefs {
  return { leverage: DEFAULT_LEVERAGE, sizing: 'FIXED_RISK', riskAmount: defaultRiskAmount(cfg), notionalAmount: DEFAULT_NOTIONAL };
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Parses + validates a stored value; anything malformed is ignored (never throws). */
export function parsePrefs(raw: string | null): ScenarioPrefs | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ScenarioPrefs>;
    if (!positive(o.leverage) || o.leverage > 125) return null;
    if (o.sizing !== 'FIXED_RISK' && o.sizing !== 'FIXED_NOTIONAL') return null;
    if (!positive(o.riskAmount) || !positive(o.notionalAmount)) return null;
    return { leverage: o.leverage, sizing: o.sizing, riskAmount: o.riskAmount, notionalAmount: o.notionalAmount };
  } catch {
    return null;
  }
}

export function loadStoredPrefs(): ScenarioPrefs | null {
  try {
    return parsePrefs(localStorage.getItem(SCENARIO_STORAGE_KEY));
  } catch {
    return null; // storage blocked / unavailable
  }
}

export function saveStoredPrefs(p: ScenarioPrefs): void {
  try {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore: private mode / quota */
  }
}

export function clearStoredPrefs(): void {
  try {
    localStorage.removeItem(SCENARIO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** What the list cards use: the remembered values when present, otherwise the defaults. */
export function resolvePrefs(cfg: Pick<PlusPublicConfig, 'account_balance' | 'risk_pct' | 'max_risk_per_trade'>): ScenarioPrefs {
  return loadStoredPrefs() ?? defaultPrefs(cfg);
}

export const amountOf = (p: ScenarioPrefs): number => (p.sizing === 'FIXED_RISK' ? p.riskAmount : p.notionalAmount);

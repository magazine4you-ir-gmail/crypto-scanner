// Reverse Plus — local scenario state for the signal detail page. Leverage / sizing / amount drive every calculation on
// the page. "Remember" stores them in THIS browser only (localStorage); unticking removes them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SizingMode } from '../../supabase/functions/_shared/reversePlus/index';
import type { PlusPublicConfig } from '@/services/reversePlusService';
import {
  DEFAULT_LEVERAGE, DEFAULT_NOTIONAL, clearStoredPrefs, defaultRiskAmount, loadStoredPrefs, saveStoredPrefs, type ScenarioPrefs,
} from './scenarioPrefs';

type CostBase = Pick<PlusPublicConfig, 'account_balance' | 'risk_pct' | 'max_risk_per_trade'>;

export function useScenario(cfg: CostBase) {
  const stored = useMemo(() => loadStoredPrefs(), []);
  const [lev, setLev] = useState<number>(stored?.leverage ?? DEFAULT_LEVERAGE);
  const [sizing, setSizingState] = useState<SizingMode>(stored?.sizing ?? 'FIXED_RISK');
  // null = "use the default" (so the default follows the public reference config once it has loaded)
  const [risk, setRisk] = useState<string | null>(stored ? String(stored.riskAmount) : null);
  const [notional, setNotional] = useState<string | null>(stored ? String(stored.notionalAmount) : null);
  const [remember, setRemember] = useState<boolean>(stored !== null);

  const riskValue = risk ?? String(defaultRiskAmount(cfg));
  const notionalValue = notional ?? String(DEFAULT_NOTIONAL);
  const amount = sizing === 'FIXED_RISK' ? riskValue : notionalValue;

  const setAmount = useCallback((v: string) => (sizing === 'FIXED_RISK' ? setRisk(v) : setNotional(v)), [sizing]);
  const setSizing = useCallback((m: SizingMode) => setSizingState(m), []);

  // persist only while the box is ticked and the numbers are sane
  useEffect(() => {
    if (!remember) return;
    const r = Number(riskValue);
    const n = Number(notionalValue);
    if (!(r > 0) || !(n > 0) || !(lev > 0)) return;
    const next: ScenarioPrefs = { leverage: lev, sizing, riskAmount: r, notionalAmount: n };
    saveStoredPrefs(next);
  }, [remember, lev, sizing, riskValue, notionalValue]);

  const toggleRemember = useCallback((on: boolean) => {
    setRemember(on);
    if (!on) clearStoredPrefs();
  }, []);

  const reset = useCallback(() => {
    setLev(DEFAULT_LEVERAGE);
    setSizingState('FIXED_RISK');
    setRisk(null);
    setNotional(null);
    setRemember(false);
    clearStoredPrefs();
  }, []);

  const prefs: ScenarioPrefs = useMemo(() => ({
    leverage: lev, sizing,
    // an empty / non-numeric field means 0 -> the page shows "enter an amount" instead of silently using a default
    riskAmount: Number.isFinite(Number(riskValue)) ? Number(riskValue) : 0,
    notionalAmount: Number.isFinite(Number(notionalValue)) ? Number(notionalValue) : 0,
  }), [lev, sizing, riskValue, notionalValue]);

  return { lev, setLev, sizing, setSizing, amount, setAmount, riskValue, notionalValue, remember, toggleRemember, reset, prefs };
}

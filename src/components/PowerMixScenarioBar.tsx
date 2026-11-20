import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/UI';
import { useSettings } from '@/contexts/SettingsContext';
import { formatNumber } from '@/i18n/format';
import { amountOf, type ScenarioPrefs } from '@/reversePlus/scenarioPrefs';

interface Props { prefs: ScenarioPrefs; custom: boolean; onSave: (p: ScenarioPrefs) => void; onReset: () => void }

/**
 * The Reverse Plus scenario (leverage + sizing + amount) used for every P&L on this page.
 * It reads / writes the SAME browser value as the Reverse Plus pages, so both always agree.
 */
export function PowerMixScenarioBar({ prefs, custom, onSave, onReset }: Props) {
  const { t, lang } = useSettings();
  const [open, setOpen] = useState(false);
  const [lev, setLev] = useState(String(prefs.leverage));
  const [sizing, setSizing] = useState(prefs.sizing);
  const [amount, setAmount] = useState(String(amountOf(prefs)));
  useEffect(() => { setLev(String(prefs.leverage)); setSizing(prefs.sizing); setAmount(String(amountOf(prefs))); }, [prefs]);

  const levN = Number(lev.replace(',', '.')), amtN = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(levN) && levN >= 1 && levN <= 125 && Number.isFinite(amtN) && amtN > 0;
  const save = () => onSave({
    leverage: levN,
    sizing,
    riskAmount: sizing === 'FIXED_RISK' ? amtN : prefs.riskAmount,
    notionalAmount: sizing === 'FIXED_NOTIONAL' ? amtN : prefs.notionalAmount,
  });

  return (
    <Card className="!p-3 sm:!p-4 space-y-3">
      <button className="w-full flex items-center justify-between gap-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100 text-start">
          <SlidersHorizontal className="w-4 h-4 text-primary-400 shrink-0" />
          {t('pmScenario')}
        </span>
        <span className="text-xs text-slate-400 tabular-nums shrink-0">
          {formatNumber(prefs.leverage, lang, 0)}x · {t(prefs.sizing === 'FIXED_RISK' ? 'pmFixedRisk' : 'pmFixedNotional')} {formatNumber(amountOf(prefs), lang, 2)}{custom ? '' : ' *'}
        </span>
      </button>
      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1"><span className="text-xs text-slate-400">{t('pmLeverage')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={lev} onChange={(e) => setLev(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-400">{t('pmSizing')}</span>
              <select className="input-field text-sm" value={sizing} onChange={(e) => { const v = e.target.value as typeof sizing; setSizing(v); setAmount(String(v === 'FIXED_RISK' ? prefs.riskAmount : prefs.notionalAmount)); }}>
                <option value="FIXED_RISK">{t('pmFixedRisk')}</option>
                <option value="FIXED_NOTIONAL">{t('pmFixedNotional')}</option>
              </select></label>
            <label className="space-y-1"><span className="text-xs text-slate-400">{t('pmAmount')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          </div>
          <p className="text-[11px] text-slate-500 leading-5">{t('pmScenarioHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-sm" disabled={!valid} onClick={save}>{t('pmScenarioSave')}</button>
            <button className="btn-secondary text-sm" onClick={onReset}>{t('pmResetDefaults')}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

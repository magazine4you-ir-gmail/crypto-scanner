import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/UI';
import { Chip } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { DAY_CLASSES, isValidConfig, type DayClass, type PowerMixConfig, type SidePick } from '@/powerMix/config';
import { formatHHMM } from '@/powerMix/tehranTime';

interface Props {
  /** the config in effect (personal override if any, else the global default) */
  value: PowerMixConfig;
  personal: boolean;
  onSave: (cfg: PowerMixConfig) => void;
  onReset: () => void;
}

const TIMES = Array.from({ length: 49 }, (_, i) => i * 30); // 00:00 … 24:00

function TimeSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <select className="input-field text-sm" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {TIMES.map((m) => <option key={m} value={m}>{formatHHMM(m)}</option>)}
    </select>
  );
}

/** Global defaults come from the DB; this panel stores a PERSONAL override in this browser only (never sent anywhere). */
export function PowerMixSettingsPanel({ value, personal, onSave, onReset }: Props) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PowerMixConfig>(value);
  const [thr, setThr] = useState(String(value.thresholdPct));
  const [vol, setVol] = useState(String(value.lowVolumeRatio));

  useEffect(() => { setDraft(value); setThr(String(value.thresholdPct)); setVol(String(value.lowVolumeRatio)); }, [value]);

  const candidate = useMemo<PowerMixConfig>(
    () => ({ ...draft, thresholdPct: Number(thr.replace(',', '.')), lowVolumeRatio: Number(vol.replace(',', '.')) }),
    [draft, thr, vol],
  );
  const valid = isValidConfig(candidate);

  const setWin = (key: 'london' | 'us', part: 'start' | 'end', v: number) => setDraft((d) => ({ ...d, [key]: { ...d[key], [part]: v } }));
  const setDead = (part: 'start' | 'end' | 'lateStart', v: number) => setDraft((d) => ({ ...d, dead: { ...d.dead, [part]: v } }));
  const setSel = (c: DayClass, v: SidePick) => setDraft((d) => ({ ...d, selection: { ...d.selection, [c]: v } }));

  return (
    <Card className="!p-3 sm:!p-4 space-y-3">
      <button className="w-full flex items-center justify-between gap-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <SlidersHorizontal className="w-4 h-4 text-primary-400" />
          {t('pmSettings')}
          <Chip tone={personal ? 'bg-primary-500/20 text-primary-300' : 'bg-surface-200 text-slate-400'}>{personal ? t('pmPersonalActive') : t('pmGlobalActive')}</Chip>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('pmSettingsHint')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmThreshold')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={thr} onChange={(e) => setThr(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmLowVolRatio')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={vol} onChange={(e) => setVol(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmLondonWindow')}</span>
              <div className="grid grid-cols-2 gap-2">
                <TimeSelect label={t('pmFrom')} value={draft.london.start} onChange={(v) => setWin('london', 'start', v)} />
                <TimeSelect label={t('pmTo')} value={draft.london.end} onChange={(v) => setWin('london', 'end', v)} />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmUsWindow')}</span>
              <div className="grid grid-cols-2 gap-2">
                <TimeSelect label={t('pmFrom')} value={draft.us.start} onChange={(v) => setWin('us', 'start', v)} />
                <TimeSelect label={t('pmTo')} value={draft.us.end} onChange={(v) => setWin('us', 'end', v)} />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmDeadWindow')}</span>
              <div className="grid grid-cols-2 gap-2">
                <TimeSelect label={t('pmFrom')} value={draft.dead.start} onChange={(v) => setDead('start', v)} />
                <TimeSelect label={t('pmTo')} value={draft.dead.end} onChange={(v) => setDead('end', v)} />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmDeadLate')}</span>
              <TimeSelect label={t('pmDeadLate')} value={draft.dead.lateStart} onChange={(v) => setDead('lateStart', v)} />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-slate-400">{t('pmSelection')}</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DAY_CLASSES.map((c) => (
                <div key={c} className="flex items-center justify-between gap-2 rounded-lg bg-surface-100/60 px-3 py-2">
                  <span className="text-sm text-slate-200">{t(`pmClass${c}`)}</span>
                  <select className="input-field text-sm !w-auto" value={draft.selection[c]} onChange={(e) => setSel(c, e.target.value as SidePick)} aria-label={t(`pmClass${c}`)}>
                    <option value="original">{t('pmSelOriginal')}</option>
                    <option value="reverse">{t('pmSelReverse')}</option>
                    <option value="none">{t('pmSelNone')}</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {!valid && <p className="text-xs text-error-400">{t('pmInvalid')}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-sm" disabled={!valid} onClick={() => onSave(candidate)}>{t('pmSave')}</button>
            <button className="btn-secondary text-sm" onClick={onReset}>{t('pmResetDefaults')}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

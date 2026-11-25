import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Card } from '@/components/UI';
import { Chip } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { DAY_CLASSES, isValidConfig, type DayClass, type DeadPick, type PowerMixConfig, type SidePick } from '@/powerMix/config';
import { formatHHMM } from '@/powerMix/tehranTime';
import { autoTuneSelection, type AutoTuneResult, type BucketTune } from '@/powerMix/autoTune';
import type { MixMode, MixRow } from '@/powerMix/mix';
import type { TradePair } from '@/powerMix/tradeCalc';
import { formatNumber, formatPercent } from '@/i18n/format';

interface Props {
  value: PowerMixConfig;
  personal: boolean;
  onSave: (cfg: PowerMixConfig) => void;
  onReset: () => void;
  /** rows in the current date range ( fore auto-tune) */
  rows?: MixRow[];
  tradesOf?: (row: MixRow) => TradePair;
  mixMode?: MixMode;
}

const TIMES = Array.from({ length: 49 }, (_, i) => i * 30);

function TimeSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <select className="input-field text-sm" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {TIMES.map((m) => (
        <option key={m} value={m}>{formatHHMM(m)}</option>
      ))}
    </select>
  );
}

function pickLabel(t: (k: string) => string, p: string) {
  if (p === 'original') return t('pmSelOriginal');
  if (p === 'reverse') return t('pmSelReverse');
  if (p === 'byClass') return t('pmSelByClass');
  return t('pmSelNone');
}

function bucketTitle(t: (k: string) => string, key: BucketTune['key']) {
  return key === 'DEAD' ? t('pmSelDead') : t(`pmClass${key}`);
}

export function PowerMixSettingsPanel({ value, personal, onSave, onReset, rows, tradesOf, mixMode = 'executable' }: Props) {
  const { t, lang } = useSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PowerMixConfig>(value);
  const [thr, setThr] = useState(String(value.thresholdPct));
  const [strong, setStrong] = useState(String(value.strongPct));
  const [vol, setVol] = useState(String(value.lowVolumeRatio));
  const [tune, setTune] = useState<AutoTuneResult | null>(null);
  const [tuneError, setTuneError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setThr(String(value.thresholdPct));
    setStrong(String(value.strongPct));
    setVol(String(value.lowVolumeRatio));
  }, [value]);

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')));
  const candidate = useMemo<PowerMixConfig>(
    () => ({ ...draft, thresholdPct: Number(thr.replace(',', '.')), strongPct: num(strong), lowVolumeRatio: Number(vol.replace(',', '.')) }),
    [draft, thr, strong, vol],
  );
  const strongOn = candidate.strongPct > 0;
  const valid = isValidConfig(candidate);
  const canTune = Boolean(rows && tradesOf && rows.length > 0);

  const setWin = (key: 'london' | 'us', part: 'start' | 'end', v: number) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [part]: v } }));
  const setDead = (part: 'start' | 'end' | 'lateStart', v: number) =>
    setDraft((d) => ({ ...d, dead: { ...d.dead, [part]: v } }));
  const setSel = (c: DayClass, v: SidePick) =>
    setDraft((d) => ({ ...d, selection: { ...d.selection, [c]: v } }));
  const setDeadPick = (v: DeadPick) =>
    setDraft((d) => ({ ...d, selection: { ...d.selection, DEAD: v } }));

  const runAutoTune = () => {
    setTuneError(null);
    if (!rows || !tradesOf) {
      setTuneError(t('pmAutoNoData'));
      return;
    }
    try {
      const result = autoTuneSelection(rows, tradesOf, mixMode, candidate);
      setTune(result);
      setDraft((d) => ({ ...d, selection: result.selection }));
    } catch (e) {
      setTuneError(e instanceof Error ? e.message : String(e));
    }
  };

  const applyAndSave = () => {
    if (!valid) return;
    onSave(candidate);
  };

  return (
    <Card className="!p-3 sm:!p-4 space-y-3">
      <button className="w-full flex items-center justify-between gap-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <SlidersHorizontal className="w-4 h-4 text-primary-400" />
          {t('pmSettings')}
          <Chip tone={personal ? 'bg-primary-500/20 text-primary-300' : 'bg-surface-200 text-slate-400'}>
            {personal ? t('pmPersonalActive') : t('pmGlobalActive')}
          </Chip>
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
              <span className="text-xs text-slate-400">{t('pmStrongPct')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={strong} onChange={(e) => setStrong(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-400">{t('pmLowVolRatio')}</span>
              <input className="input-field text-sm" inputMode="decimal" value={vol} onChange={(e) => setVol(e.target.value)} />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 leading-5">{t('pmStrongHint')}</p>

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">{t('pmSelection')}</span>
              <button
                type="button"
                className="btn-secondary text-xs inline-flex items-center gap-1.5"
                disabled={!canTune}
                onClick={runAutoTune}
                title={!canTune ? t('pmAutoNoData') : t('pmAutoHint')}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t('pmAutoTune')}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-4">{t('pmAutoHint')}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DAY_CLASSES.map((c) => {
                const off = c === 'STRONG' && !strongOn;
                return (
                  <div key={c} className={`flex items-center justify-between gap-2 rounded-lg bg-surface-100/60 px-3 py-2 ${off ? 'opacity-50' : ''}`}>
                    <span className="text-sm text-slate-200">{t(`pmClass${c}`)}</span>
                    <select
                      className="input-field text-sm !w-auto"
                      value={draft.selection[c]}
                      onChange={(e) => setSel(c, e.target.value as SidePick)}
                      aria-label={t(`pmClass${c}`)}
                    >
                      <option value="original">{t('pmSelOriginal')}</option>
                      <option value="reverse">{t('pmSelReverse')}</option>
                      <option value="none">{t('pmSelNone')}</option>
                    </select>
                  </div>
                );
              })}
              <div className="sm:col-span-2 flex items-center justify-between gap-2 rounded-lg bg-surface-100/60 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm text-slate-200">{t('pmSelDead')}</span>
                  <span className="block text-[11px] text-slate-500 leading-4">{t('pmSelDeadHint')}</span>
                </span>
                <select
                  className="input-field text-sm !w-auto shrink-0"
                  value={draft.selection.DEAD}
                  onChange={(e) => setDeadPick(e.target.value as DeadPick)}
                  aria-label={t('pmSelDead')}
                >
                  <option value="byClass">{t('pmSelByClass')}</option>
                  <option value="original">{t('pmSelOriginal')}</option>
                  <option value="reverse">{t('pmSelReverse')}</option>
                  <option value="none">{t('pmSelNone')}</option>
                </select>
              </div>
            </div>
          </div>

          {tuneError && <p className="text-xs text-error-400">{tuneError}</p>}

          {tune && (
            <div className="rounded-lg border border-primary-500/30 bg-primary-500/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-100">{t('pmAutoResult')}</p>
              <p className="text-[11px] text-slate-400 leading-4">
                {t('pmAutoOverall')
                  .replace('{n}', formatNumber(tune.totalSignals, lang, 0))
                  .replace('{usd}', `${tune.overall.netUsd >= 0 ? '+' : ''}${formatNumber(tune.overall.netUsd, lang, 2)}`)
                  .replace('{r}', `${tune.overall.totalR >= 0 ? '+' : ''}${formatNumber(tune.overall.totalR, lang, 2)}`)
                  .replace('{wr}', formatPercent(tune.overall.winRate * 100, lang))
                  .replace('{c}', formatNumber(tune.overall.closed, lang, 0))}
              </p>
              <div className="space-y-1.5">
                {tune.buckets.map((b) => (
                  <div key={b.key} className="rounded bg-surface-100/50 px-2 py-1.5 text-[11px] leading-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-slate-200">{bucketTitle(t, b.key)}</span>
                      <span className="text-primary-300">→ {pickLabel(t, String(b.best))}</span>
                      <span className="text-slate-500">
                        ({formatNumber(b.signals, lang, 0)} {t('pmHistorySignals')}
                        {b.weak ? ` · ${t('pmAutoWeak')}` : ''})
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {b.ranked
                        .filter((s) => s.pick !== 'none' || s.closed > 0 || true)
                        .map((s) => {
                          const tag = pickLabel(t, String(s.pick));
                          if (s.pick === 'none') {
                            return `${tag}: 0`;
                          }
                          return `${tag}: ${s.wins}/${s.losses}/${s.expired} · ${s.netUsd >= 0 ? '+' : ''}${formatNumber(s.netUsd, lang, 1)}$ · ${s.totalR >= 0 ? '+' : ''}${formatNumber(s.totalR, lang, 1)}R`;
                        })
                        .join(' | ')}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 leading-4">{t('pmAutoNote')}</p>
            </div>
          )}

          {!valid && (
            <p className="text-xs text-error-400">
              {t('pmInvalid')} {t('pmInvalidStrong')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-sm" disabled={!valid} onClick={applyAndSave}>
              {t('pmSave')}
            </button>
            <button className="btn-secondary text-sm" onClick={onReset}>
              {t('pmResetDefaults')}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

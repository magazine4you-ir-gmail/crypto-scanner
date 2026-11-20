import { useMemo, useState } from 'react';
import { Card, SectionTitle } from '@/components/UI';
import { Chip } from '@/components/Responsive';
import { MarketThermometer, thermoTone, useThermoLabel } from '@/components/MarketThermometer';
import { useSettings } from '@/contexts/SettingsContext';
import { formatNumber, formatPercent } from '@/i18n/format';
import type { DayClass, PowerMixConfig } from '@/powerMix/config';
import type { DayHistoryRow } from '@/powerMix/history';

const CLASS_TONE: Record<DayClass, string> = {
  VERY_STRONG: 'bg-success-500/20 text-success-400',
  STRONG: 'bg-success-500/10 text-success-400',
  POWER: 'bg-primary-500/20 text-primary-300',
  MIXED: 'bg-warning-500/20 text-warning-400',
  NEUTRAL: 'bg-surface-200 text-slate-300',
};
const PAGE = 14;
const tone = (v: number) => (v >= 0 ? 'text-success-400' : 'text-error-400');

interface Props { rows: DayHistoryRow[]; cfg: PowerMixConfig; focusKey: string | null; onPick: (dayKey: string) => void }

/** One record per trading day: thermometer, day class, London / US moves, signal count and the smart-mix result of that day. */
export function PowerMixDayHistory({ rows, cfg, focusKey, onPick }: Props) {
  const { t, lang } = useSettings();
  const label = useThermoLabel();
  const [shown, setShown] = useState(PAGE);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }), [lang]);
  const dayText = (key: string) => fmtDay.format(new Date(`${key}T12:00:00Z`)); // the key is a calendar date: print it as that date, in the chosen calendar
  const sign = (v: number | null) => (v === null ? '—' : formatPercent(v, lang));

  return (
    <Card className="!p-3 sm:!p-4 space-y-3">
      <div>
        <SectionTitle className="!text-base !mb-1">{t('pmHistoryTitle')}</SectionTitle>
        <p className="text-[11px] text-slate-500 leading-5">{t('pmHistoryHint')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t('pmHistoryEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, shown).map((r) => {
            const closed = r.mix.totalClosed;
            return (
              <button
                key={r.dayKey}
                onClick={() => onPick(r.dayKey)}
                aria-label={`${t('pmHistoryPick')}: ${dayText(r.dayKey)}`}
                className={`w-full text-start rounded-lg border p-2.5 space-y-2 transition-colors ${focusKey === r.dayKey ? 'border-primary-500/50 bg-primary-600/10' : 'border-surface-200 bg-surface-100/50 hover:bg-surface-100'}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-100">{dayText(r.dayKey)}</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {r.report.dayClass
                      ? <Chip tone={CLASS_TONE[r.report.dayClass]}>{t(`pmClass${r.report.dayClass}`)}</Chip>
                      : <Chip tone="bg-warning-500/20 text-warning-400">{r.report.state === 'NO_DATA' ? t('pmNoDay') : t('pmDayPending')}</Chip>}
                    <Chip tone={thermoTone(r.thermo)}>{label(r.thermo)}</Chip>
                    {r.report.lowVolume && <Chip tone="bg-warning-500/10 text-warning-400">{t('pmLowVolume')}</Chip>}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-4 items-center">
                  <MarketThermometer reading={r.thermo} cfg={cfg} compact />
                  <div className="grid grid-cols-4 gap-x-3 text-[11px] tabular-nums text-slate-400">
                    <span>{t('pmLondon')} <b className="text-slate-200 font-semibold">{sign(r.report.londonPct)}</b></span>
                    <span>{t('pmUs')} <b className="text-slate-200 font-semibold">{sign(r.report.usPct)}</b></span>
                    <span>{t('pmHistorySignals')} <b className="text-slate-200 font-semibold">{formatNumber(r.signals, lang, 0)}</b></span>
                    <span>{t('pmHistoryMix')}{' '}
                      <b className={`font-semibold ${closed ? tone(r.mix.netUsd) : 'text-slate-500'}`}>
                        {closed ? `${r.mix.netUsd >= 0 ? '+' : ''}${formatNumber(r.mix.netUsd, lang, 2)}` : '—'}
                      </b>
                      {closed > 0 && <span className="text-slate-500"> ({r.mix.wins}/{r.mix.losses})</span>}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
          {rows.length > shown && <div className="flex justify-center"><button className="btn-secondary text-sm" onClick={() => setShown((n) => n + PAGE)}>{t('pmHistoryMore')}</button></div>}
        </div>
      )}
    </Card>
  );
}

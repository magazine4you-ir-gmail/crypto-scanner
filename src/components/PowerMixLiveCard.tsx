import { Card } from '@/components/UI';
import { Chip } from '@/components/Responsive';
import { DayChips } from '@/components/PowerMixChips';
import { MarketThermometer, thermoTone, useThermoLabel } from '@/components/MarketThermometer';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPercent, formatPrice } from '@/i18n/format';
import type { PowerMixConfig } from '@/powerMix/config';
import type { LiveStatus } from '@/powerMix/dayPower';
import { tehranMinutes } from '@/powerMix/tehranTime';
import { readThermo } from '@/powerMix/thermo';

const PICK_TONE: Record<string, string> = {
  original: 'bg-success-500/10 border-success-500/30 text-success-400',
  reverse: 'bg-primary-600/10 border-primary-500/30 text-primary-300',
  none: 'bg-surface-100 border-surface-200 text-slate-300',
  WAIT: 'bg-surface-100 border-surface-200 text-slate-300',
};

export function PowerMixLiveCard({ live, cfg }: { live: LiveStatus; cfg: PowerMixConfig }) {
  const { t, lang } = useSettings();
  const label = useThermoLabel();
  const tod = tehranMinutes(live.nowMs);
  const thermo = readThermo(live.info, cfg);

  const windowCell = (labelText: string, pct: number | null, complete: boolean, start: number) => {
    const waiting = tod < start;
    const value = pct === null ? '—' : formatPercent(pct, lang);
    const color =
      pct === null
        ? 'text-slate-500'
        : Math.abs(pct) >= cfg.thresholdPct
          ? pct > 0
            ? 'text-success-400'
            : 'text-error-400'
          : 'text-slate-200';

    return (
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-slate-500 truncate">{labelText}</p>
        <p className={`text-sm font-semibold tabular-nums ${color}`}>{waiting ? '—' : value}</p>
        {!complete && (
          <p className="text-[10px] text-slate-500 truncate">
            {waiting ? t('pmWindowWaiting') : t('pmWindowPending')}
          </p>
        )}
      </div>
    );
  };

  const pickLabel =
    live.pick === 'original'
      ? t('pmUseOriginal')
      : live.pick === 'reverse'
        ? t('pmUseReverse')
        : live.pick === 'none'
          ? t('pmUseNone')
          : t('pmUseWait');

  return (
    <Card className="!p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-slate-100">{t('pmLiveTitle')}</p>
          <DayChips info={live.info} />
        </div>
        <div className="text-end shrink-0">
          <p className="text-[11px] text-slate-500">{t('pmBtcNow')}</p>
          <p className="text-base font-bold tabular-nums text-slate-100">
            {formatPrice(live.price, lang)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-100/60 p-2.5">
        {windowCell(t('pmLondon'), live.info.londonPct, live.londonComplete, cfg.london.start)}
        {windowCell(t('pmUs'), live.info.usPct, live.usComplete, cfg.us.start)}
        <div className="min-w-0">
          <p className="text-[11px] leading-4 text-slate-500 truncate">{t('pmDayMove')}</p>
          <p className="text-sm font-semibold tabular-nums text-slate-200">
            {live.info.dayMovePct === null ? '—' : formatPercent(live.info.dayMovePct, lang)}
          </p>
        </div>
      </div>

      {/* دماسنج اصلی + لایه تحلیلی */}
      <div className="rounded-lg bg-surface-100/60 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-200">{t('pmThermoTitle')}</p>
          <span className="flex items-center gap-1.5">
            <Chip tone={thermoTone(thermo)}>{label(thermo)}</Chip>
            {thermo.value !== null && (
              <span className="text-xs tabular-nums text-slate-300">
                {formatPercent(thermo.value, lang)}
              </span>
            )}
          </span>
        </div>

        <MarketThermometer reading={thermo} cfg={cfg} />

        {/* لایه تحلیلی واضح */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-4 text-slate-400 pt-1">
          {thermo.sessionSum !== null && (
            <span>
              {t('pmLondon')}+{t('pmUs')}:{' '}
              <span className="text-slate-200 tabular-nums font-medium">
                {formatPercent(thermo.sessionSum, lang)}
              </span>
            </span>
          )}
          {live.info.dayClass && (
            <span>
              | <span className="text-slate-200 font-medium">{live.info.dayClass}</span>
            </span>
          )}
          {thermo.conflict && (
            <span className="text-warning-400 font-medium">| {t('pmThermoConflict')}</span>
          )}
          {live.info.deadHours && (
            <span className="text-slate-500">| {t('pmBasedOnDead')}</span>
          )}
        </div>

        <p className="text-[10px] text-slate-500 leading-4">
          عدد اصلی = حرکت بیت‌کوین از شروع روز معاملاتی (۰۳:۳۰ تهران). لایه زیر = لندن+آمریکا + کلاس روز.
        </p>
      </div>

      <div className={`rounded-lg border p-3 ${PICK_TONE[live.pick] || PICK_TONE.WAIT}`}>
        <p className="text-sm font-semibold">{pickLabel}</p>
        {live.approximate && <p className="text-[11px] mt-1 opacity-80">{t('pmApprox')}</p>}
        {live.info.deadHours && <p className="text-[11px] mt-1 opacity-80">{t('pmBasedOnDead')}</p>}
      </div>
    </Card>
  );
}

import { Card } from '@/components/UI';
import { DayChips } from '@/components/PowerMixChips';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPercent, formatPrice } from '@/i18n/format';
import type { PowerMixConfig } from '@/powerMix/config';
import type { LiveStatus } from '@/powerMix/dayPower';
import { tehranMinutes } from '@/powerMix/tehranTime';

const PICK_TONE: Record<string, string> = {
  original: 'bg-success-500/10 border-success-500/30 text-success-400',
  reverse: 'bg-primary-600/10 border-primary-500/30 text-primary-300',
  none: 'bg-surface-100 border-surface-200 text-slate-300',
  WAIT: 'bg-surface-100 border-surface-200 text-slate-300',
};

/** Today's BTC day power + the recommendation "use the original or the reverse signal now". Always at the top of the page. */
export function PowerMixLiveCard({ live, cfg }: { live: LiveStatus; cfg: PowerMixConfig }) {
  const { t, lang } = useSettings();
  const tod = tehranMinutes(live.nowMs);

  const windowCell = (label: string, pct: number | null, complete: boolean, start: number) => {
    const waiting = tod < start;
    const value = pct === null ? '—' : formatPercent(pct, lang);
    const color = pct === null ? 'text-slate-500' : Math.abs(pct) >= cfg.thresholdPct ? (pct > 0 ? 'text-success-400' : 'text-error-400') : 'text-slate-200';
    return (
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-slate-500 truncate">{label}</p>
        <p className={`text-sm font-semibold tabular-nums ${color}`}>{waiting ? '—' : value}</p>
        {!complete && <p className="text-[10px] text-slate-500 truncate">{waiting ? t('pmWindowWaiting') : t('pmWindowPending')}</p>}
      </div>
    );
  };

  const pickLabel =
    live.pick === 'original' ? t('pmUseOriginal') : live.pick === 'reverse' ? t('pmUseReverse') : live.pick === 'none' ? t('pmUseNone') : t('pmUseWait');
  const day = live.info.dayMovePct;

  return (
    <Card className="!p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-slate-100">{t('pmLiveTitle')}</p>
          <DayChips info={live.info} />
        </div>
        <div className="text-end shrink-0">
          <p className="text-[11px] text-slate-500">{t('pmBtcNow')}</p>
          <p className="text-base font-bold tabular-nums text-slate-100">{formatPrice(live.price, lang)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-100/60 p-2.5">
        {windowCell(t('pmLondon'), live.info.londonPct, live.londonComplete, cfg.london.start)}
        {windowCell(t('pmUs'), live.info.usPct, live.usComplete, cfg.us.start)}
        <div className="min-w-0">
          <p className="text-[11px] leading-4 text-slate-500 truncate">{t('pmDayMove')}</p>
          <p className="text-sm font-semibold tabular-nums text-slate-200">{day === null ? '—' : formatPercent(day, lang)}</p>
        </div>
      </div>

      <div className={`rounded-lg border p-3 ${PICK_TONE[live.pick]}`}>
        <p className="text-sm font-semibold">{pickLabel}</p>
        {live.approximate && <p className="text-[11px] mt-1 opacity-80">{t('pmApprox')}</p>}
        {live.info.deadHours && <p className="text-[11px] mt-1 opacity-80">{t('pmBasedOnDead')}</p>}
      </div>
    </Card>
  );
}

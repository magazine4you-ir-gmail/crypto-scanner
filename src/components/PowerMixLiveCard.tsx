import { Card } from '@/components/UI';
import { Chip } from '@/components/Responsive';
import { DayChips } from '@/components/PowerMixChips';
import { MarketThermometer, thermoTone, useThermoLabel } from '@/components/MarketThermometer';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPercent, formatPrice } from '@/i18n/format';
import { selectionFor, type DayClass, type PowerMixConfig, type SidePick } from '@/powerMix/config';
import type { LiveStatus } from '@/powerMix/dayPower';
import { tehranMinutes } from '@/powerMix/tehranTime';
import { readThermo, type ThermoReading } from '@/powerMix/thermo';

const PICK_TONE: Record<string, string> = {
  original: 'bg-success-500/10 border-success-500/30 text-success-400',
  reverse: 'bg-primary-600/10 border-primary-500/30 text-primary-300',
  none: 'bg-surface-100 border-surface-200 text-slate-300',
  WAIT: 'bg-surface-100 border-surface-200 text-slate-300',
};

/** دماسنج فقط روی حرکت روز (از ۰۳:۳۰ تهران) — همان عدد dayMovePct موتور. */
function dayMoveThermo(dayMovePct: number | null, cfg: PowerMixConfig): ThermoReading {
  return readThermo(
    {
      londonPct: null,
      usPct: null,
      dayMovePct,
      deadHours: true, // force marketValue → dayMovePct
    },
    cfg,
  );
}

export function PowerMixLiveCard({ live, cfg }: { live: LiveStatus; cfg: PowerMixConfig }) {
  const { t, lang } = useSettings();
  const label = useThermoLabel();
  const tod = tehranMinutes(live.nowMs);

  // دماسنج فعلی (قدرت ترکیبی: لندن+آمریکا یا حرکت روز در ساعت مرده)
  const thermo = readThermo(live.info, cfg);

  // دماسنج جدید: فقط درصد فعلی بیت‌کوین از ابتدای روز معاملاتی
  const dayPct = live.info.dayMovePct;
  const dayThermo = dayMoveThermo(dayPct, cfg);

  // همان منطق «کدام سیگنال معتبر است؟» از تنظیمات
  const dayClass: DayClass | null = live.info.dayClass;
  const settingsPick: SidePick | 'WAIT' =
    dayClass != null
      ? selectionFor(cfg, dayClass, live.info.deadHours)
      : live.pick === 'WAIT'
        ? 'WAIT'
        : live.pick;

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

  const pickLabel = (pick: SidePick | 'WAIT') =>
    pick === 'original'
      ? t('pmUseOriginal')
      : pick === 'reverse'
        ? t('pmUseReverse')
        : pick === 'none'
          ? t('pmUseNone')
          : t('pmUseWait');

  const classLabel = (c: DayClass) => t(`pmClass${c}`);

  const deadPickHint = () => {
    const d = cfg.selection.DEAD;
    if (d === 'byClass') return t('pmSelByClass');
    if (d === 'original') return t('pmSelOriginal');
    if (d === 'reverse') return t('pmSelReverse');
    return t('pmSelNone');
  };

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
            {dayPct === null ? '—' : formatPercent(dayPct, lang)}
          </p>
        </div>
      </div>

      {/* ── دماسنج ۱: قدرت ترکیبی (موجود) ── */}
      <div className="rounded-lg bg-surface-100/60 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-200">{t('pmThermoTitle')}</p>
          <span className="flex items-center gap-1.5">
            <Chip tone={thermoTone(thermo)}>{label(thermo)}</Chip>
            {thermo.value !== null && (
              <span className="text-xs tabular-nums text-slate-300">
                {t('pmThermoValue')}: {formatPercent(thermo.value, lang)}
              </span>
            )}
          </span>
        </div>
        <MarketThermometer reading={thermo} cfg={cfg} />
        {thermo.conflict && <p className="text-[11px] text-warning-400">{t('pmThermoConflict')}</p>}
        <p className="text-[10px] text-slate-500 leading-4">{t('pmThermoHint')}</p>
      </div>

      {/* ── دماسنج ۲: درصد روز BTC + منطق «کدام سیگنال معتبر است؟» ── */}
      <div className="rounded-lg bg-surface-100/60 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-200">
            {lang === 'fa' ? 'دماسنج درصد روز BTC' : 'BTC day-% thermometer'}
          </p>
          <span className="flex items-center gap-1.5">
            <Chip tone={thermoTone(dayThermo)}>{label(dayThermo)}</Chip>
            {dayPct !== null && (
              <span className="text-sm font-bold tabular-nums text-slate-100">
                {formatPercent(dayPct, lang)}
              </span>
            )}
          </span>
        </div>

        <MarketThermometer reading={dayThermo} cfg={cfg} />

        {/* درصد فعلی بیت‌کوین از شروع روز — زیر دماسنج */}
        <div className="rounded-md border border-surface-200/80 bg-surface-100/40 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              {lang === 'fa' ? 'درصد فعلی BTC از ابتدای روز معاملاتی' : 'Current BTC % since trading-day open'}
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                dayPct === null
                  ? 'text-slate-500'
                  : dayPct > 0
                    ? 'text-success-400'
                    : dayPct < 0
                      ? 'text-error-400'
                      : 'text-slate-200'
              }`}
            >
              {dayPct === null ? '—' : formatPercent(dayPct, lang)}
            </span>
          </div>

          {/* کلاس روز + انتخاب طبق تنظیمات selection */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4">
            {dayClass != null ? (
              <>
                <span className="text-slate-500">{t('pmDayType')}:</span>
                <span className="font-medium text-slate-200">{classLabel(dayClass)}</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500">{t('pmSelection')}:</span>
                <Chip tone={PICK_TONE[settingsPick] ?? PICK_TONE.WAIT}>
                  {settingsPick === 'original'
                    ? t('pmSelOriginal')
                    : settingsPick === 'reverse'
                      ? t('pmSelReverse')
                      : settingsPick === 'none'
                        ? t('pmSelNone')
                        : t('pmUseWait')}
                </Chip>
              </>
            ) : (
              <span className="text-slate-500">
                {live.info.state === 'PENDING' ? t('pmPending') : t('pmNoDay')}
              </span>
            )}
            {live.info.deadHours && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500">{t('pmDead')}:</span>
                <span className="text-slate-300">{deadPickHint()}</span>
              </>
            )}
          </div>

          {/* جدول کوچک همان منطق تنظیمات (فقط نمایش وضعیت فعلی) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
            {([
              'VERY_STRONG',
              'STRONG',
              'POWER',
              'MIXED',
              'NEUTRAL',
            ] as DayClass[]).map((c) => {
              const pick = cfg.selection[c];
              const active = dayClass === c && !live.info.deadHours;
              const activeDead =
                live.info.deadHours &&
                dayClass === c &&
                (cfg.selection.DEAD === 'byClass' || cfg.selection.DEAD === pick);
              const isActive = active || activeDead;
              return (
                <div
                  key={c}
                  className={`rounded px-1.5 py-1 text-[10px] leading-4 border ${
                    isActive
                      ? 'border-primary-500/40 bg-primary-500/10 text-slate-100'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  <span className="font-medium">{classLabel(c)}</span>
                  <span className="opacity-80">
                    {' → '}
                    {pick === 'original'
                      ? t('pmSelOriginal')
                      : pick === 'reverse'
                        ? t('pmSelReverse')
                        : t('pmSelNone')}
                  </span>
                </div>
              );
            })}
            <div
              className={`rounded px-1.5 py-1 text-[10px] leading-4 border ${
                live.info.deadHours
                  ? 'border-primary-500/40 bg-primary-500/10 text-slate-100'
                  : 'border-transparent text-slate-500'
              }`}
            >
              <span className="font-medium">{t('pmDead')}</span>
              <span className="opacity-80">{' → '}{deadPickHint()}</span>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 leading-4">
          {lang === 'fa'
            ? 'این دماسنج فقط درصد حرکت BTC از ۰۳:۳۰ تهران تا الان است. کلاس روز و «کدام سیگنال معتبر است» دقیقاً از همان آستانه‌ها و جدول انتخاب تنظیمات میکس محاسبه می‌شود.'
            : 'This thermometer is only the BTC move from 03:30 Tehran until now. Day class and “which signal counts” use the same thresholds and selection table as Mix settings.'}
        </p>
      </div>

      <div className={`rounded-lg border p-3 ${PICK_TONE[live.pick] || PICK_TONE.WAIT}`}>
        <p className="text-sm font-semibold">{pickLabel(live.pick)}</p>
        {live.approximate && <p className="text-[11px] mt-1 opacity-80">{t('pmApprox')}</p>}
        {live.info.deadHours && <p className="text-[11px] mt-1 opacity-80">{t('pmBasedOnDead')}</p>}
      </div>
    </Card>
  );
}

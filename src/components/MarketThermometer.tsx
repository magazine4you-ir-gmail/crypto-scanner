import { useId } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPercent } from '@/i18n/format';
import type { PowerMixConfig } from '@/powerMix/config';
import { needlePosition, thermoLevels, type ThermoReading, type ThermoZone } from '@/powerMix/thermo';

type Cfg = Pick<PowerMixConfig, 'thresholdPct' | 'strongPct'>;

const RED = '#ef4444', RED_DEEP = '#991b1b', GREEN = '#22c55e', GREEN_DEEP = '#166534', MID = '#475569';

export const ZONE_TEXT: Record<'BULL' | 'BEAR' | 'FLAT', string> = { BULL: 'text-success-400', BEAR: 'text-error-400', FLAT: 'text-slate-300' };

/** Chip tone of a thermometer reading (green = bullish, red = bearish, grey = neutral). */
export function thermoTone(r: ThermoReading): string {
  if (r.direction === 'BULL') return r.zone === 'MODERATE' ? 'bg-success-500/15 text-success-400' : 'bg-success-500/25 text-success-400';
  if (r.direction === 'BEAR') return r.zone === 'MODERATE' ? 'bg-error-500/15 text-error-400' : 'bg-error-500/25 text-error-400';
  return 'bg-surface-200 text-slate-300';
}

export function useThermoLabel() {
  const { t } = useSettings();
  return (r: ThermoReading) => {
    if (r.value === null) return t('pmThermoNoData');
    if (r.direction === 'FLAT') return t('pmThermoNeutral');
    return `${t(r.direction === 'BULL' ? 'pmThermoBull' : 'pmThermoBear')} · ${t(`pmZone${r.zone satisfies ThermoZone}`)}`;
  };
}

interface Props {
  reading: ThermoReading;
  cfg: Cfg;
  /** thin bar without labels, for lists */
  compact?: boolean;
}

/**
 * Market thermometer: a horizontal scale, red (bearish) on the left, green (bullish) on the right, grey in the middle (neutral).
 * The needle is the combined strength; the ticks are the thresholds of the settings. Always drawn left-to-right so
 * "negative = left, positive = right" holds in Persian and English alike.
 */
export function MarketThermometer({ reading, cfg, compact = false }: Props) {
  const { t, lang } = useSettings();
  const label = useThermoLabel();
  const gid = useId().replace(/:/g, '');
  const lv = thermoLevels(cfg);
  const W = 300;
  const x = (v: number) => needlePosition(v, cfg) * W;
  const needle = reading.value === null ? null : needlePosition(reading.value, cfg) * W;
  const ticks = [-lv.strong, -lv.power, lv.power, lv.strong];
  const barY = compact ? 6 : 20;
  const barH = compact ? 6 : 12;
  const height = compact ? 18 : 56;

  return (
    <div dir="ltr" className={compact ? 'w-full' : 'space-y-1'}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto" role="img" aria-label={`${t('pmThermoTitle')}: ${label(reading)}${reading.value === null ? '' : ` (${formatPercent(reading.value, lang)})`}`}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={RED_DEEP} />
            <stop offset={x(-lv.strong) / W} stopColor={RED} />
            <stop offset={x(-lv.power) / W} stopColor={MID} />
            <stop offset={x(lv.power) / W} stopColor={MID} />
            <stop offset={x(lv.strong) / W} stopColor={GREEN} />
            <stop offset="1" stopColor={GREEN_DEEP} />
          </linearGradient>
        </defs>
        <rect x="0" y={barY} width={W} height={barH} rx={barH / 2} fill={`url(#g${gid})`} />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={barY - 2} y2={barY + barH + 2} stroke="#e2e8f0" strokeOpacity="0.55" strokeWidth="1" />
            {!compact && <text x={x(v)} y={barY + barH + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">{`${v > 0 ? '+' : ''}${v}`}</text>}
          </g>
        ))}
        <line x1={W / 2} x2={W / 2} y1={barY - 3} y2={barY + barH + 3} stroke="#e2e8f0" strokeOpacity="0.9" strokeWidth="1.5" />
        {needle !== null && (
          compact
            ? <circle cx={needle} cy={barY + barH / 2} r="5" fill="#f8fafc" stroke="#0f172a" strokeWidth="1.5" />
            : <polygon points={`${needle - 6},${barY - 12} ${needle + 6},${barY - 12} ${needle},${barY - 1}`} fill="#f8fafc" stroke="#0f172a" strokeWidth="1" />
        )}
        {needle !== null && !compact && <line x1={needle} x2={needle} y1={barY - 1} y2={barY + barH + 1} stroke="#f8fafc" strokeWidth="2" />}
      </svg>
      {!compact && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-error-400">{t('pmThermoBear')}</span>
          <span className="text-slate-400">{t('pmThermoNeutral')}</span>
          <span className="text-success-400">{t('pmThermoBull')}</span>
        </div>
      )}
    </div>
  );
}

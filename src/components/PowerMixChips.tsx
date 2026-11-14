import { Chip } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import type { DayClass } from '@/powerMix/config';
import type { SignalDayInfo } from '@/powerMix/dayPower';

const CLASS_TONE: Record<DayClass, string> = {
  VERY_STRONG: 'bg-success-500/20 text-success-400',
  POWER: 'bg-primary-500/20 text-primary-300',
  MIXED: 'bg-warning-500/20 text-warning-400',
  NEUTRAL: 'bg-surface-200 text-slate-300',
};

/** The day label of a signal / of today: class (or pending / no data), dead hours, low volume, approximate tendency. */
export function DayChips({ info }: { info: SignalDayInfo }) {
  const { t } = useSettings();
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {info.state === 'FINAL' && info.dayClass && <Chip tone={CLASS_TONE[info.dayClass]}>{t(`pmClass${info.dayClass}`)}</Chip>}
      {info.state === 'PENDING' && <Chip tone="bg-warning-500/20 text-warning-400">{t('pmPending')}</Chip>}
      {info.state === 'PENDING' && info.tendency && <Chip>{t(`pmTend${info.tendency}`)}</Chip>}
      {info.state === 'NO_DATA' && <Chip tone="bg-surface-200 text-slate-500">{t('pmNoDay')}</Chip>}
      {info.deadHours && <Chip tone="bg-surface-200 text-slate-400">{t('pmDead')}</Chip>}
      {info.lowVolume && <Chip tone="bg-warning-500/10 text-warning-400">{t('pmLowVolume')}</Chip>}
    </div>
  );
}

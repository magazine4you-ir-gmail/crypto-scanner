import { Card, SectionTitle } from '@/components/UI';
import { useSettings } from '@/contexts/SettingsContext';
import { formatNumber, formatPercent } from '@/i18n/format';
import type { OutcomeStats } from '@/services/outcomeService';

interface Props {
  original: OutcomeStats;
  reverse: OutcomeStats;
  mix: OutcomeStats;
  active: 'MIX' | 'ORIGINAL' | 'REVERSE';
}

/** Compact three-column comparison: original only | reverse only | smart mix, on the same (filtered) signals. */
export function PowerMixCompare({ original, reverse, mix, active }: Props) {
  const { t, lang } = useSettings();
  const cols = [
    { key: 'ORIGINAL', title: t('pmViewOriginal'), s: original },
    { key: 'REVERSE', title: t('pmViewReverse'), s: reverse },
    { key: 'MIX', title: t('pmViewMix'), s: mix },
  ] as const;
  const tone = (good: boolean) => (good ? 'text-success-400' : 'text-error-400');
  const pf = (v: number) => (v === Infinity ? '∞' : formatNumber(v, lang, 2));
  const rows: { label: string; cell: (s: OutcomeStats) => { text: string; cls?: string } }[] = [
    { label: t('pmClosed'), cell: (s) => ({ text: formatNumber(s.totalClosed, lang, 0) }) },
    { label: t('winRate'), cell: (s) => ({ text: formatPercent(s.winRate, lang), cls: tone(s.winRate >= s.breakEvenWinRate) }) },
    { label: `${t('win')} / ${t('loss')} / ${t('slExpired')}`, cell: (s) => ({ text: `${s.wins} / ${s.losses} / ${s.expired}` }) },
    { label: t('expectancyR'), cell: (s) => ({ text: `${s.expectancyR >= 0 ? '+' : ''}${formatNumber(s.expectancyR, lang, 2)}R`, cls: tone(s.expectancyR >= 0) }) },
    { label: t('profitFactor'), cell: (s) => ({ text: pf(s.profitFactor), cls: tone(s.profitFactor >= 1) }) },
    { label: t('totalPnl'), cell: (s) => ({ text: formatPercent(s.totalPnl, lang), cls: tone(s.totalPnl >= 0) }) },
  ];

  return (
    <Card className="!p-4">
      <SectionTitle className="!text-base !mb-3">{t('pmCompareTitle')}</SectionTitle>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-sm min-w-[22rem]">
          <thead>
            <tr>
              <th className="text-start text-[11px] font-normal text-slate-500 pb-2" />
              {cols.map((c) => (
                <th key={c.key} className={`text-end text-xs font-semibold pb-2 px-2 ${active === c.key ? 'text-primary-400' : 'text-slate-300'}`}>{c.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-surface-200">
                <td className="py-1.5 text-xs text-slate-400 pe-2">{r.label}</td>
                {cols.map((c) => {
                  const v = r.cell(c.s);
                  return (
                    <td key={c.key} className={`py-1.5 px-2 text-end tabular-nums whitespace-nowrap ${active === c.key ? 'bg-primary-600/10 font-semibold' : ''} ${v.cls ?? 'text-slate-200'}`}>
                      {v.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

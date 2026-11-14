// Stat tile + breakdown card — the same look as the ones inside Signal Lab (copied so Signal Lab itself stays untouched).
import { Card, SectionTitle } from '@/components/UI';
import { useSettings } from '@/contexts/SettingsContext';
import { formatNumber, formatPercent } from '@/i18n/format';

export function Stat({ label, value, hint, color = 'text-slate-100' }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Card className="!p-3 sm:!p-4">
      <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{hint}</p>}
    </Card>
  );
}

export function BucketCard({
  title, data, order, upper = false, labels = {},
}: {
  title: string;
  data: Record<string, { wins: number; losses: number; expired: number; winRate: number; avgR: number }>;
  order: string[];
  upper?: boolean;
  labels?: Record<string, string>;
}) {
  const { lang } = useSettings();
  const keys = order.filter((k) => data[k]);
  return (
    <Card className="!p-4">
      <SectionTitle className="!text-base !mb-3">{title}</SectionTitle>
      <div className="space-y-2">
        {keys.length === 0 && <p className="text-sm text-slate-500">—</p>}
        {keys.map((k) => {
          const v = data[k];
          return (
            <div key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className={`text-slate-300 ${upper ? 'uppercase' : ''}`}>{labels[k] ?? k}</span>
              <span className="text-slate-400 text-xs sm:text-sm text-end">
                {v.wins}W / {v.losses}L{v.expired ? ` / ${v.expired}E` : ''} · {formatPercent(v.winRate, lang)} ·{' '}
                <span className={v.avgR >= 0 ? 'text-success-400' : 'text-error-400'}>
                  {v.avgR >= 0 ? '+' : ''}{formatNumber(v.avgR, lang, 2)}R
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

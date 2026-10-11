import type { ReactNode } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { formatDate, timeAgo } from '@/i18n/format';

/** Small label + value pair used inside mobile cards. */
export function Metric({ label, value, tone = 'text-slate-200' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] leading-4 text-slate-500 truncate">{label}</p>
      <p className={`text-sm font-medium tabular-nums truncate ${tone}`}>{value}</p>
    </div>
  );
}

/** "3 hours ago" with the exact date underneath, so order and timing are always visible. */
export function TimeStamp({ value, label, compact = false }: { value: string | number | null | undefined; label?: string; compact?: boolean }) {
  const { lang } = useSettings();
  if (value === null || value === undefined) return <span className="text-slate-500">—</span>;
  return (
    <span className="block min-w-0" title={formatDate(value, lang)}>
      {label && <span className="block text-[11px] leading-4 text-slate-500">{label}</span>}
      <span className="block text-sm text-slate-200 leading-5">{timeAgo(value, lang)}</span>
      {!compact && <span className="block text-[11px] leading-4 text-slate-500">{formatDate(value, lang)}</span>}
    </span>
  );
}

export function Chip({ children, tone = 'bg-surface-200 text-slate-300' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold uppercase ${tone}`}>{children}</span>;
}

/** Horizontally scrollable pill row (tabs/filters) that never wraps into several lines on phones. */
export function PillRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">{children}</div>;
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${
        active ? 'bg-primary-600/20 text-primary-400 border-primary-500/30' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-surface-100'
      }`}
    >
      {children}
    </button>
  );
}

import type { Lang } from './translations';

export function formatPrice(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  let fractionDigits = 2;
  const abs = Math.abs(value);
  if (abs < 1) fractionDigits = 6;
  else if (abs < 10) fractionDigits = 4;
  else if (abs < 1000) fractionDigits = 2;
  else if (abs >= 1_000_000) fractionDigits = 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, lang: Lang, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatted}%`;
}

export function formatCompact(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: string | Date | number, lang: Lang): string {
  const d = typeof date === 'string' ? new Date(date) : typeof date === 'number' ? new Date(date) : date;
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDateShort(date: string | Date | number, lang: Lang): string {
  const d = typeof date === 'string' ? new Date(date) : typeof date === 'number' ? new Date(date) : date;
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** "3 ساعت پیش" / "3 hours ago" — works for past and future timestamps. */
export function timeAgo(date: string | Date | number, lang: Lang): string {
  const ts = typeof date === 'string' ? new Date(date).getTime() : typeof date === 'number' ? date : date.getTime();
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'fa' ? 'fa' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

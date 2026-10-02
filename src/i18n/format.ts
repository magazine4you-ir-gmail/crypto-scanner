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

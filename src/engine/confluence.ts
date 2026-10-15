import { baseOf, quoteOf, type QuoteAsset } from '@engine';

/**
 * Cross-quote confluence.
 *
 * The same coin is analysed twice: against the dollar (ETHUSDT) and against bitcoin (ETHBTC).
 * The two answers mean different things, so putting them side by side is more informative than either alone:
 *
 *   USDT BUY  + BTC BUY   -> STRONG_BUY          rising in dollars AND beating bitcoin (a leader)
 *   USDT SELL + BTC SELL  -> STRONG_SELL         falling in dollars AND losing to bitcoin (a laggard)
 *   USDT BUY  + BTC SELL  -> LAGGING_BUY         up only because bitcoin lifts everything; it underperforms BTC
 *   USDT SELL + BTC BUY   -> RELATIVE_STRENGTH   down in dollars but holding up better than bitcoin
 *   only one of the two is a BUY/SELL -> USDT_ONLY / BTC_ONLY
 */

export type SignalKind = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE' | 'EXIT';

export type ConfluenceKind = 'STRONG_BUY' | 'STRONG_SELL' | 'LAGGING_BUY' | 'RELATIVE_STRENGTH' | 'USDT_ONLY' | 'BTC_ONLY' | 'NONE';

export interface LegInput {
  symbol: string;
  timeframe: string;
  signalType: string;
  score: number;
}

export interface Leg {
  symbol: string;
  quote: QuoteAsset;
  signalType: SignalKind;
  score: number;
}

export interface Confluence {
  base: string;
  timeframe: string;
  usdt: Leg | null;
  btc: Leg | null;
  kind: ConfluenceKind;
  /** Score used to rank the coin: the better leg, plus a bonus when both legs agree. */
  combinedScore: number;
  /** Both legs are actionable and point the same way. */
  aligned: boolean;
}

const isAction = (t: string | undefined): t is 'BUY' | 'SELL' => t === 'BUY' || t === 'SELL';

export function confluenceKey(symbol: string, timeframe: string): string {
  return `${baseOf(symbol)}|${timeframe}`;
}

export function classify(usdt: Leg | null, btc: Leg | null): ConfluenceKind {
  const u = isAction(usdt?.signalType) ? usdt!.signalType : null;
  const b = isAction(btc?.signalType) ? btc!.signalType : null;
  if (u && b) {
    if (u === 'BUY' && b === 'BUY') return 'STRONG_BUY';
    if (u === 'SELL' && b === 'SELL') return 'STRONG_SELL';
    return u === 'BUY' ? 'LAGGING_BUY' : 'RELATIVE_STRENGTH';
  }
  if (u) return 'USDT_ONLY';
  if (b) return 'BTC_ONLY';
  return 'NONE';
}

/** Groups rows by coin + timeframe and classifies each group. Works for the manual scan and the auto scan alike. */
export function computeConfluence(rows: LegInput[]): Map<string, Confluence> {
  const groups = new Map<string, { base: string; timeframe: string; usdt: Leg | null; btc: Leg | null }>();
  for (const r of rows) {
    const key = confluenceKey(r.symbol, r.timeframe);
    let g = groups.get(key);
    if (!g) {
      g = { base: baseOf(r.symbol), timeframe: r.timeframe, usdt: null, btc: null };
      groups.set(key, g);
    }
    const quote = quoteOf(r.symbol);
    const leg: Leg = { symbol: r.symbol, quote, signalType: r.signalType as SignalKind, score: r.score };
    if (quote === 'BTC') g.btc = leg;
    else g.usdt = leg;
  }

  const out = new Map<string, Confluence>();
  for (const [key, g] of groups) {
    const kind = classify(g.usdt, g.btc);
    const aligned = kind === 'STRONG_BUY' || kind === 'STRONG_SELL';
    const best = Math.max(isAction(g.usdt?.signalType) ? g.usdt!.score : 0, isAction(g.btc?.signalType) ? g.btc!.score : 0);
    out.set(key, { ...g, kind, aligned, combinedScore: Math.min(100, best + (aligned ? 5 : 0)) });
  }
  return out;
}

export function confluenceFor(map: Map<string, Confluence>, symbol: string, timeframe: string): Confluence | null {
  return map.get(confluenceKey(symbol, timeframe)) ?? null;
}

/** Kinds worth highlighting in the UI (everything that involves BOTH quotes being actionable). */
export function isDualSignal(c: Confluence | null): c is Confluence {
  return c !== null && (c.kind === 'STRONG_BUY' || c.kind === 'STRONG_SELL' || c.kind === 'LAGGING_BUY' || c.kind === 'RELATIVE_STRENGTH');
}

export const CONFLUENCE_TEXT: Record<Exclude<ConfluenceKind, 'NONE'>, { fa: string; en: string; hintFa: string; hintEn: string; tone: string }> = {
  STRONG_BUY: {
    fa: 'خرید قوی (USDT + BTC)',
    en: 'Strong buy (USDT + BTC)',
    hintFa: 'هم در برابر دلار صعودی است، هم قوی‌تر از بیت‌کوین. معمولاً ارز پیشرو.',
    hintEn: 'Rising in dollars AND outperforming bitcoin: usually a leader.',
    tone: 'bg-success-500/25 text-success-300 border border-success-500/40',
  },
  STRONG_SELL: {
    fa: 'فروش قوی (USDT + BTC)',
    en: 'Strong sell (USDT + BTC)',
    hintFa: 'هم در برابر دلار ضعیف است، هم از بیت‌کوین عقب‌تر. ارز ضعیف.',
    hintEn: 'Weak in dollars AND losing to bitcoin: a laggard.',
    tone: 'bg-error-500/25 text-error-300 border border-error-500/40',
  },
  LAGGING_BUY: {
    fa: 'خرید USDT، ضعیف‌تر از BTC',
    en: 'USDT buy, lagging BTC',
    hintFa: 'احتمالاً فقط به‌خاطر صعود بیت‌کوین بالا می‌رود و از آن عقب می‌ماند. ریسک بیشتر.',
    hintEn: 'Likely rising only because bitcoin lifts the market, while underperforming it. Riskier.',
    tone: 'bg-warning-500/20 text-warning-300 border border-warning-500/40',
  },
  RELATIVE_STRENGTH: {
    fa: 'قدرت نسبی در برابر BTC',
    en: 'Relative strength vs BTC',
    hintFa: 'در دلار ضعیف است ولی نسبت به بیت‌کوین بهتر عمل می‌کند. بیشتر برای جابه‌جایی به BTC/آلت مفید است.',
    hintEn: 'Weak in dollars but holding up better than bitcoin. More useful for rotation than outright buying.',
    tone: 'bg-accent-500/20 text-accent-300 border border-accent-500/40',
  },
  USDT_ONLY: {
    fa: 'فقط USDT',
    en: 'USDT only',
    hintFa: 'سیگنال فقط روی جفت دلاری است.',
    hintEn: 'The signal exists on the dollar pair only.',
    tone: 'bg-surface-300 text-slate-300',
  },
  BTC_ONLY: {
    fa: 'فقط BTC',
    en: 'BTC only',
    hintFa: 'سیگنال فقط روی جفت بیت‌کوینی است.',
    hintEn: 'The signal exists on the bitcoin pair only.',
    tone: 'bg-surface-300 text-slate-300',
  },
};

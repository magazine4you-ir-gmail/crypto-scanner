import { baseOf, quoteOf, type QuoteAsset } from '@engine';
import { useSettings } from '@/contexts/SettingsContext';
import { CONFLUENCE_TEXT, type Confluence, type Leg } from '@/engine/confluence';

/** Small chip showing the quote currency of a pair (USDT / BTC). */
export function QuoteChip({ quote }: { quote: QuoteAsset }) {
  const tone = quote === 'BTC' ? 'bg-warning-500/20 text-warning-300' : 'bg-success-500/15 text-success-300';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${tone}`}>{quote}</span>;
}

/** "ETH" + quote chip, for tables and cards. */
export function PairLabel({ symbol, className = '' }: { symbol: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{baseOf(symbol)}</span>
      <QuoteChip quote={quoteOf(symbol)} />
    </span>
  );
}

function LegText({ leg, label }: { leg: Leg | null; label: string }) {
  if (!leg) return <span className="text-slate-500">{label}: —</span>;
  const tone = leg.signalType === 'BUY' ? 'text-success-400' : leg.signalType === 'SELL' ? 'text-error-400' : 'text-slate-400';
  return (
    <span className={tone}>
      {label}: {leg.signalType === 'NO_TRADE' ? '–' : leg.signalType}
      {leg.signalType === 'BUY' || leg.signalType === 'SELL' ? ` ${leg.score}` : ''}
    </span>
  );
}

/**
 * Highlights a coin that has a signal on BOTH its dollar pair and its bitcoin pair
 * (or only on one of them, in the muted variants).
 */
export function ConfluenceBadge({ c, showLegs = false }: { c: Confluence; showLegs?: boolean }) {
  const { lang } = useSettings();
  if (c.kind === 'NONE') return null;
  const txt = CONFLUENCE_TEXT[c.kind];
  return (
    <span className="inline-flex flex-col gap-0.5 align-top">
      <span
        title={lang === 'fa' ? txt.hintFa : txt.hintEn}
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${txt.tone}`}
      >
        {lang === 'fa' ? txt.fa : txt.en}
      </span>
      {showLegs && (
        <span className="text-[10px] leading-3 text-slate-400 tabular-nums" dir="ltr">
          <LegText leg={c.usdt} label="USDT" /> · <LegText leg={c.btc} label="BTC" />
        </span>
      )}
    </span>
  );
}

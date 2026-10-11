import { useState } from 'react';
import { Crosshair, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { trackSignal, TRACKABLE_TIMEFRAMES, type TrackResult } from '@/services/trackService';

interface Props {
  symbol: string;
  timeframe: string;
  signalType: string;
  compact?: boolean;
}

/**
 * "Track this signal" — registers a paper trade in Signal Lab (source: manual tracking).
 * Renders nothing for non-actionable signals, unsupported timeframes or signed-out users.
 */
export function TrackButton({ symbol, timeframe, signalType, compact = false }: Props) {
  const { t } = useSettings();
  const { user } = useAuth();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  if (!user || (signalType !== 'BUY' && signalType !== 'SELL') || !TRACKABLE_TIMEFRAMES.includes(timeframe)) return null;

  const describe = (r: TrackResult): { text: string; error: boolean } => {
    if (r.ok) return { text: r.already ? t('trackAlready') : t('trackDone'), error: false };
    switch (r.reason) {
      case 'not_actionable':
        return { text: t('trackNotActionable'), error: true };
      case 'limit_open':
        return { text: `${t('trackLimitOpen')} (${r.limit ?? 20})`, error: true };
      case 'limit_day':
        return { text: `${t('trackLimitDay')} (${r.limit ?? 50})`, error: true };
      case 'data_not_ready':
        return { text: t('trackDataNotReady'), error: true };
      case 'unauthorized':
        return { text: t('asLoginRequired'), error: true };
      default:
        return { text: t('trackFailed'), error: true };
    }
  };

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (state !== 'idle') return;
    setState('loading');
    setMessage(null);
    const r = await trackSignal(symbol, timeframe);
    const d = describe(r);
    setMessage(d.text);
    setIsError(d.error);
    setState(r.ok ? 'done' : 'idle');
  };

  return (
    <span className="inline-flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onClick}
        disabled={state !== 'idle'}
        className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        } ${
          state === 'done'
            ? 'border-success-500/30 bg-success-500/10 text-success-400'
            : 'border-primary-500/30 bg-primary-600/10 text-primary-400 hover:bg-primary-600/20'
        } disabled:opacity-80`}
      >
        {state === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : state === 'done' ? <Check className="w-3.5 h-3.5" /> : <Crosshair className="w-3.5 h-3.5" />}
        {state === 'done' ? t('trackTracked') : t('trackSignal')}
      </button>
      {message && <span className={`text-[11px] leading-4 ${isError ? 'text-warning-400' : 'text-success-400'}`}>{message}</span>}
    </span>
  );
}

import { useEffect, useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchCoinGeckoMarkets, fetchProviderStatus } from '@/services/marketData';
import { fetchRecentActionable, type ScanResultRow } from '@/services/scanService';
import { fetchKlines } from '@/services/marketData';
import { detectRegime, closedCandles } from '@engine';
import type { CoinMarketData, ProviderStatus } from '@/types/market';
import type { MarketRegime } from '@/types/signal';
import { useNavigate } from 'react-router-dom';
import { TimeStamp, Chip } from '@/components/Responsive';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { SignalBadge, RegimeBadge } from '@/components/Badges';
import { formatPrice, formatPercent, formatCompact, formatDate } from '@/i18n/format';
import { Bitcoin, TrendingUp, Activity, Server } from 'lucide-react';

export function DashboardPage() {
  const { t, lang } = useSettings();
  const [markets, setMarkets] = useState<CoinMarketData[]>([]);
  const navigate = useNavigate();
  const [signals, setSignals] = useState<ScanResultRow[]>([]);
  const [btcRegime, setBtcRegime] = useState<MarketRegime>('UNCLEAR');
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mk, sig, st, btc] = await Promise.all([
        fetchCoinGeckoMarkets(20, 1).catch(() => []),
        fetchRecentActionable(10).catch(() => [] as ScanResultRow[]),
        fetchProviderStatus().catch(() => null),
        fetchKlines('BTCUSDT', '1d', 300).catch(() => []),
      ]);
      setMarkets(mk);
      setSignals(sig);
      setStatus(st);
      if (btc.length > 0) setBtcRegime(detectRegime(closedCandles(btc), '1d').regime);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const btc = markets.find((m) => m.symbol === 'btc');
  const eth = markets.find((m) => m.symbol === 'eth');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">{t('dashboard')}</h1>

      {/* Market Overview */}
      <div>
        <SectionTitle>{t('marketOverview')}</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MarketCard icon={Bitcoin} name="BTC" price={btc?.current_price ?? null} change={btc?.price_change_percentage_24h ?? null} lang={lang} />
          <MarketCard icon={TrendingUp} name="ETH" price={eth?.current_price ?? null} change={eth?.price_change_percentage_24h ?? null} lang={lang} />
          <Card>
            <p className="text-xs text-slate-400 mb-1">{t('btcRegime')}</p>
            <RegimeBadge regime={btcRegime} />
          </Card>
          <Card>
            <p className="text-xs text-slate-400 mb-1">{t('lastUpdate')}</p>
            <p className="text-sm font-medium text-slate-200">{formatDate(Date.now(), lang)}</p>
          </Card>
        </div>
      </div>

      {/* Top Markets */}
      <div>
        <SectionTitle>{t('assets')}</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {markets.slice(0, 9).map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {m.image && <img src={m.image} alt={m.symbol} className="w-6 h-6 rounded-full" loading="lazy" />}
                  <span className="font-semibold text-slate-100 uppercase">{m.symbol}</span>
                  <span className="text-xs text-slate-500">#{m.market_cap_rank}</span>
                </div>
                <span className={`text-sm font-medium ${(m.price_change_percentage_24h ?? 0) >= 0 ? 'text-success-400' : 'text-error-400'}`}>
                  {formatPercent(m.price_change_percentage_24h, lang)}
                </span>
              </div>
              <p className="text-lg font-bold text-slate-100">{formatPrice(m.current_price, lang)}</p>
              <p className="text-xs text-slate-400 mt-1">{t('marketCap')}: {formatCompact(m.market_cap, lang)}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Signals */}
      <div>
        <SectionTitle>{t('recentSignals')}</SectionTitle>
        {signals.length === 0 ? (
          <EmptyState message={t('noSignalsYet2')} />
        ) : (
          <div className="space-y-2">
            {signals.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/asset/${s.symbol}?tf=${s.timeframe}`)}
                className="card w-full text-start p-3 flex items-center justify-between gap-3 hover:bg-surface-100 active:bg-surface-100 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-100">{s.base_asset}</span>
                    <Chip>{s.timeframe}</Chip>
                    <SignalBadge type={s.signal_type} />
                  </div>
                  <div className="mt-1.5"><TimeStamp value={s.signal_since} /></div>
                </div>
                <div className="text-end shrink-0">
                  <p className="text-sm font-semibold text-slate-100 tabular-nums">{formatPrice(s.price, lang)}</p>
                  <p className="text-xs text-slate-400 tabular-nums mt-0.5">{t('score')}: {s.score}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Provider Status */}
      {status && (
        <div>
          <SectionTitle>{t('providerStatus')}</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ProviderCard name={t('binance')} configured={status.binance.configured} reachable={status.binance.reachable} icon={Server} t={t} />
            <ProviderCard name={t('coingecko')} configured={status.coingecko.configured} reachable={status.coingecko.reachable} icon={Activity} t={t} />
            <ProviderCard name={t('coinmarketcap')} configured={status.coinmarketcap.configured} reachable={status.coinmarketcap.reachable} icon={Server} t={t} />
          </div>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

interface MarketCardProps {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  price: number | null;
  change: number | null;
  lang: 'fa' | 'en';
}

function MarketCard({ icon: Icon, name, price, change, lang }: MarketCardProps) {
  const positive = (change ?? 0) >= 0;
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5 text-primary-400" />
        <span className="text-sm text-slate-400">{name}</span>
      </div>
      <p className="text-xl font-bold text-slate-100">{formatPrice(price, lang)}</p>
      <p className={`text-sm font-medium mt-1 ${positive ? 'text-success-400' : 'text-error-400'}`}>
        {formatPercent(change, lang)}
      </p>
    </Card>
  );
}

interface ProviderCardProps {
  name: string;
  configured: boolean;
  reachable: boolean;
  icon: React.ComponentType<{ className?: string }>;
  t: (k: string) => string;
}

function ProviderCard({ name, configured, reachable, icon: Icon, t }: ProviderCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-slate-400" />
          <span className="font-medium text-slate-200">{name}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs px-2 py-0.5 rounded-full ${configured ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}`}>
            {configured ? t('configured') : t('notConfigured')}
          </span>
          {configured && (
            <span className={`text-xs flex items-center gap-1 ${reachable ? 'text-success-400' : 'text-error-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${reachable ? 'bg-success-400' : 'bg-error-400'} animate-pulse-soft`} />
              {reachable ? t('reachable') : t('unreachable')}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

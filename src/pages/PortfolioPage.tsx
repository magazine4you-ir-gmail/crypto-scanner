import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  getHoldings, addHolding, updateHolding, deleteHolding,
  type PortfolioHolding,
} from '@/services/portfolioService';
import { fetchCoinGeckoMarkets } from '@/services/marketData';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { formatPrice, formatCompact, formatPercent } from '@/i18n/format';
import { Briefcase, Plus, Trash2, X } from 'lucide-react';

interface HoldingWithPrice extends PortfolioHolding {
  currentPrice: number | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
}

export function PortfolioPage() {
  const { t, lang } = useSettings();
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newPrice, setNewPrice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await getHoldings();
      const markets = await fetchCoinGeckoMarkets(100, 1).catch(() => []);
      const priceMap = new Map<string, number>();
      for (const m of markets) {
        priceMap.set(m.symbol.toUpperCase(), m.current_price);
      }
      const enriched: HoldingWithPrice[] = raw.map((h) => {
        const currentPrice = priceMap.get(h.symbol.toUpperCase()) ?? null;
        const marketValue = currentPrice !== null ? currentPrice * h.quantity : null;
        const pnl = marketValue !== null ? marketValue - h.avg_entry_price * h.quantity : null;
        const pnlPct = pnl !== null ? (pnl / (h.avg_entry_price * h.quantity)) * 100 : null;
        return { ...h, currentPrice, marketValue, pnl, pnlPct };
      });
      setHoldings(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!newSymbol.trim() || !newQty || !newPrice) return;
    try {
      await addHolding(newSymbol.trim().toUpperCase(), Number(newQty), Number(newPrice));
      setNewSymbol('');
      setNewQty('');
      setNewPrice('');
      setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteHolding(id);
      setHoldings((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const totalValue = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const totalPnl = holdings.reduce((sum, h) => sum + (h.pnl ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Briefcase className="w-6 h-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-slate-100">{t('portfolioTitle')}</h1>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm">
          <Plus className="w-4 h-4 inline me-1" /> {t('addHolding')}
        </button>
      </div>

      {/* Summary */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <p className="text-xs text-slate-400 mb-1">{t('totalValue')}</p>
            <p className="text-2xl font-bold text-slate-100">{formatPrice(totalValue, lang)}</p>
          </Card>
          <Card>
            <p className="text-xs text-slate-400 mb-1">{t('unrealizedPnl')}</p>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-success-400' : 'text-error-400'}`}>
              {formatPrice(totalPnl, lang)}
            </p>
          </Card>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('asset')}</label>
              <input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} className="input-field text-sm" placeholder="BTC" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('quantity')}</label>
              <input type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} className="input-field text-sm" placeholder="0.5" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('avgEntry')}</label>
              <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="input-field text-sm" placeholder="40000" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} className="btn-primary text-sm flex-1">{t('save')}</button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary text-sm px-3"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </Card>
      )}

      {/* Holdings */}
      {holdings.length === 0 ? (
        <EmptyState message={t('noHoldings')} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-100 dark:bg-surface-100 text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t('asset')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('quantity')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('avgEntry')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('price')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('totalValue')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('unrealizedPnl')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {holdings.map((h) => (
                  <tr key={h.id} className="hover:bg-surface-100 dark:hover:bg-surface-100">
                    <td className="px-4 py-3 font-semibold text-slate-100 uppercase">{h.symbol}</td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">{h.quantity}</td>
                    <td className="px-4 py-3 text-slate-300 hidden sm:table-cell tabular-nums">{formatPrice(h.avg_entry_price, lang)}</td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">{formatPrice(h.currentPrice, lang)}</td>
                    <td className="px-4 py-3 text-slate-300 hidden sm:table-cell tabular-nums">{formatPrice(h.marketValue, lang)}</td>
                    <td className="px-4 py-3">
                      <span className={`tabular-nums font-medium ${h.pnlPct !== null && h.pnlPct >= 0 ? 'text-success-400' : 'text-error-400'}`}>
                        {formatPercent(h.pnlPct, lang)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(h.id)} className="p-1 text-slate-500 hover:text-error-400 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  getWatchlists, createWatchlist, renameWatchlist, deleteWatchlist,
  getWatchlistItems, addWatchlistItem, removeWatchlistItem,
  type Watchlist, type WatchlistItem,
} from '@/services/watchlistService';
import { fetchCoinGeckoMarkets } from '@/services/marketData';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { Star, Plus, Pencil, Trash2, X, Check } from 'lucide-react';

export function WatchlistPage() {
  const { t, lang } = useSettings();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [addingSymbol, setAddingSymbol] = useState('');
  const [marketSymbols, setMarketSymbols] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lists = await getWatchlists();
      setWatchlists(lists);
      if (lists.length > 0 && !activeId) {
        setActiveId(lists[0].id);
      }
      const markets = await fetchCoinGeckoMarkets(50, 1).catch(() => []);
      setMarketSymbols(markets.map((m) => m.symbol.toUpperCase()));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!activeId) {
      setItems([]);
      return;
    }
    getWatchlistItems(activeId).then(setItems).catch(() => setItems([]));
  }, [activeId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createWatchlist(newName.trim());
      if (created) {
        setNewName('');
        setCreating(false);
        await load();
        setActiveId(created.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      await renameWatchlist(id, renameValue.trim());
      setRenamingId(null);
      setRenameValue('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWatchlist(id);
      if (activeId === id) setActiveId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleAddSymbol = async () => {
    if (!activeId || !addingSymbol.trim()) return;
    try {
      await addWatchlistItem(activeId, addingSymbol.trim().toUpperCase());
      setAddingSymbol('');
      const updated = await getWatchlistItems(activeId);
      setItems(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await removeWatchlistItem(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Star className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('watchlist')}</h1>
      </div>

      {/* Watchlist tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {watchlists.map((wl) => (
          <div key={wl.id} className="flex items-center gap-1">
            {renamingId === wl.id ? (
              <div className="flex items-center gap-1">
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="input-field text-sm py-1 px-2 w-32"
                  autoFocus
                />
                <button onClick={() => handleRename(wl.id)} className="p-1 text-success-400 hover:bg-surface-100 rounded">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setRenamingId(null)} className="p-1 text-slate-400 hover:bg-surface-100 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveId(wl.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeId === wl.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-100 dark:bg-surface-100 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {wl.name}
                </button>
                <button
                  onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name); }}
                  className="p-1 text-slate-500 hover:text-slate-300 rounded"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(wl.id)}
                  className="p-1 text-slate-500 hover:text-error-400 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="input-field text-sm py-1 px-2 w-32"
              placeholder={t('watchlistName')}
              autoFocus
            />
            <button onClick={handleCreate} className="p-1 text-success-400 hover:bg-surface-100 rounded">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => setCreating(false)} className="p-1 text-slate-400 hover:bg-surface-100 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-100 text-slate-400 hover:text-slate-200"
          >
            <Plus className="w-4 h-4" /> {t('createWatchlist')}
          </button>
        )}
      </div>

      {/* Add symbol */}
      {activeId && (
        <Card>
          <div className="flex items-center gap-2">
            <input
              value={addingSymbol}
              onChange={(e) => setAddingSymbol(e.target.value)}
              className="input-field text-sm"
              placeholder={t('addAsset') + ' (e.g. BTC, ETH)'}
              list="market-symbols"
            />
            <datalist id="market-symbols">
              {marketSymbols.map((s) => <option key={s} value={s} />)}
            </datalist>
            <button onClick={handleAddSymbol} className="btn-primary text-sm whitespace-nowrap">
              <Plus className="w-4 h-4 inline me-1" /> {t('addAsset')}
            </button>
          </div>
        </Card>
      )}

      {/* Items */}
      {activeId ? (
        items.length === 0 ? (
          <EmptyState message={t('noWatchlists')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((item) => (
              <Card key={item.id} className="p-4 flex items-center justify-between">
                <span className="font-semibold text-slate-100 uppercase">{item.symbol}</span>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="p-1.5 text-slate-500 hover:text-error-400 rounded-lg hover:bg-surface-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Card>
            ))}
          </div>
        )
      ) : (
        watchlists.length === 0 && <EmptyState message={t('noWatchlists')} />
      )}

      <Disclaimer />
    </div>
  );
}

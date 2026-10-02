import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  getJournalEntries, addJournalEntry, updateJournalEntry, deleteJournalEntry,
  type JournalEntry,
} from '@/services/journalService';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { formatDate } from '@/i18n/format';
import { BookOpen, Plus, Trash2, X } from 'lucide-react';

export function JournalPage() {
  const { t, lang } = useSettings();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    asset: '',
    side: 'BUY' as 'BUY' | 'SELL',
    entry_price: '',
    exit_price: '',
    size: '',
    result: 'OPEN' as 'OPEN' | 'WIN' | 'LOSS' | 'BREAKEVEN',
    strategy: '',
    notes: '',
    trade_date: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJournalEntries();
      setEntries(data);
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
    if (!form.asset.trim() || !form.entry_price || !form.size) return;
    try {
      await addJournalEntry({
        asset: form.asset.trim().toUpperCase(),
        side: form.side,
        entry_price: Number(form.entry_price),
        exit_price: form.exit_price ? Number(form.exit_price) : null,
        size: Number(form.size),
        result: form.result,
        strategy: form.strategy || null,
        notes: form.notes || null,
        trade_date: form.trade_date,
      });
      setForm({
        asset: '', side: 'BUY', entry_price: '', exit_price: '', size: '',
        result: 'OPEN', strategy: '', notes: '', trade_date: new Date().toISOString().slice(0, 10),
      });
      setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteJournalEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    }
  };

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const resultColor = (r: string) => {
    if (r === 'WIN') return 'text-success-400';
    if (r === 'LOSS') return 'text-error-400';
    if (r === 'BREAKEVEN') return 'text-slate-400';
    return 'text-warning-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-slate-100">{t('journalTitle')}</h1>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm">
          <Plus className="w-4 h-4 inline me-1" /> {t('addEntry')}
        </button>
      </div>

      {showAdd && (
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('asset')}</label>
              <input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} className="input-field text-sm" placeholder="BTC" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('side')}</label>
              <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as any })} className="input-field text-sm">
                <option value="BUY">{t('buy')}</option>
                <option value="SELL">{t('bearish')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('date')}</label>
              <input type="date" value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('entry')}</label>
              <input type="number" value={form.entry_price} onChange={(e) => setForm({ ...form, entry_price: e.target.value })} className="input-field text-sm" placeholder="40000" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('exit')}</label>
              <input type="number" value={form.exit_price} onChange={(e) => setForm({ ...form, exit_price: e.target.value })} className="input-field text-sm" placeholder="45000" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('size')}</label>
              <input type="number" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className="input-field text-sm" placeholder="0.5" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('result')}</label>
              <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as any })} className="input-field text-sm">
                <option value="OPEN">{t('open')}</option>
                <option value="WIN">{t('win')}</option>
                <option value="LOSS">{t('loss')}</option>
                <option value="BREAKEVEN">{t('breakeven')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('strategy')}</label>
              <input value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })} className="input-field text-sm" placeholder="Trend Follow" />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs text-slate-400 mb-1">{t('notes')}</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field text-sm" placeholder="..." />
            </div>
            <div className="flex gap-2 items-end">
              <button onClick={handleAdd} className="btn-primary text-sm flex-1">{t('save')}</button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary text-sm px-3"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </Card>
      )}

      {entries.length === 0 ? (
        <EmptyState message={t('noEntries')} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-100 dark:bg-surface-100 text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t('asset')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('side')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('entry')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('exit')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t('size')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('result')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">{t('strategy')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('date')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-100 dark:hover:bg-surface-100">
                    <td className="px-4 py-3 font-semibold text-slate-100 uppercase">{e.asset}</td>
                    <td className="px-4 py-3 text-slate-300">{e.side === 'BUY' ? t('buy') : t('bearish')}</td>
                    <td className="px-4 py-3 text-slate-300 hidden sm:table-cell tabular-nums">{e.entry_price}</td>
                    <td className="px-4 py-3 text-slate-300 hidden sm:table-cell tabular-nums">{e.exit_price ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300 hidden md:table-cell tabular-nums">{e.size}</td>
                    <td className={`px-4 py-3 font-medium ${resultColor(e.result)}`}>
                      {e.result === 'OPEN' ? t('open') : e.result === 'WIN' ? t('win') : e.result === 'LOSS' ? t('loss') : t('breakeven')}
                    </td>
                    <td className="px-4 py-3 text-slate-400 hidden lg:table-cell">{e.strategy ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">{formatDate(e.trade_date, lang)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(e.id)} className="p-1 text-slate-500 hover:text-error-400 rounded">
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

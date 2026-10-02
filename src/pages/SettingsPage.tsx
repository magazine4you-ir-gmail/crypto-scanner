import { useState, useEffect } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { Card, SectionTitle, LoadingSpinner, Disclaimer } from '@/components/UI';
import { TIMEFRAMES } from '@/types/market';
import type { Timeframe } from '@/types/market';
import { Settings as SettingsIcon, Globe, Moon, Sun, Sliders, Save } from 'lucide-react';

export function SettingsPage() {
  const { t, lang, theme, settings, loading, updateSettings, setLang, setTheme } = useSettings();
  const [local, setLocal] = useState({
    defaultTimeframe: settings?.default_timeframe ?? '1d',
    thresholdStrong: settings?.signal_threshold_strong ?? 80,
    thresholdBuy: settings?.signal_threshold_buy ?? 70,
    thresholdWatch: settings?.signal_threshold_watch ?? 60,
    riskPercent: settings?.risk_percent ?? 1,
    minRR: settings?.min_risk_reward ?? 2,
    assetUniverse: settings?.asset_universe ?? 'top20',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocal({
        defaultTimeframe: settings.default_timeframe ?? '1d',
        thresholdStrong: settings.signal_threshold_strong ?? 80,
        thresholdBuy: settings.signal_threshold_buy ?? 70,
        thresholdWatch: settings.signal_threshold_watch ?? 60,
        riskPercent: settings.risk_percent ?? 1,
        minRR: settings.min_risk_reward ?? 2,
        assetUniverse: settings.asset_universe ?? 'top20',
      });
    }
  }, [settings]);

  if (loading) return <LoadingSpinner size="lg" />;

  const handleSave = async () => {
    setSaving(true);
    await updateSettings({
      default_timeframe: local.defaultTimeframe,
      signal_threshold_strong: local.thresholdStrong,
      signal_threshold_buy: local.thresholdBuy,
      signal_threshold_watch: local.thresholdWatch,
      risk_percent: local.riskPercent,
      min_risk_reward: local.minRR,
      asset_universe: local.assetUniverse,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('settings')}</h1>
      </div>

      {/* Language & Theme */}
      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2"><Globe className="w-5 h-5 text-primary-400" /> {t('preferences')}</span>
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('language')}</label>
            <div className="flex gap-2">
              <button
                onClick={() => setLang('fa')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${lang === 'fa' ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-100 text-slate-400'}`}
              >
                فارسی
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${lang === 'en' ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-100 text-slate-400'}`}
              >
                English
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('theme')}</label>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${theme === 'dark' ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-100 text-slate-400'}`}
              >
                <Moon className="w-4 h-4" /> {t('darkMode')}
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${theme === 'light' ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-100 text-slate-400'}`}
              >
                <Sun className="w-4 h-4" /> {t('lightMode')}
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Signal & Risk Settings */}
      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2"><Sliders className="w-5 h-5 text-primary-400" /> {t('signalThreshold')}</span>
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('defaultTimeframe')}</label>
            <select
              value={local.defaultTimeframe}
              onChange={(e) => setLocal({ ...local, defaultTimeframe: e.target.value })}
              className="input-field text-sm"
            >
              {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('assetUniverse')}</label>
            <select
              value={local.assetUniverse}
              onChange={(e) => setLocal({ ...local, assetUniverse: e.target.value })}
              className="input-field text-sm"
            >
              <option value="top10">{t('top10')}</option>
              <option value="top20">{t('top20')}</option>
              <option value="top50">{t('top50')}</option>
              <option value="top100">{t('top100')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('strong')} (≥)</label>
            <input type="number" min={70} max={100} value={local.thresholdStrong} onChange={(e) => setLocal({ ...local, thresholdStrong: Number(e.target.value) })} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('buy')} (≥)</label>
            <input type="number" min={60} max={100} value={local.thresholdBuy} onChange={(e) => setLocal({ ...local, thresholdBuy: Number(e.target.value) })} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('watch')} (≥)</label>
            <input type="number" min={40} max={100} value={local.thresholdWatch} onChange={(e) => setLocal({ ...local, thresholdWatch: Number(e.target.value) })} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('riskPercent')}</label>
            <input type="number" min={0.1} max={10} step={0.1} value={local.riskPercent} onChange={(e) => setLocal({ ...local, riskPercent: Number(e.target.value) })} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('minRiskReward')}</label>
            <input type="number" min={1} max={10} step={0.5} value={local.minRR} onChange={(e) => setLocal({ ...local, minRR: Number(e.target.value) })} className="input-field text-sm" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            <Save className="w-4 h-4 inline me-1" /> {saving ? t('loading') : t('saveChanges')}
          </button>
          {saved && <span className="text-sm text-success-400 animate-fade-in">{t('saved')}</span>}
        </div>
      </Card>

      <Disclaimer />
    </div>
  );
}

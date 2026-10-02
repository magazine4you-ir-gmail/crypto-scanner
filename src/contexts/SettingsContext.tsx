import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Lang } from '@/i18n/translations';
import { t as translate } from '@/i18n/translations';
import { ensureSettings, type UserSettings } from '@/services/settingsService';
import { useAuth } from './AuthContext';

interface SettingsContextValue {
  lang: Lang;
  theme: 'dark' | 'light';
  settings: UserSettings | null;
  loading: boolean;
  setLang: (lang: Lang) => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => Promise<void>;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  t: (key: string) => string;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [lang, setLangState] = useState<Lang>('fa');
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    ensureSettings()
      .then((s) => {
        if (s) {
          setSettings(s);
          setLangState(s.language);
          setThemeState(s.theme);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const setLang = async (newLang: Lang) => {
    setLangState(newLang);
    if (user) {
      const { upsertSettings } = await import('@/services/settingsService');
      await upsertSettings({ language: newLang });
    }
  };

  const setTheme = async (newTheme: 'dark' | 'light') => {
    setThemeState(newTheme);
    if (user) {
      const { upsertSettings } = await import('@/services/settingsService');
      await upsertSettings({ theme: newTheme });
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    if (!user) return;
    const { upsertSettings } = await import('@/services/settingsService');
    const updated = await upsertSettings(updates);
    if (updated) {
      setSettings(updated);
      if (updates.language) setLangState(updated.language);
      if (updates.theme) setThemeState(updated.theme);
    }
  };

  const t = (key: string) => translate(key, lang);

  return (
    <SettingsContext.Provider value={{ lang, theme, settings, loading, setLang, setTheme, updateSettings, t }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

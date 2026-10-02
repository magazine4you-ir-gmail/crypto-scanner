import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Card, SectionTitle, Disclaimer } from '@/components/UI';
import { User as UserIcon, Mail, Shield, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const { t, lang, theme } = useSettings();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserIcon className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('profile')}</h1>
      </div>

      {/* Profile header */}
      <Card>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-2xl font-bold text-white">
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-100">{user?.email ?? '—'}</p>
            <p className="text-sm text-slate-400">{t('profile')}</p>
          </div>
        </div>
      </Card>

      {/* Account info */}
      <Card>
        <SectionTitle>{t('accountSettings')}</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-100 dark:bg-surface-100">
            <Mail className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400">{t('email')}</p>
              <p className="text-sm font-medium text-slate-200">{user?.email ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-100 dark:bg-surface-100">
            <SettingsIcon className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400">{t('language')}</p>
              <p className="text-sm font-medium text-slate-200">{lang === 'fa' ? 'فارسی' : 'English'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-100 dark:bg-surface-100">
            <Shield className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-xs text-slate-400">{t('theme')}</p>
              <p className="text-sm font-medium text-slate-200">{theme === 'dark' ? t('darkMode') : t('lightMode')}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex gap-3">
        <button onClick={() => navigate('/settings')} className="btn-secondary text-sm">
          {t('settings')}
        </button>
        <button
          onClick={async () => { await signOut(); navigate('/login'); }}
          className="btn-danger text-sm"
        >
          {t('logout')}
        </button>
      </div>

      <Disclaimer />
    </div>
  );
}

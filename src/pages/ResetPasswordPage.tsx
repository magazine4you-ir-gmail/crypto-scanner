import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { LineChart, Mail, AlertCircle, CheckCircle } from 'lucide-react';

export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const { t } = useSettings();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await resetPassword(email);
    setLoading(false);
    if (resetError) {
      setError(resetError);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-0 dark:bg-surface-0">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary-600 flex items-center justify-center mb-4">
            <LineChart className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{t('resetPassword')}</h1>
        </div>

        <div className="card p-6">
          {sent ? (
            <div className="flex flex-col items-center text-center py-4">
              <CheckCircle className="w-12 h-12 text-success-400 mb-3" />
              <p className="text-slate-200 mb-4">{t('resetLinkSent')}</p>
              <Link to="/login" className="btn-secondary">
                {t('back')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-error-500/10 text-error-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('email')}</label>
                <div className="relative">
                  <Mail className="absolute inset-y-0 my-auto ms-3 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field ps-10"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? t('loading') : t('resetPassword')}
              </button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-slate-400">
            <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium">
              {t('back')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

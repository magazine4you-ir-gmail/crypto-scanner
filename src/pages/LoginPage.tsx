import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { LineChart, Mail, Lock, AlertCircle } from 'lucide-react';

export function LoginPage() {
  const { signIn } = useAuth();
  const { t } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }
    setLoading(true);
    const { error: signInError } = await signIn(email, password);
    setLoading(false);
    if (signInError) {
      setError(signInError);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-0 dark:bg-surface-0">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary-600 flex items-center justify-center mb-4">
            <LineChart className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{t('welcomeBack')}</h1>
          <p className="text-sm text-slate-400 mt-1">{t('authSubtitle')}</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-error-500/10 text-error-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {location.state?.message === 'checkEmail' && (
              <div className="p-3 rounded-lg bg-success-500/10 text-success-400 text-sm">
                {t('checkEmail')}
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
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('password')}</label>
              <div className="relative">
                <Lock className="absolute inset-y-0 my-auto ms-3 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field ps-10"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? t('loading') : t('signIn')}
            </button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link to="/reset-password" className="text-primary-400 hover:text-primary-300">
              {t('forgotPassword')}
            </Link>
            <span className="text-slate-400">
              {t('noAccount')}{' '}
              <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium">
                {t('signUp')}
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { NavLink, useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Radar,
  LineChart,
  Star,
  Briefcase,
  BookOpen,
  FlaskConical,
  TrendingUp,
  Settings as SettingsIcon,
  User as UserIcon,
  LogOut,
  LogIn,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'scanner', path: '/scanner', icon: Radar },
  { key: 'watchlist', path: '/watchlist', icon: Star },
  { key: 'portfolio', path: '/portfolio', icon: Briefcase },
  { key: 'journal', path: '/journal', icon: BookOpen },
  { key: 'backtest', path: '/backtest', icon: FlaskConical },
  { key: 'performance', path: '/performance', icon: TrendingUp },
  { key: 'settings', path: '/settings', icon: SettingsIcon },
  { key: 'profile', path: '/profile', icon: UserIcon },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useSettings();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-surface-0 dark:bg-surface-0">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-64 flex-col border-e border-surface-200 dark:border-surface-200 bg-surface-50 dark:bg-surface-50">
        <div className="h-16 flex items-center justify-center border-b border-surface-200 dark:border-surface-200">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center">
              <LineChart className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-100 dark:text-slate-100">Signal Terminal</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-100 dark:hover:bg-surface-100'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              <span>{t(item.key)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-surface-200 dark:border-surface-200">
          {user ? (
            <>
              <div className="flex items-center gap-3 px-3 py-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-surface-300 flex items-center justify-center text-sm font-semibold text-slate-300">
                  {user?.email?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-error-400 hover:bg-error-500/10 transition-colors duration-200"
              >
                <LogOut className="w-5 h-5" />
                <span>{t('logout')}</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-primary-400 hover:bg-primary-500/10 transition-colors duration-200"
            >
              <LogIn className="w-5 h-5" />
              <span>{t('signIn')}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-16 z-40 flex items-center justify-between px-4 border-b border-surface-200 dark:border-surface-200 bg-surface-50 dark:bg-surface-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <LineChart className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-bold text-slate-100">Signal Terminal</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg hover:bg-surface-100 text-slate-300"
          aria-label="Menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-surface-0/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute top-16 inset-x-0 bg-surface-50 dark:bg-surface-50 border-b border-surface-200 dark:border-surface-200 p-3 space-y-1 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {navItems.map((item) => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-600/20 text-primary-400'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-surface-100'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{t(item.key)}</span>
              </NavLink>
            ))}
            {user ? (
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-error-400 hover:bg-error-500/10"
              >
                <LogOut className="w-5 h-5" />
                <span>{t('logout')}</span>
              </button>
            ) : (
              <button
                onClick={() => { setMobileOpen(false); navigate('/login'); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-primary-400 hover:bg-primary-500/10"
              >
                <LogIn className="w-5 h-5" />
                <span>{t('signIn')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:ms-0 pt-16 lg:pt-0 min-w-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">{children}</div>
      </main>
    </div>
  );
}

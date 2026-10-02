import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ScannerPage } from '@/pages/ScannerPage';
import { AssetDetailPage } from '@/pages/AssetDetailPage';
import { WatchlistPage } from '@/pages/WatchlistPage';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { JournalPage } from '@/pages/JournalPage';
import { BacktestPage } from '@/pages/BacktestPage';
import { PerformancePage } from '@/pages/PerformancePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { LoadingSpinner } from '@/components/UI';
import type { ReactNode } from 'react';

function AppRoute({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 dark:bg-surface-0">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <Layout>{children}</Layout>;
}

function AuthRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 dark:bg-surface-0">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (user) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
      <Route path="/register" element={<AuthRoute><RegisterPage /></AuthRoute>} />
      <Route path="/reset-password" element={<AuthRoute><ResetPasswordPage /></AuthRoute>} />

      <Route path="/" element={<AppRoute><DashboardPage /></AppRoute>} />
      <Route path="/scanner" element={<AppRoute><ScannerPage /></AppRoute>} />
      <Route path="/asset/:symbol" element={<AppRoute><AssetDetailPage /></AppRoute>} />
      <Route path="/watchlist" element={<AppRoute><WatchlistPage /></AppRoute>} />
      <Route path="/portfolio" element={<AppRoute><PortfolioPage /></AppRoute>} />
      <Route path="/journal" element={<AppRoute><JournalPage /></AppRoute>} />
      <Route path="/backtest" element={<AppRoute><BacktestPage /></AppRoute>} />
      <Route path="/performance" element={<AppRoute><PerformancePage /></AppRoute>} />
      <Route path="/settings" element={<AppRoute><SettingsPage /></AppRoute>} />
      <Route path="/profile" element={<AppRoute><ProfilePage /></AppRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <AppRoutes />
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

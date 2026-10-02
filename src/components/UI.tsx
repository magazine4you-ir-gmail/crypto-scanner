import { useSettings } from '@/contexts/SettingsContext';

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-2', lg: 'w-12 h-12 border-2' };
  return (
    <div className="flex items-center justify-center py-8">
      <div className={`${sizes[size]} border-2 border-surface-300 border-t-primary-500 rounded-full animate-spin`} />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-200 dark:bg-surface-200 rounded ${className}`} />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useSettings();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-error-500/10 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-error-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-error-400 text-sm mb-4">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-sm">
          {t('retry')}
        </button>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold text-slate-100 mb-4 ${className}`}>{children}</h2>;
}

export function Disclaimer() {
  const { t } = useSettings();
  return (
    <div className="mt-8 p-4 rounded-lg bg-warning-500/10 border border-warning-500/20">
      <p className="text-xs text-warning-400 leading-relaxed">{t('disclaimer')}</p>
    </div>
  );
}

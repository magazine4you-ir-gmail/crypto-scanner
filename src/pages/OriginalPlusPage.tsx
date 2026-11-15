import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleDot } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, LoadingSpinner } from '@/components/UI';
import { Pill, PillRow } from '@/components/Responsive';
import { OriginalPlusFeed } from '@/components/OriginalPlusFeed';

type Tab = 'signals' | 'analysis';

/**
 * Original Plus — main page, the same structure as Reverse Plus: two tabs only (the open-signal list and the analysis
 * center, same card, extra filters), server-side paging, one shared card with the executable numbers.
 */
export function OriginalPlusPage() {
  const { t } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('signals');

  const header = (
    <div className="min-w-0">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><CircleDot className="w-5 h-5 text-primary-400" />{t('originalPlus')}</h1>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('opSubtitle')}</p>
    </div>
  );

  if (authLoading) return <div className="space-y-6">{header}<LoadingSpinner /></div>;
  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <p className="text-slate-300 text-sm mb-4">{t('asLoginRequired')}</p>
          <button className="btn-primary text-sm" onClick={() => navigate('/login')}>{t('signIn')}</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20"><p className="text-xs text-primary-300 leading-relaxed">{t('opNote')}</p></div>
      <PillRow>
        <Pill active={tab === 'signals'} onClick={() => setTab('signals')}>{t('rpSignals')}</Pill>
        <Pill active={tab === 'analysis'} onClick={() => setTab('analysis')}>{t('rpTabAnalysis')}</Pill>
      </PillRow>
      <OriginalPlusFeed key={tab} variant={tab} />
      <p className="text-[11px] text-slate-500 leading-relaxed">{t('disclaimer')}</p>
    </div>
  );
}

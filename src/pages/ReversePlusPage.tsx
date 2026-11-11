import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, LoadingSpinner } from '@/components/UI';
import { Pill, PillRow } from '@/components/Responsive';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { ReversePlusAnalysis } from '@/components/ReversePlusAnalysis';
import { ReversePlusFeed } from '@/components/ReversePlusFeed';

type Tab = 'signals' | 'analysis';

/**
 * Reverse Signal Plus — main page. Two tabs only: the open-signal list and the analysis center (same card, extra filters).
 * No history / trades / performance / settings tabs; those fetches no longer exist.
 */
export function ReversePlusPage() {
  const { t } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('signals');

  if (!isReversePlusEnabled()) return <Card><p className="text-slate-300 text-sm">{t('rpDisabledPage')}</p></Card>;

  const header = (
    <div className="min-w-0">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-primary-400" />{t('reversePlus')}</h1>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('rpSubtitle')}</p>
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
      <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20"><p className="text-xs text-warning-400 leading-relaxed">{t('rpStructuralNote')}</p></div>
      <PillRow>
        <Pill active={tab === 'signals'} onClick={() => setTab('signals')}>{t('rpSignals')}</Pill>
        <Pill active={tab === 'analysis'} onClick={() => setTab('analysis')}>{t('rpTabAnalysis')}</Pill>
      </PillRow>
      {tab === 'signals' ? <ReversePlusFeed variant="signals" /> : <ReversePlusAnalysis />}
      <p className="text-[11px] text-slate-500 leading-relaxed">{t('disclaimer')}</p>
    </div>
  );
}

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { buildAuditExport, downloadJson, type AuditProgress } from '@/services/auditExportService';

/** Downloads signals + surrounding candles as one json file for offline verification (npm run audit). */
export function AuditExportButton() {
  const { t } = useSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await buildAuditExport(setProgress);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      downloadJson(data, `signal-audit-${stamp}.json`);
      setMessage(
        `${t('slAuditDone')}: ${data.outcomes.length}` + (data.warnings.length ? ` · ${data.warnings.length} ${t('slAuditWarnings')}` : ''),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const label =
    busy && progress?.phase === 'candles' ? `${t('slAuditBusy')} ${progress.done}/${progress.total}` : t('slAuditExport');

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={() => void run()}
        disabled={busy}
        className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-60"
        title={t('slAuditHint')}
      >
        <Download className="w-4 h-4" />
        <span>{label}</span>
      </button>
      {message && <p className="text-xs text-slate-400">{message}</p>}
    </div>
  );
}

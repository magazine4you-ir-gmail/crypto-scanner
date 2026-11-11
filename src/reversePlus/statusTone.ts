// Reverse Plus — chip tones per Reverse Lab status (open / profit / loss / expired).
export const STATUS_CHIP_TONE: Record<string, string> = {
  OPEN: 'bg-warning-500/20 text-warning-400',
  WIN: 'bg-success-500/20 text-success-400',
  LOSS: 'bg-error-500/20 text-error-400',
  EXPIRED: 'bg-surface-200 text-slate-400',
  CANCELLED: 'bg-surface-200 text-slate-500',
};

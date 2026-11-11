import { ReversePlusFeed } from '@/components/ReversePlusFeed';

/**
 * Analysis center: trustworthy counts (open / profit / loss / expired, straight from the reverse signal outcomes) plus
 * symbol / direction / timeframe filters, over the SAME card as the Signals tab. No historical or performance tables.
 */
export function ReversePlusAnalysis() {
  return <ReversePlusFeed variant="analysis" />;
}

import { memo, useCallback } from 'react';
import { OriginalPlusSignalCard } from '@/components/OriginalPlusSignalCard';
import type { PlusPublicConfig } from '@/services/reversePlusService';
import type { ScenarioPrefs } from '@/reversePlus/scenarioPrefs';
import type { MixRow } from '@/powerMix/mix';

interface Props {
  row: MixRow;
  cfg: PlusPublicConfig;
  prefs: ScenarioPrefs;
  onOpen: (row: MixRow) => void;
}

/** The ORIGINAL signal of a Power Mix pair: the very same card as the Original Plus list (one template, no copy). */
function CardImpl({ row, cfg, prefs, onOpen }: Props) {
  const open = useCallback(() => onOpen(row), [onOpen, row]);
  return <OriginalPlusSignalCard o={row.original} cfg={cfg} prefs={prefs} onOpen={open} />;
}

export const PowerMixOriginalCard = memo(CardImpl);

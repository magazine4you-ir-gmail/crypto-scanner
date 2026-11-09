// Reverse Signal Plus — plain-language trade instruction for a signal (Persian + English), from facts only.
// It never "greens" a state: ENTRY_ALLOWED needs the stored strategy evaluation to be READY (all rules re-checked by the
// evaluator), not merely the price being inside the zone.
import type { BtOutcome } from './backtest.ts';
import type { BilingualText } from './types.ts';

export type InstructionState =
  | 'WAITING_FOR_ENTRY' | 'ENTRY_ALLOWED' | 'POSITION_OPEN' | 'APPROACHING_TP' | 'APPROACHING_SL'
  | 'TP_HIT' | 'SL_HIT' | 'NO_ENTRY' | 'EXPIRED' | 'INVALID' | 'AMBIGUOUS' | 'UNKNOWN';

export interface InstructionInput {
  mode: 'LIVE' | 'HISTORICAL';
  /** entry_status of the stored evaluation */
  evalStatus: 'WAITING' | 'APPROACHING' | 'READY' | 'INVALID' | 'EXPIRED' | null;
  /** backtest outcome (HISTORICAL, or LIVE once the path is known) */
  backtest?: BtOutcome | null;
  exitReason?: 'TARGET' | 'STOP' | null;
  /** a PAPER / hypothetical position is open */
  positionOpen?: boolean;
  /** distance of the current price to TP / SL as a % of price (null when unknown) */
  pctToTarget?: number | null;
  pctToStop?: number | null;
  approachPct?: number;
}

export interface Instruction { state: InstructionState; text: BilingualText }

const T: Record<InstructionState, BilingualText> = {
  WAITING_FOR_ENTRY: { fa: 'منتظر بمانید: قیمت هنوز به محدوده ورود نرسیده است. بدون رسیدن قیمت وارد معامله نشوید.', en: 'Wait: price has not reached the entry zone yet. Do not enter before it does.' },
  ENTRY_ALLOWED: { fa: 'شرایط ورود برقرار است: قیمت در محدوده ورود است و تمام شروط استراتژی (R/R، لیکوییدیشن، اعتبار) تأیید شده است.', en: 'Entry conditions are met: price is in the entry zone and all strategy checks passed.' },
  POSITION_OPEN: { fa: 'معامله باز است. حد ضرر و حد سود را رعایت کنید؛ منتظر برخورد قیمت با یکی از آن‌ها باشید.', en: 'Position is open. Respect stop-loss and take-profit and wait for price to reach one of them.' },
  APPROACHING_TP: { fa: 'قیمت به حد سود نزدیک شده است.', en: 'Price is approaching the take-profit.' },
  APPROACHING_SL: { fa: 'قیمت به حد ضرر نزدیک شده است؛ ریسک را بررسی کنید.', en: 'Price is approaching the stop-loss; review the risk.' },
  TP_HIT: { fa: 'حد سود فعال شد؛ معامله با سود بسته شد.', en: 'Take-profit was hit; the trade closed in profit.' },
  SL_HIT: { fa: 'حد ضرر فعال شد؛ معامله با ضرر بسته شد.', en: 'Stop-loss was hit; the trade closed at a loss.' },
  NO_ENTRY: { fa: 'قیمت هرگز به محدوده ورود نرسید؛ معامله‌ای باز نشد و سود یا زیانی ثبت نمی‌شود.', en: 'Price never reached the entry zone; no trade was opened and no result is recorded.' },
  EXPIRED: { fa: 'فرصت منقضی شد: در بازهٔ مجاز نه ورود/خروج کامل شد و نه نتیجه‌ای قطعی ثبت می‌شود.', en: 'The opportunity expired within the allowed window; no definitive result is recorded.' },
  INVALID: { fa: 'شرایط استراتژی معتبر نیست؛ وارد این معامله نشوید (دلیل در جزئیات نمایش داده می‌شود).', en: 'Strategy conditions are not valid; do not enter this trade (reasons are shown in the details).' },
  AMBIGUOUS: { fa: 'نتیجه نامشخص است: در یک کندل هم حد سود و هم حد ضرر لمس شده و ترتیب آن‌ها با داده موجود معلوم نیست. به‌عنوان برد یا باخت حساب نمی‌شود.', en: 'Result is ambiguous: both TP and SL were touched inside one candle and the order cannot be determined. It is not counted as a win or a loss.' },
  UNKNOWN: { fa: 'داده کافی برای تعیین نتیجه وجود ندارد؛ برد یا باخت فرض نمی‌شود.', en: 'Not enough data to determine the result; it is not assumed to be a win or a loss.' },
};

export function instructionFor(i: InstructionInput): Instruction {
  const out = (state: InstructionState): Instruction => ({ state, text: T[state] });
  if (i.backtest) {
    switch (i.backtest) {
      case 'WIN': return out('TP_HIT');
      case 'LOSS': return out('SL_HIT');
      case 'NO_ENTRY': return out('NO_ENTRY');
      case 'EXPIRED': return out('EXPIRED');
      case 'AMBIGUOUS': return out('AMBIGUOUS');
      case 'UNKNOWN': return out('UNKNOWN');
      case 'BREAKEVEN': return out('TP_HIT');
    }
  }
  if (i.evalStatus === 'INVALID') return out('INVALID');
  if (i.evalStatus === 'EXPIRED') return out('EXPIRED');
  if (i.positionOpen) {
    const a = i.approachPct ?? 0.5;
    if (i.pctToTarget !== null && i.pctToTarget !== undefined && i.pctToTarget >= 0 && i.pctToTarget <= a) return out('APPROACHING_TP');
    if (i.pctToStop !== null && i.pctToStop !== undefined && i.pctToStop >= 0 && i.pctToStop <= a) return out('APPROACHING_SL');
    return out('POSITION_OPEN');
  }
  if (i.evalStatus === 'READY') return out('ENTRY_ALLOWED');
  if (i.evalStatus === 'WAITING' || i.evalStatus === 'APPROACHING') return out('WAITING_FOR_ENTRY');
  return out('UNKNOWN');
}

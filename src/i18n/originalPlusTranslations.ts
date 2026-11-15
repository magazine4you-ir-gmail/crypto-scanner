// Original Plus — translations (additive; merged into the main dictionary).
type Dict = Record<string, { fa: string; en: string }>;

export const originalPlusTranslations: Dict = {
  originalPlus: { fa: 'اصلی پلاس', en: 'Original Plus' },
  opSubtitle: {
    fa: 'سیگنال‌های اصلی را با نگاه اجرایی ببینید: ورود، حد ضرر، حد سود، اهرم و سناریوی ریسک. فقط تحلیل است؛ سفارشی به صرافی ارسال نمی‌شود.',
    en: 'View original signals through an execution lens: entry, stop, target, leverage and risk scenario. Analysis only — no orders are sent.',
  },
  opNote: {
    fa: 'این بخش همان مدل معکوس پلاس است، ولی روی سیگنال اصلی (signal_outcomes) کار می‌کند — نه روی سیگنال معکوس.',
    en: 'Same model as Reverse Signal Plus, applied to the original signal (signal_outcomes) — not the reverse trade.',
  },
  opNoMatch: { fa: 'سیگنالی با این فیلتر پیدا نشد.', en: 'No signals match this filter.' },
  opNoOpen: { fa: 'در حال حاضر سیگنال اصلی بازی وجود ندارد.', en: 'There are no open original signals right now.' },
  opCountsHint: {
    fa: 'شمارش‌ها مستقیم از نتایج سیگنال اصلی (همان منبع آزمایشگاه سیگنال) محاسبه می‌شوند.',
    en: 'Counts come straight from the original signal outcomes (the same source as Signal Lab).',
  },
  opBack: { fa: 'بازگشت به اصلی پلاس', en: 'Back to Original Plus' },
};

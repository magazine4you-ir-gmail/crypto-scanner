// Power Mix Lab (میکس هوشمند) — translations. Additive: merged into the main dictionary, existing keys are never overwritten.
// Prefix "pm"; the single navigation key is "powerMix".
type Dict = Record<string, { fa: string; en: string }>;

export const powerMixTranslations: Dict = {
  // ---- navigation / page -------------------------------------------------------------------------
  powerMix: { fa: 'میکس هوشمند', en: 'Power Mix Lab' },
  pmDescription: {
    fa: 'سیگنال‌های عادی و معکوس بر اساس قدرت روند روزانهٔ بیت‌کوین (به وقت ایران) ترکیب می‌شوند: در روزهای پرقدرت سیگنال اصلی، در روزهای خنثی سیگنال معکوس معتبر است.',
    en: "Normal and reverse signals are mixed by Bitcoin's daily trend power (Tehran time): the original signal counts on strong days, the reverse one on neutral days.",
  },
  pmLoadFailed: { fa: 'بارگذاری داده‌ها ممکن نشد', en: 'Could not load the data' },
  pmNoCandles: {
    fa: 'قیمت‌های بیت‌کوین در دسترس نیست؛ دسته‌بندی روز انجام نشد.',
    en: 'Bitcoin prices are unavailable, so days could not be classified.',
  },
  pmNoData: { fa: 'هنوز سیگنالی برای میکس وجود ندارد.', en: 'There are no signals to mix yet.' },

  // ---- live status ---------------------------------------------------------------------------------
  pmLiveTitle: { fa: 'وضعیت امروز', en: "Today's status" },
  pmBtcNow: { fa: 'قیمت BTC', en: 'BTC price' },
  pmLondon: { fa: 'لندن', en: 'London' },
  pmUs: { fa: 'آمریکا', en: 'US' },
  pmDayMove: { fa: 'حرکت از ابتدای روز', en: 'Move since day start' },
  pmWindowPending: { fa: 'در حال شکل‌گیری', en: 'In progress' },
  pmWindowWaiting: { fa: 'شروع نشده', en: 'Not started' },
  pmUseOriginal: { fa: 'از سیگنال اصلی استفاده کن', en: 'Use the original signal' },
  pmUseReverse: { fa: 'از سیگنال معکوس استفاده کن', en: 'Use the reverse signal' },
  pmUseNone: { fa: 'طبق تنظیمات فعلی هیچ‌کدام انتخاب نمی‌شود', en: 'Neither side is selected by the current settings' },
  pmUseWait: { fa: 'هنوز نمی‌شود تصمیم گرفت', en: 'Too early to decide' },
  pmApprox: {
    fa: 'تقریبی است و تا بسته شدن بازهٔ آمریکا ممکن است تغییر کند.',
    en: 'Approximate — it can change until the US window closes.',
  },
  pmBasedOnDead: {
    fa: 'ساعت مرده است: طبقه‌بندی بر اساس حرکت BTC از ابتدای روز تا همین لحظه است.',
    en: 'Dead hours: classified by the BTC move from day start until now.',
  },

  // ---- day classes ---------------------------------------------------------------------------------
  pmClassVERY_STRONG: { fa: 'خیلی قوی', en: 'Very strong' },
  pmClassPOWER: { fa: 'پرقدرت', en: 'Power' },
  pmClassMIXED: { fa: 'جهت‌های مخالف', en: 'Mixed direction' },
  pmClassNEUTRAL: { fa: 'خنثی', en: 'Neutral' },
  pmPending: { fa: 'در حال تعیین', en: 'Pending' },
  pmNoDay: { fa: 'بدون داده BTC', en: 'No BTC data' },
  pmDead: { fa: 'ساعت مرده', en: 'Dead hours' },
  pmLowVolume: { fa: 'بازار کم‌حجم / تعطیل‌مانند', en: 'Low-volume / holiday-like' },
  pmTendUP: { fa: 'تمایل: صعودی', en: 'Leaning: up' },
  pmTendDOWN: { fa: 'تمایل: نزولی', en: 'Leaning: down' },
  pmTendFLAT: { fa: 'تمایل: خنثی', en: 'Leaning: flat' },
  pmPickOriginal: { fa: 'اصلی', en: 'Original' },
  pmPickReverse: { fa: 'معکوس', en: 'Reverse' },

  // ---- views / comparison ---------------------------------------------------------------------------
  pmViewMix: { fa: 'میکس هوشمند', en: 'Smart mix' },
  pmViewOriginal: { fa: 'فقط عادی', en: 'Original only' },
  pmViewReverse: { fa: 'فقط معکوس', en: 'Reverse only' },
  pmInvert: { fa: 'منطق وارونه (راستی‌آزمایی)', en: 'Inverted logic (verification)' },
  pmInvertOn: {
    fa: 'منطق میکس وارونه شده است: روزهای پرقدرت ← معکوس، روزهای خنثی ← اصلی.',
    en: 'The mix logic is inverted: strong days ← reverse, neutral days ← original.',
  },
  pmCompareTitle: { fa: 'مقایسه سه حالت', en: 'Three-way comparison' },
  pmClosed: { fa: 'بسته‌شده', en: 'Closed' },
  pmExcluded: { fa: 'خارج از میکس', en: 'Left out of the mix' },
  pmExcludedDetail: {
    fa: 'در حال تعیین: {p} · بدون داده BTC: {d} · انتخاب‌نشده توسط تنظیمات: {n}',
    en: 'Pending: {p} · no BTC data: {d} · not selected by settings: {n}',
  },

  // ---- filters / list --------------------------------------------------------------------------------
  pmDayType: { fa: 'نوع روز', en: 'Day type' },
  pmAllDays: { fa: 'همه روزها', en: 'All days' },
  pmOriginDirection: { fa: 'جهت سیگنال اصلی', en: 'Original direction' },
  pmShowMore: { fa: 'نمایش بیشتر', en: 'Show more' },
  pmShown: { fa: 'نمایش', en: 'Showing' },
  pmOf: { fa: 'از', en: 'of' },
  pmResult: { fa: 'نتیجه', en: 'Result' },
  pmSmallSample: {
    fa: 'نمونه هنوز کوچک است (کمتر از ۳۰ معامله بسته‌شده)؛ به این آمار تکیه نکنید.',
    en: 'Sample is still small (< 30 closed trades); do not rely on these numbers yet.',
  },
  pmHindsightNote: {
    fa: 'دسته‌بندی هر روز پس از بسته شدن بازهٔ آمریکا قفل می‌شود؛ پس برای سیگنالی که قبل از آن صادر شده، آمار با دانستنِ حرکت کامل روز محاسبه شده است (نه آنچه لحظهٔ صدور معلوم بود).',
    en: "Each day's class locks once the US window closes, so for signals issued earlier the stats use the full day's move (not what was known at issue time).",
  },

  // ---- settings --------------------------------------------------------------------------------------
  pmSettings: { fa: 'تنظیمات میکس', en: 'Mix settings' },
  pmSettingsHint: {
    fa: 'مقادیر پیش‌فرض عمومی توسط مدیر تعیین می‌شود. تغییرهای شما فقط در همین مرورگر و فقط برای نمای خودتان اعمال می‌شود و روی سیگنال‌ها و آمار دیگران اثری ندارد.',
    en: 'Global defaults are set by the admin. Your changes apply only in this browser, only to your own view, and never affect signals or anyone else.',
  },
  pmThreshold: { fa: 'آستانهٔ «پرقدرت» — حرکت BTC (٪)', en: 'Power threshold — BTC move (%)' },
  pmLondonWindow: { fa: 'بازهٔ لندن (وقت ایران)', en: 'London window (Tehran)' },
  pmUsWindow: { fa: 'بازهٔ آمریکا (وقت ایران)', en: 'US window (Tehran)' },
  pmDeadWindow: { fa: 'ساعت مرده: از – تا', en: 'Dead hours: from – to' },
  pmDeadLate: { fa: 'ساعت مرده: از این ساعت تا پایان روز', en: 'Dead hours: from this time to end of day' },
  pmFrom: { fa: 'از', en: 'From' },
  pmTo: { fa: 'تا', en: 'To' },
  pmSelection: { fa: 'کدام سیگنال معتبر است؟', en: 'Which signal counts?' },
  pmSelOriginal: { fa: 'اصلی', en: 'Original' },
  pmSelReverse: { fa: 'معکوس', en: 'Reverse' },
  pmSelNone: { fa: 'هیچ‌کدام', en: 'Neither' },
  pmLowVolRatio: { fa: 'آستانهٔ کم‌حجم (نسبت به میانهٔ ۱۴ روز؛ ۰ = خاموش)', en: 'Low-volume ratio (vs 14-day median; 0 = off)' },
  pmSave: { fa: 'ذخیره برای من', en: 'Save for me' },
  pmResetDefaults: { fa: 'بازگشت به پیش‌فرض عمومی', en: 'Back to global defaults' },
  pmPersonalActive: { fa: 'تنظیمات شخصی فعال است', en: 'Personal settings active' },
  pmGlobalActive: { fa: 'پیش‌فرض عمومی', en: 'Global defaults' },
  pmMixModeLocked: { fa: 'آمار پایان‌روز (قفل بعد از آمریکا)', en: 'End-of-day stats (locks after US)' },
  pmMixModeExecutable: { fa: 'آمار لحظهٔ سیگنال (قابل‌اجرا)', en: 'At-signal stats (executable)' },
  pmMixModeHintLocked: {
    fa: 'روز معاملاتی از ۰۳:۳۰ تهران تا ۰۳:۳۰ بعدی است. کلاس روز بعد از بسته‌شدن بازهٔ آمریکا قفل می‌شود و سیگنال‌های زودتر با دانستن کل روز دسته‌بندی می‌شوند (مرجع مقایسه؛ قابل معامله نیست). سیگنال‌های ساعت مرده همان لحظه دسته‌بندی می‌شوند.',
    en: "The trading day runs 03:30 Tehran to 03:30. The class locks after the US window and earlier signals are classified with hindsight (a reference, not tradable). Dead-hours signals are classified at signal time.",
  },
  pmMixModeHintExecutable: {
    fa: 'فقط با کندل‌های بسته‌شدهٔ تا لحظهٔ صدور سیگنال دسته‌بندی می‌شود و بعد از آن هرگز تغییر نمی‌کند. آمار هر روز ساعت ۰۳:۳۰ تهران ریست می‌شود — مناسب برای ارزیابی لبهٔ واقعی ترید.',
    en: 'Uses only candles closed by signal time and never changes afterwards. The day resets at 03:30 Tehran — suitable for measuring a tradable edge.',
  },
  pmTimeRange: { fa: 'بازهٔ زمانی', en: 'Time range' },
  pmRange1d: { fa: 'امروز', en: 'Today' },
  pmRange7d: { fa: '۱ هفته', en: '1 week' },
  pmRange30d: { fa: '۱ ماه', en: '1 month' },
  pmRange90d: { fa: '۳ ماه', en: '3 months' },
  pmRangeAll: { fa: 'همه', en: 'All time' },

  pmInvalid: { fa: 'بازه‌ها معتبر نیستند (لندن باید قبل از آمریکا تمام شود و ساعت‌ها ترتیب درست داشته باشند).', en: 'The windows are not valid (London must end before US starts and times must be in order).' },

  // ---- strength ladder / dead-hours pick --------------------------------------------------------------
  pmClassSTRONG: { fa: 'قوی', en: 'Strong' },
  pmStrongPct: { fa: 'آستانهٔ «قوی» (٪) — ۰ = خاموش', en: 'Strong threshold (%) — 0 = off' },
  pmStrongHint: {
    fa: 'پله‌ها: زیر آستانهٔ پرقدرت = خنثی ← از آستانهٔ پرقدرت تا آستانهٔ قوی = پرقدرت ← از آستانهٔ قوی به بالا = قوی (جهت‌ها هم‌سو نیست) یا خیلی قوی (لندن و آمریکا هم‌جهت‌اند). قدرت روز = |لندن + آمریکا| وقتی هم‌جهت‌اند، وگرنه بزرگ‌ترین بازه. روز با دو بازهٔ بزرگِ مخالف همیشه «جهت‌های مخالف» می‌ماند.',
    en: 'Ladder: below the power threshold = neutral → power threshold up to the strong threshold = power → at/above the strong threshold = strong (sessions not aligned) or very strong (London and US move the same way). Day strength = |London + US| when aligned, otherwise the larger session. A day with two big opposite sessions stays "mixed direction".',
  },
  pmSelDead: { fa: 'ساعت مرده', en: 'Dead hours' },
  pmSelByClass: { fa: 'طبق نوع روز (پیش‌فرض)', en: 'By day class (default)' },
  pmSelDeadHint: {
    fa: 'سیگنال‌هایی که در ساعت مرده صادر شده‌اند جدا از نوع روز تنظیم می‌شوند.',
    en: 'Signals issued in dead hours get their own pick, separate from the day class.',
  },
  pmInvalidStrong: { fa: 'آستانهٔ «قوی» باید ۰ (خاموش) یا بزرگ‌تر از آستانهٔ پرقدرت باشد.', en: 'The strong threshold must be 0 (off) or above the power threshold.' },

  // ---- thermometer -----------------------------------------------------------------------------------
  pmThermoTitle: { fa: 'دماسنج بازار', en: 'Market thermometer' },
  pmThermoValue: { fa: 'قدرت ترکیبی', en: 'Combined strength' },
  pmThermoBear: { fa: 'نزولی', en: 'Bearish' },
  pmThermoBull: { fa: 'صعودی', en: 'Bullish' },
  pmThermoNeutral: { fa: 'خنثی', en: 'Neutral' },
  pmThermoNoData: { fa: 'داده‌ای نیست', en: 'No data' },
  pmZoneNEUTRAL: { fa: 'خنثی', en: 'Neutral' },
  pmZoneMODERATE: { fa: 'پرقدرت', en: 'Power' },
  pmZoneSTRONG: { fa: 'قوی', en: 'Strong' },
  pmZoneEXTREME: { fa: 'خیلی قوی', en: 'Very strong' },
  pmThermoConflict: { fa: 'لندن و آمریکا خلاف هم‌اند؛ دما صفر می‌شود ولی بازار آرام نیست.', en: 'London and US oppose each other: the value cancels out but the market is not quiet.' },
  pmThermoHint: {
    fa: 'عدد = حرکت لندن + حرکت آمریکا (در ساعت مرده: حرکت از شروع روز). قرمز = نزولی، سبز = صعودی، وسط = خنثی؛ خط‌ها آستانه‌های تنظیمات هستند.',
    en: 'Value = London move + US move (dead hours: move since day start). Red = bearish, green = bullish, middle = neutral; ticks are your threshold settings.',
  },

  // ---- calendar range --------------------------------------------------------------------------------
  pmDateRange: { fa: 'بازهٔ تاریخ (تقویم)', en: 'Date range (calendar)' },
  pmRangeCustom: { fa: 'بازهٔ دلخواه', en: 'Custom range' },
  pmDateFrom: { fa: 'از تاریخ', en: 'From' },
  pmDateTo: { fa: 'تا تاریخ', en: 'To' },
  pmCalJalali: { fa: 'شمسی', en: 'Jalali' },
  pmCalGregorian: { fa: 'میلادی', en: 'Gregorian' },
  pmDateClear: { fa: 'پاک کردن تاریخ', en: 'Clear dates' },
  pmDateInvalid: { fa: 'تاریخ شروع باید قبل از تاریخ پایان باشد.', en: 'The start date must be before the end date.' },
  pmDateHint: {
    fa: 'روز بر اساس تقویم تهران (۰۰:۰۰ تا ۲۴:۰۰) و روی زمان صدور سیگنال اعمال می‌شود؛ هر دو سر بازه شامل می‌شوند.',
    en: 'Days follow the Tehran calendar (00:00–24:00) and apply to the signal time; both ends are included.',
  },
  pmDateYear: { fa: 'سال', en: 'Year' },
  pmDateMonth: { fa: 'ماه', en: 'Month' },
  pmDateDay: { fa: 'روز', en: 'Day' },

  // ---- unified signal card ----------------------------------------------------------------------------
  pmScore: { fa: 'امتیاز', en: 'Score' },
  pmQuality: { fa: 'کیفیت ورود', en: 'Entry quality' },
  pmNetPnl: { fa: 'سود/زیان خالص', en: 'Net P&L' },
  pmNetPnlUsd: { fa: 'سود/زیان (USDT)', en: 'P&L (USDT)' },
  pmRoi: { fa: 'بازده روی مارجین', en: 'ROI on margin' },
  pmEntryUsed: { fa: 'ورود', en: 'Entry' },
  pmExit: { fa: 'خروج', en: 'Exit' },
  pmSourcePLUS: { fa: 'محاسبه: معکوس پلاس', en: 'Calc: Reverse Plus' },
  pmSourceLAB: { fa: 'نتیجهٔ آزمایشگاه', en: 'Lab result' },
  pmStOPEN: { fa: 'باز', en: 'Open' },
  pmStWIN: { fa: 'سود', en: 'Win' },
  pmStLOSS: { fa: 'ضرر', en: 'Loss' },
  pmStEXPIRED: { fa: 'منقضی', en: 'Expired' },
  pmStNO_ENTRY: { fa: 'ورود فعال نشد', en: 'Entry not reached' },
  pmStUNKNOWN: { fa: 'نامشخص', en: 'Undecided' },
  pmLiquidated: { fa: 'لیکویید', en: 'Liquidated' },

  // ---- extra statistics --------------------------------------------------------------------------------
  pmNetUsd: { fa: 'سود خالص (USDT)', en: 'Net profit (USDT)' },
  pmMaxDd: { fa: 'بیشینهٔ افت (USDT)', en: 'Max drawdown (USDT)' },
  pmNoEntry: { fa: 'بدون ورود', en: 'No entry' },
  pmTotalR: { fa: 'مجموع R', en: 'Total R' },
  pmLiqCount: { fa: 'لیکوید شده', en: 'Liquidated' },
  pmBestWorst: { fa: 'بهترین / بدترین (USDT)', en: 'Best / worst (USDT)' },
  pmCountedClosed: { fa: 'بسته‌شده', en: 'Closed' },

  // ---- scenario bar (shared with the Reverse Plus pages) -------------------------------------------------
  pmScenario: { fa: 'سناریوی محاسبه — همان تنظیمات معکوس پلاس', en: 'Calculation scenario — same as Reverse Plus' },
  pmLeverage: { fa: 'اهرم', en: 'Leverage' },
  pmSizing: { fa: 'اندازهٔ پوزیشن', en: 'Position sizing' },
  pmFixedRisk: { fa: 'ریسک ثابت', en: 'Fixed risk' },
  pmFixedNotional: { fa: 'حجم ثابت', en: 'Fixed notional' },
  pmAmount: { fa: 'مبلغ (USDT)', en: 'Amount (USDT)' },
  pmScenarioHint: {
    fa: 'سود و زیان معکوس‌ها از بک‌تست معکوس پلاس (ورود پیشنهادی، حد ضرر و هدف معکوس، کارمزد و لغزش) با همین اهرم و مبلغ محاسبه می‌شود؛ اصلی هم با همین سناریو به USDT تبدیل می‌شود. این مقادیر با صفحات معکوس پلاس مشترک و فقط در همین مرورگر ذخیره می‌شوند.',
    en: 'Reverse P&L comes from the Reverse Plus backtest (recommended entry, reverse stop / target, fees and slippage) with this leverage and amount; the original is converted to USDT with the same scenario. Values are shared with the Reverse Plus pages and stored in this browser only.',
  },
  pmScenarioSave: { fa: 'ذخیره', en: 'Save' },

  // ---- day history ---------------------------------------------------------------------------------------
  pmHistoryTitle: { fa: 'سابقهٔ روزها', en: 'Day history' },
  pmHistoryHint: {
    fa: 'هر ردیف یک روز معاملاتی (۰۳:۳۰ تا ۰۳:۳۰ تهران) است: دما، نوع روز، تعداد سیگنال‌ها و نتیجهٔ میکس. روی یک روز بزنید تا آمار و فهرست فقط همان روز نشان داده شود.',
    en: 'Each row is one trading day (03:30 → 03:30 Tehran): temperature, day class, signal count and the mix result. Tap a day to see the stats and list for that day only.',
  },
  pmHistoryDay: { fa: 'روز', en: 'Day' },
  pmHistorySignals: { fa: 'سیگنال', en: 'Signals' },
  pmHistoryMix: { fa: 'میکس', en: 'Mix' },
  pmHistoryPick: { fa: 'فیلتر همین روز', en: 'Filter to this day' },
  pmHistoryEmpty: { fa: 'روزی در این بازه نیست.', en: 'No days in this range.' },
  pmHistoryMore: { fa: 'نمایش روزهای بیشتر', en: 'Show more days' },
  pmDayPending: { fa: 'در حال تعیین', en: 'Pending' },

  // ---- notices ---------------------------------------------------------------------------------------
  pmTruncated: { fa: 'فقط {n} سیگنال آخر بارگذاری شد؛ سابقهٔ قدیمی‌تر ناقص است.', en: 'Only the latest {n} signals were loaded; older history is incomplete.' },
  pmNoBacktest: {
    fa: 'برای {n} سیگنال معکوس هنوز بک‌تست معکوس پلاس وجود ندارد؛ برای آن‌ها نتیجهٔ آزمایشگاه معکوس استفاده شد.',
    en: '{n} reverse signals have no Reverse Plus backtest yet; their Reverse Lab result is used instead.',
  },
  pmBtFailed: { fa: 'خواندن بک‌تست معکوس پلاس ممکن نشد؛ همهٔ معکوس‌ها با نتیجهٔ آزمایشگاه نمایش داده شدند.', en: 'Could not read the Reverse Plus backtests; all reverse results use the Reverse Lab outcome.' },
};

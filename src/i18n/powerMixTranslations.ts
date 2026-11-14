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
  pmThreshold: { fa: 'آستانهٔ حرکت BTC (٪)', en: 'BTC move threshold (%)' },
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
  pmInvalid: { fa: 'بازه‌ها معتبر نیستند (لندن باید قبل از آمریکا تمام شود و ساعت‌ها ترتیب درست داشته باشند).', en: 'The windows are not valid (London must end before US starts and times must be in order).' },
};

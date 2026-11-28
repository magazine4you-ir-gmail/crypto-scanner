# گزارش نهایی تست

> فقط مواردی که **واقعاً اجرا شدند** پاس/ناموفق گزارش شده‌اند. چیزهایی که اجرا نشدند صریحاً در بخش ۵ آمده‌اند.
> محیط: Node 22، Vitest 4، Deno 2.9.6، PostgreSQL 16.15 (+ `postgresql-16-cron`)، Ubuntu 24. خط پایه = ZIP اصلی بدون هیچ تغییر.

## ۱. خلاصه

| بررسی | خط پایه (ZIP اصلی) | وضعیت نهایی |
|---|---|---|
| `npm run typecheck` | ۸ خطا | ۸ خطا، **مجموعه‌ی کاملاً یکسان** (هیچ خطای جدید) |
| `npm test` | ۲۵۶ پاس / ۱ شکست از ۲۵۷ | **۲۹۸ پاس / ۱ شکست از ۲۹۹** (همان شکست قبلی) |
| فایل‌های تست بارگذاری‌نشده | ۲ | همان ۲ (قبلی) |
| `npm run build` | موفق | موفق (bundle اصلی ۴۴۶٫۷ → ۴۱۱٫۷ kB) |
| `deno check` Edge Functionها | اجرا نشد | ۴ تابع + ۲ bundle: **همه exit 0** |
| harness ارزیاب (قدیمی در برابر جدید) | — | داده‌ی یکسان (۰ اختلاف) در همه‌ی سناریوها |
| `check:market-data` | — | ۱۵ بررسی، همه PASS |
| migration پاک‌سازی روی PostgreSQL واقعی (+ pg_cron) | — | همه‌ی موارد پاس |
| `usage_audit.sql` روی schema نمونه | — | بدون خطا |

## ۲. خطاهای از قبل موجود (در خط پایه‌ی ZIP اصلی، قبل از هر تغییر)

| مورد | علت |
|---|---|
| ۷ خطای typecheck در `src/i18n/powerMixTranslations.ts` | کلیدهای تکراری در object literal |
| ۱ خطای typecheck در `src/reversePlus/__tests__/independence.test.ts` | ماژول `scripts/golden-signal-output` در ZIP موجود نیست |
| ۱ تست ناموفق: `thermometer signed value, zones, conflict` (`src/powerMix/__tests__/features.test.ts`) | `value: 3` به‌جای `4` مورد انتظار؛ در خط پایه هم شکست می‌خورد، به تغییرات من ربطی ندارد و بررسی نشد |
| `configConsistency.test.ts` بارگذاری نمی‌شود | فایل `supabase/migrations/20261109000000_reverse_plus_public.sql` در ZIP نیست |
| `independence.test.ts` بارگذاری نمی‌شود | همان ماژول گمشده‌ی `scripts/golden-signal-output` |

## ۳. خطاهای جدیدِ معرفی‌شده توسط تغییرات و رفع آن‌ها
در حین کار، تست‌ها چند اشکال واقعی در کار خودم را گرفتند که **همه قبل از تحویل رفع شدند**:
- تایپ‌چک: استفاده از `Array.prototype.at` در یک تست جدید (target پروژه آن را ندارد) → اصلاح شد.
- تست جدید `marketDataProxy`: فیکسچر mock شکل پاسخ Binance را اشتباه می‌داد (خطای تست، نه کد) → اصلاح شد.
- migration پاک‌سازی (پیش از تحویل قبلی): `$$` داخل پیام NOTICE بدنه‌ی `DO $$` را زودتر می‌بست → رفع شد؛ و ایندکس `fetched_at` در بازبینی این مرحله به‌خاطر اثر منفی روی HOT-update حذف شد.
- ترتیب بک‌لاگ ارزیاب (تحویل قبلی): چرخش ساده، پوشش ناکافی می‌داد → با ترتیب hash-شده جایگزین و تست شد.
**وضعیت نهایی: صفر خطای typecheck جدید، صفر تست ناموفق جدید.**

## ۴. تست‌ها

۲۵۷ (خط پایه) − ۲۳ (تست‌های Scalp حذف‌شده) + ۶۵ (جدید) = **۲۹۹**.

| فایل تست جدید | تعداد | چه چیزی را می‌سنجد |
|---|---|---|
| `src/reversePlus/__tests__/evalPolicy.test.ts` | ۱۹ | قاعده‌ی LIVE بدون تغییر (هم‌خوانی با `closedCandles` برای همه‌ی تایم‌فریم‌ها)، قطعی بودن تحلیل، ترتیب کار، بک‌لاگ بدون گرسنگی، helperهای env |
| `src/reversePlus/__tests__/evalDefaults.test.ts` | ۵ | `LIVE_SKIP_UNCHANGED=false` و `HOT_ONLY=false` پیش‌فرض، بررسی همه‌ی خطاهای خواندن، ترتیب کامل صفحه‌بندی |
| `src/services/__tests__/requestCache.test.ts` | ۷ | dedupe، TTL، force، عدم کش خطا، invalidate |
| `src/services/__tests__/requestPatterns.test.ts` | ۱۱ | ستون‌های صریح، کش/dedupe config و evaluationها، شمارش فقط صفحه‌ی اول، کش بک‌تست نهایی، کش AutoScan |
| `src/services/__tests__/marketDataRequests.test.ts` | ۴ | query پایدار برای «تا الان»، حفظ endTime تاریخی، جدا ماندن symbol/interval/start |
| `src/services/__tests__/marketDataProxy.test.ts` | ۵ | مسیر proxy: `maxAge` و حذف `endTime`، عدم ارسال به Binance، chunkهای نمودار PowerMix |
| `src/hooks/__tests__/useVisibleInterval.test.ts` | ۶ | توقف در تب پنهان، catch-up هنگام بازگشت، cleanup |
| `src/__tests__/scalpRemoval.test.ts` | ۸ | نبود هر فایل/ارجاع Scalp؛ هر import به فایل موجود؛ هر منو → route + صفحه + ترجمه؛ ویژگی‌های باقی‌مانده route دارند؛ `/scalp` → `/` |

## ۵. شبیه‌سازی‌ها و آزمون‌های بیرون از Vitest (اجرا شدند)

- `npm run eval:harness`: اجرای **خود کد** Edge Function قدیمی و جدید روی DB درون‌حافظه‌ای + Binance ساختگی با ساعت کنترل‌شده. سناریوها: پیش‌فرض‌ها، `LIVE_SKIP_UNCHANGED=true`، `HOT_ONLY=true`، حالت تک‌سیگنال، شکست خواندن دسته‌ای (fallback)، >۳۰۰۰ سیگنال (مسیر پنجره‌ای). همه: ۰ اختلاف داده؛ جدول کاهش در `USAGE_OPTIMIZATION_REPORT.md`.
- `npm run check:market-data`: ۱۵ بررسی روی کد واقعی `market-data` (بخش ۴ گزارش بهینه‌سازی).
- `deno check`: `reverse-plus-eval`، `market-data`، `scheduled-scan`، `track-signal` و هر دو bundle → exit 0. کنترل منفی (خطای عمدی) ثابت کرد چک واقعاً کار می‌کند. فقط خط `jsr:@supabase/functions-js/...` (انواع محیطی) در یک **کپی موقت** حذف شد، چون jsr.io در محیط من در دسترس نبود؛ سورس پروژه دست‌نخورده است.
- PostgreSQL 16.15: migration، اعمال مجدد، تابع، دسته‌بندی، دسترسی (`anon` رد می‌شود)، اثر نکردن روی جدول‌های دیگر، rollback؛ با `pg_cron` واقعی: ساخت job، اعمال مجدد = ۱ job، rollback = ۰ job.
- `usage_audit.sql` (بخش‌های ۳–۱۱) روی schema نمونه بدون خطا.

## ۶. اجرا **نشد** / محدودیت‌ها
- هیچ تست در **مرورگر واقعی/UI**؛ هیچ اتصال به Supabase یا Binance واقعی.
- Reverse Plus، Manual Scan و احراز هویت فقط با تست واحد/یکپارچگی/شبیه‌ساز سنجیده شدند، نه end-to-end.
- `configConsistency` و `independence` به‌خاطر فایل‌های گمشده‌ی ZIP اجرا نمی‌شوند؛ پس استقلال مدل عمومی از تنظیمات کاربر با این دو تست **تأیید نشد**.
- `supabase db push`، `supabase functions deploy` و build Cloudflare اجرا نشدند (طبق محدودیت‌های شما).
- بخش `pg_cron` روی Production بررسی نشد (فقط روی نصب محلی).
- `deno check` با jsr.io و type-check کامل Supabase client در محیط واقعی Deploy اجرا نشد.
- harness روی داده‌ی ساختگی است؛ اعداد Production را بعد از deploy اندازه بگیرید.

## ۷. نحوه‌ی بازتولید
```bash
npm ci && npm run typecheck && npm test && npm run build
npm run eval:harness          # SIGNALS_LIVE=300 SIGNALS_HIST=3300 RUNS=14 HOT=1 EDGE=1 npm run eval:harness
npm run check:market-data
```

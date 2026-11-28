# گزارش بهینه‌سازی مصرف Supabase — نسخه‌ی نهایی

> وضعیت: **فقط کد، migration و بسته‌ی بازبینی.** هیچ تغییری روی Production اعمال نشده، migration اجرا نشده، Edge Function deploy نشده و هیچ داده‌ای حذف نشده است.
> اعداد «قبل/بعد» از شبیه‌ساز (harness) روی داده‌ی ساختگی هستند، نه لاگ Production؛ بعد از deploy باید دوباره اندازه‌گیری شوند (بخش ۹).
> این سند جایگزین گزارش قبلی است. حذف Scalp در `SCALP_REMOVAL_REPORT.md` و نتایج دقیق تست‌ها در `TESTING_REPORT.md` آمده است.

---

## ۱. تصحیح‌های این نسخه نسبت به نسخه‌ی قبلی

| # | موضوع | قبل | اکنون |
|---|---|---|---|
| ۱ | `REVERSE_PLUS_LIVE_SKIP_UNCHANGED` | پیش‌فرض **true** | پیش‌فرض **false** (opt-in). بدون هیچ secret، هر ردیف LIVE مثل قبل در هر اجرا بازنویسی می‌شود. یک تست (`evalDefaults.test.ts`) پیش‌فرض را قفل می‌کند. |
| ۲ | `REVERSE_PLUS_HOT_ONLY` | false | همچنان **false** (opt-in)، قفل‌شده با تست. |
| ۳ | تازگی قیمت LIVE بعد از پایدار شدن کلید کش | TTL ثابت ۳۰ ثانیه | پارامتر اختیاری `maxAge` برای درخواست‌های live (بخش ۴). بدون آن، قیمت poll ۲۰ثانیه‌ای می‌توانست تا ۳۰ ثانیه کهنه باشد. |
| ۴ | ایندکس `fetched_at` روی `market_data_cache` | داخل migration | **حذف شد** (بخش ۵): هر refresh کش را از HOT-update خارج می‌کرد. |
| ۵ | خطاهای خواندن ارزیاب | چند خواندن بدون بررسی خطا | همه بررسی می‌شوند؛ شکست خواندن هرگز به‌معنای «چیزی وجود ندارد» تفسیر نمی‌شود (بخش ۶). |
| ۶ | صفحه‌بندی لیست سیگنال‌ها | `order by signal_at` (غیرمنحصربه‌فرد) | با tie-break روی `id` (کاملاً مرتب) |
| ۷ | شکست خواندن evaluationها در `ReversePlusFeed` | بی‌صدا | پیام غیرمسدودکننده + دکمه‌ی «تلاش مجدد» |
| ۸ | bundleهای `supabase/single-file/` | ناهم‌خوان با سورس (از قبل) | بازتولید شدند (بخش ۷) |

---

## ۲. ریشه‌ی مشکلات (Audit، بدون تغییر نسبت به نسخه‌ی قبل)

**ارزیاب Reverse Plus.** هر اجرا تا ۳۰۰۰ سیگنال می‌خواند و برای هر ۱۰۰ سیگنال ۳ GET جدا می‌زد (≈ **۹۵ GET در اجرا**)، با `select('*')` روی trades؛ برای هر سیگنال فعال یک POST LIVE جدا (حتی بدون کندل جدید)؛ کوئری داخل حلقه؛ ترتیب «جدید به قدیم» با بودجه‌ی ۱۰۰ ثانیه که بک‌لاگ را گرسنه می‌گذاشت.

**کش `market-data`.** کلید کش شامل `startTime/endTime` ساخته‌شده از `Date.now()` بود؛ هر درخواست کلید یکتا داشت، هرگز Hit نمی‌شد و یک ردیف جدید می‌ساخت که هیچ‌جا پاک نمی‌شد.

**فرانت‌اند.** refetch config/شمارش‌ها با هر فیلتر؛ PowerMix با تا ۵۰ درخواست `select('*')` و دانلود دوباره‌ی ده‌ها chunk کندل در هر mount؛ AutoScan با خواندن ۱۰۰۰ ردیف هر ۶۰ ثانیه؛ هیچ pollingی در تب پنهان متوقف نمی‌شد.

**لاگ.** `console.*` کم است؛ حجم لاگ اصلی از Gateway/PostgREST می‌آید و فقط با کم شدن خود درخواست‌ها کم می‌شود.

---

## ۳. نتیجه‌ی اندازه‌گیری (harness: ارزیاب قدیمی در برابر جدید)

سناریو: ۳۰۰ سیگنال زنده + ۳۳۰۰ تاریخی (>۳۰۰۰، مثل Production)، ۱۴ اجرای ۵ دقیقه‌ای، DB درون‌حافظه‌ای و Binance ساختگی. میانگین حالت پایدار برای **یک اجرا**:

| معیار | قبل | **پیش‌فرض‌های امن** (فعلی) | با `LIVE_SKIP_UNCHANGED=true` (opt-in) | با `HOT_ONLY=true` (opt-in) |
|---|---|---|---|---|
| GET | 95 | **13** (−۸۶٪) | 13 | 6.6 |
| POST | 209.8 | **9.0** (−۹۶٪) | 1.7 | 9.0 |
| حجم پاسخ خواندن | 2763 KB | 2432 KB (−۱۲٪) | 2432 KB | 566 KB (−۸۰٪) |
| حجم بدنه‌ی نوشتن | 792 KB | **792 KB (بدون تغییر)** | 101 KB (−۸۷٪) | 792 KB |
| فراخوانی Binance | 378 | **378 (بدون تغییر)** | 104 (−۷۲٪) | 378 |
| داده‌ی نهایی | — | **یکسان** (۳۲۱۰ ارزیابی، ۳۰۰ معامله، ۲۷۰۰ بک‌تست؛ ۰ اختلاف) | یکسان (۰ اختلاف) | یکسان (۰ اختلاف) |

**نکته‌ی صادقانه:** با پیش‌فرض‌های امن، کاهش اصلی در **تعداد** درخواست‌هاست (batch). چون همه‌ی ردیف‌های LIVE هنوز در هر اجرا بازنویسی می‌شوند، **حجم نوشتن و فراخوانی Binance تغییری نمی‌کند**؛ آن دو فقط با opt-in کم می‌شوند. اگر بعد از اندازه‌گیری Production تصمیم گرفتید opt-in را روشن کنید، بخش ۴ همین سند و بخش «رفتار قابل‌تأیید» را ببینید.

برآورد روزانه‌ی خواندن/نوشتن ارزیاب (فقط ارزیاب، با ۲۸۸ اجرا/روز): GET حدود ۲۷٬۴۰۰ → ۳٬۷۰۰ ؛ POST حدود ۶۰٬۴۰۰ → ۲٬۶۰۰ (با شبیه‌ساز؛ مقدار واقعی را بعد از deploy اندازه بگیرید).

---

## ۴. بررسی دقیق تغییر کش `market-data` (حذف `endTime` از درخواست‌های «تا همین الان»)

**قاعده‌ی کلاینت:** پنجره‌ای که `endTime` آن در ≤۲ ثانیه‌ی اخیر یا آینده است، «تا الان» محسوب می‌شود و `endTime` نمی‌فرستد (و `maxAge=5` می‌فرستد). هر بازه‌ی تاریخی `endTime` دقیق خودش را نگه می‌دارد. کلید سرور همان فرمت قبلی را دارد: `klines:SYMBOL:INTERVAL:LIMIT:START:END`.

بررسی فراخواننده‌ها: (الف) صفحه‌ی جزئیات سیگنال (بار اولیه و تغییر تایم‌فریم نمودار): همیشه `max(end, now−1)`، یعنی از قبل «تا الان»؛ (ب) PowerMix: chunkهای گذشته‌ی هم‌تراز endTime دقیق دارند و فقط chunk آخر «تا الان» است؛ این تصمیم **یک‌بار در ابتدای تابع** گرفته می‌شود تا یک batch کند، chunk آخر را به درخواست یکتا تبدیل نکند؛ (ج) poll زنده: «۴ کندل آخر» (بدون start/end، پایدار).

**چرا نتیجه‌ی Binance یکسان است:** وقتی `startTime` داده شده، Binance همیشه *اولین* `limit` کندل از آن نقطه را برمی‌گرداند و کندل آینده وجود ندارد؛ پس `endTime=now` و بدون `endTime` یک مجموعه می‌دهند.

**تازگی (اصلاح مهم این نسخه):** با کلید پایدار، یک poll می‌توانست تا ۳۰ ثانیه کهنه باشد، در حالی که قبلاً هر poll تازه بود. پارامتر اختیاری `maxAge` فقط TTL را **کوتاه** می‌کند (هرگز بلندتر)، کلید و `ttl_seconds` ردیف را تغییر نمی‌دهد. درخواست‌های live و pollها `maxAge=5` می‌فرستند؛ درخواست‌های تاریخی ندارند و از TTL کامل استفاده می‌کنند.

**اثبات (اجرای واقعی همان کد Edge Function با DB و Binance ساختگی — `npm run check:market-data`، ۱۵ بررسی، همه PASS):**
- ۱۰ poll زنده در یک TTL → ۱ ردیف کش و ۱ فراخوانی upstream (رفتار قدیمی: ۱۰ ردیف و ۱۰ فراخوانی)؛
- ۷ درخواست متفاوت (endTime تاریخی دیگر، start دیگر، symbol، interval، limit، live) → ۷ ردیف مجزا و هر کدام کندل‌های خودش (بازه‌ی تاریخی دقیقاً همان بازه را برمی‌گرداند)؛
- تکرار یک درخواست تاریخی → Hit با کندل‌های یکسان؛
- `maxAge=5` روی ردیف ۱۰ثانیه‌ای → fetch تازه؛ روی ۲ثانیه‌ای → Hit؛ `maxAge` بزرگ هرگز TTL را تمدید نمی‌کند؛ مقدار نامعتبر نادیده گرفته می‌شود؛
- ۸ درخواست هم‌زمان یکسان → ۱ فراخوانی upstream.
تست‌های کلاینت (`marketDataRequests`, `marketDataProxy`) نیز پایداری query، حفظ endTime تاریخی و ارسال نشدن `maxAge/endTime` به Binance در مسیر مستقیم را می‌سنجند.

**محدودیت:** این تغییر روی نمودار/replay، بک‌تست و تایم‌فریم‌ها با تست واحد و شبیه‌ساز سنجیده شد، نه در مرورگر واقعی.

---

## ۵. بازبینی migration پاک‌سازی کش (`20261127000000_market_cache_purge.sql`)

| بررسی | نتیجه (روی PostgreSQL 16.15 واقعی) |
|---|---|
| فقط ردیف‌های منقضی | قاعده‌ی دقیقاً مثل Edge Function: `fetched_at + ttl_seconds + grace < now()`؛ ردیف معتبر، `exchangeInfo` با TTL ۲۴ساعته، و ردیف تازه‌منقضی (داخل grace ۱ ساعته) حذف نشدند |
| جداول دیگر | جدول‌های signals/evaluations/backtests/trades (۵۰ ردیف نمونه هرکدام) دست‌نخورده؛ تابع فقط `market_data_cache` را لمس می‌کند |
| حذف دسته‌ای ایمن | `LIMIT` + `FOR UPDATE SKIP LOCKED`؛ حداکثر `batch×max_batches` (پیش‌فرض ۲۰۰۰×۲۵)؛ تست دسته‌ی ۲×۲ فقط ۴ ردیف حذف کرد؛ آرگومان نامعتبر رد می‌شود |
| ایندکس | **بدون ایندکس جدید** (دلیل: `fetched_at` در هر refresh تغییر می‌کند؛ ایندکس آن upsertهای پرتکرار را non-HOT می‌کرد. با کلید پایدار جدول کوچک می‌ماند و حذف روزانه یک scan ارزان است). ایندکس یکتای `(provider, cache_key)` دست‌نخورده |
| زمان‌بندی | روزانه ۰۳:۱۷ UTC با pg_cron؛ روی page load یا شروع برنامه اجرا نمی‌شود؛ مکانیزم انقضای دوم اضافه نشده |
| امنیت | `search_path` ثابت، بدون `SECURITY DEFINER`، `REVOKE` از `public/anon/authenticated` (تست: `anon` رد شد). `service_role` طبق پیش‌فرض Supabase EXECUTE دارد (فقط با کلید سرویس قابل فراخوانی است) |
| Idempotent | اعمال دوباره‌ی migration فقط **یک** job نگه می‌دارد (روی PostgreSQL با pg_cron واقعی تست شد) |
| Rollback | `supabase/rollback/market_cache_purge_down.sql` job و تابع را برمی‌دارد (تست شد). بازیابی داده لازم نیست: ردیف حذف‌شده فقط یک miss است و دوباره از Binance ساخته می‌شود |

**پیش‌نیاز pg_cron (مستند، نه فرض):** افزونه‌ی `pg_cron` باید در پروژه فعال باشد (Dashboard → Database → Extensions → `pg_cron`، یا `create extension pg_cron;`). migration افزونه را **نمی‌سازد**؛ اگر نباشد فقط یک NOTICE می‌دهد و هیچ زمان‌بندی‌ای نمی‌سازد (تابع باقی می‌ماند و با هر scheduler دیگری قابل‌اجراست). در Production وجود/فعال بودن pg_cron را نتوانستم بررسی کنم.

---

## ۶. بررسی رفتار کوئری‌ها (`reverse_plus_evaluations`, `reverse_plus_backtests`, `reverse_plus_trades`, `reverse_signal_outcomes`, `market_data_cache`)

| مورد | وضعیت |
|---|---|
| خطای نادیده‌گرفته‌شده | ارزیاب: خواندن open trades، signalهای معاملات باز، lookup معامله و لغو معامله‌ی PENDING اکنون **throw** می‌کنند. خواندن دسته‌ای ناموفق به خواندن per-id می‌افتد و خطا در `errors` پاسخ ثبت می‌شود (در harness تست شد). فرانت: شکست evaluationها دیگر بی‌صدا نیست |
| شکست خواندن ≠ «وجود ندارد» | هیچ خواندن ناموفقی خالی تفسیر نمی‌شود؛ اجرا یا fallback می‌کند یا متوقف می‌شود (اجرای بعدی ادامه می‌دهد). ارزیاب فقط با ignoreDuplicates می‌نویسد، پس تکرار اجرا امن است |
| صفحه‌بندی | وضعیت‌های evaluation/backtest/trade با `order id` + `range` صفحه‌بندی می‌شوند؛ لیست سیگنال‌ها اکنون با `signal_at desc, id desc` (ترتیب کامل) |
| نوشتن دسته‌ای idempotent | `upsert … onConflict (owner_key, reverse_outcome_id, eval_kind)`؛ خطای یک دسته → fallback تک‌به‌تک برای جداسازی ردیف خراب |
| درخواست تکراری | `requestCache` (فرانت) و coalescing (market-data) |
| رکورد از قلم نیافتد | پنجره‌ی `signal_at` شامل `OR signal_at IS NULL`؛ سیگنال‌های قدیمی‌تر از پنجره که معامله‌ی باز دارند جداگانه بارگذاری می‌شوند؛ بک‌لاگ تاریخی با ترتیب hash-شده‌ی هر اجرا گرسنه نمی‌ماند (تست) |
| داده‌ی تاریخی | ارزیاب همان فرمول‌ها را اجرا می‌کند؛ harness ۰ اختلاف در ۳۲۱۰ ارزیابی، ۳۰۰ معامله و ۲۷۰۰ بک‌تست نشان داد؛ ضمناً در PowerMix هیچ محاسبه‌ی آماری تغییر نکرد (فقط منبع داده کش می‌شود) |

---

## ۷. bundleهای `supabase/single-file/`

پروژه با `npm run bundle:functions` فقط `scheduled-scan` و `track-signal` را (با engine داخل‌خطی) برای paste در داشبورد می‌سازد؛ `reverse-plus-eval` و `market-data` در این فهرست نیستند و با CLI deploy می‌شوند.
- من `scheduled-scan` (لاگ) و `engine.ts` (حذف فیلد Scalp) را تغییر دادم، پس هر دو bundle **بازتولید شدند** و idempotent هستند (اجرای دوم بدون تغییر).
- **ناهم‌خوانی از قبل:** bundleهای ZIP اصلی از قبل با سورس‌ها هم‌خوان نبودند (حدود ۷۶۴ خط اختلاف پیش از هر تغییر من). بازتولید، آن‌ها را به سورس فعلی می‌رساند و تغییرات قدیمی‌تر سورس هم وارد می‌شود (اندازه: ۷۵٬۶۴۷ → ۷۸٬۷۶۳ و ۵۱٬۶۲۰ → ۵۴٬۲۹۸ بایت). اگر Production از bundle قدیمی ساخته شده بود، رفتار آن با سورس فعلی تفاوت دارد؛ قبل از paste این را در نظر بگیرید.
- هر دو bundle با `deno check` بدون خطا type-check شدند و هیچ ارجاعی به Scalp ندارند.

---

## ۸. فهرست تغییرات این مرحله (نسبت به تحویل قبلی)

**حذف‌شده:** `src/pages/ScalpPage.tsx`، `src/components/VolumeProfileChart.tsx`، `src/engine/__tests__/scalp.test.ts`، `supabase/functions/_shared/scalp.ts`.
**جدید:** `scripts/eval-harness/market-data-check.mjs`، `src/__tests__/scalpRemoval.test.ts`، `src/reversePlus/__tests__/evalDefaults.test.ts`، `src/services/__tests__/marketDataProxy.test.ts`.
**تغییرکرده:** `README.md`، `package.json` (اسکریپت `check:market-data`)، `scripts/eval-harness/run.mjs`، `src/App.tsx`، `src/components/Layout.tsx`، `src/components/ReversePlusFeed.tsx`، `src/i18n/reversePlusTranslations.ts`، `src/i18n/translations.ts`، `src/pages/OriginalPlusSignalPage.tsx`، `src/pages/ReversePlusSignalPage.tsx`، `src/reversePlus/__tests__/independence.test.ts`، `src/services/marketData.ts`، `src/services/powerMixService.ts`، `src/types/market.ts`، `supabase/functions/_shared/engine.ts`، `supabase/functions/market-data/index.ts`، `supabase/functions/reverse-plus-eval/index.ts`، migration و rollback پاک‌سازی کش، هر دو bundle، `tsconfig.app.json`، `vite.config.ts`.
(فهرست کامل نسبت به ZIP اصلی در `usage-optimization-complete.patch` است.)

---

## ۹. دستورات و مراحل دستی قبل از Production

### محلی
```bash
npm ci
npm run typecheck            # انتظار: دقیقاً همان ۸ خطای قبلی (بخش TESTING_REPORT)
npm test                     # انتظار: فقط thermometer + ۲ فایل بارگذاری‌نشده‌ی قبلی
npm run build
npm run eval:harness         # قدیمی/جدید: داده‌ی یکسان + جدول کاهش   (SIGNALS_LIVE=300 SIGNALS_HIST=3300 RUNS=14 HOT=1 EDGE=1)
npm run check:market-data    # ۱۵ بررسی کش market-data
```

### مراحل دستی (به ترتیب، پس از بازبینی و تأیید شما)
1. **فقط‌خواندنی:** `supabase/diagnostics/usage_audit.sql` را اجرا و ذخیره کنید («قبل»). بخش ۱ برنامه‌ی واقعی cron ارزیاب را نشان می‌دهد (ریپو ساعتی می‌گوید؛ شما ۵دقیقه‌ای گفتید).
2. اگر پاک‌سازی روزانه را می‌خواهید، `pg_cron` را فعال کنید (بخش ۵).
3. Deploy (**ترتیب مهم است:** `market-data` قبل از فرانت‌اند، چون فرانت جدید `maxAge` می‌فرستد؛ سرور قدیمی آن را نادیده می‌گیرد و تازگی live کم می‌شود):
```bash
supabase link --project-ref aabcrkdwigkzznhlwcgm
supabase db push                                             # migration پاک‌سازی (غیرمخرب)
supabase functions deploy market-data       --no-verify-jwt
supabase functions deploy reverse-plus-eval --no-verify-jwt
supabase functions deploy scheduled-scan    --no-verify-jwt
# سپس build و deploy فرانت‌اند (npm run build) روی Cloudflare Pages
```
4. بدون هیچ secret، ارزیاب با پیش‌فرض‌های امن اجرا می‌شود. **فعال‌سازی opt-in فقط پس از تأیید جداگانه:**
```bash
supabase secrets set REVERSE_PLUS_LIVE_SKIP_UNCHANGED=true   # ریسک: تغییر مشخصات قرارداد Binance تا ۶ ساعت دیر اعمال می‌شود
supabase secrets set REVERSE_PLUS_HOT_ONLY=true              # ریسک: بک‌لاگ تاریخی تا یک ساعت دیرتر
```

### Rollback
| چه چیزی | چگونه |
|---|---|
| کد Edge Functionها | deploy مجدد نسخه‌ی قبلی (`patch -R -p1 < usage-optimization-complete.patch`، یا نسخه‌ی قبلی از Git) |
| opt-inها | `supabase secrets unset REVERSE_PLUS_LIVE_SKIP_UNCHANGED REVERSE_PLUS_HOT_ONLY` |
| migration | `psql -f supabase/rollback/market_cache_purge_down.sql` |
| فرانت‌اند | deploy مجدد build قبلی |

---

## ۱۰. اندازه‌گیری پس از deploy
۱) دوباره `usage_audit.sql` (بخش‌های ۲، ۳، ۵). ۲) در Supabase Logs شمارش `GET/POST /rest/v1/reverse_plus_evaluations` در ۲۴ ساعت قبل/بعد و خط `reverse-plus-eval full ms=… reads=… writes=…`. ۳) ردیف‌های `klines` با `endTime` صریح در `market_data_cache` باید به‌تدریج به صفر برسند. ۴) در مرورگر، تب پنهان نباید درخواستی بزند (Network).

## ۱۱. هشدارها و محدودیت‌های شناخته‌شده
- دو migration (`20261109000000_reverse_plus_public.sql`، `20261109000100_reverse_plus_backtests.sql`) و `scripts/golden-signal-output.ts` در ZIP نیستند؛ دو فایل تست به همین دلیل بارگذاری نمی‌شوند و استقلال مدل عمومی از تنظیمات کاربر با آن‌ها **سنجیده نشد**. هیچ schema روی جدول‌های `reverse_plus_*` تغییر نکرد.
- Retention همچنان فقط گزارش است (بخش ۷ گزارش قبلی و `usage_audit.sql` بخش‌های ۷–۱۱)؛ هیچ حذفی پیاده نشد.
- پاسخ‌های خواندن ارزیاب هنوز ≈۲٫۴ MB/اجرا (لیست ۳۰۰۰ سیگنال)؛ کاهش بیشتر فقط با `HOT_ONLY` یا ذخیره‌ی زمان آخرین شبیه‌سازی معامله (نیازمند schema).
- هر درخواست `market-data` یک `auth.getUser()` هم دارد (درخواست Auth)؛ دست نزدم.
- زمان‌بندی واقعی cron در Production باید تأیید شود.

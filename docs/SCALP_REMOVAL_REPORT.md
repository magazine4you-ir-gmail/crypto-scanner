# گزارش حذف کامل Fast Scalp

> وضعیت: پیاده‌سازی در کد انجام شده و تست شده است. هیچ migration اجرا، Edge Function deploy یا داده‌ای در Production تغییر/حذف نشده است.

## ۱. روش

۱) ابتدا کل پروژه (کد، پیکربندی، bundleها، migrationها، اسکریپت‌ها، مستندات) با جست‌وجوی بدون‌حساسیت‌به‌حروف برای `scalp` بررسی شد. ۲) برای هر ارجاع، وابستگی‌های مشترک جداگانه راستی‌آزمایی شد. ۳) فقط پیاده‌سازی واقعی حذف شد؛ منو یا route پنهان/غیرفعال نشد. ۴) یک تست دائمی (`src/__tests__/scalpRemoval.test.ts`) برگشت هر ارجاع را در آینده می‌گیرد.

## ۲. آنچه حذف شد

| مورد | فایل / محل |
|---|---|
| صفحه‌ی Scalp (UI، state، polling خودکار ۳۰ثانیه‌ای، فراخوانی‌های داده) | `src/pages/ScalpPage.tsx` (حذف فایل) |
| نمودار Volume Profile (فقط توسط Scalp استفاده می‌شد) | `src/components/VolumeProfileChart.tsx` (حذف فایل) |
| موتور Scalp (تحلیل، پلن، HTF bias) | `supabase/functions/_shared/scalp.ts` (حذف فایل) |
| تست‌های Scalp (۲۳ تست) | `src/engine/__tests__/scalp.test.ts` (حذف فایل) |
| route `/scalp` و import صفحه | `src/App.tsx` |
| ورودی منوی ناوبری و آیکن `Zap` (فقط برای Scalp) | `src/components/Layout.tsx` |
| کلید ترجمه‌ی `scalp` | `src/i18n/translations.ts` |
| alias `@scalp` | `vite.config.ts`، `tsconfig.app.json` |
| بخش مستندات Fast Scalp | `README.md` |
| فیلد `takerBuyVolume` (فقط فیلتر دلتای Scalp آن را می‌خواند؛ هیچ کد دیگری نمی‌خواند) | `src/types/market.ts`، `supabase/functions/_shared/engine.ts` (فقط تعریف نوع)، `src/services/marketData.ts` و `supabase/functions/market-data/index.ts` (فقط نگاشت یک فیلد اضافه) |
| نمونه‌ی `scalp` در تست استقلال Reverse Plus (جایگزین با ورودی خنثی `powerMix`) | `src/reversePlus/__tests__/independence.test.ts` |
| ارجاع‌های تولیدشده در bundleها | `supabase/single-file/*.ts` (بازتولید با `npm run bundle:functions`) |

حذف `takerBuyVolume` فقط یک فیلد اختیاری و بی‌مصرف را برمی‌دارد: هیچ منطق سیگنال، استراتژی یا محاسبه‌ای تغییر نکرد (typecheck، ۲۹۹ تست و ۴ `deno check` پاس شدند) و پاسخ `market-data` برای هر کندل کمی کوچک‌تر شد.

## ۳. چیزهایی که عمداً **نگه داشته شد** (مشترک)

| مورد | چرا نگه داشته شد |
|---|---|
| `fetchKlines`, `fetchKlinesRange` | صفحه‌های جزئیات سیگنال، PowerMix و سایر بخش‌ها از آن‌ها استفاده می‌کنند |
| `fetchTickers` و action `ticker` در `market-data` | `AssetDetailPage` (و بخش‌های دیگر) از آن‌ها استفاده می‌کنند؛ Scalp فقط یکی از مصرف‌کنندگان بود |
| Edge Function `market-data` و کش `market_data_cache` | مشترک بین کل برنامه |
| نوع `Timeframe` و تایم‌فریم `1m` در `TIMEFRAMES`، جدول‌های `TF_MS`، `INTERVAL_ALLOWLIST` | Scalp تنها مصرف‌کننده‌ی `1m` نبود؛ همین مقادیر در صفحه‌ها، AutoScan و Edge Function مشترک‌اند |
| `useVisibleInterval`، `requestCache` | زیرساخت بهینه‌سازی مشترک (AutoScan، PowerMix، صفحه‌های جزئیات) |
| توابع engine مانند `closedCandles`، `quoteOf`، `normalizeSymbol` | بخشی از موتور مشترک سیگنال؛ دست نخورد |
| همه‌ی پکیج‌های npm | بررسی شد: هیچ پکیجی منحصر به Scalp نبود (`lucide-react`، `react` و غیره مشترک‌اند)، پس `package.json` برای وابستگی‌ها تغییری نکرد |

## ۴. اشیای دیتابیس، Edge Function و زمان‌بندی

| بررسی | نتیجه |
|---|---|
| جدول، ستون، policy، تابع یا migration مخصوص Scalp | **هیچ‌کدام وجود نداشت** (جست‌وجوی `scalp` در `supabase/migrations`، `supabase/*.sql`، `supabase/admin`، `supabase/rollback` نتیجه‌ای نداد) |
| Edge Function مخصوص Scalp | وجود نداشت؛ Scalp از `market-data` مشترک استفاده می‌کرد |
| cron/job مخصوص Scalp | وجود نداشت |
| ذخیره‌ی مرورگر (localStorage/sessionStorage) | Scalp از آن استفاده نمی‌کرد؛ از `useSettings` فقط زبان را می‌خواند و هیچ تنظیمی از Scalp در دیتابیس ذخیره نمی‌شد |
| داده‌ی تاریخی/کاربر مرتبط با Scalp | **ندارد**؛ Scalp هیچ ردیفی در دیتابیس نمی‌نوشت. پس چیزی برای «دست‌نخورده نگه داشتن» جز جدول‌های مشترک نیست (signals، outcomes، trades و غیره کاملاً دست‌نخورده‌اند) |

نتیجه: **هیچ تغییر دیتابیس یا Supabase لازم نیست** و هیچ‌کدام انجام نشد.

## ۵. درخواست‌هایی که کم می‌شوند

Scalp جدول دیتابیس نداشت؛ مصرفش فقط فراخوانی‌های Edge Function `market-data` بود (که خودشان یک `auth.getUser`، یک خواندن کش و در miss یک upsert کش تولید می‌کنند). هر اسکن Scalp با لیست پیش‌فرض ۱۰ ارز: ۱ فراخوانی `ticker` + تا ۲۰ فراخوانی `klines` (۱۰ ارز × تایم‌فریم اصلی + HTF)، یعنی تا حدود **۲۱ فراخوانی در هر اسکن**. با Auto روشن (هر ۳۰ ثانیه) در یک تب باز تا حدود **۲٬۵۰۰ فراخوانی در ساعت**. این‌ها اکنون صفرند. سهم واقعی Production به استفاده‌ی کاربران بستگی دارد و از روی کد قابل‌اندازه‌گیری نیست.

اثر جانبی: bundle اصلی فرانت از ۴۴۶٫۷۰ kB به ۴۱۱٫۷۰ kB (gzip: ۱۳۲٫۲۲ → ۱۱۷٫۲۴ kB) کوچک شد.

## ۶. رفتار لینک‌های قدیمی
مسیر `/scalp` دیگر route ندارد و مثل هر مسیر ناشناخته با `<Route path="*">` به `/` (داشبورد) هدایت می‌شود (تست شد). Bookmarkهای قدیمی خطا نمی‌دهند.

## ۷. تأیید باقی ویژگی‌ها
نتیجه‌ی تست‌ها در `TESTING_REPORT.md`. خلاصه: typecheck بدون خطای جدید؛ ۲۹۸ از ۲۹۹ تست پاس (تنها شکست از قبل وجود داشت)؛ build موفق؛ تست یکپارچگی ثابت می‌کند هر importِ `src` به فایل موجود اشاره می‌کند، هر ورودی منو route، صفحه و ترجمه دارد و ویژگی‌های `/scanner`، `/auto-scan`، `/signal-lab`، `/reverse-lab`، `/power-mix`، `/performance`، `/backtest`، `/settings` همچنان route دارند. تست‌های موجود Signal Lab، Reverse Lab، Original Lab، PowerMix، بک‌تست و آمار (بخش‌های بدون تغییر) پاس می‌شوند. Reverse Plus، Manual Scan و احراز هویت در مرورگر واقعی اجرا نشدند (فقط تست واحد/یکپارچگی).

## ۸. مراحل دستی
هیچ مرحله‌ی دستی مخصوص Scalp لازم نیست (نه SQL، نه deploy جداگانه). فقط deploy معمول فرانت‌اند (و در صورت استفاده از paste دستی، bundleهای بازتولیدشده).

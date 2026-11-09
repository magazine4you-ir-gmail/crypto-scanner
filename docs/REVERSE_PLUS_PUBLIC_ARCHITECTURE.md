# Reverse Plus — مدل عمومی/مرکزی، بک‌تست و صفحهٔ سیگنال (گزارش معماری)

## ۱. معماری
| لایه | مسیر | نقش |
|---|---|---|
| دیتابیس | `20261109000000_reverse_plus_public.sql` | `reverse_plus_public_config` (تنظیمات مرجع + `public_since`)، `user_id` نال‌پذیر در evaluations/trades (NULL = ردیف مرکزی)، `owner_key` برای upsert، RLS خواندن عمومی، کپی سوابق قدیمی |
| دیتابیس | `20261109000100_reverse_plus_backtests.sql` | جدول مرکزی نتایج بک‌تست (فقط خواندن برای کاربران) |
| Edge | `reverse-plus-eval/index.ts` | یک پردازش مرکزی؛ مرز تاریخی/زنده؛ بک‌تست تاریخی با ترتیب‌یابی تایم‌فریم پایین‌تر |
| موتور خالص | `_shared/reversePlus/{backtest,leverage,backtestStats,replay,instruction,publicScope}.ts` | بک‌تست، اهرم/لیکویید/PnL، آمار، Replay، دستورالعمل، مرز عمومی (Dec/BigInt؛ بدون وابستگی به UI) |
| فرانت | `ReversePlusPage` (+تب «مرکز تحلیل»)، `ReversePlusAnalysis`، `ReversePlusSignalPage` (`/reverse-plus/signal/:id`)، `PriceChart` (توسعه‌یافته) | داشبورد، فیلتر، کارت‌ها، نمودار تعاملی |

## ۲. مرز دقیق تاریخی / زنده (`public_since`)
* قبل از `public_since`: فقط `SIGNAL_TIME` (اسنپ‌شات لحظهٔ صدور) + بک‌تست. **بدون LIVE و بدون PAPER.**
* بعد از `public_since`: SIGNAL_TIME + LIVE + PAPER طبق قوانین موتور.
* بک‌تست فقط کندل‌های «بعد از بسته‌شدن کندل سیگنال» را، مرتب و بدون تکرار، می‌خواند؛ قیمت فعلی هیچ‌وقت وارد نتیجهٔ تاریخی نمی‌شود.

## ۳. بک‌تست (موتور `bt-1`)
ورود Limit در سطح Entry فقط وقتی کندل به آن برسد؛ TP و SL در یک کندل بدون ترتیب معلوم → ابتدا تایم‌فریم پایین‌تر (1m/5m/15m/1h)، وگرنه `AMBIGUOUS`؛ نبود داده → `UNKNOWN`؛ بدون ورود → `NO_ENTRY`؛ ورود بدون خروج در پنجرهٔ نگه‌داری → `EXPIRED`؛ گپ SL با قیمت باز، TP با قیمت TP. Win rate مخرج: WIN+LOSS+BREAKEVEN. فاندینگ لحاظ نمی‌شود (`fundingIncluded:false`).

## ۴. تنظیمات مرکزی
مقادیر پیش‌فرض با ستون‌های `reverse_plus_settings` و `DEFAULT_PLUS_SETTINGS` یکی‌اند (تست `configConsistency.test.ts`). فقط service_role/مالک پروژه می‌تواند تغییر دهد (`supabase/admin/reverse_plus_config.sql`)؛ کاربر عادی فقط SELECT دارد. تنظیمات شخصی (`reverse_plus_settings`) فقط برای ثبت ACTUAL شخصی است و روی نتایج عمومی اثر ندارد.

## ۵. معاملات PAPER قدیمیِ باز — پیشنهاد (اعمال نشده)
تعداد را اینجا بشمارید: `select user_id, count(*) from reverse_plus_trades where mode='PAPER' and outcome in ('PENDING','OPEN') and user_id is not null group by 1;`
* **گزینه A (پیشنهادی):** مالکیت تغییر نکند؛ در تابع یک «پاس میراث» اضافه شود که فقط همین معاملات باز را با `plan` ذخیره‌شده و کارمزد/لغزش همان کاربر تا بسته‌شدن پیش ببرد. نتیجه خصوصی کاربر می‌ماند و وارد آمار عمومی نمی‌شود. تکرار ندارد؛ محاسبات قبلی تغییر نمی‌کند.
* گزینه B: بدون تغییر (حالت فعلی Patch) → همان‌طور OPEN می‌مانند.
* گزینه C (توصیه نمی‌شود): تبدیل به ردیف مرکزی؛ حجم‌ها بر اساس موجودی/اهرم شخصی بوده و آمار عمومی را آلوده می‌کند.

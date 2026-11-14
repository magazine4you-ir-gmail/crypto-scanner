# Power Mix Lab (میکس هوشمند) — `/power-mix`

صفحهٔ عمومی (برای همهٔ کاربران واردشده) که سیگنال‌های Signal Lab و Reverse Signal Lab را بر اساس **قدرت روند روزانهٔ BTCUSDT** (به وقت Asia/Tehran) ترکیب می‌کند.

## منطق دسته‌بندی روز
حرکت هر بازه = حرکت خالص `(close آخرین کندل − open اولین کندل) / open اولین کندل` روی کندل‌های ۳۰ دقیقه‌ای BTCUSDT.

| کلاس | شرط |
|---|---|
| Very Strong | هر دو بازهٔ لندن و آمریکا ≥ آستانه، **هم‌جهت** |
| Mixed Direction | هر دو ≥ آستانه، **خلاف جهت** |
| Power | فقط یکی از دو بازه ≥ آستانه |
| Neutral | هیچ‌کدام |

پیش‌فرض‌ها: آستانه ۲٪ · لندن ۱۱:۳۰–۱۴:۳۰ · آمریکا ۱۶:۳۰–۱۹:۳۰ · ساعت مرده ۰۲:۰۰–۱۱:۰۰ و از ۲۱:۳۰.

* هر سیگنال با **زمان تولید خودش** دسته‌بندی می‌شود (`candle_close_time`، در غیر این صورت `signal_at`).
* سیگنال در ساعت مرده ← بلافاصله: حرکت BTC از ۰۰:۰۰ تا لحظهٔ سیگنال ≥ آستانه = Power، وگرنه Neutral، با برچسب «ساعت مرده».
* سیگنال خارج از ساعت مرده ← تا بسته‌شدن بازهٔ آمریکا **Pending** (با تمایل تقریبی صعودی/نزولی/خنثی)، بعد قفل می‌شود.
* برچسب «کم‌حجم / تعطیل‌مانند»: مجموع حجم لندن+آمریکای آن روز < ۵۰٪ میانهٔ ۱۴ روز قبل (قابل تنظیم، ۰ = خاموش).

## میکس هوشمند
VERY_STRONG / POWER / MIXED ← سیگنال اصلی · NEUTRAL ← سیگنال معکوس (قابل تغییر برای هر کلاس).
دکمهٔ «منطق وارونه» عکس این انتخاب را برای راستی‌آزمایی نشان می‌دهد. سیگنال‌های Pending از آمار میکس خارج‌اند.

## داده و معماری
* سیگنال‌ها: `reverse_signal_outcomes` + join یک‌به‌یک به `signal_outcomes` (فقط خواندن، CANCELLED حذف) — هیچ منطق تولید/تعیین نتیجهٔ سیگنال تغییر نکرده است.
* قیمت BTC: همان Edge Function موجود `market-data` (`fetchKlinesRange`) — **نیازی به Edge Function یا cron جدید نیست**. قدرت روز در مرورگر محاسبه می‌شود، پس با هر تغییر آستانه/بازه فوراً بازمحاسبه می‌شود.
* تنظیمات عمومی: جدول تک‌ردیفه `power_mix_config` (کاربران فقط SELECT؛ مدیر با `supabase/admin/power_mix_config.sql` تغییر می‌دهد).
* تنظیمات شخصی: هر کاربر می‌تواند در همان صفحه مقادیر را فقط برای نمای خودش (localStorage مرورگر) عوض کند.
* کارت سیگنال معکوس = `ReversePlusSignalCard` (جزئیات ← `/reverse-plus/signal/:id`). کارت سیگنال اصلی = همان قالب با همان محاسبهٔ ماشین‌حساب محلی (`computeSignalSummary`)، جزئیات ← صفحهٔ دارایی Signal Lab.

## فایل‌ها
جدید: `src/powerMix/*` (tehranTime, config, dayPower, mix + تست‌ها) · `src/services/powerMixService.ts` · `src/pages/PowerMixPage.tsx` · `src/components/PowerMix{Chips,LiveCard,OriginalCard,Compare,SettingsPanel}.tsx` · `src/components/LabStats.tsx` · `src/i18n/powerMixTranslations.ts` · `supabase/migrations/20261115000000_power_mix_config.sql` · `supabase/admin/power_mix_config.sql` · `supabase/rollback/power_mix_down.sql` · `supabase/tests/power_mix_rls.sql`
ویرایش‌شده: `src/App.tsx` (۱ مسیر) · `src/components/Layout.tsx` (۱ آیتم منو) · `src/i18n/translations.ts` (merge ترجمه‌ها)

## برگشت
حذف جدول: `supabase/rollback/power_mix_down.sql`. صفحه بدون جدول هم با پیش‌فرض‌های داخلی کار می‌کند.

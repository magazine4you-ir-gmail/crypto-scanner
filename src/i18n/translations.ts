export type Lang = 'fa' | 'en';

export interface Translations {
  [key: string]: { fa: string; en: string };
}

export const translations: Translations = {
  // Navigation
  dashboard: { fa: 'داشبورد', en: 'Dashboard' },
  scanner: { fa: 'اسکنر', en: 'Scanner' },
  market: { fa: 'بازار', en: 'Market' },
  assets: { fa: 'دارایی‌ها', en: 'Assets' },
  watchlist: { fa: 'واچ‌لیست', en: 'Watchlist' },
  portfolio: { fa: 'پرتفوی', en: 'Portfolio' },
  journal: { fa: 'ژورنال', en: 'Journal' },
  backtest: { fa: 'بک‌تست', en: 'Backtest' },
  performance: { fa: 'عملکرد', en: 'Performance' },
  settings: { fa: 'تنظیمات', en: 'Settings' },
  profile: { fa: 'پروفایل', en: 'Profile' },

  // Auth
  login: { fa: 'ورود', en: 'Login' },
  register: { fa: 'ثبت‌نام', en: 'Register' },
  logout: { fa: 'خروج', en: 'Logout' },
  email: { fa: 'ایمیل', en: 'Email' },
  password: { fa: 'رمز عبور', en: 'Password' },
  confirmPassword: { fa: 'تکرار رمز عبور', en: 'Confirm Password' },
  forgotPassword: { fa: 'فراموشی رمز عبور', en: 'Forgot Password' },
  resetPassword: { fa: 'بازنشانی رمز عبور', en: 'Reset Password' },
  signIn: { fa: 'ورود به حساب', en: 'Sign In' },
  signUp: { fa: 'ایجاد حساب', en: 'Sign Up' },
  noAccount: { fa: 'حساب ندارید؟', en: "Don't have an account?" },
  haveAccount: { fa: 'حساب دارید؟', en: 'Already have an account?' },
  invalidCredentials: { fa: 'ایمیل یا رمز عبور نامعتبر', en: 'Invalid email or password' },
  emailNotConfirmed: { fa: 'ایمیل تأیید نشده است', en: 'Email not confirmed' },
  passwordTooShort: { fa: 'رمز عبور باید حداقل ۶ کاراکتر باشد', en: 'Password must be at least 6 characters' },
  passwordsDontMatch: { fa: 'رمز عبور و تکرار آن یکسان نیستند', en: 'Passwords do not match' },
  registrationSuccess: { fa: 'ثبت‌نام موفق بود', en: 'Registration successful' },
  registrationFailed: { fa: 'ثبت‌نام ناموفق بود', en: 'Registration failed' },
  checkEmail: {
    fa: 'ثبت‌نام انجام شد. لطفاً ایمیل خود را بررسی کرده و روی لینک تأیید کلیک کنید، سپس وارد شوید.',
    en: 'Registration complete. Please check your email and click the confirmation link, then sign in.',
  },
  resetLinkSent: { fa: 'لینک بازنشانی ارسال شد', en: 'Reset link sent' },
  welcomeBack: { fa: 'خوش آمدید', en: 'Welcome Back' },
  createAccount: { fa: 'ایجاد حساب کاربری', en: 'Create Account' },
  authSubtitle: { fa: 'پلتفرم تحلیل بازار و سیگنال ارزهای دیجیتال', en: 'Crypto Market Analysis & Signal Platform' },

  // Dashboard
  marketOverview: { fa: 'نمای کلی بازار', en: 'Market Overview' },
  marketRegime: { fa: 'رژیم بازار', en: 'Market Regime' },
  topSetups: { fa: 'بهترین ستاپ‌ها', en: 'Top Setups' },
  recentSignals: { fa: 'سیگنال‌های اخیر', en: 'Recent Signals' },
  providerStatus: { fa: 'وضعیت ارائه‌دهنده', en: 'Provider Status' },
  dataFreshness: { fa: 'تازگی داده', en: 'Data Freshness' },
  systemHealth: { fa: 'سلامت سیستم', en: 'System Health' },
  lastUpdate: { fa: 'آخرین به‌روزرسانی', en: 'Last Update' },
  noSignalsYet: { fa: 'هنوز سیگنالی تولید نشده است', en: 'No signals generated yet' },

  // Scanner
  scannerTitle: { fa: 'اسکنر سیگنال', en: 'Signal Scanner' },
  assetUniverse: { fa: 'جهان دارایی', en: 'Asset Universe' },
  timeframe: { fa: 'تایم‌فریم', en: 'Timeframe' },
  minScore: { fa: 'حداقل امتیاز', en: 'Minimum Score' },
  riskLevel: { fa: 'سطح ریسک', en: 'Risk Level' },
  minRR: { fa: 'حداقل R/R', en: 'Minimum R/R' },
  signalType: { fa: 'نوع سیگنال', en: 'Signal Type' },
  scan: { fa: 'اسکن', en: 'Scan' },
  scanning: { fa: 'در حال اسکن...', en: 'Scanning...' },
  noResults: { fa: 'نتیجه‌ای یافت نشد', en: 'No results found' },
  asset: { fa: 'دارایی', en: 'Asset' },
  signal: { fa: 'سیگنال', en: 'Signal' },
  score: { fa: 'امتیاز', en: 'Score' },
  trend: { fa: 'روند', en: 'Trend' },
  structure: { fa: 'ساختار', en: 'Structure' },
  risk: { fa: 'ریسک', en: 'Risk' },
  rr: { fa: 'R/R', en: 'R/R' },
  price: { fa: 'قیمت', en: 'Price' },
  updated: { fa: 'به‌روزرسانی', en: 'Updated' },

  // Signal types
  buy: { fa: 'خرید', en: 'BUY' },
  wait: { fa: 'انتظار', en: 'WAIT' },
  exit: { fa: 'خروج', en: 'EXIT' },
  noTrade: { fa: 'عدم معامله', en: 'NO TRADE' },

  // Trend
  bullish: { fa: 'صعودی', en: 'Bullish' },
  bearish: { fa: 'نزولی', en: 'Bearish' },
  neutral: { fa: 'خنثی', en: 'Neutral' },

  // Risk levels
  low: { fa: 'پایین', en: 'Low' },
  medium: { fa: 'متوسط', en: 'Medium' },
  high: { fa: 'بالا', en: 'High' },

  // Regimes
  bullishTrend: { fa: 'روند صعودی', en: 'Bullish Trend' },
  bearishTrend: { fa: 'روند نزولی', en: 'Bearish Trend' },
  range: { fa: 'رنج', en: 'Range' },
  highVolatility: { fa: 'نوسان بالا', en: 'High Volatility' },
  lowVolatility: { fa: 'نوسان پایین', en: 'Low Volatility' },
  transition: { fa: 'گذار', en: 'Transition' },
  unclear: { fa: 'نامشخص', en: 'Unclear' },

  // Asset Detail
  price24h: { fa: 'تغییر ۲۴ ساعت', en: '24H Change' },
  volume24h: { fa: 'حجم ۲۴ ساعت', en: '24H Volume' },
  marketCap: { fa: 'ارزش بازار', en: 'Market Cap' },
  rank: { fa: 'رتبه', en: 'Rank' },
  chart: { fa: 'چارت', en: 'Chart' },
  indicators: { fa: 'اندیکاتورها', en: 'Indicators' },
  supportResistance: { fa: 'حمایت/مقاومت', en: 'Support/Resistance' },
  signalHistory: { fa: 'تاریخچه سیگنال', en: 'Signal History' },
  entryZone: { fa: 'محدوده ورود', en: 'Entry Zone' },
  invalidation: { fa: 'ابطال', en: 'Invalidation' },
  stopLoss: { fa: 'حد ضرر', en: 'Stop Loss' },
  target1: { fa: 'هدف ۱', en: 'Target 1' },
  target2: { fa: 'هدف ۲', en: 'Target 2' },
  target3: { fa: 'هدف ۳', en: 'Target 3' },
  riskReward: { fa: 'نسبت ریسک به بازده', en: 'Risk/Reward' },
  positionSize: { fa: 'اندازه پوزیشن پیشنهادی', en: 'Suggested Position Size' },
  explanation: { fa: 'توضیحات', en: 'Explanation' },

  // Watchlist
  createWatchlist: { fa: 'ایجاد واچ‌لیست', en: 'Create Watchlist' },
  rename: { fa: 'تغییر نام', en: 'Rename' },
  delete: { fa: 'حذف', en: 'Delete' },
  addAsset: { fa: 'افزودن دارایی', en: 'Add Asset' },
  remove: { fa: 'حذف', en: 'Remove' },
  noWatchlists: { fa: 'هنوز واچ‌لیستی ساخته نشده است', en: 'No watchlists created yet' },
  watchlistName: { fa: 'نام واچ‌لیست', en: 'Watchlist Name' },

  // Portfolio
  portfolioTitle: { fa: 'پرتفوی دستی', en: 'Manual Portfolio' },
  addHolding: { fa: 'افزودن دارایی', en: 'Add Holding' },
  quantity: { fa: 'تعداد', en: 'Quantity' },
  avgEntry: { fa: 'میانگین قیمت ورود', en: 'Average Entry' },
  totalValue: { fa: 'ارزش کل', en: 'Total Value' },
  unrealizedPnl: { fa: 'سود/زیان محقق‌نشده', en: 'Unrealized PnL' },
  allocation: { fa: 'تخصیص', en: 'Allocation' },
  assetPerformance: { fa: 'عملکرد دارایی', en: 'Asset Performance' },
  noHoldings: { fa: 'هنوز دارایی‌ای اضافه نشده است', en: 'No holdings added yet' },

  // Journal
  journalTitle: { fa: 'ژورنال معاملات', en: 'Trading Journal' },
  addEntry: { fa: 'افزودن رکورد', en: 'Add Entry' },
  addJournalEntry: { fa: 'افزودن معامله', en: 'Add Trade' },
  side: { fa: 'جهت', en: 'Side' },
  entry: { fa: 'ورود', en: 'Entry' },
  exitPrice: { fa: 'قیمت خروج', en: 'Exit Price' },
  size: { fa: 'اندازه', en: 'Size' },
  result: { fa: 'نتیجه', en: 'Result' },
  strategy: { fa: 'استراتژی', en: 'Strategy' },
  notes: { fa: 'یادداشت', en: 'Notes' },
  date: { fa: 'تاریخ', en: 'Date' },
  noEntries: { fa: 'هنوز رکوردی ثبت نشده است', en: 'No entries recorded yet' },
  open: { fa: 'باز', en: 'Open' },
  win: { fa: 'سود', en: 'Win' },
  loss: { fa: 'زیان', en: 'Loss' },
  breakeven: { fa: 'بدون سود/زیان', en: 'Breakeven' },

  // Settings
  language: { fa: 'زبان', en: 'Language' },
  theme: { fa: 'پوسته', en: 'Theme' },
  darkMode: { fa: 'حالت تاریک', en: 'Dark Mode' },
  lightMode: { fa: 'حالت روشن', en: 'Light Mode' },
  defaultTimeframe: { fa: 'تایم‌فریم پیش‌فرض', en: 'Default Timeframe' },
  signalThreshold: { fa: 'آستانه سیگنال', en: 'Signal Threshold' },
  riskPercent: { fa: 'درصد ریسک', en: 'Risk %' },
  minRiskReward: { fa: 'حداقل R/R', en: 'Minimum R/R' },
  chartPreferences: { fa: 'ترجیحات چارت', en: 'Chart Preferences' },
  save: { fa: 'ذخیره', en: 'Save' },
  saved: { fa: 'ذخیره شد', en: 'Saved' },
  saveChanges: { fa: 'ذخیره تغییرات', en: 'Save Changes' },

  // Profile
  name: { fa: 'نام', en: 'Name' },
  security: { fa: 'امنیت', en: 'Security' },
  accountSettings: { fa: 'تنظیمات حساب', en: 'Account Settings' },
  preferences: { fa: 'ترجیحات', en: 'Preferences' },

  // Provider Status
  binance: { fa: 'بایننس', en: 'Binance' },
  coingecko: { fa: 'کوین‌گکو', en: 'CoinGecko' },
  coinmarketcap: { fa: 'کوین‌مارکت‌کپ', en: 'CoinMarketCap' },
  configured: { fa: 'پیکربندی شده', en: 'Configured' },
  notConfigured: { fa: 'پیکربندی نشده', en: 'Not Configured' },
  reachable: { fa: 'قابل دسترس', en: 'Reachable' },
  unreachable: { fa: 'غیرقابل دسترس', en: 'Unreachable' },

  // Common
  loading: { fa: 'در حال بارگذاری...', en: 'Loading...' },
  error: { fa: 'خطا', en: 'Error' },
  retry: { fa: 'تلاش مجدد', en: 'Retry' },
  cancel: { fa: 'انصراف', en: 'Cancel' },
  confirm: { fa: 'تأیید', en: 'Confirm' },
  close: { fa: 'بستن', en: 'Close' },
  back: { fa: 'بازگشت', en: 'Back' },
  search: { fa: 'جستجو', en: 'Search' },
  all: { fa: 'همه', en: 'All' },
  none: { fa: 'هیچ‌کدام', en: 'None' },
  yes: { fa: 'بله', en: 'Yes' },
  no: { fa: 'خیر', en: 'No' },
  saveSignal: { fa: 'ذخیره سیگنال', en: 'Save Signal' },
  signalSaved: { fa: 'سیگنال ذخیره شد', en: 'Signal saved' },
  generateSignal: { fa: 'تحلیل و تولید سیگنال', en: 'Analyze & Generate Signal' },
  analyzing: { fa: 'در حال تحلیل...', en: 'Analyzing...' },
  disclaimer: {
    fa: 'این محصول تنها ابزار تصمیم‌گیری و تحلیل بازار است و هیچ‌گونه وعده سود تضمینی نمی‌دهد. ریسک بازار را بپذیرید.',
    en: 'This product is a decision support and market analysis tool only. It makes no guaranteed profit claims. Accept market risk.',
  },
  dataNotAvailable: { fa: 'داده در دسترس نیست', en: 'Data not available' },
  providerNotConfigured: { fa: 'ارائه‌دهنده پیکربندی نشده است', en: 'Provider Not Configured' },
  staleData: { fa: 'داده قدیمی', en: 'Stale Data' },
  insufficientData: { fa: 'داده کافی نیست', en: 'Insufficient Data' },
  fetchError: { fa: 'خطا در دریافت داده', en: 'Failed to fetch data' },
  noChartData: { fa: 'داده چارت در دسترس نیست', en: 'No chart data available' },
  top10: { fa: '۱۰ برتر', en: 'Top 10' },
  top20: { fa: '۲۰ برتر', en: 'Top 20' },
  top50: { fa: '۵۰ برتر', en: 'Top 50' },
  top100: { fa: '۱۰۰ برتر', en: 'Top 100' },
  custom: { fa: 'سفارشی', en: 'Custom' },
  strong: { fa: 'قوی', en: 'Strong' },
  watch: { fa: 'تحت نظر', en: 'Watch' },
  positive: { fa: 'مثبت', en: 'Positive' },
  negative: { fa: 'منفی', en: 'Negative' },
  totalSignals: { fa: 'کل سیگنال‌ها', en: 'Total Signals' },
  validSignals: { fa: 'سیگنال‌های معتبر', en: 'Valid Signals' },
  noTradeRate: { fa: 'نرخ عدم معامله', en: 'NO TRADE Rate' },
  signalAccuracy: { fa: 'دقت سیگنال', en: 'Signal Accuracy' },
  winRate: { fa: 'نرخ برد', en: 'Win Rate' },
  profitFactor: { fa: 'ضریب سود', en: 'Profit Factor' },
  expectancy: { fa: 'انتظاری', en: 'Expectancy' },
  maxDrawdown: { fa: 'حداکثر افت سرمایه', en: 'Max Drawdown' },
  avgRR: { fa: 'میانگین R/R', en: 'Average R/R' },
  bestSetup: { fa: 'بهترین ستاپ', en: 'Best Setup' },
  worstSetup: { fa: 'بدترین ستاپ', en: 'Worst Setup' },
  paperTradingPerformance: { fa: 'عملکرد پیپر تریدینگ', en: 'Paper Trading Performance' },
  backtestPerformance: { fa: 'عملکرد بک‌تست', en: 'Backtest Performance' },
  comingSoon: { fa: 'به‌زودی', en: 'Coming Soon' },

  // Auto scan
  autoScan: { fa: 'اسکن خودکار', en: 'Auto Scan' },
  asDescription: {
    fa: 'اسکن ساعتی ۱۰۰ ارز برتر روی سرور (حتی وقتی سایت بسته است). سیگنال‌های خرید و شورت به‌همراه ورود، حد ضرر و هدف نمایش داده می‌شوند.',
    en: 'Hourly server-side scan of the top 100 coins (runs even when the site is closed). Shows Buy and Short signals with entry, stop loss and target.',
  },
  asShort: { fa: 'شورت', en: 'SHORT' },
  asBuyAndShort: { fa: 'خرید و شورت', en: 'Buy & Short' },
  asLastScan: { fa: 'آخرین اسکن', en: 'Last scan' },
  asCoins: { fa: 'ارز', en: 'coins' },
  asRefresh: { fa: 'بازخوانی', en: 'Refresh' },
  asTarget: { fa: 'هدف ۱', en: 'Target 1' },
  asSince: { fa: 'فعال از', en: 'Active since' },
  asNoData: {
    fa: 'هنوز اسکنی انجام نشده. اولین اسکن خودکار حداکثر تا یک ساعت دیگر نتیجه می‌دهد.',
    en: 'No scan results yet. The first automatic scan will appear within an hour.',
  },
  asLoginRequired: {
    fa: 'برای دیدن نتایج اسکن خودکار وارد حساب خود شوید.',
    en: 'Sign in to view the auto-scan results.',
  },
  asStale: {
    fa: 'اسکن خودکار بیش از ۲ ساعت است که اجرا نشده. زمان‌بندی (cron) و تابع اسکن را در Supabase بررسی کنید.',
    en: 'The auto scan has not run for over 2 hours. Check the cron schedule and the scan function in Supabase.',
  },
  asLastFailed: { fa: 'آخرین اسکن با خطا تمام شد', en: 'The last scan failed' },
  asTablesMissing: {
    fa: 'جدول‌های اسکن خودکار هنوز ساخته نشده‌اند. فایل migration مربوط به auto_scan را در Supabase اجرا کنید.',
    en: 'The auto-scan tables do not exist yet. Run the auto_scan migration in Supabase.',
  },

  // Signal Lab
  signalLab: { fa: 'آزمایشگاه سیگنال', en: 'Signal Lab' },
  slDescription: {
    fa: 'سیگنال‌های BUY و SELL صادرشده توسط اسکن خودکار اینجا ثبت می‌شوند و با قیمت واقعی بازار ارزیابی می‌گردند (برد / باخت / منقضی).',
    en: 'BUY and SELL signals from auto-scan are recorded here and evaluated against live market prices (win / loss / expired).',
  },
  slEvaluate: { fa: 'ارزیابی سیگنال‌های باز', en: 'Evaluate Open Signals' },
  slEvaluating: { fa: 'در حال ارزیابی...', en: 'Evaluating...' },
  slOpen: { fa: 'باز', en: 'Open' },
  slExpired: { fa: 'منقضی', en: 'Expired' },
  slCancelled: { fa: 'لغو شده', en: 'Cancelled' },
  slNoData: {
    fa: 'هنوز سیگنالی برای تست ثبت نشده. پس از اولین اسکن خودکار که سیگنال BUY/SELL بدهد، اینجا ظاهر می‌شود.',
    en: 'No signals recorded yet. After the next auto-scan that produces BUY/SELL signals, they will appear here.',
  },
  slByTimeframe: { fa: 'بر اساس تایم‌فریم', en: 'By Timeframe' },
  slByScore: { fa: 'بر اساس امتیاز', en: 'By Score' },
  avgPnl: { fa: 'میانگین PnL', en: 'Avg PnL' },

  // Lab / Live Analysis
  labSignal: { fa: 'سیگنال آزمایشگاه', en: 'Lab Signal' },
  liveAnalysis: { fa: 'تحلیل لحظه‌ای', en: 'Live Analysis' },
  labSignalHint: {
    fa: 'این همان سیگنالی است که اسکن خودکار ثبت کرده (ممکن است با تحلیل لحظه‌ای فرق داشته باشد).',
    en: 'This is the signal recorded by auto-scan (it may differ from live analysis).',
  },
  liveAnalysisHint: {
    fa: 'تحلیل فعلی موتور صفحه دارایی؛ شورت فقط در اسکن خودکار تولید می‌شود.',
    en: 'Current client-engine analysis; SHORT signals come only from auto-scan.',
  },
  backToLab: { fa: 'بازگشت به آزمایشگاه', en: 'Back to Signal Lab' },
  labResult: { fa: 'نتیجه آزمایش', en: 'Lab result' },
  source: { fa: 'منبع', en: 'Source' },
};

export function t(key: string, lang: Lang): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en ?? key;
}

/*
  # Core schema for crypto signal platform

  ## Overview
  Creates the foundational tables for the spot market analysis and signal
  scanner platform: user watchlists, user preferences, an append-only log
  of computed signals (real market analysis output, not user data), manual
  portfolio holdings, a trading journal, and a server-side cache table used
  internally by the market-data edge function.

  ## 1. New Tables

  ### `watchlists`
  A named list of symbols owned by a user.
  - `id` (uuid, primary key)
  - `user_id` (uuid, owner, defaults to the signed-in user)
  - `name` (text)
  - `created_at` (timestamptz)

  ### `watchlist_items`
  Symbols belonging to a watchlist.
  - `id` (uuid, primary key)
  - `watchlist_id` (uuid, references watchlists)
  - `user_id` (uuid, owner, defaults to the signed-in user)
  - `symbol` (text, e.g. BTCUSDT)
  - `created_at` (timestamptz)

  ### `user_settings`
  One row per user holding their preferences (language, theme, thresholds,
  risk settings, default universe/watchlist/timeframe).
  - `user_id` (uuid, primary key, references auth.users)
  - `language`, `theme`, `default_timeframe`
  - `signal_threshold_strong`, `signal_threshold_buy`, `signal_threshold_watch`
  - `risk_percent`, `min_risk_reward`
  - `asset_universe`, `default_watchlist_id`
  - `created_at`, `updated_at`

  ### `signals`
  Append-only audit log of every signal computed by the rule-based engine.
  This is shared market analysis output (not private user data), so it is
  readable by any signed-in visitor, but rows can never be edited or
  deleted once written, and only the computing user's id is stamped on
  insert. Holds score, trend/structure/regime classification, risk levels,
  entry/invalidation/targets, R:R, and the generated Persian/English
  explanation text.

  ### `portfolio_holdings`
  Manually entered spot holdings per user (asset, quantity, average entry).

  ### `journal_entries`
  Manually logged trades (and later paper trades) per user.

  ### `market_data_cache`
  Internal cache-aside store used only by the market-data edge function
  (service role). Not exposed to anon/authenticated clients.

  ## 2. Security
  - RLS enabled on every table.
  - `watchlists`, `watchlist_items`, `user_settings`, `portfolio_holdings`,
    `journal_entries` are owner-scoped to `auth.uid()` with 4 separate
    policies each (select/insert/update/delete).
  - `signals` allows SELECT to any authenticated user (shared analysis
    data) and INSERT restricted to the authenticated user who computed it;
    no UPDATE/DELETE policies exist, making it an immutable log.
  - `market_data_cache` has RLS enabled with no anon/authenticated
    policies at all, so only the service-role edge function can read/write it.
*/

CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_watchlists" ON watchlists;
CREATE POLICY "select_own_watchlists" ON watchlists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_watchlists" ON watchlists;
CREATE POLICY "insert_own_watchlists" ON watchlists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_watchlists" ON watchlists;
CREATE POLICY "update_own_watchlists" ON watchlists FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_watchlists" ON watchlists;
CREATE POLICY "delete_own_watchlists" ON watchlists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, symbol)
);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_watchlist_items" ON watchlist_items;
CREATE POLICY "select_own_watchlist_items" ON watchlist_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_watchlist_items" ON watchlist_items;
CREATE POLICY "insert_own_watchlist_items" ON watchlist_items FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_watchlist_items" ON watchlist_items;
CREATE POLICY "update_own_watchlist_items" ON watchlist_items FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_watchlist_items" ON watchlist_items;
CREATE POLICY "delete_own_watchlist_items" ON watchlist_items FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'fa' CHECK (language IN ('fa', 'en')),
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  default_timeframe text NOT NULL DEFAULT '1D',
  signal_threshold_strong integer NOT NULL DEFAULT 80,
  signal_threshold_buy integer NOT NULL DEFAULT 70,
  signal_threshold_watch integer NOT NULL DEFAULT 60,
  risk_percent numeric NOT NULL DEFAULT 1,
  min_risk_reward numeric NOT NULL DEFAULT 2,
  asset_universe text NOT NULL DEFAULT 'top20',
  default_watchlist_id uuid REFERENCES watchlists(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_settings" ON user_settings;
CREATE POLICY "select_own_settings" ON user_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_settings" ON user_settings;
CREATE POLICY "insert_own_settings" ON user_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_settings" ON user_settings;
CREATE POLICY "update_own_settings" ON user_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_settings" ON user_settings;
CREATE POLICY "delete_own_settings" ON user_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('BUY', 'WAIT', 'EXIT', 'NO_TRADE')),
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  regime text NOT NULL,
  trend text NOT NULL,
  structure text NOT NULL,
  risk_level text NOT NULL,
  entry_low numeric,
  entry_high numeric,
  invalidation numeric,
  stop_loss numeric,
  target1 numeric,
  target2 numeric,
  target3 numeric,
  risk_reward numeric,
  price_at_signal numeric NOT NULL,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation_fa text NOT NULL,
  explanation_en text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_timeframe_created
  ON signals (symbol, timeframe, created_at DESC);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_signals" ON signals;
CREATE POLICY "select_signals" ON signals FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_signals" ON signals;
CREATE POLICY "insert_signals" ON signals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  avg_entry_price numeric NOT NULL CHECK (avg_entry_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_holdings" ON portfolio_holdings;
CREATE POLICY "select_own_holdings" ON portfolio_holdings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_holdings" ON portfolio_holdings;
CREATE POLICY "insert_own_holdings" ON portfolio_holdings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_holdings" ON portfolio_holdings;
CREATE POLICY "update_own_holdings" ON portfolio_holdings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_holdings" ON portfolio_holdings;
CREATE POLICY "delete_own_holdings" ON portfolio_holdings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  asset text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL CHECK (entry_price >= 0),
  exit_price numeric CHECK (exit_price IS NULL OR exit_price >= 0),
  size numeric NOT NULL CHECK (size > 0),
  result text NOT NULL DEFAULT 'OPEN' CHECK (result IN ('OPEN', 'WIN', 'LOSS', 'BREAKEVEN')),
  strategy text,
  notes text,
  trade_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_journal" ON journal_entries;
CREATE POLICY "select_own_journal" ON journal_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_journal" ON journal_entries;
CREATE POLICY "insert_own_journal" ON journal_entries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_journal" ON journal_entries;
CREATE POLICY "update_own_journal" ON journal_entries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_journal" ON journal_entries;
CREATE POLICY "delete_own_journal" ON journal_entries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS market_data_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds integer NOT NULL DEFAULT 60,
  UNIQUE (provider, cache_key)
);

ALTER TABLE market_data_cache ENABLE ROW LEVEL SECURITY;

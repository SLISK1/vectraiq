-- ============================================================
-- Signal Quality Upgrade: Real sentiment, event blackout,
-- relative strength vs sector, earnings surprises & insider data
-- ============================================================

-- 1. news_sentiment_cache: aggregated sentiment per ticker
--    Populated by compute-news-sentiment from news_cache rows.
CREATE TABLE IF NOT EXISTS public.news_sentiment_cache (
  ticker text PRIMARY KEY,
  score numeric NOT NULL DEFAULT 0,            -- -1.0 (very bearish) .. +1.0 (very bullish)
  magnitude numeric NOT NULL DEFAULT 0,        -- 0..1, average per-article emotional intensity
  article_count integer NOT NULL DEFAULT 0,
  positive_count integer NOT NULL DEFAULT 0,
  negative_count integer NOT NULL DEFAULT 0,
  top_themes jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.news_sentiment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_sentiment_cache_select_all"
  ON public.news_sentiment_cache FOR SELECT USING (true);

-- 2. event_calendar: upcoming earnings & macro events
--    ticker = NULL means market-wide (CPI, Fed, ECB, Riksbank, NFP).
CREATE TABLE IF NOT EXISTS public.event_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text,
  event_type text NOT NULL,                    -- earnings | dividend | split | cpi | fed | ecb | riksbank | nfp | gdp
  event_date timestamptz NOT NULL,
  importance smallint NOT NULL DEFAULT 1,      -- 1=low, 2=med, 3=high
  source text DEFAULT 'fmp',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_calendar_ticker_date
  ON public.event_calendar(ticker, event_date);
CREATE INDEX IF NOT EXISTS idx_event_calendar_date
  ON public.event_calendar(event_date) WHERE ticker IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_calendar
  ON public.event_calendar(coalesce(ticker, ''), event_type, event_date);
ALTER TABLE public.event_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_calendar_select_all"
  ON public.event_calendar FOR SELECT USING (true);

-- 3. earnings_surprises: post-earnings drift signal
CREATE TABLE IF NOT EXISTS public.earnings_surprises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  period text NOT NULL,                        -- e.g. '2026-Q1'
  reported_at timestamptz NOT NULL,
  eps_actual numeric,
  eps_estimate numeric,
  surprise_pct numeric,                        -- (actual - estimate) / |estimate|
  revenue_actual numeric,
  revenue_estimate numeric,
  source text DEFAULT 'fmp',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_earnings_surprises
  ON public.earnings_surprises(ticker, period);
CREATE INDEX IF NOT EXISTS idx_earnings_surprises_recent
  ON public.earnings_surprises(ticker, reported_at DESC);
ALTER TABLE public.earnings_surprises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earnings_surprises_select_all"
  ON public.earnings_surprises FOR SELECT USING (true);

-- 4. analyst_revisions: estimate revision signal
CREATE TABLE IF NOT EXISTS public.analyst_revisions (
  ticker text PRIMARY KEY,
  mean_target numeric,
  current_price_at_update numeric,
  num_revisions_up_30d integer NOT NULL DEFAULT 0,
  num_revisions_down_30d integer NOT NULL DEFAULT 0,
  num_analysts integer,
  consensus text,                              -- strong_buy | buy | hold | sell | strong_sell
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.analyst_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analyst_revisions_select_all"
  ON public.analyst_revisions FOR SELECT USING (true);

-- 5. insider_trades: insider buying/selling
CREATE TABLE IF NOT EXISTS public.insider_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  transaction_date date NOT NULL,
  transaction_type text NOT NULL,              -- buy | sell
  shares numeric,
  value_usd numeric,
  insider_name text,
  insider_role text,
  source text DEFAULT 'fmp',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insider_trades_ticker_date
  ON public.insider_trades(ticker, transaction_date DESC);
ALTER TABLE public.insider_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insider_trades_select_all"
  ON public.insider_trades FOR SELECT USING (true);

-- 6. sector_returns_cache: pre-computed rolling returns by sector
CREATE TABLE IF NOT EXISTS public.sector_returns_cache (
  sector text NOT NULL,
  asset_type text NOT NULL,                    -- stock | crypto | metal | fund
  period_days integer NOT NULL,                -- 5, 21, 63, 126
  return_pct numeric NOT NULL,
  member_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sector, asset_type, period_days)
);
ALTER TABLE public.sector_returns_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sector_returns_cache_select_all"
  ON public.sector_returns_cache FOR SELECT USING (true);

-- 7. index_returns_cache: benchmark index returns (OMXS30, SPX, BTC, etc.)
CREATE TABLE IF NOT EXISTS public.index_returns_cache (
  index_ticker text NOT NULL,
  asset_type text NOT NULL,
  period_days integer NOT NULL,
  return_pct numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (index_ticker, asset_type, period_days)
);
ALTER TABLE public.index_returns_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "index_returns_cache_select_all"
  ON public.index_returns_cache FOR SELECT USING (true);

-- ============================================================
-- Universe expansion + Strategic Thesis (LLM-based) module
-- T2: ~150-250 new tickers across themes + AI-driven thesis scoring
-- ============================================================

-- 1. Extend symbols table with risk classification + theme tagging
ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS risk_class text NOT NULL DEFAULT 'main',  -- main|first_north|spotlight|ngm|growth|pre_revenue|high_risk
  ADD COLUMN IF NOT EXISTS theme text,                               -- cleantech|nuclear|ai|biotech|robotics|fintech|space|...
  ADD COLUMN IF NOT EXISTS listing_date date;                        -- IPO date, used for "newly listed" badge

CREATE INDEX IF NOT EXISTS idx_symbols_risk_class ON public.symbols(risk_class);
CREATE INDEX IF NOT EXISTS idx_symbols_theme ON public.symbols(theme) WHERE theme IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_symbols_listing_date ON public.symbols(listing_date) WHERE listing_date IS NOT NULL;

-- 2. strategic_thesis_cache: LLM-generated qualitative analysis
--    Refreshed every 30-60 days OR on triggering events (earnings, big news, etc.)
CREATE TABLE IF NOT EXISTS public.strategic_thesis_cache (
  ticker text PRIMARY KEY,
  thesis_score numeric NOT NULL DEFAULT 50,                          -- 0-100 composite
  uniqueness_score numeric NOT NULL DEFAULT 50,                      -- 0-10 product uniqueness
  moat_score numeric NOT NULL DEFAULT 50,                            -- 0-10 competitive moat
  market_size text,                                                  -- 'small'|'medium'|'large'|'massive'
  themes jsonb DEFAULT '[]'::jsonb,                                  -- ['cleantech','automation']
  thesis_summary text,                                               -- 1-2 paragraph human-readable
  key_risks jsonb DEFAULT '[]'::jsonb,                               -- ['regulatory','execution','financing']
  catalysts jsonb DEFAULT '[]'::jsonb,                               -- forward-looking catalysts
  model_used text,                                                   -- 'gemini-3-flash' | 'gpt-5.2' etc.
  trigger_reason text,                                               -- 'scheduled'|'earnings'|'news_spike'|'on_demand'
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategic_thesis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategic_thesis_cache_select_all"
  ON public.strategic_thesis_cache FOR SELECT USING (true);

-- 3. thesis_analysis_budget: monthly budget tracker (USD-equivalent)
--    Hard-cap on LLM costs to prevent runaway spending.
CREATE TABLE IF NOT EXISTS public.thesis_analysis_budget (
  month_key text PRIMARY KEY,                                        -- YYYY-MM
  calls_used integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  budget_cap_usd numeric NOT NULL DEFAULT 10,                        -- $10/month default
  last_updated timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.thesis_analysis_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY "thesis_analysis_budget_select_all"
  ON public.thesis_analysis_budget FOR SELECT USING (true);

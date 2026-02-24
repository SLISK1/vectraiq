
-- ============================================
-- STRATEGY TABLES MIGRATION
-- ============================================

-- 1) strategy_configs
CREATE TABLE public.strategy_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  portfolio_value numeric NOT NULL DEFAULT 100000,
  max_risk_pct numeric NOT NULL DEFAULT 1.0,
  max_open_pos integer NOT NULL DEFAULT 5,
  max_sector_pct numeric NOT NULL DEFAULT 30,
  mean_reversion_enabled boolean NOT NULL DEFAULT false,
  total_score_min integer NOT NULL DEFAULT 65,
  agreement_min integer NOT NULL DEFAULT 80,
  coverage_min integer NOT NULL DEFAULT 90,
  vol_risk_max integer NOT NULL DEFAULT 60,
  max_staleness_h integer NOT NULL DEFAULT 24,
  automation_mode text NOT NULL DEFAULT 'OFF',
  schedule text NOT NULL DEFAULT 'daily',
  universe_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  combine_mode text NOT NULL DEFAULT 'UNION',
  candidate_limit integer NOT NULL DEFAULT 200,
  execution_policy text NOT NULL DEFAULT 'NEXT_OPEN',
  slippage_bps numeric NOT NULL DEFAULT 10,
  commission_per_trade numeric NOT NULL DEFAULT 0,
  commission_bps numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_configs_select_own" ON public.strategy_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategy_configs_insert_own" ON public.strategy_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_configs_update_own" ON public.strategy_configs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "strategy_configs_delete_own" ON public.strategy_configs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_strategy_configs_updated_at
  BEFORE UPDATE ON public.strategy_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) strategy_candidates
CREATE TABLE public.strategy_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  config_id uuid NOT NULL REFERENCES public.strategy_configs(id) ON DELETE CASCADE,
  symbol_id uuid NOT NULL,
  ticker text NOT NULL,
  source text NOT NULL,
  regime text,
  status text NOT NULL DEFAULT 'candidate',
  block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_score integer,
  confidence integer,
  trend_duration integer,
  trend_strength integer,
  stop_loss_price numeric,
  stop_loss_pct numeric,
  target_price numeric,
  target_pct numeric,
  rr_ratio numeric,
  position_size numeric,
  entry_price numeric,
  signal_price numeric,
  analysis_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  fundamental_exit_available boolean NOT NULL DEFAULT false,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_candidates_select_own" ON public.strategy_candidates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategy_candidates_insert_own" ON public.strategy_candidates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_candidates_update_own" ON public.strategy_candidates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "strategy_candidates_delete_own" ON public.strategy_candidates FOR DELETE USING (auth.uid() = user_id);

-- 3) strategy_positions
CREATE TABLE public.strategy_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  config_id uuid NOT NULL REFERENCES public.strategy_configs(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.strategy_candidates(id) ON DELETE SET NULL,
  symbol_id uuid NOT NULL,
  ticker text NOT NULL,
  regime text NOT NULL,
  side text NOT NULL DEFAULT 'long',
  entry_price numeric NOT NULL,
  effective_entry numeric,
  stop_loss numeric,
  take_profit numeric,
  qty numeric NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  exit_price numeric,
  effective_exit numeric,
  gross_pnl numeric,
  net_pnl numeric,
  pnl_pct numeric,
  slippage_cost numeric,
  commission_cost numeric,
  close_reason text
);

ALTER TABLE public.strategy_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_positions_select_own" ON public.strategy_positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategy_positions_insert_own" ON public.strategy_positions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_positions_update_own" ON public.strategy_positions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "strategy_positions_delete_own" ON public.strategy_positions FOR DELETE USING (auth.uid() = user_id);

-- 4) strategy_trade_log
CREATE TABLE public.strategy_trade_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  config_id uuid,
  run_id uuid,
  action text NOT NULL,
  ticker text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_trade_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_trade_log_select_own" ON public.strategy_trade_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategy_trade_log_insert_own" ON public.strategy_trade_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_trade_log_deny_update" ON public.strategy_trade_log FOR UPDATE USING (false);
CREATE POLICY "strategy_trade_log_deny_delete" ON public.strategy_trade_log FOR DELETE USING (false);

-- 5) strategy_automation_jobs
CREATE TABLE public.strategy_automation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  config_id uuid NOT NULL REFERENCES public.strategy_configs(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  universe_size integer,
  candidates_found integer,
  positions_opened integer,
  positions_closed integer,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.strategy_automation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_automation_jobs_select_own" ON public.strategy_automation_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategy_automation_jobs_insert_own" ON public.strategy_automation_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_automation_jobs_update_own" ON public.strategy_automation_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "strategy_automation_jobs_deny_delete" ON public.strategy_automation_jobs FOR DELETE USING (false);

-- 6) universe_cache
CREATE TABLE public.universe_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_stale boolean NOT NULL DEFAULT false
);

ALTER TABLE public.universe_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universe_cache_select_all" ON public.universe_cache FOR SELECT USING (true);
CREATE POLICY "universe_cache_deny_insert" ON public.universe_cache FOR INSERT WITH CHECK (false);
CREATE POLICY "universe_cache_deny_update" ON public.universe_cache FOR UPDATE USING (false);
CREATE POLICY "universe_cache_deny_delete" ON public.universe_cache FOR DELETE USING (false);

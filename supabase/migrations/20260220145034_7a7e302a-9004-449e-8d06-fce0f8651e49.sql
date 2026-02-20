
-- 1. betting_matches: publik cache för matcher
CREATE TABLE public.betting_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'ufc')),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_date TIMESTAMP WITH TIME ZONE NOT NULL,
  league TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished')),
  home_score INTEGER,
  away_score INTEGER,
  source_data JSONB DEFAULT '{}'::jsonb,
  external_id TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.betting_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "betting_matches_select_all" ON public.betting_matches FOR SELECT USING (true);
CREATE POLICY "betting_matches_deny_insert" ON public.betting_matches AS RESTRICTIVE FOR INSERT WITH CHECK (false);
CREATE POLICY "betting_matches_deny_update" ON public.betting_matches AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY "betting_matches_deny_delete" ON public.betting_matches AS RESTRICTIVE FOR DELETE USING (false);

CREATE TRIGGER update_betting_matches_updated_at
  BEFORE UPDATE ON public.betting_matches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. betting_predictions: append-only snapshot (backtest-kritisk)
CREATE TABLE public.betting_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  predicted_winner TEXT NOT NULL CHECK (predicted_winner IN ('home', 'away', 'draw')),
  predicted_prob NUMERIC(4,3) NOT NULL CHECK (predicted_prob >= 0 AND predicted_prob <= 1),
  confidence_raw INTEGER NOT NULL CHECK (confidence_raw >= 0 AND confidence_raw <= 100),
  confidence_capped INTEGER NOT NULL CHECK (confidence_capped >= 0 AND confidence_capped <= 100),
  cap_reason TEXT,
  model_version TEXT NOT NULL DEFAULT '1.0',
  sources_hash TEXT,
  sources_used JSONB DEFAULT '[]'::jsonb,
  ai_reasoning TEXT,
  key_factors JSONB DEFAULT '[]'::jsonb,
  market_odds_home NUMERIC(6,2),
  market_odds_draw NUMERIC(6,2),
  market_odds_away NUMERIC(6,2),
  market_implied_prob NUMERIC(4,3),
  model_edge NUMERIC(5,3),
  outcome TEXT CHECK (outcome IN ('home_win', 'draw', 'away_win')),
  scored_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.betting_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "betting_predictions_select_all" ON public.betting_predictions FOR SELECT USING (true);
CREATE POLICY "betting_predictions_deny_insert" ON public.betting_predictions AS RESTRICTIVE FOR INSERT WITH CHECK (false);
CREATE POLICY "betting_predictions_deny_update" ON public.betting_predictions AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY "betting_predictions_deny_delete" ON public.betting_predictions AS RESTRICTIVE FOR DELETE USING (false);

CREATE INDEX idx_betting_predictions_match_id ON public.betting_predictions(match_id);
CREATE INDEX idx_betting_predictions_created_at ON public.betting_predictions(created_at DESC);

-- 3. betting_watchlist: personlig bevakning per user
CREATE TABLE public.betting_watchlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  match_id UUID NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES public.betting_predictions(id) ON DELETE SET NULL,
  notes TEXT,
  saved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, match_id)
);

ALTER TABLE public.betting_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "betting_watchlist_select_own" ON public.betting_watchlist FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "betting_watchlist_insert_own" ON public.betting_watchlist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "betting_watchlist_update_own" ON public.betting_watchlist FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "betting_watchlist_delete_own" ON public.betting_watchlist FOR DELETE USING (auth.uid() = user_id);

-- 4. pool_tickets: sparade Topptipset/Stryktipset per user
CREATE TABLE public.pool_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('topptipset', 'stryktipset')),
  round_id TEXT NOT NULL,
  round_name TEXT,
  rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_size INTEGER NOT NULL DEFAULT 1,
  budget_sek NUMERIC(10,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pool_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pool_tickets_select_own" ON public.pool_tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pool_tickets_insert_own" ON public.pool_tickets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pool_tickets_update_own" ON public.pool_tickets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pool_tickets_delete_own" ON public.pool_tickets FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_pool_tickets_user_id ON public.pool_tickets(user_id);
CREATE INDEX idx_betting_watchlist_user_id ON public.betting_watchlist(user_id);

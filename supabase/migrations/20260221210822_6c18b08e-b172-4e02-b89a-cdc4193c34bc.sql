
-- Cache for Alpha Vantage technical indicators and intraday data
CREATE TABLE public.alpha_indicators_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  indicator_type TEXT NOT NULL, -- 'RSI', 'MACD', 'ADX', 'VWAP', 'OBV', 'INTRADAY'
  timeframe TEXT NOT NULL DEFAULT '60min', -- '5min', '15min', '60min', 'daily'
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '6 hours'),
  UNIQUE(symbol_id, indicator_type, timeframe)
);

-- Enable RLS
ALTER TABLE public.alpha_indicators_cache ENABLE ROW LEVEL SECURITY;

-- Read-only for all, write only from service role
CREATE POLICY "alpha_indicators_cache_select_all" ON public.alpha_indicators_cache FOR SELECT USING (true);
CREATE POLICY "alpha_indicators_cache_deny_insert" ON public.alpha_indicators_cache FOR INSERT WITH CHECK (false);
CREATE POLICY "alpha_indicators_cache_deny_update" ON public.alpha_indicators_cache FOR UPDATE USING (false);
CREATE POLICY "alpha_indicators_cache_deny_delete" ON public.alpha_indicators_cache FOR DELETE USING (false);

-- Index for quick lookups
CREATE INDEX idx_alpha_indicators_symbol_type ON public.alpha_indicators_cache(symbol_id, indicator_type);
CREATE INDEX idx_alpha_indicators_valid ON public.alpha_indicators_cache(valid_until);

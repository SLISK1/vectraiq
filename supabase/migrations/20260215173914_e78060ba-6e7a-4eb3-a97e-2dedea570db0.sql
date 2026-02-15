
-- News cache table for storing fetched news articles
CREATE TABLE public.news_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_name TEXT,
  url TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  sentiment_score NUMERIC,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for quick lookups by ticker + recency
CREATE INDEX idx_news_cache_ticker_fetched ON public.news_cache (ticker, fetched_at DESC);

-- Auto-cleanup: remove news older than 7 days
CREATE INDEX idx_news_cache_created ON public.news_cache (created_at);

-- Enable RLS
ALTER TABLE public.news_cache ENABLE ROW LEVEL SECURITY;

-- News is viewable by all authenticated users
CREATE POLICY "News cache is viewable by everyone"
  ON public.news_cache FOR SELECT
  USING (true);

-- Only service role can insert/update/delete
CREATE POLICY "Deny public inserts on news_cache"
  ON public.news_cache FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny public updates on news_cache"
  ON public.news_cache FOR UPDATE
  USING (false);

CREATE POLICY "Deny public deletes on news_cache"
  ON public.news_cache FOR DELETE
  USING (false);

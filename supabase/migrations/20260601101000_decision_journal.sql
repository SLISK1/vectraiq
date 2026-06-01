-- Decision Journal: the plan's honesty gate.
-- Log every decision (thesis + decision + outcome) to measure edge vs luck.
-- User-ownership RLS pattern copied verbatim from watchlist_cases
-- (migration 20260205220950). Reuses the shared public.update_updated_at_column() trigger.

CREATE TABLE public.decision_journal (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol_id UUID REFERENCES public.symbols(id) ON DELETE SET NULL,
  ticker TEXT,
  -- Snapshot of the signal at decision time (nullable)
  horizon TEXT,
  direction TEXT,
  signal_score NUMERIC,
  -- The user's written rationale
  thesis TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('buy', 'sell', 'skip', 'watch')),
  conviction INTEGER CHECK (conviction BETWEEN 1 AND 5),
  entry_price NUMERIC,
  stop_loss NUMERIC,
  target_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Outcome fields (filled on close)
  outcome TEXT CHECK (outcome IN ('win', 'loss', 'breakeven', 'abandoned')),
  exit_price NUMERIC,
  realized_return_pct NUMERIC,
  closed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for journal lookups (current user's entries, newest first)
CREATE INDEX idx_decision_journal_user_created ON public.decision_journal(user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.decision_journal ENABLE ROW LEVEL SECURITY;

-- RLS Policies for decision_journal (user-specific) — copied from watchlist_cases
CREATE POLICY "Users can view their own journal"
ON public.decision_journal FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own journal entries"
ON public.decision_journal FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own journal entries"
ON public.decision_journal FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own journal entries"
ON public.decision_journal FOR DELETE
USING (auth.uid() = user_id);

-- Reuse the repo's shared updated_at trigger function
CREATE TRIGGER update_decision_journal_updated_at
BEFORE UPDATE ON public.decision_journal
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

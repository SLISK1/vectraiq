-- Create enum for asset types
CREATE TYPE public.asset_type AS ENUM ('stock', 'crypto', 'metal');

-- Create enum for signal direction
CREATE TYPE public.signal_direction AS ENUM ('UP', 'DOWN', 'NEUTRAL');

-- Create enum for horizons
CREATE TYPE public.horizon_type AS ENUM ('1s', '1m', '1h', '1d', '1w', '1mo', '1y');

-- Symbols/Assets table
CREATE TABLE public.symbols (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_type asset_type NOT NULL,
  sector TEXT,
  exchange TEXT,
  currency TEXT NOT NULL DEFAULT 'SEK',
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Raw prices table (for historical price data)
CREATE TABLE public.raw_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  open_price NUMERIC,
  high_price NUMERIC,
  low_price NUMERIC,
  volume NUMERIC,
  market_cap NUMERIC,
  change_24h NUMERIC,
  change_percent_24h NUMERIC,
  source TEXT NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for price lookups
CREATE INDEX idx_raw_prices_symbol_recorded ON public.raw_prices(symbol_id, recorded_at DESC);

-- Signals table (analysis results per module)
CREATE TABLE public.signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  module TEXT NOT NULL, -- technical, fundamental, sentiment, etc.
  direction signal_direction NOT NULL,
  strength INTEGER NOT NULL CHECK (strength >= 0 AND strength <= 100),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  horizon horizon_type NOT NULL,
  coverage INTEGER NOT NULL DEFAULT 100 CHECK (coverage >= 0 AND coverage <= 100),
  evidence JSONB DEFAULT '[]',
  rank_run_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for signal lookups
CREATE INDEX idx_signals_symbol_module ON public.signals(symbol_id, module, created_at DESC);

-- Rank runs table (snapshot of each ranking calculation)
CREATE TABLE public.rank_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  horizon horizon_type NOT NULL,
  total_assets_ranked INTEGER NOT NULL DEFAULT 0,
  data_sources_status JSONB DEFAULT '{}',
  config_snapshot JSONB DEFAULT '{}',
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Watchlist cases table
CREATE TABLE public.watchlist_cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  horizon horizon_type NOT NULL,
  prediction_direction signal_direction NOT NULL,
  entry_price NUMERIC NOT NULL,
  entry_price_source TEXT NOT NULL,
  target_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  confidence_at_save INTEGER NOT NULL CHECK (confidence_at_save >= 0 AND confidence_at_save <= 100),
  expected_move NUMERIC,
  model_snapshot_id UUID REFERENCES public.rank_runs(id),
  -- Result fields (filled when horizon ends)
  exit_price NUMERIC,
  return_pct NUMERIC,
  hit BOOLEAN,
  result_locked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for watchlist lookups
CREATE INDEX idx_watchlist_user_active ON public.watchlist_cases(user_id, result_locked_at NULLS FIRST);

-- User profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for symbols (public read)
CREATE POLICY "Symbols are viewable by everyone" 
ON public.symbols FOR SELECT 
USING (true);

-- RLS Policies for raw_prices (public read)
CREATE POLICY "Prices are viewable by everyone" 
ON public.raw_prices FOR SELECT 
USING (true);

-- RLS Policies for signals (public read)
CREATE POLICY "Signals are viewable by everyone" 
ON public.signals FOR SELECT 
USING (true);

-- RLS Policies for rank_runs (public read)
CREATE POLICY "Rank runs are viewable by everyone" 
ON public.rank_runs FOR SELECT 
USING (true);

-- RLS Policies for watchlist_cases (user-specific)
CREATE POLICY "Users can view their own watchlist" 
ON public.watchlist_cases FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own watchlist items" 
ON public.watchlist_cases FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlist items" 
ON public.watchlist_cases FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watchlist items" 
ON public.watchlist_cases FOR DELETE 
USING (auth.uid() = user_id);

-- RLS Policies for profiles
CREATE POLICY "Profiles are viewable by owner" 
ON public.profiles FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_symbols_updated_at
BEFORE UPDATE ON public.symbols
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_watchlist_updated_at
BEFORE UPDATE ON public.watchlist_cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for auto-creating profile
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
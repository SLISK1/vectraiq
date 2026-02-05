-- Create table for historical OHLCV data
CREATE TABLE public.price_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  open_price NUMERIC NOT NULL,
  high_price NUMERIC NOT NULL,
  low_price NUMERIC NOT NULL,
  close_price NUMERIC NOT NULL,
  volume NUMERIC,
  source TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(symbol_id, date, source)
);

-- Enable RLS
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- Everyone can read price history
CREATE POLICY "Price history is viewable by everyone" 
ON public.price_history 
FOR SELECT 
USING (true);

-- Create index for efficient queries
CREATE INDEX idx_price_history_symbol_date ON public.price_history(symbol_id, date DESC);

-- Enable realtime for price history
ALTER PUBLICATION supabase_realtime ADD TABLE public.price_history;
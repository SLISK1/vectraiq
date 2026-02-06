-- Add explicit DENY policies for public write operations on read-only tables
-- This ensures only service role operations can write, while public reads remain allowed

-- symbols table
CREATE POLICY "Deny public inserts on symbols" 
ON public.symbols FOR INSERT 
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny public updates on symbols" 
ON public.symbols FOR UPDATE 
TO anon, authenticated
USING (false);

CREATE POLICY "Deny public deletes on symbols" 
ON public.symbols FOR DELETE 
TO anon, authenticated
USING (false);

-- raw_prices table
CREATE POLICY "Deny public inserts on raw_prices" 
ON public.raw_prices FOR INSERT 
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny public updates on raw_prices" 
ON public.raw_prices FOR UPDATE 
TO anon, authenticated
USING (false);

CREATE POLICY "Deny public deletes on raw_prices" 
ON public.raw_prices FOR DELETE 
TO anon, authenticated
USING (false);

-- signals table
CREATE POLICY "Deny public inserts on signals" 
ON public.signals FOR INSERT 
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny public updates on signals" 
ON public.signals FOR UPDATE 
TO anon, authenticated
USING (false);

CREATE POLICY "Deny public deletes on signals" 
ON public.signals FOR DELETE 
TO anon, authenticated
USING (false);

-- rank_runs table
CREATE POLICY "Deny public inserts on rank_runs" 
ON public.rank_runs FOR INSERT 
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny public updates on rank_runs" 
ON public.rank_runs FOR UPDATE 
TO anon, authenticated
USING (false);

CREATE POLICY "Deny public deletes on rank_runs" 
ON public.rank_runs FOR DELETE 
TO anon, authenticated
USING (false);

-- price_history table
CREATE POLICY "Deny public inserts on price_history" 
ON public.price_history FOR INSERT 
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny public updates on price_history" 
ON public.price_history FOR UPDATE 
TO anon, authenticated
USING (false);

CREATE POLICY "Deny public deletes on price_history" 
ON public.price_history FOR DELETE 
TO anon, authenticated
USING (false);

-- Fix: Restrict module_reliability to authenticated users only
DROP POLICY IF EXISTS "module_reliability_select_all" ON public.module_reliability;

CREATE POLICY "module_reliability_select_authenticated"
  ON public.module_reliability FOR SELECT
  TO authenticated
  USING (true);

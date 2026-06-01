import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// ---- Types (the backtest_runs table types may lag in generated Supabase types) ----
export interface BacktestParams {
  start_date?: string;
  end_date?: string;
  lookback_months: number;
  top_n: number;
  rebalance: string; // 'monthly' | 'weekly' | 'quarterly'
  initial_capital: number;
  slippage_bps: number;
  commission_per_trade: number;
  commission_bps: number;
  use_liquidity_filter: boolean;
}

export interface BacktestMetrics {
  total_return_pct: number;
  cagr_pct: number;
  ann_vol_pct: number;
  sharpe: number;
  max_drawdown_pct: number;
  hit_rate_pct: number;
  turnover: number;
  total_cost: number;
  n_rebalances: number;
  start_date: string;
  end_date: string;
  benchmark_total_return_pct: number;
  excess_return_pct: number;
  information_ratio: number;
  beat_benchmark: boolean;
  omxsgi_return_pct: number | null;
  note: string | null;
}

export interface EquityPoint {
  date: string;
  strategy: number;
  benchmark: number;
}

export interface BacktestRun {
  id: string;
  user_id: string;
  name: string;
  params: BacktestParams;
  status: 'running' | 'completed' | 'failed';
  metrics: BacktestMetrics | null;
  equity_curve: EquityPoint[] | null;
  trades: unknown[] | null;
  benchmark_ticker: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

// ---- List current user's runs (newest first) ----
export function useBacktestRuns() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['backtest-runs', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from('backtest_runs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BacktestRun[];
    },
    enabled: !!user,
  });
}

// ---- Single run by id ----
export function useBacktestRun(id?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['backtest-run', id],
    queryFn: async () => {
      if (!user || !id) return null;
      const { data, error } = await (supabase as any)
        .from('backtest_runs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as BacktestRun) || null;
    },
    enabled: !!user && !!id,
  });
}

// ---- Run a backtest (invokes the run-backtest edge function) ----
export function useRunBacktest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ params, name }: { params: BacktestParams; name: string }) => {
      const { data, error } = await supabase.functions.invoke('run-backtest', {
        body: { params, name },
      });
      if (error) {
        const errorMsg = (data as Record<string, string>)?.error || error.message || 'Backtest misslyckades';
        throw new Error(errorMsg);
      }
      if ((data as Record<string, string>)?.error) {
        throw new Error((data as Record<string, string>).error);
      }
      return data as BacktestRun;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtest-runs'] });
      queryClient.invalidateQueries({ queryKey: ['backtest-run'] });
      toast({ title: 'Backtest klar', description: 'Resultatet har sparats.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Backtest misslyckades', description: err.message, variant: 'destructive' });
    },
  });
}

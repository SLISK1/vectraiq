import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// ---- Strategy Config ----
export function useStrategyConfig() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['strategy-config', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('strategy_configs')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const upsert = useMutation({
    mutationFn: async (config: Record<string, any>) => {
      if (!user) throw new Error('Not authenticated');
      const existing = query.data;
      if (existing) {
        const { error } = await supabase
          .from('strategy_configs')
          .update(config)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('strategy_configs')
          .insert({ ...config, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-config'] });
      toast({ title: 'Konfiguration sparad' });
    },
    onError: (err: any) => {
      toast({ title: 'Fel', description: err.message, variant: 'destructive' });
    },
  });

  return { config: query.data, isLoading: query.isLoading, upsert };
}

// ---- Strategy Candidates ----
export function useStrategyCandidates(configId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['strategy-candidates', configId],
    queryFn: async () => {
      if (!user || !configId) return [];
      const { data, error } = await supabase
        .from('strategy_candidates')
        .select('*')
        .eq('config_id', configId)
        .order('total_score', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!configId,
  });
}

// ---- Strategy Positions ----
export function useStrategyPositions(configId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['strategy-positions', configId],
    queryFn: async () => {
      if (!user || !configId) return [];
      const { data, error } = await supabase
        .from('strategy_positions')
        .select('*')
        .eq('config_id', configId)
        .order('opened_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!configId,
  });
}

// ---- Strategy Trade Log ----
export function useStrategyLog(configId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['strategy-log', configId],
    queryFn: async () => {
      if (!user || !configId) return [];
      const { data, error } = await supabase
        .from('strategy_trade_log')
        .select('*')
        .eq('config_id', configId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!configId,
  });
}

// ---- S&P 500 Universe ----
export function useSP500Universe() {
  return useQuery({
    queryKey: ['sp500-universe'],
    queryFn: async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || anonKey;

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/fetch-sp500`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch S&P 500');
      return await res.json() as {
        source: string;
        updatedAt: string;
        tickers: string[];
        count: number;
        stale: boolean;
        disclaimer: string;
      };
    },
    staleTime: 60 * 60 * 1000, // 1h
    retry: 1,
  });
}

// ---- Run Evaluation ----
export function useRunEvaluation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (configId: string) => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/strategy-evaluate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ config_id: configId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Evaluation failed');
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-log'] });
      toast({ title: 'Utvärdering klar', description: 'Kandidater har uppdaterats.' });
    },
    onError: (err: any) => {
      toast({ title: 'Utvärdering misslyckades', description: err.message, variant: 'destructive' });
    },
  });
}

// ---- Automation Jobs ----
export function useAutomationJobs(configId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['strategy-jobs', configId],
    queryFn: async () => {
      if (!user || !configId) return [];
      const { data, error } = await supabase
        .from('strategy_automation_jobs')
        .select('*')
        .eq('config_id', configId)
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!configId,
  });
}

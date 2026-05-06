import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Play, Sparkles, Database, RefreshCw, CheckCircle2, XCircle,
  Clock, Loader2, AlertTriangle,
} from 'lucide-react';

interface StepResult {
  step: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  duration_ms: number;
  details: Record<string, unknown>;
}

interface PipelineRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  step_results: StepResult[] | null;
  errors: Array<{ step: string; error: string }> | null;
}

interface BudgetRow {
  month_key: string;
  calls_used: number;
  estimated_cost_usd: number;
  budget_cap_usd: number;
}

const fetchRecentRuns = async (): Promise<PipelineRun[]> => {
  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('id, started_at, completed_at, status, step_results, errors')
    .order('started_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []) as unknown as PipelineRun[];
};

const fetchThesisBudget = async (): Promise<BudgetRow | null> => {
  const monthKey = new Date().toISOString().substring(0, 7);
  // Cast to any: types may lag on new tables
  const { data } = await (supabase as any)
    .from('thesis_analysis_budget')
    .select('*')
    .eq('month_key', monthKey)
    .maybeSingle();
  return data as BudgetRow | null;
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const formatTime = (iso: string): string => {
  return new Date(iso).toLocaleString('sv-SE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const StepStatusIcon = ({ status }: { status: string }) => {
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-up" />;
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-down" />;
  if (status === 'skipped') return <span className="w-3.5 h-3.5 inline-block text-muted-foreground">—</span>;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
};

export const AdminPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState<string | null>(null);

  const { data: runs, isLoading } = useQuery({
    queryKey: ['pipeline-runs'],
    queryFn: fetchRecentRuns,
    enabled: !!user,
    refetchInterval: (query) => {
      // Auto-refresh every 5s if any recent run is still running
      const data = query.state.data as PipelineRun[] | undefined;
      const hasRunning = data?.some(r => r.status === 'running');
      return hasRunning ? 5_000 : 30_000;
    },
  });

  const { data: budget } = useQuery({
    queryKey: ['thesis-budget'],
    queryFn: fetchThesisBudget,
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const triggerFunction = useCallback(async (
    target: string,
    payload: Record<string, unknown> = {},
    label: string,
  ) => {
    setTriggering(target);
    try {
      const { data, error } = await supabase.functions.invoke('trigger-pipeline', {
        body: { target, payload },
      });
      if (error) throw error;
      toast({
        title: `${label} startad`,
        description: 'Körs i bakgrunden. Status uppdateras nedan.',
      });
      // Optimistically refresh runs list after a short delay
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] }), 1500);
    } catch (e: any) {
      toast({
        title: `Kunde inte starta ${label}`,
        description: e?.message || 'Okänt fel',
        variant: 'destructive',
      });
    } finally {
      setTriggering(null);
    }
  }, [toast, queryClient]);

  if (!user) {
    return null;
  }

  const lastRun = runs?.[0];
  const isRunning = lastRun?.status === 'running';

  return (
    <div className="glass-card rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Admin — Datapipeline
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trigga pipeline manuellt + se senaste körningarna
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] })}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground"
          title="Uppdatera status"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Button
          onClick={() => triggerFunction('daily-pipeline', {}, 'Daily pipeline')}
          disabled={!!triggering || isRunning}
          variant="default"
          className="gap-2"
        >
          {triggering === 'daily-pipeline' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Kör Daily Pipeline
        </Button>

        <Button
          onClick={() => triggerFunction('seed-extended-universe', {}, 'Seed universum')}
          disabled={!!triggering}
          variant="secondary"
          className="gap-2"
        >
          {triggering === 'seed-extended-universe' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Database className="w-4 h-4" />
          )}
          Seeda Universum
        </Button>

        <Button
          onClick={() => {
            const tickers = prompt(
              'Ange tickers (kommaseparerade) för tes-analys:\n\n' +
              'Lämna tomt = avbryt. Varje ticker kostar ~$0.005.\n' +
              'Exempel: OKLO,ISRG,ENPH,NVO',
              'OKLO,ISRG,ENPH,NVO,LLY',
            );
            if (!tickers) return;
            const list = tickers.split(',').map(t => t.trim()).filter(Boolean);
            if (list.length === 0) return;
            const cost = (list.length * 0.005).toFixed(3);
            if (!confirm(`Analysera ${list.length} tickers? Estimerad kostnad: $${cost}.`)) return;
            triggerFunction('analyze-thesis', { tickers: list, trigger_reason: 'on_demand' }, `Tes-analys (${list.length})`);
          }}
          disabled={!!triggering}
          variant="outline"
          className="gap-2"
        >
          {triggering === 'analyze-thesis' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 text-purple-400" />
          )}
          Analysera Teser
        </Button>
      </div>

      {/* Thesis budget meter */}
      {budget && (
        <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Tes-budget {budget.month_key}
            </span>
            <span className="font-mono font-semibold">
              ${budget.estimated_cost_usd.toFixed(3)} / ${budget.budget_cap_usd}
              <span className="text-muted-foreground ml-2">({budget.calls_used} anrop)</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                budget.estimated_cost_usd / budget.budget_cap_usd > 0.8
                  ? "bg-down"
                  : budget.estimated_cost_usd / budget.budget_cap_usd > 0.5
                  ? "bg-yellow-500"
                  : "bg-purple-400"
              )}
              style={{
                width: `${Math.min(100, (budget.estimated_cost_usd / budget.budget_cap_usd) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Run history */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          Senaste körningar
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-primary normal-case font-normal">
              <Loader2 className="w-3 h-3 animate-spin" />
              auto-refresh varje 5s
            </span>
          )}
        </h4>

        {isLoading ? (
          <div className="text-sm text-muted-foreground p-3">Laddar...</div>
        ) : !runs || runs.length === 0 ? (
          <div className="p-4 rounded-lg bg-muted/20 text-sm text-muted-foreground text-center flex flex-col items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <span>Ingen pipeline-körning hittad. Tryck "Kör Daily Pipeline" ovan för att starta.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const RunRow = ({ run }: { run: PipelineRun }) => {
  const [expanded, setExpanded] = useState(false);

  const duration = run.completed_at
    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    : Date.now() - new Date(run.started_at).getTime();

  const stepsByStatus = (run.step_results || []).reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {run.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />}
          {run.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-up flex-shrink-0" />}
          {run.status === 'failed' && <XCircle className="w-4 h-4 text-down flex-shrink-0" />}
          <span className="text-sm font-mono truncate">{formatTime(run.started_at)}</span>
          <span className={cn(
            "text-xs px-1.5 py-0.5 rounded font-semibold",
            run.status === 'completed' ? "bg-up/15 text-up"
            : run.status === 'failed' ? "bg-down/15 text-down"
            : run.status === 'running' ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
          )}>
            {run.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
          <span className="font-mono">{formatDuration(duration)}</span>
          {stepsByStatus.success > 0 && <span className="text-up">✓ {stepsByStatus.success}</span>}
          {stepsByStatus.failed > 0 && <span className="text-down">✗ {stepsByStatus.failed}</span>}
          {stepsByStatus.skipped > 0 && <span>— {stepsByStatus.skipped}</span>}
        </div>
      </button>

      {expanded && run.step_results && (
        <div className="px-3 py-2 border-t border-border bg-muted/40 space-y-1">
          {run.step_results.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <StepStatusIcon status={step.status} />
              <span className="font-mono w-44 truncate">{step.step}</span>
              <span className="text-muted-foreground font-mono">{formatDuration(step.duration_ms)}</span>
              <span className="flex-1 text-muted-foreground truncate">
                {step.status === 'failed'
                  ? <span className="text-down">{String((step.details as { error?: string }).error || '')}</span>
                  : Object.entries(step.details).slice(0, 3).map(([k, v]) =>
                      typeof v === 'object' ? `${k}=…` : `${k}=${v}`
                    ).join(' ')
                }
              </span>
            </div>
          ))}
          {run.errors && run.errors.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              {run.errors.map((e, i) => (
                <div key={i} className="text-xs text-down">
                  ✗ {e.step}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

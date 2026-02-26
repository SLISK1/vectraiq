import { useState, useEffect, useCallback } from 'react';
import { Target, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useStrategyConfig, useStrategyCandidates, useStrategyPositions, useStrategyLog, useRunEvaluation } from '@/hooks/useStrategy';
import { UniverseBuilder } from './UniverseBuilder';
import { StrategyOverview } from './StrategyOverview';
import { StrategyRulesForm } from './StrategyRulesForm';
import { AutomationPanel } from './AutomationPanel';

const DEFAULT_CONFIG = {
  portfolio_value: 100000,
  max_risk_pct: 1,
  max_open_pos: 5,
  max_sector_pct: 30,
  mean_reversion_enabled: false,
  total_score_min: 60,
  agreement_min: 60,
  coverage_min: 60,
  vol_risk_max: 75,
  max_staleness_h: 48,
  automation_mode: 'OFF',
  schedule: 'daily',
  universe_sources: [] as string[],
  combine_mode: 'UNION',
  candidate_limit: 200,
  execution_policy: 'NEXT_OPEN',
  slippage_bps: 10,
  commission_per_trade: 0,
  commission_bps: 0,
};

export function StrategyPage() {
  const { user } = useAuth();
  const { config: savedConfig, isLoading, upsert } = useStrategyConfig();
  const [localConfig, setLocalConfig] = useState(DEFAULT_CONFIG);
  const [manualTickers, setManualTickers] = useState('');
  const [dirty, setDirty] = useState(false);

  // Load saved config
  useEffect(() => {
    if (savedConfig) {
      setLocalConfig({
        ...DEFAULT_CONFIG,
        ...savedConfig,
        universe_sources: Array.isArray(savedConfig.universe_sources) ? savedConfig.universe_sources as string[] : [],
      });
    }
  }, [savedConfig]);

  const configId = savedConfig?.id;
  const { data: candidates = [] } = useStrategyCandidates(configId);
  const { data: positions = [] } = useStrategyPositions(configId);
  const { data: logs = [] } = useStrategyLog(configId);
  const runEval = useRunEvaluation();

  const handleChange = useCallback((key: string, value: any) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    const toSave = { ...localConfig };
    delete (toSave as any).id;
    delete (toSave as any).created_at;
    delete (toSave as any).updated_at;
    upsert.mutate(toSave, { onSuccess: () => setDirty(false) });
  }, [localConfig, upsert]);

  const handleReset = useCallback(() => {
    setLocalConfig(DEFAULT_CONFIG);
    setDirty(true);
  }, []);

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/20"><Target className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-lg font-semibold">Strategi</h2>
            <p className="text-sm text-muted-foreground">Regelbaserad trading-strategi</p>
          </div>
        </div>
        <div className="glass-card rounded-xl p-8 text-center">
          <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">Logga in för att använda Strategi</h3>
          <p className="text-muted-foreground">Skapa ett konto för att konfigurera och köra din regelbaserade strategi.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20"><Target className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-lg font-semibold">Strategi</h2>
            <p className="text-sm text-muted-foreground">Regelbaserad swing & position-motor</p>
          </div>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={upsert.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {upsert.isPending ? 'Sparar...' : 'Spara konfiguration'}
          </button>
        )}
      </div>

      <Tabs defaultValue="universe" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="universe">Universum</TabsTrigger>
          <TabsTrigger value="overview">Översikt</TabsTrigger>
          <TabsTrigger value="rules">Regler</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
        </TabsList>

        <TabsContent value="universe">
          <UniverseBuilder
            sources={localConfig.universe_sources}
            onSourcesChange={(s) => handleChange('universe_sources', s)}
            combineMode={localConfig.combine_mode}
            onCombineModeChange={(m) => handleChange('combine_mode', m)}
            candidateLimit={localConfig.candidate_limit}
            onCandidateLimitChange={(n) => handleChange('candidate_limit', n)}
            manualTickers={manualTickers}
            onManualTickersChange={setManualTickers}
          />
        </TabsContent>

        <TabsContent value="overview">
          <StrategyOverview
            candidates={candidates}
            positions={positions}
            universeSources={localConfig.universe_sources}
          />
        </TabsContent>

        <TabsContent value="rules">
          <StrategyRulesForm
            config={localConfig}
            onChange={handleChange}
            onReset={handleReset}
          />
        </TabsContent>

        <TabsContent value="automation">
          <AutomationPanel
            configId={configId}
            automationMode={localConfig.automation_mode}
            schedule={localConfig.schedule}
            onModeChange={(m) => handleChange('automation_mode', m)}
            onScheduleChange={(s) => handleChange('schedule', s)}
            onRunNow={() => configId && runEval.mutate(configId)}
            isRunning={runEval.isPending}
            logs={logs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

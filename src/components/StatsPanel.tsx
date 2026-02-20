import { HORIZON_LABELS, MODULE_NAMES, Horizon } from '@/types/market';
import { cn } from '@/lib/utils';
import { Target, TrendingUp, AlertTriangle, Info, Award } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ModuleReliability {
  module: string;
  horizon: string;
  hit_rate: number;
  total_predictions: number;
  correct_predictions: number;
}

interface WatchlistStats {
  hitRateByHorizon: Record<string, { total: number; hits: number; rate: number; avgExcess: number | null }>;
  hitRateByModule: Record<string, number>;
  calibration: { confidence: number; hitRate: number }[];
}

const fetchWatchlistStats = async (userId: string | undefined): Promise<WatchlistStats | null> => {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('watchlist_cases')
    .select('horizon, prediction_direction, confidence_at_save, hit, result_locked_at, return_pct, excess_return')
    .eq('user_id', userId)
    .not('result_locked_at', 'is', null);

  if (error || !data || data.length === 0) return null;

  const hitRateByHorizon: Record<string, { total: number; hits: number; rate: number; avgExcess: number | null }> = {};

  for (const item of data) {
    const horizon = item.horizon as string;
    if (!hitRateByHorizon[horizon]) {
      hitRateByHorizon[horizon] = { total: 0, hits: 0, rate: 0, avgExcess: null };
    }
    hitRateByHorizon[horizon].total++;
    if (item.hit) hitRateByHorizon[horizon].hits++;
  }

  for (const horizon of Object.keys(hitRateByHorizon)) {
    const stats = hitRateByHorizon[horizon];
    stats.rate = stats.total > 0 ? (stats.hits / stats.total) * 100 : 0;
    const withExcess = data.filter(d => d.horizon === horizon && d.excess_return != null);
    if (withExcess.length > 0) {
      stats.avgExcess = withExcess.reduce((s, d) => s + Number(d.excess_return || 0), 0) / withExcess.length;
    }
  }

  const confidenceBuckets: Record<number, { total: number; hits: number }> = {
    50: { total: 0, hits: 0 },
    60: { total: 0, hits: 0 },
    70: { total: 0, hits: 0 },
    80: { total: 0, hits: 0 },
    90: { total: 0, hits: 0 },
  };

  for (const item of data) {
    const conf = item.confidence_at_save;
    let bucket = 50;
    if (conf >= 85) bucket = 90;
    else if (conf >= 75) bucket = 80;
    else if (conf >= 65) bucket = 70;
    else if (conf >= 55) bucket = 60;
    confidenceBuckets[bucket].total++;
    if (item.hit) confidenceBuckets[bucket].hits++;
  }

  const calibration = Object.entries(confidenceBuckets).map(([conf, stats]) => ({
    confidence: parseInt(conf),
    hitRate: stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) : 0,
  }));

  return { hitRateByHorizon, hitRateByModule: {}, calibration };
};

const fetchModuleReliability = async (): Promise<ModuleReliability[]> => {
  const { data } = await supabase
    .from('module_reliability')
    .select('module, horizon, hit_rate, total_predictions, correct_predictions')
    .order('hit_rate', { ascending: false });

  return (data || []).map(d => ({
    module: d.module,
    horizon: d.horizon,
    hit_rate: Number(d.hit_rate || 0),
    total_predictions: d.total_predictions,
    correct_predictions: d.correct_predictions,
  }));
};

const ModuleReliabilityPanel = ({ reliability }: { reliability: ModuleReliability[] }) => {
  const topModules = reliability
    .filter(r => r.total_predictions >= 5)
    .sort((a, b) => b.hit_rate - a.hit_rate)
    .slice(0, 8);

  if (topModules.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <Award className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Modul-reliabilitet (walk-forward)</h3>
        <span className="text-xs text-muted-foreground">(baserat på historiska prediktioner)</span>
      </div>

      <div className="space-y-2">
        {topModules.map(r => (
          <div key={`${r.module}:${r.horizon}`} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 truncate">{MODULE_NAMES[r.module] || r.module}</span>
            <span className="text-xs text-muted-foreground w-12">{HORIZON_LABELS[r.horizon as Horizon] || r.horizon}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  r.hit_rate >= 0.6 ? 'bg-up' : r.hit_rate >= 0.52 ? 'bg-yellow-500' : 'bg-down'
                )}
                style={{ width: `${Math.min(100, r.hit_rate * 100)}%` }}
              />
            </div>
            <span className={cn(
              'font-mono text-xs w-10 text-right',
              r.hit_rate >= 0.6 ? 'text-up' : r.hit_rate >= 0.52 ? 'text-yellow-500' : 'text-down'
            )}>
              {(r.hit_rate * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-muted-foreground w-14 text-right">n={r.total_predictions}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const StatsPanel = () => {
  const { user } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['watchlist-stats', user?.id],
    queryFn: () => fetchWatchlistStats(user?.id),
    enabled: !!user,
  });

  const { data: moduleReliability } = useQuery({
    queryKey: ['module-reliability'],
    queryFn: fetchModuleReliability,
    staleTime: 1000 * 60 * 30,
  });

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  if (!user) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <Info className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-2">Logga in för statistik</h3>
        <p className="text-sm text-muted-foreground">
          Statistik beräknas från dina watchlist-prediktioner efter att tidshorisonten har gått ut.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <div className="animate-pulse">Laddar statistik...</div>
      </div>
    );
  }

  if (!stats || Object.keys(stats.hitRateByHorizon).length === 0) {
    return (
      <div className="space-y-6">
        <div className="glass-card rounded-xl p-6 text-center">
          <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-2">Ingen statistik ännu</h3>
          <p className="text-sm text-muted-foreground">
            Lägg till tillgångar i din watchlist och vänta tills tidshorisonten har gått ut för att se träffsäkerhet.
          </p>
        </div>
        {moduleReliability && moduleReliability.length > 0 && (
          <ModuleReliabilityPanel reliability={moduleReliability} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hit Rate by Horizon */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Träffsäkerhet per horisont</h3>
          <span className="text-xs text-muted-foreground">(riktig data)</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(Object.entries(stats.hitRateByHorizon) as [string, { total: number; hits: number; rate: number; avgExcess: number | null }][]).map(([horizon, data]) => (
            <div key={horizon} className="text-center p-3 rounded-lg bg-muted/30">
              <div className="text-sm text-muted-foreground mb-1">{HORIZON_LABELS[horizon as Horizon] || horizon}</div>
              <div className={cn(
                "font-mono font-bold text-2xl",
                data.rate >= 65 ? "text-up" : data.rate >= 50 ? "text-yellow-500" : "text-down"
              )}>
                {formatPercent(data.rate)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.hits}/{data.total} träffar
              </div>
              {data.avgExcess != null && (
                <div className={cn(
                  "text-xs font-mono mt-1",
                  data.avgExcess >= 0 ? "text-up" : "text-down"
                )}>
                  {data.avgExcess >= 0 ? '+' : ''}{data.avgExcess.toFixed(1)}% vs index
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Calibration */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Kalibrering</h3>
          <span className="text-xs text-muted-foreground">(vid X% konfidens, hur ofta träffar vi?)</span>
        </div>

        <div className="flex items-end justify-between gap-2 h-40">
          {stats.calibration.map(({ confidence, hitRate }) => {
            const isCalibrated = Math.abs(confidence - hitRate) <= 10;
            const hasData = hitRate > 0;
            return (
              <div key={confidence} className="flex-1 flex flex-col items-center gap-2">
                <div className="flex-1 w-full flex flex-col justify-end">
                  <div className="relative w-full">
                    <div
                      className="absolute w-full h-0.5 bg-muted-foreground/30"
                      style={{ bottom: `${confidence}%` }}
                    />
                    {hasData ? (
                      <div
                        className={cn(
                          "w-full rounded-t transition-all duration-500",
                          isCalibrated ? "bg-up" : "bg-yellow-500"
                        )}
                        style={{ height: `${hitRate}%` }}
                      />
                    ) : (
                      <div className="w-full h-4 rounded bg-muted/50 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">-</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-sm">{hasData ? `${hitRate}%` : '-'}</div>
                  <div className="text-xs text-muted-foreground">vid {confidence}%</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Horisontell linje = förväntad träffsäkerhet. Stapel = faktisk träffsäkerhet baserad på dina watchlist-resultat.
          </span>
        </div>
      </div>

      {/* Module Reliability */}
      {moduleReliability && moduleReliability.length > 0 && (
        <ModuleReliabilityPanel reliability={moduleReliability} />
      )}
    </div>
  );
};

import { HORIZON_LABELS, MODULE_NAMES, Horizon } from '@/types/market';
import { cn } from '@/lib/utils';
import { BarChart3, Target, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface WatchlistStats {
  hitRateByHorizon: Record<string, { total: number; hits: number; rate: number }>;
  hitRateByModule: Record<string, number>;
  calibration: { confidence: number; hitRate: number }[];
}

// Fetch real stats from watchlist results
const fetchWatchlistStats = async (userId: string | undefined): Promise<WatchlistStats | null> => {
  if (!userId) return null;
  
  const { data, error } = await supabase
    .from('watchlist_cases')
    .select('horizon, prediction_direction, confidence_at_save, hit, result_locked_at')
    .eq('user_id', userId)
    .not('result_locked_at', 'is', null);
  
  if (error || !data || data.length === 0) {
    return null;
  }
  
  // Calculate hit rate by horizon
  const hitRateByHorizon: Record<string, { total: number; hits: number; rate: number }> = {};
  
  for (const item of data) {
    const horizon = item.horizon as string;
    if (!hitRateByHorizon[horizon]) {
      hitRateByHorizon[horizon] = { total: 0, hits: 0, rate: 0 };
    }
    hitRateByHorizon[horizon].total++;
    if (item.hit) {
      hitRateByHorizon[horizon].hits++;
    }
  }
  
  // Calculate rates
  for (const horizon of Object.keys(hitRateByHorizon)) {
    const stats = hitRateByHorizon[horizon];
    stats.rate = stats.total > 0 ? (stats.hits / stats.total) * 100 : 0;
  }
  
  // Calculate calibration
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
    if (item.hit) {
      confidenceBuckets[bucket].hits++;
    }
  }
  
  const calibration = Object.entries(confidenceBuckets).map(([conf, stats]) => ({
    confidence: parseInt(conf),
    hitRate: stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) : 0,
  }));
  
  return {
    hitRateByHorizon,
    hitRateByModule: {}, // Would need to track module-level predictions to calculate this
    calibration,
  };
};

export const StatsPanel = () => {
  const { user } = useAuth();
  
  const { data: stats, isLoading } = useQuery({
    queryKey: ['watchlist-stats', user?.id],
    queryFn: () => fetchWatchlistStats(user?.id),
    enabled: !!user,
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
      <div className="glass-card rounded-xl p-6 text-center">
        <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-2">Ingen statistik ännu</h3>
        <p className="text-sm text-muted-foreground">
          Lägg till tillgångar i din watchlist och vänta tills tidshorisonten har gått ut för att se träffsäkerhet.
        </p>
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
          {(Object.entries(stats.hitRateByHorizon) as [string, { total: number; hits: number; rate: number }][]).map(([horizon, data]) => (
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
                    {/* Expected line */}
                    <div 
                      className="absolute w-full h-0.5 bg-muted-foreground/30"
                      style={{ bottom: `${confidence}%` }}
                    />
                    {/* Actual bar */}
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
    </div>
  );
};

import { MOCK_STATS } from '@/data/mockData';
import { HORIZON_LABELS, MODULE_NAMES, Horizon } from '@/types/market';
import { cn } from '@/lib/utils';
import { BarChart3, Target, TrendingUp, AlertTriangle } from 'lucide-react';

export const StatsPanel = () => {
  const { hitRateByHorizon, hitRateByModule, calibration } = MOCK_STATS;

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Hit Rate by Horizon */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Träffsäkerhet per horisont</h3>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(Object.entries(hitRateByHorizon) as [Horizon, { total: number; hits: number; rate: number }][]).map(([horizon, data]) => (
            <div key={horizon} className="text-center p-3 rounded-lg bg-muted/30">
              <div className="text-sm text-muted-foreground mb-1">{HORIZON_LABELS[horizon]}</div>
              <div className={cn(
                "font-mono font-bold text-2xl",
                data.rate >= 65 ? "text-up" : data.rate >= 50 ? "text-neutral" : "text-down"
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

      {/* Hit Rate by Module */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Träffsäkerhet per modul</h3>
        </div>
        
        <div className="space-y-2">
          {Object.entries(hitRateByModule)
            .sort(([, a], [, b]) => b - a)
            .map(([module, rate]) => (
              <div key={module} className="flex items-center gap-3">
                <div className="w-32 text-sm truncate">{MODULE_NAMES[module]}</div>
                <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      rate >= 65 ? "bg-up" : rate >= 50 ? "bg-neutral" : "bg-down"
                    )}
                    style={{ width: `${rate}%` }}
                  />
                </div>
                <div className={cn(
                  "w-12 text-right font-mono text-sm",
                  rate >= 65 ? "text-up" : rate >= 50 ? "text-neutral" : "text-down"
                )}>
                  {rate}%
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
          {calibration.map(({ confidence, hitRate }) => {
            const isCalibrated = Math.abs(confidence - hitRate) <= 10;
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
                    <div
                      className={cn(
                        "w-full rounded-t transition-all duration-500",
                        isCalibrated ? "bg-up" : "bg-neutral"
                      )}
                      style={{ height: `${hitRate}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-sm">{hitRate}%</div>
                  <div className="text-xs text-muted-foreground">vid {confidence}%</div>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Horisontell linje = förväntad träffsäkerhet. Stapel = faktisk träffsäkerhet. 
            Perfekt kalibrering = stapeln når linjen.
          </span>
        </div>
      </div>
    </div>
  );
};

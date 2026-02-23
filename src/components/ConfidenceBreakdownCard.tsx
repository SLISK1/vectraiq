import { ConfidenceBreakdown } from '@/types/market';
import { cn } from '@/lib/utils';
import { Clock, Database, Users, Zap, Activity, BarChart3 } from 'lucide-react';

interface ConfidenceBreakdownCardProps {
  breakdown: ConfidenceBreakdown;
  totalConfidence: number;
  className?: string;
}

const metrics: { key: keyof ConfidenceBreakdown; label: string; icon: typeof Clock; weight: number; description: string; inverted?: boolean }[] = [
  { key: 'freshness', label: 'Data-fräschör', icon: Clock, weight: 15, description: 'Hur nyligen data uppdaterades' },
  { key: 'coverage', label: 'Datatäckning', icon: Database, weight: 25, description: 'Andel tillgänglig data' },
  { key: 'agreement', label: 'Signal-enighet', icon: Users, weight: 25, description: 'Hur många moduler pekar samma riktning (signerad)' },
  { key: 'signalStrength', label: 'Signalstyrka', icon: Zap, weight: 25, description: 'Modulernas interna konfidens (ej historisk träff)' },
  { key: 'regimeRisk', label: 'Volatilitetsrisk', icon: Activity, weight: 10, description: 'Lägre vid extremvolatilitet', inverted: true },
];

export const ConfidenceBreakdownCard = ({ breakdown, totalConfidence, className }: ConfidenceBreakdownCardProps) => {
  const getColorClass = (value: number, inverted = false) => {
    const effectiveValue = inverted ? 100 - value : value;
    if (effectiveValue >= 70) return 'text-up bg-up/20';
    if (effectiveValue >= 50) return 'text-neutral bg-neutral/20';
    return 'text-down bg-down/20';
  };

  return (
    <div className={cn("glass-card rounded-xl p-4 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Konfidens-nedbrytning</h3>
        <div className={cn(
          "px-3 py-1 rounded-lg font-mono font-bold text-lg",
          getColorClass(totalConfidence)
        )}>
          {totalConfidence}%
        </div>
      </div>

      <div className="space-y-3">
        {metrics.map(({ key, label, icon: Icon, weight, description, inverted }) => {
          const value = breakdown[key as keyof ConfidenceBreakdown];
          if (typeof value !== 'number') return null;
          const displayValue = inverted ? 100 - value : value;
          const contribution = (weight / 100) * displayValue;

          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span>{label}</span>
                  <span className="text-xs text-muted-foreground">({weight}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono", getColorClass(displayValue).split(' ')[0])}>
                    {displayValue}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    → +{contribution.toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", getColorClass(displayValue))}
                  style={{ width: `${displayValue}%` }}
                />
              </div>
              
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          );
        })}

        {/* Empirical reliability (from DB) */}
        {breakdown.empiricalReliability != null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                <span>Historisk träffsäkerhet</span>
                {breakdown.lowSampleWarning && (
                  <span className="text-xs text-amber-500">(lågt N)</span>
                )}
              </div>
              <span className={cn("font-mono", getColorClass(breakdown.empiricalReliability).split(' ')[0])}>
                {breakdown.empiricalReliability}%
              </span>
            </div>
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", getColorClass(breakdown.empiricalReliability))}
                style={{ width: `${breakdown.empiricalReliability}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Bayesiansk posterior av modulernas faktiska träffar (från self-learning)
            </p>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-border/50">
        <p className="text-xs text-muted-foreground">
          <strong>Formel:</strong> 0.15×fräschör + 0.25×täckning + 0.25×enighet + 0.25×signalstyrka + 0.10×(100 − regimrisk)
        </p>
      </div>
    </div>
  );
};

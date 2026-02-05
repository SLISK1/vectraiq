import { TrendPrediction, Direction } from '@/types/market';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Shield, Target, Clock, AlertTriangle } from 'lucide-react';
import { Progress } from './ui/progress';

interface TrendPredictionCardProps {
  prediction: TrendPrediction;
  direction: Direction;
  currentPrice: number;
  currency: string;
}

export const TrendPredictionCard = ({ 
  prediction, 
  direction, 
  currentPrice,
  currency 
}: TrendPredictionCardProps) => {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  const getMethodLabel = (method: string) => {
    switch (method) {
      case 'atr': return 'ATR-baserad';
      case 'support': return 'Stöd/Motstånd';
      case 'volatility': return 'Volatilitet';
      default: return method;
    }
  };

  const getDurationLabel = (days: number) => {
    if (days < 1) return 'Intradag';
    if (days === 1) return '1 dag';
    if (days < 7) return `${days} dagar`;
    if (days < 30) return `${Math.round(days / 7)} veckor`;
    if (days < 365) return `${Math.round(days / 30)} månader`;
    return `${(days / 365).toFixed(1)} år`;
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" />
        Trendprognos & Stop/Loss
      </h3>

      {/* Trend Duration */}
      <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Förväntad trendduration</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Minimum</div>
            <div className="font-mono font-semibold">{getDurationLabel(prediction.trendDuration.minDays)}</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-2">
            <div className="text-xs text-primary mb-1">Troligast</div>
            <div className="font-mono font-bold text-lg">{getDurationLabel(prediction.trendDuration.likelyDays)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Maximum</div>
            <div className="font-mono font-semibold">{getDurationLabel(prediction.trendDuration.maxDays)}</div>
          </div>
        </div>
      </div>

      {/* Stop Loss */}
      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-destructive" />
            <span className="text-sm font-medium">Rekommenderad Stop/Loss</span>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
            {getMethodLabel(prediction.stopLoss.method)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono font-bold text-2xl text-destructive">
              {formatPrice(prediction.stopLoss.price)}
            </div>
            <div className="text-sm text-muted-foreground">
              {direction === 'UP' ? '-' : '+'}{prediction.stopLoss.percentage.toFixed(2)}% från nuvarande
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Risk per enhet</div>
            <div className="font-mono text-destructive">
              {formatPrice(Math.abs(currentPrice - prediction.stopLoss.price))}
            </div>
          </div>
        </div>
      </div>

      {/* Take Profit Levels */}
      <div className="p-4 rounded-xl bg-up/10 border border-up/30">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-up" />
          <span className="text-sm font-medium">Take Profit-nivåer</span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="text-sm">Konservativ (1.5:1)</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-semibold">{formatPrice(prediction.takeProfit.conservative.price)}</span>
              <span className="text-xs text-up ml-2">+{prediction.takeProfit.conservative.percentage}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-up" />
              <span className="text-sm">Måttlig (2.5:1)</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-semibold">{formatPrice(prediction.takeProfit.moderate.price)}</span>
              <span className="text-xs text-up ml-2">+{prediction.takeProfit.moderate.percentage}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-sm">Aggressiv (4:1)</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-semibold">{formatPrice(prediction.takeProfit.aggressive.price)}</span>
              <span className="text-xs text-up ml-2">+{prediction.takeProfit.aggressive.percentage}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            {direction === 'UP' ? (
              <TrendingUp className="w-4 h-4 text-up" />
            ) : direction === 'DOWN' ? (
              <TrendingDown className="w-4 h-4 text-down" />
            ) : (
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">Trendstyrka</span>
          </div>
          <Progress 
            value={prediction.trendStrength} 
            className={cn(
              "h-2",
              prediction.trendStrength >= 70 ? "[&>div]:bg-up" : 
              prediction.trendStrength >= 40 ? "[&>div]:bg-yellow-500" : 
              "[&>div]:bg-down"
            )}
          />
          <div className="text-right mt-1">
            <span className="font-mono font-bold">{prediction.trendStrength}%</span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={cn(
              "w-4 h-4",
              prediction.reversalRisk >= 70 ? "text-destructive" :
              prediction.reversalRisk >= 40 ? "text-yellow-500" :
              "text-up"
            )} />
            <span className="text-xs text-muted-foreground">Reverseringsrisk</span>
          </div>
          <Progress 
            value={prediction.reversalRisk} 
            className={cn(
              "h-2",
              prediction.reversalRisk >= 70 ? "[&>div]:bg-destructive" : 
              prediction.reversalRisk >= 40 ? "[&>div]:bg-yellow-500" : 
              "[&>div]:bg-up"
            )}
          />
          <div className="text-right mt-1">
            <span className="font-mono font-bold">{prediction.reversalRisk}%</span>
          </div>
        </div>
      </div>

      {/* Risk/Reward Summary */}
      <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
        <div className="text-xs text-muted-foreground mb-1">Risk/Belöning Ratio</div>
        <div className="font-mono font-bold text-xl text-primary">
          1:{prediction.riskRewardRatio}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {prediction.riskRewardRatio >= 3 ? '✓ Utmärkt' : 
           prediction.riskRewardRatio >= 2 ? '✓ Bra' : 
           prediction.riskRewardRatio >= 1 ? '⚠️ Acceptabel' : 
           '⚠️ Låg'}
        </div>
      </div>
    </div>
  );
};

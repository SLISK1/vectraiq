import { WatchlistCase, HORIZON_LABELS } from '@/types/market';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { cn } from '@/lib/utils';
import { Clock, TrendingUp, TrendingDown, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { differenceInDays, differenceInHours, format, isPast } from 'date-fns';
import { sv } from 'date-fns/locale';

interface WatchlistCardProps {
  watchlistCase: WatchlistCase;
  onClick?: (watchlistCase: WatchlistCase) => void;
  className?: string;
}

export const WatchlistCard = ({ watchlistCase, onClick, className }: WatchlistCardProps) => {
  const isCompleted = !!watchlistCase.resultLockedAt;
  const isActive = !isCompleted;
  const targetDate = new Date(watchlistCase.targetEndTime);
  const isOverdue = isPast(targetDate) && isActive;

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  const getTimeRemaining = () => {
    if (isCompleted) return null;
    
    const now = new Date();
    const days = differenceInDays(targetDate, now);
    const hours = differenceInHours(targetDate, now) % 24;

    if (days > 0) return `${days}d ${hours}h kvar`;
    if (hours > 0) return `${hours}h kvar`;
    return 'Avslutas snart';
  };

  const returnValue = isCompleted ? watchlistCase.returnPct : watchlistCase.currentReturn;
  const ReturnIcon = returnValue && returnValue >= 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-4 transition-all duration-300 hover:scale-[1.01] cursor-pointer",
        isCompleted && watchlistCase.hit && "border-up/30",
        isCompleted && !watchlistCase.hit && "border-down/30",
        isActive && "border-primary/20",
        className
      )}
      onClick={() => onClick?.(watchlistCase)}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Asset Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">{watchlistCase.ticker}</h3>
            <AssetTypeBadge type={watchlistCase.asset.type} />
            <DirectionBadge direction={watchlistCase.predictionDirection} size="sm" />
          </div>
          
          <p className="text-sm text-muted-foreground mb-2">{watchlistCase.asset.name}</p>
          
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="horizon-badge bg-muted text-muted-foreground">
              {HORIZON_LABELS[watchlistCase.horizon]}
            </span>
            <span className="text-muted-foreground">
              Sparat: {format(new Date(watchlistCase.savedAt), 'dd MMM yyyy', { locale: sv })}
            </span>
            <span className="text-muted-foreground">
              Konfidens: <span className="font-mono text-foreground">{watchlistCase.confidenceAtSave}%</span>
            </span>
          </div>
        </div>

        {/* Middle: Prices */}
        <div className="text-center space-y-1">
          <div className="text-xs text-muted-foreground">Entry → {isCompleted ? 'Exit' : 'Nu'}</div>
          <div className="flex items-center gap-2 font-mono">
            <span>{formatPrice(watchlistCase.entryPrice, watchlistCase.asset.currency)}</span>
            <span className="text-muted-foreground">→</span>
            <span className={cn(
              returnValue && returnValue >= 0 ? "text-up" : "text-down"
            )}>
              {formatPrice(
                isCompleted ? watchlistCase.exitPrice! : watchlistCase.currentPrice || watchlistCase.entryPrice,
                watchlistCase.asset.currency
              )}
            </span>
          </div>
        </div>

        {/* Right: Return & Status */}
        <div className="text-right space-y-2">
          {returnValue !== undefined && (
            <div className={cn(
              "flex items-center justify-end gap-1.5 font-mono font-bold text-lg",
              returnValue >= 0 ? "text-up" : "text-down"
            )}>
              <ReturnIcon className="w-5 h-5" />
              {returnValue >= 0 ? '+' : ''}{returnValue.toFixed(2)}%
            </div>
          )}

          {isActive && (
            <div className={cn(
              "flex items-center justify-end gap-1.5 text-sm",
              isOverdue ? "text-neutral" : "text-muted-foreground"
            )}>
              <Clock className="w-4 h-4" />
              {isOverdue ? 'Väntar på data' : getTimeRemaining()}
            </div>
          )}

          {isCompleted && (
            <div className={cn(
              "flex items-center justify-end gap-1.5 text-sm font-medium",
              watchlistCase.hit ? "text-up" : "text-down"
            )}>
              {watchlistCase.hit ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Träff
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" />
                  Miss
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { WatchlistCase, HORIZON_LABELS } from '@/types/market';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { WatchlistEvents } from './WatchlistEvents';
import { useWatchlistThesisMap } from '@/hooks/useMarketData';
import { cn } from '@/lib/utils';
import { Clock, TrendingUp, TrendingDown, CheckCircle, XCircle, AlertCircle, AlertTriangle, Target } from 'lucide-react';
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

  // User-authored thesis / stop-loss / target. The page-level mapping doesn't
  // carry these columns, so read them here keyed by case id.
  const { data: thesisMap } = useWatchlistThesisMap();
  const meta = thesisMap?.get(watchlistCase.id);
  const thesisNote = meta?.thesisNote ?? null;
  const stopLoss = meta?.stopLoss ?? null;
  const targetPrice = meta?.targetPrice ?? null;

  const currency = watchlistCase.asset.currency;

  const formatPrice = (price: number, curr: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  // Thesis-break detection: for a long/UP case the stop is below price and is
  // hit when price falls to/below it; for a short/DOWN case it is above and
  // hit when price rises to/above it. Only meaningful while the case is active.
  const livePrice = watchlistCase.currentPrice;
  const isShort = watchlistCase.predictionDirection === 'DOWN';
  const thesisBroken =
    isActive &&
    stopLoss != null &&
    livePrice != null &&
    (isShort ? livePrice >= stopLoss : livePrice <= stopLoss);

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

  const hasThesisDetails = !!thesisNote || stopLoss != null || targetPrice != null;

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-4 transition-all duration-300 hover:scale-[1.01] cursor-pointer",
        isCompleted && watchlistCase.hit && "border-up/30",
        isCompleted && !watchlistCase.hit && "border-down/30",
        isActive && !thesisBroken && "border-primary/20",
        thesisBroken && "border-down/60 ring-1 ring-down/40",
        className
      )}
      onClick={() => onClick?.(watchlistCase)}
    >
      {/* Thesis-break warning — prominent when the stop-loss is crossed */}
      {thesisBroken && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-down/10 border border-down/30 text-down">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-semibold">Tesen bruten · Stop-loss nådd</span>
          {livePrice != null && stopLoss != null && (
            <span className="text-xs font-mono ml-auto">
              {formatPrice(livePrice, currency)} / SL {formatPrice(stopLoss, currency)}
            </span>
          )}
        </div>
      )}

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
            <span>{formatPrice(watchlistCase.entryPrice, currency)}</span>
            <span className="text-muted-foreground">→</span>
            <span className={cn(
              returnValue && returnValue >= 0 ? "text-up" : "text-down"
            )}>
              {formatPrice(
                isCompleted ? watchlistCase.exitPrice! : watchlistCase.currentPrice || watchlistCase.entryPrice,
                currency
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

      {/* Thesis, stop-loss & target (user-authored) */}
      {hasThesisDetails && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          {thesisNote && (
            <div className="text-sm">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tes</span>
              <p className="mt-0.5 text-foreground whitespace-pre-line">{thesisNote}</p>
            </div>
          )}
          {(stopLoss != null || targetPrice != null) && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {stopLoss != null && (
                <span className={cn("inline-flex items-center gap-1.5", thesisBroken ? "text-down font-medium" : "text-muted-foreground")}>
                  <AlertCircle className="w-3.5 h-3.5" />
                  Stop-loss: <span className="font-mono text-foreground">{formatPrice(stopLoss, currency)}</span>
                </span>
              )}
              {targetPrice != null && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Target className="w-3.5 h-3.5" />
                  Riktkurs: <span className="font-mono text-foreground">{formatPrice(targetPrice, currency)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upcoming events (earnings + dividends) for this ticker.
          Renders nothing (incl. its own divider) when there are no events. */}
      <WatchlistEvents ticker={watchlistCase.ticker} />
    </div>
  );
};

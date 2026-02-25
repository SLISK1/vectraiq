import { RankedAsset, MODULE_NAMES } from '@/types/market';
import { ScoreRing } from './ScoreRing';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { cn } from '@/lib/utils';
import { ChevronRight, Star, AlertTriangle, ShoppingCart } from 'lucide-react';

interface RankedAssetCardProps {
  asset: RankedAsset;
  rank: number;
  dbRank?: { rank: number; total: number } | null;
  onAddToWatchlist?: (asset: RankedAsset) => void;
  onClick?: (asset: RankedAsset) => void;
  onSimulateTrade?: (asset: RankedAsset) => void;
  className?: string;
}

export const RankedAssetCard = ({ asset, rank, dbRank, onAddToWatchlist, onClick, onSimulateTrade, className }: RankedAssetCardProps) => {
  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  const formatChange = (percent: number) => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  };

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-4 transition-all duration-300 hover:scale-[1.02] cursor-pointer group",
        asset.direction === 'UP' && "hover:border-up/30",
        asset.direction === 'DOWN' && "hover:border-down/30",
        className
      )}
      onClick={() => onClick?.(asset)}
    >
      <div className="flex items-start gap-4">
        {/* Rank */}
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-lg",
          rank <= 3 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {rank}
        </div>

        {/* Score Ring */}
        <ScoreRing score={asset.totalScore} direction={asset.direction} size="md" />

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg truncate">{asset.ticker}</h3>
            <AssetTypeBadge type={asset.type} />
            <DirectionBadge direction={asset.direction} size="sm" />
            {dbRank && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                Rankad {dbRank.rank}/{dbRank.total}
              </span>
            )}
          </div>
          
          <p className="text-sm text-muted-foreground truncate mb-2">{asset.name}</p>
          
          <div className="flex items-center gap-3 text-sm">
            <span className="font-mono font-medium">{formatPrice(asset.lastPrice, asset.currency)}</span>
            <span className={cn(
              "font-mono",
              asset.changePercent24h >= 0 ? "text-up" : "text-down"
            )}>
              {formatChange(asset.changePercent24h)}
            </span>
          </div>

          {/* Predicted Returns + Z-score */}
          {asset.predictedReturns && (
            <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
              <span className="text-muted-foreground">Prognos:</span>
              <span className={cn("font-mono", asset.predictedReturns.day1 >= 0 ? "text-up" : "text-down")}>
                1d {asset.predictedReturns.day1 >= 0 ? '+' : ''}{asset.predictedReturns.day1}%
              </span>
              <span className={cn("font-mono", asset.predictedReturns.week1 >= 0 ? "text-up" : "text-down")}>
                1v {asset.predictedReturns.week1 >= 0 ? '+' : ''}{asset.predictedReturns.week1}%
              </span>
              {(asset as any).peerZScore !== undefined && (asset as any).peerZScore !== 0 && (
                <span className={cn(
                  "font-mono text-xs px-1.5 py-0.5 rounded border",
                  (asset as any).peerZScore > 0
                    ? "text-up border-up/30 bg-up/10"
                    : "text-down border-down/30 bg-down/10"
                )}>
                  {(asset as any).peerZScore > 0 ? '+' : ''}{(asset as any).peerZScore}σ vs peers
                </span>
              )}
            </div>
          )}
        </div>

        {/* Confidence & Contributors */}
        <div className="text-right space-y-2">
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-xs text-muted-foreground">Konfidens</span>
            <span className={cn(
              "font-mono font-semibold text-sm",
              asset.confidence >= 70 ? "text-up" : asset.confidence >= 50 ? "text-neutral" : "text-down"
            )}>
              {asset.confidence}%
            </span>
            {asset.confidence < 50 && <AlertTriangle className="w-3.5 h-3.5 text-neutral" />}
          </div>
          
          <div className="space-y-1">
            {asset.topContributors.slice(0, 2).map((c, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                <span>{MODULE_NAMES[c.module]}</span>
                <span className={cn("font-mono", asset.direction === 'UP' ? "text-up" : "text-down")}>
                  +{c.contribution}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToWatchlist?.(asset);
            }}
            className="p-2 rounded-lg bg-muted hover:bg-accent transition-colors"
            title="Lägg till i watchlist"
          >
            <Star className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSimulateTrade?.(asset);
            }}
            className="p-2 rounded-lg bg-muted hover:bg-accent transition-colors"
            title="Simulera trade"
          >
            <ShoppingCart className="w-4 h-4" />
          </button>
          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    </div>
  );
};

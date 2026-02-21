import { RankedAsset } from '@/types/market';
import { RankedAssetCard } from './RankedAssetCard';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopRankingListProps {
  title: string;
  direction: 'UP' | 'DOWN';
  assets: RankedAsset[];
  isLoading?: boolean;
  lastUpdated?: string;
  onAddToWatchlist?: (asset: RankedAsset) => void;
  onAssetClick?: (asset: RankedAsset) => void;
  onRefresh?: () => void;
  className?: string;
}

export const TopRankingList = ({
  title,
  direction,
  assets,
  isLoading,
  lastUpdated,
  onAddToWatchlist,
  onAssetClick,
  onRefresh,
  className,
}: TopRankingListProps) => {
  const Icon = direction === 'UP' ? TrendingUp : TrendingDown;
  const gradientClass = direction === 'UP' ? 'gradient-up' : 'gradient-down';
  const iconColor = direction === 'UP' ? 'text-up' : 'text-down';

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", gradientClass)}>
            <Icon className={cn("w-5 h-5", iconColor)} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Uppdaterad: {new Date(lastUpdated).toLocaleString('sv-SE')}
              </p>
            )}
          </div>
        </div>
        
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-lg bg-muted hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-muted" />
                <div className="w-16 h-16 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-24 bg-muted rounded" />
                  <div className="h-4 w-32 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))
        ) : assets.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center text-muted-foreground space-y-2">
            <p>Inga signaler tillgängliga för denna kombination</p>
            <p className="text-xs">Prova ett annat filter eller en annan horisont. Tillgångar utan tillräcklig prishistorik filtreras bort automatiskt.</p>
          </div>
        ) : (
          assets.map((asset, index) => (
            <RankedAssetCard
              key={asset.ticker}
              asset={asset}
              rank={index + 1}
              onAddToWatchlist={onAddToWatchlist}
              onClick={onAssetClick}
            />
          ))
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center px-4 py-2 bg-muted/30 rounded-lg">
        ⚠️ Datadriven översikt baserad på offentlig data. Ej investeringsråd.
      </p>
    </div>
  );
};

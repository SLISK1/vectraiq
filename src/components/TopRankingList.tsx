import { useMemo } from 'react';
import { RankedAsset } from '@/types/market';
import { RankedAssetCard } from './RankedAssetCard';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TopRankingListProps {
  title: string;
  direction: 'UP' | 'DOWN';
  assets: RankedAsset[];
  isLoading?: boolean;
  lastUpdated?: string;
  onAddToWatchlist?: (asset: RankedAsset) => void;
  onAssetClick?: (asset: RankedAsset) => void;
  onSimulateTrade?: (asset: RankedAsset) => void;
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
  onSimulateTrade,
  onRefresh,
  className,
}: TopRankingListProps) => {
  const Icon = direction === 'UP' ? TrendingUp : TrendingDown;
  const gradientClass = direction === 'UP' ? 'gradient-up' : 'gradient-down';
  const iconColor = direction === 'UP' ? 'text-up' : 'text-down';

  // Fetch today's rank_results from DB (if a rank_run exists)
  const { data: rankResultsData } = useQuery({
    queryKey: ['rank-results-today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data: runs } = await supabase
        .from('rank_runs')
        .select('id')
        .gte('ts', `${today}T00:00:00Z`)
        .order('ts', { ascending: false })
        .limit(1);
      if (!runs?.length) return null;
      const { data: results } = await supabase
        .from('rank_results')
        .select('asset_id, rank, symbols!inner(ticker)')
        .eq('rank_run_id', runs[0].id);
      return results as { asset_id: string; rank: number; symbols: { ticker: string } }[] | null;
    },
    staleTime: 1000 * 60 * 10,
  });

  const rankMap = useMemo(() => {
    if (!rankResultsData) return new Map<string, { rank: number; total: number }>();
    const total = rankResultsData.length;
    const m = new Map<string, { rank: number; total: number }>();
    for (const r of rankResultsData) {
      const ticker = (r.symbols as any)?.ticker;
      if (ticker) m.set(ticker, { rank: r.rank, total });
    }
    return m;
  }, [rankResultsData]);

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
              dbRank={rankMap.get(asset.ticker) ?? null}
              onAddToWatchlist={onAddToWatchlist}
              onClick={onAssetClick}
              onSimulateTrade={onSimulateTrade}
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

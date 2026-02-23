import { RankedAsset, HORIZON_LABELS } from '@/types/market';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScoreRing } from './ScoreRing';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { ConfidenceBreakdownCard } from './ConfidenceBreakdownCard';
import { ModuleSignalTable } from './ModuleSignalTable';
import { TrendPredictionCard } from './TrendPredictionCard';
import { SignalFlipCard } from './SignalFlipCard';
import { cn } from '@/lib/utils';
import { Star, ExternalLink, TrendingUp, BarChart2, ShoppingCart } from 'lucide-react';
import { Button } from './ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AssetDetailModalProps {
  asset: RankedAsset | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToWatchlist?: (asset: RankedAsset) => void;
  onSimulateTrade?: (asset: RankedAsset) => void;
}

export const AssetDetailModal = ({ asset, isOpen, onClose, onAddToWatchlist, onSimulateTrade }: AssetDetailModalProps) => {
  if (!asset) return null;

  // Fetch historical predictions for this asset (excess return data)
  const { data: predictions } = useQuery({
    queryKey: ['asset-predictions', asset.ticker],
    queryFn: async () => {
      const { data: symbols } = await supabase
        .from('symbols')
        .select('id')
        .eq('ticker', asset.ticker)
        .limit(1);
      
      if (!symbols?.length) return null;
      const symbolId = symbols[0].id;
      
      const { data } = await supabase
        .from('asset_predictions')
        .select('hit, return_pct, excess_return, horizon, predicted_direction, created_at')
        .eq('symbol_id', symbolId)
        .not('hit', 'is', null)
        .eq('horizon', asset.horizon)
        .order('created_at', { ascending: false })
        .limit(30);
      
      return data;
    },
    enabled: isOpen && !!asset,
    staleTime: 1000 * 60 * 5,
  });

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
    if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
    return volume.toString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-2xl">{asset.ticker}</span>
            <AssetTypeBadge type={asset.type} />
            <DirectionBadge direction={asset.direction} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Historical Performance vs Benchmark */}
          {predictions && predictions.length > 0 && (() => {
            const hits = predictions.filter(p => p.hit).length;
            const hitRate = (hits / predictions.length) * 100;
            const avgReturn = predictions.reduce((s, p) => s + (p.return_pct || 0), 0) / predictions.length;
            const avgExcess = predictions.filter(p => p.excess_return != null).reduce((s, p) => s + (p.excess_return || 0), 0) / (predictions.filter(p => p.excess_return != null).length || 1);
            const hasExcess = predictions.some(p => p.excess_return != null);
            return (
              <div className="p-4 rounded-xl bg-muted/20 border border-border/50">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Historisk träffsäkerhet ({predictions.length} predictions, {HORIZON_LABELS[asset.horizon]})</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center">
                    <div className={cn('font-mono font-bold text-xl', hitRate >= 60 ? 'text-up' : hitRate >= 50 ? 'text-yellow-500' : 'text-down')}>{hitRate.toFixed(0)}%</div>
                    <div className="text-xs text-muted-foreground">Hit Rate ({hits}/{predictions.length})</div>
                  </div>
                  <div className="text-center">
                    <div className={cn('font-mono font-bold text-xl', avgReturn >= 0 ? 'text-up' : 'text-down')}>{avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">Snitt avkastning</div>
                  </div>
                  {hasExcess && (
                    <div className="text-center">
                      <div className={cn('font-mono font-bold text-xl', avgExcess >= 0 ? 'text-up' : 'text-down')}>{avgExcess >= 0 ? '+' : ''}{avgExcess.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground">vs Index (excess)</div>
                    </div>
                  )}
                  <div className="text-center">
                    <div className={cn('font-mono font-bold text-xl', asset.confidence >= 65 ? 'text-up' : 'text-yellow-500')}>{asset.confidence}%</div>
                    <div className="text-xs text-muted-foreground">Nuv. konfidens</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* AI Summary */}
          {asset.aiSummary && (
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/20">
              <h3 className="font-semibold text-sm mb-2 text-primary">🤖 AI-analys</h3>
              <p className="text-sm">{asset.aiSummary}</p>
            </div>
          )}

          {/* Predicted Returns Grid */}
          {asset.predictedReturns && (
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">1 dag</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  asset.predictedReturns.day1 >= 0 ? "text-up" : "text-down"
                )}>
                  {asset.predictedReturns.day1 >= 0 ? '+' : ''}{asset.predictedReturns.day1}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">1 vecka</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  asset.predictedReturns.week1 >= 0 ? "text-up" : "text-down"
                )}>
                  {asset.predictedReturns.week1 >= 0 ? '+' : ''}{asset.predictedReturns.week1}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">1 år</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  asset.predictedReturns.year1 >= 0 ? "text-up" : "text-down"
                )}>
                  {asset.predictedReturns.year1 >= 0 ? '+' : ''}{asset.predictedReturns.year1}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">5 år</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  asset.predictedReturns.year5 >= 0 ? "text-up" : "text-down"
                )}>
                  {asset.predictedReturns.year5 >= 0 ? '+' : ''}{asset.predictedReturns.year5}%
                </div>
              </div>
            </div>
          )}

          {/* Top Section: Score + Price Info */}
          <div className="flex flex-col md:flex-row gap-6">
            {/* Score Ring */}
            <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-muted/30">
              <ScoreRing score={asset.totalScore} direction={asset.direction} size="lg" />
              <div className="text-center">
                <div className="text-sm text-muted-foreground">Total Score</div>
                <div className="horizon-badge bg-muted text-muted-foreground mt-1">
                  {HORIZON_LABELS[asset.horizon]}
                </div>
              </div>
            </div>

            {/* Price & Stats */}
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Senaste pris</div>
                <div className="font-mono font-bold text-lg">{formatPrice(asset.lastPrice, asset.currency)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">24h förändring</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  asset.changePercent24h >= 0 ? "text-up" : "text-down"
                )}>
                  {asset.changePercent24h >= 0 ? '+' : ''}{asset.changePercent24h.toFixed(2)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Volym 24h</div>
                <div className="font-mono font-bold text-lg">{formatVolume(asset.volume24h)}</div>
              </div>
              {asset.marketCap && (
                <div className="p-3 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">Börsvärde</div>
                  <div className="font-mono font-bold text-lg">{formatVolume(asset.marketCap)}</div>
                </div>
              )}
            </div>
          </div>

          {/* Trend Prediction & Stop/Loss */}
          {asset.trendPrediction && (
            <TrendPredictionCard 
              prediction={asset.trendPrediction}
              direction={asset.direction}
              currentPrice={asset.lastPrice}
              currency={asset.currency}
            />
          )}

          {/* Confidence Breakdown */}
          <ConfidenceBreakdownCard 
            breakdown={asset.confidenceBreakdown} 
            totalConfidence={asset.confidence} 
          />

          {/* Module Signals */}
          <div>
            <h3 className="font-semibold mb-3">Analys per modul</h3>
            <ModuleSignalTable signals={asset.signals} />
          </div>

          {/* Signal Flip Card */}
          <SignalFlipCard
            signals={asset.signals}
            direction={asset.direction}
            assetType={asset.type as 'stock' | 'crypto' | 'metal'}
          />

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border/50">
            <Button
              onClick={() => onAddToWatchlist?.(asset)}
              className="flex-1 gap-2"
            >
              <Star className="w-4 h-4" />
              Lägg till i Watchlist
            </Button>
            <Button
              onClick={() => onSimulateTrade?.(asset)}
              variant="secondary"
              className="flex-1 gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              Simulera trade
            </Button>
            <Button variant="outline" className="flex-1 gap-2">
              <ExternalLink className="w-4 h-4" />
              Öppna på Yahoo Finance
            </Button>
          </div>

          {/* Disclaimer */}
          <p className="text-xs text-muted-foreground text-center p-3 bg-muted/30 rounded-lg">
            ⚠️ Denna analys är baserad på offentlig data och utgör inte investeringsrådgivning. 
            Gör alltid din egen research innan investeringsbeslut.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

import { RankedAsset, HORIZON_LABELS } from '@/types/market';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScoreRing } from './ScoreRing';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { ConfidenceBreakdownCard } from './ConfidenceBreakdownCard';
import { ModuleSignalTable } from './ModuleSignalTable';
import { cn } from '@/lib/utils';
import { Star, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';

interface AssetDetailModalProps {
  asset: RankedAsset | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToWatchlist?: (asset: RankedAsset) => void;
}

export const AssetDetailModal = ({ asset, isOpen, onClose, onAddToWatchlist }: AssetDetailModalProps) => {
  if (!asset) return null;

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

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border/50">
            <Button
              onClick={() => onAddToWatchlist?.(asset)}
              className="flex-1 gap-2"
            >
              <Star className="w-4 h-4" />
              Lägg till i Watchlist
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

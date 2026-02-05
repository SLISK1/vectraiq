import { RankedAsset, Horizon, HORIZON_LABELS, HORIZON_SUPPORT } from '@/types/market';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DirectionBadge } from './DirectionBadge';
import { AssetTypeBadge } from './AssetTypeBadge';
import { cn } from '@/lib/utils';
import { Star, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { addDays, addWeeks, addMonths, addYears, format } from 'date-fns';
import { sv } from 'date-fns/locale';

interface AddToWatchlistModalProps {
  asset: RankedAsset | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (asset: RankedAsset, horizon: Horizon) => void;
}

const supportedHorizons: Horizon[] = ['1d', '1w', '1mo', '1y'];

const getTargetDate = (horizon: Horizon): Date => {
  const now = new Date();
  switch (horizon) {
    case '1d': return addDays(now, 1);
    case '1w': return addWeeks(now, 1);
    case '1mo': return addMonths(now, 1);
    case '1y': return addYears(now, 1);
    default: return addWeeks(now, 1);
  }
};

export const AddToWatchlistModal = ({ asset, isOpen, onClose, onConfirm }: AddToWatchlistModalProps) => {
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>(asset?.horizon || '1w');

  if (!asset) return null;

  const handleConfirm = () => {
    onConfirm(asset, selectedHorizon);
    onClose();
  };

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency,
      minimumFractionDigits: price < 10 ? 2 : 0,
      maximumFractionDigits: price < 10 ? 4 : 2,
    }).format(price);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-primary" />
            Lägg till i Watchlist
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Asset Info */}
          <div className="p-4 rounded-lg bg-muted/30 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg">{asset.ticker}</span>
              <AssetTypeBadge type={asset.type} />
            </div>
            <p className="text-sm text-muted-foreground">{asset.name}</p>
            <div className="flex items-center gap-3 text-sm">
              <span>Entry-pris:</span>
              <span className="font-mono font-medium">{formatPrice(asset.lastPrice, asset.currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Prediktion:</span>
              <DirectionBadge direction={asset.direction} size="sm" />
              <span className="text-sm text-muted-foreground">(Konfidens: {asset.confidence}%)</span>
            </div>
          </div>

          {/* Horizon Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Välj tidshorisont</label>
            <div className="grid grid-cols-2 gap-2">
              {supportedHorizons.map((horizon) => {
                const targetDate = getTargetDate(horizon);
                const isSupported = HORIZON_SUPPORT[horizon] === 'full';
                
                return (
                  <button
                    key={horizon}
                    onClick={() => isSupported && setSelectedHorizon(horizon)}
                    disabled={!isSupported}
                    className={cn(
                      "p-3 rounded-lg text-left transition-all duration-200",
                      selectedHorizon === horizon
                        ? "bg-primary text-primary-foreground"
                        : isSupported
                          ? "bg-muted hover:bg-accent"
                          : "bg-muted/50 opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="font-medium">{HORIZON_LABELS[horizon]}</div>
                    <div className={cn(
                      "text-xs mt-1",
                      selectedHorizon === horizon ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}>
                      Slutdatum: {format(targetDate, 'dd MMM yyyy', { locale: sv })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info Box */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 text-sm">
            <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              När horisonten är slut kommer resultatet att låsas automatiskt och vi sparar huruvida 
              prediktionen var korrekt för statistik.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={handleConfirm} className="gap-2">
            <Star className="w-4 h-4" />
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

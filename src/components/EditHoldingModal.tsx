import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import type { SymbolWithPrice } from '@/lib/api/database';
import type { PortfolioHolding } from '@/hooks/useMarketData';

interface EditHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: { quantity: number; purchasePrice: number; purchaseDate: string; notes?: string }) => Promise<void>;
  holding: PortfolioHolding | null;
  symbol?: SymbolWithPrice;
  isUpdating: boolean;
}

export const EditHoldingModal = ({ isOpen, onClose, onUpdate, holding, symbol, isUpdating }: EditHoldingModalProps) => {
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');

  // Populate form when holding changes
  useEffect(() => {
    if (holding) {
      setQuantity(String(holding.quantity));
      setPurchasePrice(String(holding.purchase_price));
      setPurchaseDate(holding.purchase_date);
      setNotes(holding.notes || '');
    }
  }, [holding]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holding || !quantity || !purchasePrice) return;

    await onUpdate(holding.id, {
      quantity: Number(quantity),
      purchasePrice: Number(purchasePrice),
      purchaseDate,
      notes: notes || undefined,
    });
  };

  const currency = symbol?.currency || 'SEK';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Redigera innehav
            {symbol && <span className="text-muted-foreground ml-2">({symbol.ticker})</span>}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Asset info (read-only) */}
          {symbol && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="font-medium">{symbol.ticker}</p>
              <p className="text-sm text-muted-foreground">{symbol.name}</p>
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="edit-quantity">Antal</Label>
            <Input
              id="edit-quantity"
              type="number"
              step="any"
              min="0"
              placeholder="t.ex. 10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          {/* Purchase price */}
          <div className="space-y-2">
            <Label htmlFor="edit-purchasePrice">Köppris per enhet ({currency})</Label>
            <Input
              id="edit-purchasePrice"
              type="number"
              step="any"
              min="0"
              placeholder="t.ex. 150.50"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              required
            />
          </div>

          {/* Purchase date */}
          <div className="space-y-2">
            <Label htmlFor="edit-purchaseDate">Köpdatum</Label>
            <Input
              id="edit-purchaseDate"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Anteckningar (valfritt)</Label>
            <Textarea
              id="edit-notes"
              placeholder="t.ex. Köpt vid dip"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Avbryt
            </Button>
            <Button type="submit" disabled={!quantity || !purchasePrice || isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sparar...
                </>
              ) : (
                'Spara ändringar'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

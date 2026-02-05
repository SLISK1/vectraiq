import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SymbolWithPrice } from '@/lib/api/database';

interface AddHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { symbolId: string; quantity: number; purchasePrice: number; purchaseDate: string; notes?: string }) => Promise<void>;
  symbols: SymbolWithPrice[];
  isAdding: boolean;
}

export const AddHoldingModal = ({ isOpen, onClose, onAdd, symbols, isAdding }: AddHoldingModalProps) => {
  const [symbolId, setSymbolId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedSymbol = symbols.find(s => s.id === symbolId);

  const filteredSymbols = useMemo(() => {
    if (!searchQuery) return symbols.slice(0, 20);
    const query = searchQuery.toLowerCase();
    return symbols
      .filter(s => s.ticker.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
      .slice(0, 20);
  }, [symbols, searchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbolId || !quantity || !purchasePrice) return;

    await onAdd({
      symbolId,
      quantity: Number(quantity),
      purchasePrice: Number(purchasePrice),
      purchaseDate,
      notes: notes || undefined,
    });

    // Reset form
    setSymbolId('');
    setQuantity('');
    setPurchasePrice('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setNotes('');
  };

  const handleSelectSymbol = (id: string) => {
    setSymbolId(id);
    setOpen(false);
    // Auto-fill current price if available
    const symbol = symbols.find(s => s.id === id);
    if (symbol?.latestPrice) {
      setPurchasePrice(String(symbol.latestPrice.price));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lägg till innehav</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Symbol selector */}
          <div className="space-y-2">
            <Label>Tillgång</Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between"
                >
                  {selectedSymbol ? (
                    <span>{selectedSymbol.ticker} - {selectedSymbol.name}</span>
                  ) : (
                    <span className="text-muted-foreground">Välj tillgång...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command shouldFilter={false}>
                  <CommandInput 
                    placeholder="Sök tillgång..." 
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                  />
                  <CommandList>
                    <CommandEmpty>Ingen tillgång hittades.</CommandEmpty>
                    <CommandGroup>
                      {filteredSymbols.map((symbol) => (
                        <CommandItem
                          key={symbol.id}
                          value={symbol.id}
                          onSelect={() => handleSelectSymbol(symbol.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              symbolId === symbol.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="font-medium mr-2">{symbol.ticker}</span>
                          <span className="text-muted-foreground truncate">{symbol.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="quantity">Antal</Label>
            <Input
              id="quantity"
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
            <Label htmlFor="purchasePrice">Köppris per enhet ({selectedSymbol?.currency || 'SEK'})</Label>
            <Input
              id="purchasePrice"
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
            <Label htmlFor="purchaseDate">Köpdatum</Label>
            <Input
              id="purchaseDate"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Anteckningar (valfritt)</Label>
            <Textarea
              id="notes"
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
            <Button type="submit" disabled={!symbolId || !quantity || !purchasePrice || isAdding}>
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Lägger till...
                </>
              ) : (
                'Lägg till'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

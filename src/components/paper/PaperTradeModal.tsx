import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePaperTradeMutation, usePaperPortfolio } from '@/hooks/usePaperPortfolio';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

interface PaperTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbolId: string;
  ticker: string;
  name: string;
  lastPrice: number;
  currency: string;
  assetType?: string;
  defaultSide?: 'buy' | 'sell';
}

export const PaperTradeModal = ({
  isOpen, onClose, symbolId, ticker, name, lastPrice, currency, assetType = 'stock', defaultSide = 'buy',
}: PaperTradeModalProps) => {
  const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
  const [amountType, setAmountType] = useState<'cash' | 'qty'>('cash');
  const [amount, setAmount] = useState('');
  const tradeMutation = usePaperTradeMutation();
  const { data: portfolioData } = usePaperPortfolio();
  const { toast } = useToast();

  const estimate = useMemo(() => {
    const val = Number(amount);
    if (!val || val <= 0 || !lastPrice) return null;
    if (amountType === 'cash') {
      const fee = val * 0.001;
      const qty = (val - fee) / lastPrice;
      return { qty: Math.round(qty * 1e6) / 1e6, notional: val, fee: Math.round(fee * 100) / 100 };
    } else {
      const notional = val * lastPrice;
      const fee = notional * 0.001;
      return { qty: val, notional: Math.round(notional * 100) / 100, fee: Math.round(fee * 100) / 100 };
    }
  }, [amount, amountType, lastPrice]);

  const cashBalance = portfolioData?.portfolio ? Number(portfolioData.portfolio.cash_balance) : 100000;
  const holdingQty = portfolioData?.holdings?.find(h => h.symbol_id === symbolId)?.qty || 0;

  const handleSubmit = async () => {
    if (!estimate) return;
    try {
      await tradeMutation.mutateAsync({
        symbol_id: symbolId,
        ticker,
        asset_type: assetType,
        side,
        amount_type: amountType,
        amount: Number(amount),
      });
      toast({
        title: side === 'buy' ? `Köpt ${ticker}` : `Sålt ${ticker}`,
        description: `${estimate.qty.toFixed(4)} st @ ${lastPrice.toFixed(2)} ${currency}`,
      });
      setAmount('');
      onClose();
    } catch (err: any) {
      toast({ title: 'Trade misslyckades', description: err.message, variant: 'destructive' });
    }
  };

  const formatSEK = (v: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 2 }).format(v);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Simulera trade – {ticker}</DialogTitle>
          <DialogDescription>{name} • {formatSEK(lastPrice)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Side toggle */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={side === 'buy' ? 'default' : 'outline'}
              onClick={() => setSide('buy')}
              className={cn(side === 'buy' && 'bg-up hover:bg-up/90 text-white')}
            >
              <TrendingUp className="w-4 h-4 mr-2" /> Köp
            </Button>
            <Button
              variant={side === 'sell' ? 'default' : 'outline'}
              onClick={() => setSide('sell')}
              className={cn(side === 'sell' && 'bg-down hover:bg-down/90 text-white')}
            >
              <TrendingDown className="w-4 h-4 mr-2" /> Sälj
            </Button>
          </div>

          {/* Info */}
          <div className="text-sm text-muted-foreground flex justify-between">
            <span>Tillgängligt: {formatSEK(cashBalance)}</span>
            {holdingQty > 0 && <span>Innehav: {holdingQty.toFixed(4)} st</span>}
          </div>

          {/* Amount type */}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant={amountType === 'cash' ? 'secondary' : 'ghost'} onClick={() => setAmountType('cash')}>
              Belopp (SEK)
            </Button>
            <Button size="sm" variant={amountType === 'qty' ? 'secondary' : 'ghost'} onClick={() => setAmountType('qty')}>
              Antal (st)
            </Button>
          </div>

          {/* Input */}
          <div>
            <Label htmlFor="amount">{amountType === 'cash' ? 'Belopp i SEK' : 'Antal enheter'}</Label>
            <Input
              id="amount"
              type="number"
              placeholder={amountType === 'cash' ? '10000' : '10'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step={amountType === 'cash' ? 100 : 0.01}
            />
          </div>

          {/* Estimate */}
          {estimate && (
            <div className="p-3 rounded-lg bg-muted/30 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Antal:</span>
                <span className="font-mono">{estimate.qty.toFixed(4)} st</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Belopp:</span>
                <span className="font-mono">{formatSEK(estimate.notional)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avgift (0.1%):</span>
                <span className="font-mono">{formatSEK(estimate.fee)}</span>
              </div>
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={!estimate || tradeMutation.isPending}
            className={cn('w-full', side === 'buy' ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90', 'text-white')}
          >
            {tradeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {side === 'buy' ? 'Bekräfta köp' : 'Bekräfta sälj'}
          </Button>

          {/* Disclaimer */}
          <p className="text-xs text-muted-foreground text-center flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            Simulerad handel med låtsaspengar. Ej finansiell rådgivning.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

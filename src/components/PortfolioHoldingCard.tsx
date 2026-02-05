import { Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AssetTypeBadge } from './AssetTypeBadge';
import { formatCurrency } from '@/lib/utils';
import type { SymbolWithPrice } from '@/lib/api/database';
import type { AssetType } from '@/types/market';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

interface PortfolioHolding {
  id: string;
  symbol_id: string;
  quantity: number;
  purchase_price: number;
  purchase_date: string;
  notes?: string | null;
}

interface PortfolioHoldingCardProps {
  holding: PortfolioHolding;
  symbol?: SymbolWithPrice;
  onDelete: () => void;
}

export const PortfolioHoldingCard = ({ holding, symbol, onDelete }: PortfolioHoldingCardProps) => {
  const currentPrice = symbol?.latestPrice ? Number(symbol.latestPrice.price) : holding.purchase_price;
  const investedValue = holding.quantity * holding.purchase_price;
  const currentValue = holding.quantity * currentPrice;
  const profitLoss = currentValue - investedValue;
  const returnPct = investedValue > 0 ? (profitLoss / investedValue) * 100 : 0;
  const currency = symbol?.currency || 'SEK';

  return (
    <div className="glass-card rounded-xl p-4 hover:bg-card/80 transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Left: Asset info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-foreground truncate">
              {symbol?.ticker || 'N/A'}
            </span>
            {symbol && (
              <AssetTypeBadge type={(symbol.asset_type || 'stock') as AssetType} size="sm" />
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate mb-2">
            {symbol?.name || 'Okänd tillgång'}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{holding.quantity} st</span>
            <span>Köpt: {formatCurrency(holding.purchase_price, currency)}</span>
            <span>Datum: {format(new Date(holding.purchase_date), 'd MMM yyyy', { locale: sv })}</span>
          </div>
          {holding.notes && (
            <p className="text-xs text-muted-foreground mt-2 italic">{holding.notes}</p>
          )}
        </div>

        {/* Middle: Values */}
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktuellt värde</p>
          <p className="text-lg font-semibold">{formatCurrency(currentValue, currency)}</p>
          <p className="text-xs text-muted-foreground">
            Investerat: {formatCurrency(investedValue, currency)}
          </p>
        </div>

        {/* Right: Return */}
        <div className="text-right min-w-[100px]">
          <div className="flex items-center justify-end gap-1">
            {profitLoss >= 0 ? (
              <TrendingUp className="w-4 h-4 text-bullish" />
            ) : (
              <TrendingDown className="w-4 h-4 text-bearish" />
            )}
            <span className={`font-semibold ${profitLoss >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
            </span>
          </div>
          <p className={`text-sm ${profitLoss >= 0 ? 'text-bullish' : 'text-bearish'}`}>
            {profitLoss >= 0 ? '+' : ''}{formatCurrency(profitLoss, currency)}
          </p>
        </div>

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

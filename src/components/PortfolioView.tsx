import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio, useSymbols, useAddHolding, useDeleteHolding, useUpdateHolding, type PortfolioHolding } from '@/hooks/useMarketData';
import { PortfolioHoldingCard } from './PortfolioHoldingCard';
import { AddHoldingModal } from './AddHoldingModal';
import { EditHoldingModal } from './EditHoldingModal';
import { Button } from '@/components/ui/button';
import { Briefcase, Plus, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export const PortfolioView = () => {
  const { user } = useAuth();
  const { data: portfolio, isLoading } = usePortfolio();
  const { data: symbols } = useSymbols();
  const addHoldingMutation = useAddHolding();
  const deleteHoldingMutation = useDeleteHolding();
  const updateHoldingMutation = useUpdateHolding();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingHolding, setEditingHolding] = useState<PortfolioHolding | null>(null);

  if (!user) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <Briefcase className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold mb-2">Logga in för att se din portfolio</h3>
        <p className="text-muted-foreground">
          Skapa ett konto för att spåra dina innehav och se utvecklingen.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Calculate portfolio metrics
  const holdings = portfolio || [];
  const totalInvested = holdings.reduce((sum, h) => sum + (h.quantity * h.purchase_price), 0);
  const totalCurrentValue = holdings.reduce((sum, h) => {
    const symbol = symbols?.find(s => s.id === h.symbol_id);
    const currentPrice = symbol?.latestPrice ? Number(symbol.latestPrice.price) : h.purchase_price;
    return sum + (h.quantity * currentPrice);
  }, 0);
  const totalProfitLoss = totalCurrentValue - totalInvested;
  const totalReturnPct = totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

  const handleAddHolding = async (data: { symbolId: string; quantity: number; purchasePrice: number; purchaseDate: string; notes?: string }) => {
    await addHoldingMutation.mutateAsync(data);
    setShowAddModal(false);
  };

  const handleDeleteHolding = async (id: string) => {
    await deleteHoldingMutation.mutateAsync(id);
  };

  const handleUpdateHolding = async (id: string, data: { quantity: number; purchasePrice: number; purchaseDate: string; notes?: string }) => {
    await updateHoldingMutation.mutateAsync({ id, data });
    setEditingHolding(null);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card rounded-xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Antal innehav</p>
          <p className="text-2xl font-bold">{holdings.length}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Investerat</p>
          <p className="text-2xl font-bold">{formatCurrency(totalInvested, 'SEK')}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Aktuellt värde</p>
          <p className="text-2xl font-bold">{formatCurrency(totalCurrentValue, 'SEK')}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Total avkastning</p>
          <div className="flex items-center gap-2">
            {totalProfitLoss >= 0 ? (
              <TrendingUp className="w-5 h-5 text-bullish" />
            ) : (
              <TrendingDown className="w-5 h-5 text-bearish" />
            )}
            <span className={`text-2xl font-bold ${totalProfitLoss >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
            </span>
          </div>
          <p className={`text-sm ${totalProfitLoss >= 0 ? 'text-bullish' : 'text-bearish'}`}>
            {totalProfitLoss >= 0 ? '+' : ''}{formatCurrency(totalProfitLoss, 'SEK')}
          </p>
        </div>
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <Button onClick={() => setShowAddModal(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Lägg till innehav
        </Button>
      </div>

      {/* Holdings list */}
      {holdings.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <Briefcase className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">Ingen portfolio ännu</h3>
          <p className="text-muted-foreground mb-4">
            Lägg till dina första innehav för att börja spåra din utveckling.
          </p>
          <Button onClick={() => setShowAddModal(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Lägg till innehav
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {holdings.map((holding) => {
            const symbol = symbols?.find(s => s.id === holding.symbol_id);
            return (
              <PortfolioHoldingCard
                key={holding.id}
                holding={holding}
                symbol={symbol}
                onEdit={() => setEditingHolding(holding)}
                onDelete={() => handleDeleteHolding(holding.id)}
              />
            );
          })}
        </div>
      )}

      {/* Add Modal */}
      <AddHoldingModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddHolding}
        symbols={symbols || []}
        isAdding={addHoldingMutation.isPending}
      />

      {/* Edit Modal */}
      <EditHoldingModal
        isOpen={!!editingHolding}
        onClose={() => setEditingHolding(null)}
        onUpdate={handleUpdateHolding}
        holding={editingHolding}
        symbol={editingHolding ? symbols?.find(s => s.id === editingHolding.symbol_id) : undefined}
        isUpdating={updateHoldingMutation.isPending}
      />
    </div>
  );
};

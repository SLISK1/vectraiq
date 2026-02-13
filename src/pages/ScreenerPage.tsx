import { useState } from 'react';
import { SectorCategories } from '@/components/screener/SectorCategories';
import { ScreenerFilters } from '@/components/screener/ScreenerFilters';
import { ScreenerTable } from '@/components/screener/ScreenerTable';
import { ScreenerDetailModal } from '@/components/screener/ScreenerDetailModal';
import { useSymbols } from '@/hooks/useMarketData';
import { Loader2, LayoutGrid } from 'lucide-react';
import type { SymbolWithPrice } from '@/lib/api/database';

export const ScreenerPage = () => {
  const { data: symbols, isLoading } = useSymbols();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedMarketCap, setSelectedMarketCap] = useState('all');
  const [selectedAssetType, setSelectedAssetType] = useState('all');
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolWithPrice | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/20">
          <LayoutGrid className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Aktiescreener</h2>
          <p className="text-sm text-muted-foreground">Filtrera och sortera {symbols?.length || 0} tillgångar</p>
        </div>
      </div>

      {/* Sector Categories */}
      <SectorCategories selectedSector={selectedSector} onSectorSelect={setSelectedSector} />

      {/* Filters */}
      <ScreenerFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedSector={selectedSector}
        onSectorChange={setSelectedSector}
        selectedMarketCap={selectedMarketCap}
        onMarketCapChange={setSelectedMarketCap}
        selectedAssetType={selectedAssetType}
        onAssetTypeChange={setSelectedAssetType}
      />

      {/* Table */}
      <ScreenerTable
        symbols={symbols || []}
        searchQuery={searchQuery}
        selectedSector={selectedSector}
        selectedMarketCap={selectedMarketCap}
        selectedAssetType={selectedAssetType}
        onAssetClick={(s) => setSelectedSymbol(s)}
      />

      {/* Detail Modal */}
      <ScreenerDetailModal
        symbol={selectedSymbol}
        isOpen={!!selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />
    </div>
  );
};

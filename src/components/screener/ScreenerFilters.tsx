import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ScreenerFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedSector: string | null;
  onSectorChange: (sector: string | null) => void;
  selectedMarketCap: string;
  onMarketCapChange: (cap: string) => void;
  selectedAssetType: string;
  onAssetTypeChange: (type: string) => void;
}

const SECTORS = [
  'Energy', 'Financial Services', 'Technology', 'Healthcare', 'Industrials',
  'Real Estate', 'Materials', 'Consumer Discretionary', 'Consumer Staples',
  'Communication Services', 'Utilities',
];

export const ScreenerFilters = ({
  searchQuery,
  onSearchChange,
  selectedSector,
  onSectorChange,
  selectedMarketCap,
  onMarketCapChange,
  selectedAssetType,
  onAssetTypeChange,
}: ScreenerFiltersProps) => {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Sök aktie, fond, krypto..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Sector */}
      <Select value={selectedSector || 'all'} onValueChange={(v) => onSectorChange(v === 'all' ? null : v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Bransch" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alla branscher</SelectItem>
          {SECTORS.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Market Cap */}
      <Select value={selectedMarketCap} onValueChange={onMarketCapChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Börsvärde" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alla</SelectItem>
          <SelectItem value="large">Large Cap</SelectItem>
          <SelectItem value="mid">Mid Cap</SelectItem>
          <SelectItem value="small">Small Cap</SelectItem>
        </SelectContent>
      </Select>

      {/* Asset Type */}
      <Select value={selectedAssetType} onValueChange={onAssetTypeChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Typ" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alla typer</SelectItem>
          <SelectItem value="stock">Aktier</SelectItem>
          <SelectItem value="crypto">Krypto</SelectItem>
          <SelectItem value="fund">Fonder</SelectItem>
          <SelectItem value="metal">Metaller</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

import { useState, useMemo } from 'react';
import { Search, X, TrendingUp, TrendingDown, Minus, Plus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AssetTypeBadge } from '@/components/AssetTypeBadge';
import { cn } from '@/lib/utils';

interface SearchableAsset {
  id: string;
  ticker: string;
  name: string;
  type: 'stock' | 'crypto' | 'metal' | 'fund';
  price?: number;
  changePercent?: number;
  currency?: string;
}

interface SearchAssetsProps {
  assets: SearchableAsset[];
  onSelect: (asset: SearchableAsset) => void;
  onAddNew?: (ticker: string) => Promise<void>;
  placeholder?: string;
  isAdding?: boolean;
}

export const SearchAssets = ({ 
  assets, 
  onSelect, 
  onAddNew,
  placeholder = "Sök aktie, fond eller krypto...",
  isAdding = false
}: SearchAssetsProps) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const filteredAssets = useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    return assets
      .filter(asset => 
        asset.ticker.toLowerCase().includes(lowerQuery) ||
        asset.name.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 8); // Limit results
  }, [assets, query]);

  const handleSelect = (asset: SearchableAsset) => {
    onSelect(asset);
    setQuery('');
    setIsFocused(false);
  };

  const handleAddNew = async () => {
    if (onAddNew && query.trim()) {
      await onAddNew(query.trim().toUpperCase());
      setQuery('');
      setIsFocused(false);
    }
  };

  const showResults = isFocused && query.trim().length > 0;
  const noResults = showResults && filteredAssets.length === 0;
  const canAdd = noResults && onAddNew && query.trim().length >= 1;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 300)}
          placeholder={placeholder}
          className="pl-10 pr-10 bg-background/50 border-border/50 focus:border-primary/50"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {filteredAssets.length === 0 ? (
            <div className="p-4">
              <div className="text-center text-muted-foreground text-sm mb-3">
                Inga resultat för "{query}"
              </div>
              {canAdd && (
                <Button
                  onClick={handleAddNew}
                  disabled={isAdding}
                  className="w-full gap-2"
                  variant="outline"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Lägger till {query.toUpperCase()}...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Lägg till "{query.toUpperCase()}" som ny tillgång
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {filteredAssets.map((asset) => (
                <li key={asset.id}>
                  <button
                    onClick={() => handleSelect(asset)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <AssetTypeBadge type={asset.type} size="sm" />
                      <div>
                        <div className="font-medium">{asset.ticker}</div>
                        <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {asset.name}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {asset.price !== undefined && (
                        <div className="font-medium">
                          {asset.price.toLocaleString('sv-SE', { 
                            minimumFractionDigits: 2, 
                            maximumFractionDigits: 2 
                          })} {asset.currency || 'SEK'}
                        </div>
                      )}
                      {asset.changePercent !== undefined && (
                        <div className={cn(
                          "text-sm flex items-center justify-end gap-1",
                          asset.changePercent > 0 ? "text-emerald-500" : 
                          asset.changePercent < 0 ? "text-destructive" : "text-muted-foreground"
                        )}>
                          {asset.changePercent > 0 ? <TrendingUp className="w-3 h-3" /> : 
                           asset.changePercent < 0 ? <TrendingDown className="w-3 h-3" /> : 
                           <Minus className="w-3 h-3" />}
                          {asset.changePercent > 0 ? '+' : ''}{asset.changePercent.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

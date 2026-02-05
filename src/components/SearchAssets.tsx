import { useState, useMemo } from 'react';
import { Search, X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  placeholder?: string;
}

export const SearchAssets = ({ assets, onSelect, placeholder = "Sök aktie, fond eller krypto..." }: SearchAssetsProps) => {
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

  const showResults = isFocused && query.trim().length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
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
            <div className="p-4 text-center text-muted-foreground text-sm">
              Inga resultat för "{query}"
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

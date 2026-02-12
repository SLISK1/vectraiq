import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { SymbolWithPrice } from '@/lib/api/database';

type SortKey = 'name' | 'changePercent' | 'price' | 'sector' | 'pe' | 'dividendYield' | 'marketCap';
type SortDir = 'asc' | 'desc';

interface ScreenerTableProps {
  symbols: SymbolWithPrice[];
  searchQuery: string;
  selectedSector: string | null;
  selectedMarketCap: string;
  selectedAssetType: string;
  onAssetClick?: (symbol: SymbolWithPrice) => void;
}

const formatNumber = (n: number | undefined | null, decimals = 2): string => {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatMarketCap = (n: number | undefined | null): string => {
  if (n == null || isNaN(n) || n === 0) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} Mdr`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} M`;
  return n.toLocaleString('sv-SE');
};

const getMarketCapValue = (symbol: SymbolWithPrice): number => {
  return symbol.latestPrice?.market_cap ? Number(symbol.latestPrice.market_cap) : 0;
};

const getPE = (symbol: SymbolWithPrice): number | null => {
  const meta = symbol.metadata as any;
  return meta?.fundamentals?.peRatio ?? null;
};

const getDividendYield = (symbol: SymbolWithPrice): number | null => {
  const meta = symbol.metadata as any;
  return meta?.fundamentals?.dividendYield ?? null;
};

export const ScreenerTable = ({
  symbols,
  searchQuery,
  selectedSector,
  selectedMarketCap,
  selectedAssetType,
  onAssetClick,
}: ScreenerTableProps) => {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const filtered = useMemo(() => {
    let result = symbols;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }

    // Sector filter
    if (selectedSector) {
      result = result.filter(s => s.sector === selectedSector);
    }

    // Asset type filter
    if (selectedAssetType !== 'all') {
      result = result.filter(s => s.asset_type === selectedAssetType);
    }

    // Market cap filter
    if (selectedMarketCap !== 'all') {
      result = result.filter(s => {
        const mc = getMarketCapValue(s);
        if (selectedMarketCap === 'large') return mc >= 10_000_000_000;
        if (selectedMarketCap === 'mid') return mc >= 2_000_000_000 && mc < 10_000_000_000;
        if (selectedMarketCap === 'small') return mc > 0 && mc < 2_000_000_000;
        return true;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      switch (sortKey) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          return sortDir === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
        case 'changePercent':
          valA = a.latestPrice ? Number(a.latestPrice.change_percent_24h || 0) : 0;
          valB = b.latestPrice ? Number(b.latestPrice.change_percent_24h || 0) : 0;
          break;
        case 'price':
          valA = a.latestPrice ? Number(a.latestPrice.price) : 0;
          valB = b.latestPrice ? Number(b.latestPrice.price) : 0;
          break;
        case 'sector':
          valA = (a.sector || '').toLowerCase();
          valB = (b.sector || '').toLowerCase();
          return sortDir === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
        case 'pe':
          valA = getPE(a) ?? -Infinity;
          valB = getPE(b) ?? -Infinity;
          break;
        case 'dividendYield':
          valA = getDividendYield(a) ?? -Infinity;
          valB = getDividendYield(b) ?? -Infinity;
          break;
        case 'marketCap':
          valA = getMarketCapValue(a);
          valB = getMarketCapValue(b);
          break;
      }

      return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

    return result;
  }, [symbols, searchQuery, selectedSector, selectedMarketCap, selectedAssetType, sortKey, sortDir]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 ml-1 text-primary" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1 text-primary" />;
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{filtered.length} tillgångar</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('name')}>
              <span className="flex items-center">Namn <SortIcon column="name" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort('changePercent')}>
              <span className="flex items-center justify-end">Utv. idag <SortIcon column="changePercent" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort('price')}>
              <span className="flex items-center justify-end">Senast <SortIcon column="price" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none hidden md:table-cell" onClick={() => handleSort('sector')}>
              <span className="flex items-center">Sektor <SortIcon column="sector" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none text-right hidden lg:table-cell" onClick={() => handleSort('pe')}>
              <span className="flex items-center justify-end">P/E <SortIcon column="pe" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none text-right hidden lg:table-cell" onClick={() => handleSort('dividendYield')}>
              <span className="flex items-center justify-end">Direktavk. <SortIcon column="dividendYield" /></span>
            </TableHead>
            <TableHead className="cursor-pointer select-none text-right hidden sm:table-cell" onClick={() => handleSort('marketCap')}>
              <span className="flex items-center justify-end">Börsvärde <SortIcon column="marketCap" /></span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                Inga tillgångar matchar filtren
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((symbol) => {
              const changePercent = symbol.latestPrice ? Number(symbol.latestPrice.change_percent_24h || 0) : 0;
              const price = symbol.latestPrice ? Number(symbol.latestPrice.price) : null;
              const pe = getPE(symbol);
              const divYield = getDividendYield(symbol);
              const mc = getMarketCapValue(symbol);

              return (
                <TableRow
                  key={symbol.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => onAssetClick?.(symbol)}
                >
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">{symbol.ticker.replace('.ST', '')}</span>
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">{symbol.name}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-medium ${changePercent > 0 ? 'text-green-500' : changePercent < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {changePercent > 0 ? '+' : ''}{formatNumber(changePercent)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {price != null ? formatNumber(price) : '—'} <span className="text-xs text-muted-foreground">{symbol.currency}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {symbol.sector ? (
                      <Badge variant="secondary" className="text-xs font-normal">{symbol.sector}</Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right hidden lg:table-cell">
                    {pe != null ? formatNumber(pe, 1) : '—'}
                  </TableCell>
                  <TableCell className="text-right hidden lg:table-cell">
                    {divYield != null ? `${formatNumber(divYield, 1)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">
                    {formatMarketCap(mc)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
};

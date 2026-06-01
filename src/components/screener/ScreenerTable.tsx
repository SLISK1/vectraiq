import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { SymbolWithPrice } from '@/lib/api/database';
import type { AltmanZone } from '@/lib/analysis/screening';
import {
  computeSymbolMetrics,
  computeMagicRanks,
  type SymbolScreeningMetrics,
} from './screeningMetrics';

type SortKey =
  | 'name' | 'changePercent' | 'price' | 'sector' | 'pe' | 'dividendYield' | 'marketCap' | 'signal'
  | 'fScore' | 'altmanZ' | 'earningsYield' | 'returnOnCapital' | 'magicRank';
type SortDir = 'asc' | 'desc';

interface ScreenerTableProps {
  symbols: SymbolWithPrice[];
  searchQuery: string;
  selectedSector: string | null;
  selectedMarketCap: string;
  selectedAssetType: string;
  minFScore: string;
  altmanZone: string;
  onAssetClick?: (symbol: SymbolWithPrice) => void;
}

const formatNumber = (n: number | undefined | null, decimals = 2): string => {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatPercent = (fraction: number | undefined | null, decimals = 1): string => {
  if (fraction == null || isNaN(fraction)) return '—';
  return `${(fraction * 100).toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
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

type SignalDirection = 'UP' | 'DOWN' | 'NEUTRAL' | null;

const getSignalFromPrice = (symbol: SymbolWithPrice): SignalDirection => {
  if (!symbol.latestPrice) return null;
  const change = Number(symbol.latestPrice.change_percent_24h || 0);
  if (change > 1) return 'UP';
  if (change < -1) return 'DOWN';
  return 'NEUTRAL';
};

// Swedish zone labels + colour treatment, mirroring the signal badge styling.
const ZONE_LABEL: Record<AltmanZone, string> = {
  safe: 'Säker',
  grey: 'Grå',
  distress: 'Distress',
};

const AltmanBadge = ({ zone, z }: { zone: AltmanZone | null; z: number | null }) => {
  if (zone == null || z == null) return <span>—</span>;
  const cls =
    zone === 'safe'
      ? 'bg-green-500/20 text-green-500 border-green-500/30'
      : zone === 'grey'
        ? 'bg-amber-500/20 text-amber-500 border-amber-500/30'
        : 'bg-red-500/20 text-red-500 border-red-500/30';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono">{formatNumber(z, 2)}</span>
      <Badge className={`${cls} text-xs`}>{ZONE_LABEL[zone]}</Badge>
    </span>
  );
};

export const ScreenerTable = ({
  symbols,
  searchQuery,
  selectedSector,
  selectedMarketCap,
  selectedAssetType,
  minFScore,
  altmanZone,
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

  // Compute the deterministic screening models once per symbol.
  const metricsById = useMemo(() => {
    const map = new Map<string, SymbolScreeningMetrics>();
    for (const s of symbols) map.set(s.id, computeSymbolMetrics(s));
    return map;
  }, [symbols]);

  // Apply all filters first (order-independent). Sorting happens afterwards so
  // the Magic-Formula rank can be computed over the filtered peer group and
  // then referenced by the sort comparator without a circular dependency.
  const filteredUnsorted = useMemo(() => {
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

    // Piotroski F-score filter (minimum threshold)
    if (minFScore !== 'all') {
      const min = Number(minFScore);
      result = result.filter(s => {
        const f = metricsById.get(s.id)?.fScore;
        return f != null && f >= min;
      });
    }

    // Altman zone filter
    if (altmanZone !== 'all') {
      result = result.filter(s => metricsById.get(s.id)?.altmanZone === altmanZone);
    }

    return result;
  }, [symbols, searchQuery, selectedSector, selectedMarketCap, selectedAssetType, minFScore, altmanZone, metricsById]);

  // Greenblatt combined rank computed over the *filtered* peer group so the
  // ordinal reflects only the stocks the user is currently looking at.
  const magicRanks = useMemo(() => {
    const subset = new Map<string, SymbolScreeningMetrics>();
    for (const s of filteredUnsorted) {
      const m = metricsById.get(s.id);
      if (m) subset.set(s.id, m);
    }
    return computeMagicRanks(subset);
  }, [filteredUnsorted, metricsById]);

  const filtered = useMemo(() => {
    const result = [...filteredUnsorted].sort((a, b) => {
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
        case 'fScore':
          valA = metricsById.get(a.id)?.fScore ?? -Infinity;
          valB = metricsById.get(b.id)?.fScore ?? -Infinity;
          break;
        case 'altmanZ':
          valA = metricsById.get(a.id)?.altmanZ ?? -Infinity;
          valB = metricsById.get(b.id)?.altmanZ ?? -Infinity;
          break;
        case 'earningsYield':
          valA = metricsById.get(a.id)?.earningsYield ?? -Infinity;
          valB = metricsById.get(b.id)?.earningsYield ?? -Infinity;
          break;
        case 'returnOnCapital':
          valA = metricsById.get(a.id)?.returnOnCapital ?? -Infinity;
          valB = metricsById.get(b.id)?.returnOnCapital ?? -Infinity;
          break;
        case 'magicRank':
          // Lower rank = better; symbols without a rank sort last regardless of dir.
          valA = magicRanks.get(a.id) ?? Infinity;
          valB = magicRanks.get(b.id) ?? Infinity;
          // Ascending = best (rank 1) first.
          return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
        case 'signal': {
          const dirMap = { 'UP': 2, 'NEUTRAL': 1, 'DOWN': 0 };
          const sA = getSignalFromPrice(a);
          const sB = getSignalFromPrice(b);
          valA = sA ? dirMap[sA] : -1;
          valB = sB ? dirMap[sB] : -1;
          break;
        }
      }

      return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

    return result;
  }, [filteredUnsorted, sortKey, sortDir, metricsById, magicRanks]);

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
      <div className="overflow-x-auto">
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
              <TableHead className="cursor-pointer select-none text-center hidden lg:table-cell" onClick={() => handleSort('fScore')} title="Piotroski F-score (0–9): finansiell styrka">
                <span className="flex items-center justify-center">F-score <SortIcon column="fScore" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-right hidden xl:table-cell" onClick={() => handleSort('altmanZ')} title="Altman Z-score: konkursrisk (säker > 3,0 / grå 1,8–3,0 / distress < 1,8)">
                <span className="flex items-center justify-end">Altman Z <SortIcon column="altmanZ" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-right hidden xl:table-cell" onClick={() => handleSort('earningsYield')} title="Earnings yield = EBIT / EV (Magic Formula)">
                <span className="flex items-center justify-end">Vinstavk. <SortIcon column="earningsYield" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-right hidden xl:table-cell" onClick={() => handleSort('returnOnCapital')} title="Avkastning på kapital = EBIT / (rörelsekapital + anläggningstillgångar) (Magic Formula)">
                <span className="flex items-center justify-end">ROIC <SortIcon column="returnOnCapital" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-center hidden xl:table-cell" onClick={() => handleSort('magicRank')} title="Magic Formula kombinerad ranking (lägre = bättre)">
                <span className="flex items-center justify-center">Magic # <SortIcon column="magicRank" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-right hidden sm:table-cell" onClick={() => handleSort('marketCap')}>
                <span className="flex items-center justify-end">Börsvärde <SortIcon column="marketCap" /></span>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-center hidden md:table-cell" onClick={() => handleSort('signal')}>
                <span className="flex items-center justify-center">Signal <SortIcon column="signal" /></span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
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
                const m = metricsById.get(symbol.id);
                const magicRank = magicRanks.get(symbol.id) ?? null;

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
                    <TableCell className="text-center hidden lg:table-cell">
                      {m?.fScore != null ? (
                        <span className="font-mono" title={`${m.fAvailable} av 9 kriterier bedömda`}>
                          {m.fScore}<span className="text-muted-foreground text-xs">/9</span>
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right hidden xl:table-cell">
                      <AltmanBadge zone={m?.altmanZone ?? null} z={m?.altmanZ ?? null} />
                    </TableCell>
                    <TableCell className="text-right hidden xl:table-cell font-mono">
                      {formatPercent(m?.earningsYield)}
                    </TableCell>
                    <TableCell className="text-right hidden xl:table-cell font-mono">
                      {formatPercent(m?.returnOnCapital)}
                    </TableCell>
                    <TableCell className="text-center hidden xl:table-cell font-mono">
                      {magicRank != null ? magicRank : '—'}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {formatMarketCap(mc)}
                    </TableCell>
                    <TableCell className="text-center hidden md:table-cell">
                      {(() => {
                        const signal = getSignalFromPrice(symbol);
                        if (!signal) return '—';
                        if (signal === 'UP') return <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs"><TrendingUp className="w-3 h-3 mr-1" />Köp</Badge>;
                        if (signal === 'DOWN') return <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs"><TrendingDown className="w-3 h-3 mr-1" />Sälj</Badge>;
                        return <Badge variant="secondary" className="text-xs"><Minus className="w-3 h-3 mr-1" />Neutral</Badge>;
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

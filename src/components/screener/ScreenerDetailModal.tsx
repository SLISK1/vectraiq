import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, BarChart3, Building2, DollarSign, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { SymbolWithPrice } from '@/lib/api/database';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ScreenerDetailModalProps {
  symbol: SymbolWithPrice | null;
  isOpen: boolean;
  onClose: () => void;
}

interface SignalRow {
  module: string;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  strength: number;
  confidence: number;
  horizon: string;
}

const MODULE_LABELS: Record<string, string> = {
  technical: 'Teknisk Analys',
  fundamental: 'Fundamental',
  sentiment: 'Sentiment',
  measuredMoves: 'Measured Moves',
  quant: 'Kvantmodeller',
  macro: 'Makroekonomi',
  volatility: 'Volatilitet',
  seasonal: 'Säsongsdata',
  orderFlow: 'Orderflöde',
  ml: 'Machine Learning',
};

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

const DirectionIcon = ({ direction }: { direction: string }) => {
  if (direction === 'UP') return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (direction === 'DOWN') return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
};

export const ScreenerDetailModal = ({ symbol, isOpen, onClose }: ScreenerDetailModalProps) => {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(false);

  useEffect(() => {
    if (!symbol || !isOpen) return;
    setLoadingSignals(true);
    supabase
      .from('signals')
      .select('module, direction, strength, confidence, horizon')
      .eq('symbol_id', symbol.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setSignals((data as SignalRow[]) || []);
        setLoadingSignals(false);
      });
  }, [symbol, isOpen]);

  if (!symbol) return null;

  const price = symbol.latestPrice ? Number(symbol.latestPrice.price) : null;
  const changePercent = symbol.latestPrice ? Number(symbol.latestPrice.change_percent_24h || 0) : 0;
  const change24h = symbol.latestPrice ? Number(symbol.latestPrice.change_24h || 0) : 0;
  const volume = symbol.latestPrice?.volume ? Number(symbol.latestPrice.volume) : null;
  const marketCap = symbol.latestPrice?.market_cap ? Number(symbol.latestPrice.market_cap) : null;
  const meta = symbol.metadata as any;
  const pe = meta?.fundamentals?.peRatio ?? null;
  const divYield = meta?.fundamentals?.dividendYield ?? null;
  const roe = meta?.fundamentals?.roe ?? null;
  const debtToEquity = meta?.fundamentals?.debtToEquity ?? null;
  const week52High = meta?.fundamentals?.week52High ?? null;
  const week52Low = meta?.fundamentals?.week52Low ?? null;

  const overallSignal = changePercent > 1 ? 'UP' : changePercent < -1 ? 'DOWN' : 'NEUTRAL';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-xl font-bold">{symbol.ticker.replace('.ST', '')}</span>
            <span className="text-muted-foreground font-normal text-sm truncate">{symbol.name}</span>
            <Badge variant="secondary" className="text-xs ml-auto">{symbol.asset_type}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Price hero */}
          <div className="flex items-end gap-4 p-4 rounded-xl bg-muted/30">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Senaste pris</div>
              <div className="text-3xl font-mono font-bold">
                {price != null ? formatNumber(price) : '—'}
                <span className="text-sm text-muted-foreground ml-1">{symbol.currency}</span>
              </div>
            </div>
            <div className="flex flex-col items-end ml-auto">
              <div className={cn(
                "flex items-center gap-1 text-lg font-mono font-semibold",
                changePercent > 0 ? "text-green-500" : changePercent < 0 ? "text-red-500" : "text-muted-foreground"
              )}>
                {changePercent > 0 ? <ArrowUpRight className="w-5 h-5" /> : changePercent < 0 ? <ArrowDownRight className="w-5 h-5" /> : null}
                {changePercent > 0 ? '+' : ''}{formatNumber(changePercent)}%
              </div>
              <div className={cn(
                "text-sm font-mono",
                change24h > 0 ? "text-green-500/70" : change24h < 0 ? "text-red-500/70" : "text-muted-foreground"
              )}>
                {change24h > 0 ? '+' : ''}{formatNumber(change24h)} {symbol.currency}
              </div>
            </div>
          </div>

          {/* Overall signal */}
          <div className="flex items-center gap-2 p-3 rounded-lg border border-border">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">VectraIQ Signal:</span>
            {overallSignal === 'UP' && <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><TrendingUp className="w-3 h-3 mr-1" />Köp</Badge>}
            {overallSignal === 'DOWN' && <Badge className="bg-red-500/20 text-red-500 border-red-500/30"><TrendingDown className="w-3 h-3 mr-1" />Sälj</Badge>}
            {overallSignal === 'NEUTRAL' && <Badge variant="secondary"><Minus className="w-3 h-3 mr-1" />Neutral</Badge>}
          </div>

          {/* Key stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<BarChart3 className="w-4 h-4" />} label="Volym" value={volume != null ? formatMarketCap(volume) : '—'} />
            <StatCard icon={<DollarSign className="w-4 h-4" />} label="Börsvärde" value={formatMarketCap(marketCap)} />
            <StatCard icon={<Building2 className="w-4 h-4" />} label="Sektor" value={symbol.sector || '—'} />
            <StatCard label="Börs" value={symbol.exchange || '—'} />
          </div>

          {/* Fundamentals */}
          {(pe != null || divYield != null || roe != null) && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Fundamentaldata</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="P/E-tal" value={pe != null ? formatNumber(pe, 1) : '—'} />
                <StatCard label="Direktavkastning" value={divYield != null ? `${formatNumber(divYield, 1)}%` : '—'} />
                <StatCard label="ROE" value={roe != null ? `${formatNumber(roe, 1)}%` : '—'} />
                <StatCard label="D/E" value={debtToEquity != null ? formatNumber(debtToEquity, 2) : '—'} />
              </div>
            </div>
          )}

          {/* 52-week range */}
          {week52High != null && week52Low != null && price != null && (
            <div>
              <h3 className="text-sm font-semibold mb-2">52-veckorsintervall</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground">{formatNumber(week52Low)}</span>
                <div className="flex-1 relative h-2 rounded-full bg-muted">
                  <div
                    className="absolute top-0 left-0 h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(100, Math.max(0, ((price - week52Low) / (week52High - week52Low)) * 100))}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background"
                    style={{ left: `${Math.min(100, Math.max(0, ((price - week52Low) / (week52High - week52Low)) * 100))}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{formatNumber(week52High)}</span>
              </div>
            </div>
          )}

          {/* Signals from DB */}
          {signals.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Analyssignaler</h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium">Modul</th>
                      <th className="text-center px-3 py-2 font-medium">Riktning</th>
                      <th className="text-right px-3 py-2 font-medium">Styrka</th>
                      <th className="text-right px-3 py-2 font-medium">Konfidens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map((s, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-2">{MODULE_LABELS[s.module] || s.module}</td>
                        <td className="px-3 py-2 text-center"><DirectionIcon direction={s.direction} /></td>
                        <td className="px-3 py-2 text-right font-mono">{s.strength}</td>
                        <td className="px-3 py-2 text-right font-mono">{s.confidence}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loadingSignals && signals.length === 0 && (
            <p className="text-xs text-muted-foreground text-center p-3 bg-muted/30 rounded-lg">
              Inga analyssignaler tillgängliga för denna tillgång ännu.
            </p>
          )}

          {/* Disclaimer */}
          <p className="text-xs text-muted-foreground text-center p-3 bg-muted/30 rounded-lg">
            ⚠️ Denna data utgör inte investeringsrådgivning. Gör alltid din egen research.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const StatCard = ({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) => (
  <div className="p-3 rounded-lg bg-muted/30">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
      {icon}
      {label}
    </div>
    <div className="font-medium text-sm truncate">{value}</div>
  </div>
);

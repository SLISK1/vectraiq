import { useState } from 'react';
import { usePaperPortfolio, usePaperTrades, usePaperSnapshots, useResetPaperPortfolio } from '@/hooks/usePaperPortfolio';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PaperTradeModal } from './PaperTradeModal';
import { cn } from '@/lib/utils';
import { Wallet, TrendingUp, TrendingDown, RotateCcw, Loader2, AlertTriangle, LineChart } from 'lucide-react';
import { LineChart as ReLineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AuthModal } from '@/components/AuthModal';

export const PaperPortfolioPage = () => {
  const { user } = useAuth();
  const { data: portfolioData, isLoading } = usePaperPortfolio();
  const { data: trades } = usePaperTrades();
  const { data: snapshots } = usePaperSnapshots();
  const resetMutation = useResetPaperPortfolio();
  const [showReset, setShowReset] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [tradeModal, setTradeModal] = useState<{ symbolId: string; ticker: string; name: string; lastPrice: number; assetType: string; side: 'buy' | 'sell' } | null>(null);

  const formatSEK = (v: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(v);
  const formatPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="glass-card rounded-xl p-8 text-center">
          <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">Logga in för Paper Portfolio</h3>
          <p className="text-muted-foreground mb-4">Skapa ett konto för att simulera handel med 100 000 SEK.</p>
          <Button onClick={() => setAuthOpen(true)}>Logga in</Button>
        </div>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const portfolio = portfolioData?.portfolio;
  const holdings = portfolioData?.holdings || [];
  const totalValue = portfolioData?.totalValue || 100000;
  const cashBalance = portfolio ? Number(portfolio.cash_balance) : 100000;
  const holdingsValue = portfolioData?.holdingsValue || 0;
  const pnlTotal = portfolioData?.pnlTotal || 0;
  const pnlPct = portfolioData?.pnlPct || 0;

  const chartData = (snapshots || []).map(s => ({
    date: new Date(s.snapshot_at).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' }),
    value: Number(s.total_value),
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Disclaimer */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border border-border text-sm text-muted-foreground">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Simulerad handel med låtsaspengar. Ej finansiell rådgivning.
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Totalt värde</div>
            <div className="font-mono font-bold text-lg">{formatSEK(totalValue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Cash</div>
            <div className="font-mono font-bold text-lg">{formatSEK(cashBalance)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Innehav</div>
            <div className="font-mono font-bold text-lg">{formatSEK(holdingsValue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total P/L</div>
            <div className={cn('font-mono font-bold text-lg', pnlTotal >= 0 ? 'text-up' : 'text-down')}>
              {formatSEK(pnlTotal)} ({formatPct(pnlPct)})
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><LineChart className="w-4 h-4" /> Utveckling</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ReLineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: number) => formatSEK(v)} />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </ReLineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Holdings Table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Innehav</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowReset(true)} className="gap-1">
            <RotateCcw className="w-3 h-3" /> Återställ
          </Button>
        </CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Inga innehav ännu. Köp från Dashboard!</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Antal</TableHead>
                  <TableHead className="text-right">Snitt</TableHead>
                  <TableHead className="text-right">Pris</TableHead>
                  <TableHead className="text-right">Värde</TableHead>
                  <TableHead className="text-right">P/L</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.ticker}</TableCell>
                    <TableCell className="text-right font-mono">{h.qty.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK(h.avg_cost)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK(h.last_price || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK(h.market_value || 0)}</TableCell>
                    <TableCell className={cn('text-right font-mono', (h.pnl || 0) >= 0 ? 'text-up' : 'text-down')}>
                      {formatSEK(h.pnl || 0)} ({formatPct(h.pnl_pct || 0)})
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTradeModal({ symbolId: h.symbol_id, ticker: h.ticker, name: h.name || h.ticker, lastPrice: h.last_price || 0, assetType: h.asset_type || 'stock', side: 'sell' })}
                      >
                        Sälj
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades */}
      {trades && trades.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Senaste transaktioner</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Antal</TableHead>
                  <TableHead className="text-right">Pris</TableHead>
                  <TableHead className="text-right">Summa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{new Date(t.executed_at).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</TableCell>
                    <TableCell className="font-medium">{t.ticker}</TableCell>
                    <TableCell>
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded', t.side === 'buy' ? 'bg-up/20 text-up' : 'bg-down/20 text-down')}>
                        {t.side === 'buy' ? 'KÖP' : 'SÄLJ'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{Number(t.qty).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK(Number(t.price))}</TableCell>
                    <TableCell className="text-right font-mono">{formatSEK(Number(t.notional))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Reset Confirmation */}
      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Återställ Paper Portfolio?</DialogTitle>
            <DialogDescription>All historik, innehav och trades raderas. Du får en ny startkassa på 100 000 SEK.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReset(false)}>Avbryt</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await resetMutation.mutateAsync();
                setShowReset(false);
              }}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Återställ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trade Modal from holdings sell button */}
      {tradeModal && (
        <PaperTradeModal
          isOpen={!!tradeModal}
          onClose={() => setTradeModal(null)}
          symbolId={tradeModal.symbolId}
          ticker={tradeModal.ticker}
          name={tradeModal.name}
          lastPrice={tradeModal.lastPrice}
          currency="SEK"
          assetType={tradeModal.assetType}
          defaultSide={tradeModal.side}
        />
      )}
    </div>
  );
};

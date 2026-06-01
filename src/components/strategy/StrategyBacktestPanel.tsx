import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useBacktestRuns, useRunBacktest, type BacktestParams, type BacktestRun } from '@/hooks/useBacktest';
import { FlaskConical, Loader2, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, XCircle, LineChart, Play } from 'lucide-react';
import { LineChart as ReLineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const DEFAULT_PARAMS: BacktestParams = {
  start_date: '',
  end_date: '',
  lookback_months: 6,
  top_n: 10,
  rebalance: 'monthly',
  initial_capital: 100000,
  slippage_bps: 5,
  commission_per_trade: 1,
  commission_bps: 0,
  use_liquidity_filter: false,
};

const formatPct = (v: number | null | undefined, decimals = 2) =>
  v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
const formatNum = (v: number | null | undefined, decimals = 2) =>
  v == null ? '–' : v.toFixed(decimals);
const formatSEK = (v: number | null | undefined) =>
  v == null ? '–' : new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(v);

function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className={cn('font-mono font-bold text-lg', tone === 'up' && 'text-up', tone === 'down' && 'text-down')}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function StrategyBacktestPanel() {
  const [params, setParams] = useState<BacktestParams>(DEFAULT_PARAMS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useBacktestRuns();
  const runBacktest = useRunBacktest();

  const set = <K extends keyof BacktestParams>(key: K, value: BacktestParams[K]) =>
    setParams(prev => ({ ...prev, [key]: value }));

  // The active run: either the explicitly selected one, the just-finished mutation result,
  // or the most recent run in the list. Selection always wins so clicking history works.
  const activeRun: BacktestRun | null = useMemo(() => {
    if (selectedId) return runs.find(r => r.id === selectedId) || null;
    if (runBacktest.data) return runBacktest.data;
    return runs[0] || null;
  }, [selectedId, runs, runBacktest.data]);

  const handleRun = () => {
    const payload: BacktestParams = { ...params };
    // Drop empty optional dates so the backend can fall back to its own defaults.
    if (!payload.start_date) delete payload.start_date;
    if (!payload.end_date) delete payload.end_date;
    const name = `Backtest ${new Date().toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    setSelectedId(null);
    runBacktest.mutate({ params: payload, name });
  };

  const metrics = activeRun?.metrics ?? null;
  const equity = activeRun?.equity_curve ?? [];
  const benchmarkLabel = activeRun?.benchmark_ticker || 'OMXS-index';

  const chartData = useMemo(
    () =>
      (equity || []).map(p => ({
        date: new Date(p.date).toLocaleDateString('sv-SE', { year: '2-digit', month: 'short' }),
        strategi: p.strategy,
        benchmark: p.benchmark,
      })),
    [equity],
  );

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border border-border text-sm text-muted-foreground">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Historisk simulering. Tidigare resultat är ingen garanti för framtida avkastning.
      </div>

      {/* Config form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4" /> Backtest-inställningar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Startdatum (valfritt)</Label>
              <Input type="date" value={params.start_date || ''} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Slutdatum (valfritt)</Label>
              <Input type="date" value={params.end_date || ''} onChange={e => set('end_date', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ombalansering</Label>
              <Select value={params.rebalance} onValueChange={v => set('rebalance', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Veckovis</SelectItem>
                  <SelectItem value="monthly">Månadsvis</SelectItem>
                  <SelectItem value="quarterly">Kvartalsvis</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Lookback (månader)</Label>
              <Input type="number" min={1} max={36} value={params.lookback_months} onChange={e => set('lookback_months', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Antal innehav (Top N)</Label>
              <Input type="number" min={1} max={50} value={params.top_n} onChange={e => set('top_n', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Startkapital (SEK)</Label>
              <Input type="number" min={1000} value={params.initial_capital} onChange={e => set('initial_capital', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Slippage (bps)</Label>
              <Input type="number" min={0} max={100} value={params.slippage_bps} onChange={e => set('slippage_bps', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Courtage/trade (SEK)</Label>
              <Input type="number" min={0} value={params.commission_per_trade} onChange={e => set('commission_per_trade', Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Courtage (bps)</Label>
              <Input type="number" min={0} value={params.commission_bps} onChange={e => set('commission_bps', Number(e.target.value))} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary w-4 h-4"
                checked={params.use_liquidity_filter}
                onChange={e => set('use_liquidity_filter', e.target.checked)}
              />
              Likviditetsfilter
            </label>
            <Button onClick={handleRun} disabled={runBacktest.isPending} className="gap-2">
              {runBacktest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {runBacktest.isPending ? 'Kör backtest...' : 'Kör backtest'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Running state (mutation in flight, no result yet) */}
      {runBacktest.isPending && !activeRun && (
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Simulerar strategin mot historiska priser...</p>
          </CardContent>
        </Card>
      )}

      {/* Active run states */}
      {activeRun && activeRun.status === 'running' && (
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Backtest pågår...</p>
          </CardContent>
        </Card>
      )}

      {activeRun && activeRun.status === 'failed' && (
        <Card className="border-down/40">
          <CardContent className="p-6 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-down shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-down">Backtest misslyckades</div>
              <p className="text-sm text-muted-foreground mt-1">{activeRun.error || 'Ett okänt fel uppstod.'}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed results */}
      {activeRun && activeRun.status === 'completed' && metrics && (
        <>
          {/* Verdict banner — the core question */}
          <Card
            className={cn(
              'border-2',
              metrics.beat_benchmark ? 'border-up bg-up/10' : 'border-down bg-down/10',
            )}
          >
            <CardContent className="p-6 flex items-center gap-4">
              {metrics.beat_benchmark ? (
                <CheckCircle2 className="w-10 h-10 text-up shrink-0" />
              ) : (
                <XCircle className="w-10 h-10 text-down shrink-0" />
              )}
              <div className="flex-1">
                <div className="text-sm text-muted-foreground">Slog {benchmarkLabel}?</div>
                <div className={cn('text-2xl font-bold', metrics.beat_benchmark ? 'text-up' : 'text-down')}>
                  {metrics.beat_benchmark ? 'JA' : 'NEJ'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Överavkastning</div>
                <div className={cn('text-2xl font-bold font-mono', metrics.excess_return_pct >= 0 ? 'text-up' : 'text-down')}>
                  {formatPct(metrics.excess_return_pct)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Strategi {formatPct(metrics.total_return_pct)} vs {benchmarkLabel} {formatPct(metrics.benchmark_total_return_pct)}
                </div>
              </div>
            </CardContent>
          </Card>

          {metrics.note && (
            <p className="text-xs text-muted-foreground italic px-1">{metrics.note}</p>
          )}

          {/* Equity curve */}
          {chartData.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <LineChart className="w-4 h-4" /> Värdeutveckling
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ReLineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={(v: number) => formatSEK(v)} width={80} />
                      <Tooltip formatter={(v: number) => formatSEK(v)} />
                      <Legend />
                      <Line type="monotone" dataKey="strategi" name="Strategi" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="benchmark" name={benchmarkLabel} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls />
                    </ReLineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard
              label="Total avkastning"
              value={formatPct(metrics.total_return_pct)}
              tone={metrics.total_return_pct >= 0 ? 'up' : 'down'}
              sub={`${benchmarkLabel}: ${formatPct(metrics.benchmark_total_return_pct)}`}
            />
            <MetricCard
              label="CAGR"
              value={formatPct(metrics.cagr_pct)}
              tone={metrics.cagr_pct >= 0 ? 'up' : 'down'}
              sub={metrics.omxsgi_return_pct != null ? `med utdelningar (OMXSGI): ${formatPct(metrics.omxsgi_return_pct)}` : undefined}
            />
            <MetricCard
              label="Sharpe"
              value={formatNum(metrics.sharpe)}
              sub={`Volatilitet ${formatPct(metrics.ann_vol_pct)}`}
            />
            <MetricCard
              label="Max Drawdown"
              value={formatPct(metrics.max_drawdown_pct)}
              tone="down"
              sub={`Info-ratio ${formatNum(metrics.information_ratio)}`}
            />
            <MetricCard
              label="Träffsäkerhet"
              value={formatPct(metrics.hit_rate_pct, 1)}
              sub={`${metrics.n_rebalances} ombalanseringar`}
            />
            <MetricCard
              label="Omsättning / Kostnad"
              value={formatNum(metrics.turnover)}
              sub={`Kostnad ${formatSEK(metrics.total_cost)}`}
            />
          </div>
        </>
      )}

      {/* Empty state — never run before */}
      {!runBacktest.isPending && !activeRun && !runsLoading && (
        <Card>
          <CardContent className="p-8 text-center">
            <FlaskConical className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Inga backtests ännu. Ställ in parametrar ovan och kör din första simulering.</p>
          </CardContent>
        </Card>
      )}

      {/* Previous runs */}
      {runs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tidigare körningar</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Avkastning</TableHead>
                  <TableHead className="text-right">Index</TableHead>
                  <TableHead className="text-right">Slog index?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => {
                  const m = r.metrics;
                  const isActive = activeRun?.id === r.id;
                  return (
                    <TableRow
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn('cursor-pointer', isActive && 'bg-accent/50')}
                    >
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m ? `${m.start_date} → ${m.end_date}` : new Date(r.created_at).toLocaleDateString('sv-SE')}
                      </TableCell>
                      <TableCell className={cn('text-right font-mono', m && (m.total_return_pct >= 0 ? 'text-up' : 'text-down'))}>
                        {m ? formatPct(m.total_return_pct) : '–'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {m ? formatPct(m.benchmark_total_return_pct) : '–'}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === 'running' ? (
                          <Badge variant="secondary" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" />Kör</Badge>
                        ) : r.status === 'failed' ? (
                          <Badge variant="destructive">Fel</Badge>
                        ) : m?.beat_benchmark ? (
                          <Badge className="bg-up text-up-foreground gap-1"><TrendingUp className="w-3 h-3" />JA</Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1"><TrendingDown className="w-3 h-3" />NEJ</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

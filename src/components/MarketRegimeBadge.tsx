import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, ArrowLeftRight, Loader2, type LucideIcon } from 'lucide-react';
import { useSymbols } from '@/hooks/useMarketData';
import { fetchPriceHistory } from '@/lib/api/priceHistory';
import { classifyMarketRegime, type MarketRegime } from '@/lib/analysis/regime';

interface MarketRegimeBadgeProps {
  /**
   * Benchmark index closes (oldest→newest). If omitted, the badge sources a
   * benchmark series itself from the existing symbols + price-history hooks.
   */
  indexCloses?: number[];
  /** Externally-controlled loading state (used when `indexCloses` is fed by a page). */
  loading?: boolean;
  className?: string;
}

const REGIME_CONFIG: Record<MarketRegime, { label: string; Icon: LucideIcon; color: string }> = {
  BULL: { label: 'Bull', Icon: TrendingUp, color: 'bg-up/20 text-up border-up/30' },
  BEAR: { label: 'Björn', Icon: TrendingDown, color: 'bg-down/20 text-down border-down/30' },
  SIDEWAYS: { label: 'Sidledes', Icon: ArrowLeftRight, color: 'bg-neutral/20 text-neutral border-neutral/30' },
};

// Candidate benchmark tickers, in priority order. We resolve the first one that
// exists in the symbols table (most Nordic deployments carry OMXS30 / OMXSPI;
// otherwise we fall back to a broad index / S&P proxy). Matches the benchmark
// convention already used in useMarketData (benchmarkFor).
const BENCHMARK_PRIORITY = ['OMXSPI', 'OMXS30', '^OMX', 'OMX', 'SPY', '^GSPC'];

export const MarketRegimeBadge = ({ indexCloses, loading, className }: MarketRegimeBadgeProps) => {
  const externallyFed = indexCloses !== undefined;

  // Resolve a benchmark symbol id from the already-cached symbols list (no new
  // network round-trip for the list — useSymbols is shared/staleTime-cached).
  const { data: symbols } = useSymbols();
  const benchmark = useMemo(() => {
    if (externallyFed || !symbols) return undefined;
    const byTicker = new Map(symbols.map(s => [s.ticker.toUpperCase(), s]));
    for (const t of BENCHMARK_PRIORITY) {
      const hit = byTicker.get(t.toUpperCase());
      if (hit) return hit;
    }
    return undefined;
  }, [symbols, externallyFed]);

  // Fetch ~1 year of benchmark closes via the EXISTING price-history helper
  // (same supabase price_history table the rest of the app uses — no new edge fn).
  const { data: fetchedCloses, isLoading: fetching } = useQuery({
    queryKey: ['marketRegimeIndex', benchmark?.id],
    queryFn: async () => {
      if (!benchmark) return [] as number[];
      const history = await fetchPriceHistory(benchmark.id, 365);
      return history.map(h => h.close);
    },
    enabled: !externallyFed && !!benchmark,
    staleTime: 1000 * 60 * 30, // 30 minutes — regime moves slowly
  });

  const closes = externallyFed ? (indexCloses as number[]) : (fetchedCloses ?? []);
  const isLoading = externallyFed ? !!loading : (fetching || (!!benchmark === false && !symbols));

  const result = useMemo(
    () => (closes.length > 0 ? classifyMarketRegime(closes) : null),
    [closes]
  );

  if (isLoading) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
          'bg-muted/30 text-muted-foreground border-border',
          className
        )}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Marknadsregim…
      </span>
    );
  }

  // No data resolvable (e.g. no benchmark in this deployment) — render nothing
  // so the dashboard header stays clean.
  if (!result) return null;

  const { regime, trend, volPercentile, confidence, reasons } = result;
  const { label, Icon, color } = REGIME_CONFIG[regime];
  const trendLabel = trend === 'UP' ? 'Stigande' : trend === 'DOWN' ? 'Fallande' : 'Sidledes';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold cursor-default',
            color,
            className
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          Marknadsregim: {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4 font-semibold">
            <span>Marknadsregim: {label}</span>
            <span className="text-muted-foreground">{confidence}% konfidens</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>Trend: {trendLabel}</span>
            <span>Volatilitet: {volPercentile}:e perc.</span>
          </div>
          {reasons.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

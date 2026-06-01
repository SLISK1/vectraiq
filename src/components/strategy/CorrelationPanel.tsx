import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCorrelation, type CorrelationInput } from '@/hooks/useCorrelation';
import { Network, AlertTriangle, Info, GitBranch } from 'lucide-react';

interface CorrelationPanelProps {
  // Set of names to analyze — typically the current strategy candidates.
  items: CorrelationInput[];
  // Optional label for the source ("kandidater", "innehav", ...).
  sourceLabel?: string;
}

// Map a correlation value in [-1, 1] to a background colour. Strong positive
// correlation (the dangerous "same bet" case) trends red; strong negative
// (diversifying) trends to the "up"/green token; near-zero is neutral.
function corrCellStyle(v: number | null): React.CSSProperties {
  if (v == null) return {};
  const a = Math.min(1, Math.abs(v));
  // Use HSL tokens via inline alpha so it follows the theme's up/down hues.
  if (v >= 0) {
    return { backgroundColor: `hsl(var(--down) / ${(a * 0.55).toFixed(3)})` };
  }
  return { backgroundColor: `hsl(var(--up) / ${(a * 0.55).toFixed(3)})` };
}

const fmtCorr = (v: number | null) => (v == null ? '–' : v.toFixed(2));

export function CorrelationPanel({ items, sourceLabel = 'kandidater' }: CorrelationPanelProps) {
  const { data, isLoading, isError } = useCorrelation(items);

  const avgPct = useMemo(
    () => (data?.avgPairwise != null ? Math.round(data.avgPairwise * 100) : null),
    [data?.avgPairwise],
  );

  // Not enough names to correlate.
  if (items.length < 2) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            Minst två {sourceLabel} krävs för att beräkna korrelation. Kör en utvärdering för att fylla listan.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-down/40">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-down shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">Kunde inte beräkna korrelation från prishistoriken.</p>
        </CardContent>
      </Card>
    );
  }

  const { tickers, matrix, cluster, highlyCorrelatedPairs, skipped, highCorrThreshold, observations } = data;
  const thresholdPct = Math.round(highCorrThreshold * 100);

  // Concentration warning triggers when the book is broadly correlated (high
  // average pairwise corr) OR when there is a cluster of >=3 names all moving
  // together — the plan's "five defense stocks moving together" risk.
  const avgWarn = data.avgPairwise != null && data.avgPairwise > highCorrThreshold;
  const clusterWarn = cluster.length >= 3;
  const showWarning = avgWarn || clusterWarn;

  if (tickers.length < 2) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            Otillräcklig prishistorik för att beräkna korrelation
            {skipped.length > 0 ? ` (saknas för: ${skipped.join(', ')})` : ''}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Concentration warning ("Koncentrationsvarning") */}
      {showWarning && (
        <Card className="border-2 border-down bg-down/10">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-down shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-down">Koncentrationsvarning</div>
              {clusterWarn && (
                <p className="text-sm text-foreground/90">
                  {cluster.length} namn rör sig i praktiken som en och samma position (korrelation ≥ {thresholdPct}%):{' '}
                  <span className="font-mono font-medium">{cluster.join(', ')}</span>. Det är egentligen ett enda vad —
                  överväg att minska exponeringen eller sprida den.
                </p>
              )}
              {avgWarn && (
                <p className="text-sm text-foreground/90">
                  Genomsnittlig parvis korrelation är {avgPct}% — portföljen är svagt diversifierad och bär mycket
                  samvariation.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="gap-1">
          <Network className="w-3 h-3" /> {tickers.length} namn
        </Badge>
        <Badge variant="outline">Snitt korr {avgPct != null ? `${avgPct}%` : '–'}</Badge>
        <Badge variant="outline">Tröskel ≥ {thresholdPct}%</Badge>
        <Badge variant="outline">{observations} handelsdagar</Badge>
        {!showWarning && (
          <Badge className="bg-up/20 text-up border-up/30">Väl diversifierad</Badge>
        )}
      </div>

      {/* Correlation heatmap / table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Network className="w-4 h-4" /> Korrelationsmatris (daglig avkastning)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card p-1.5 text-left font-medium text-muted-foreground" />
                {tickers.map((t) => (
                  <th key={t} className="p-1.5 font-mono font-medium text-muted-foreground whitespace-nowrap">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((rowT, i) => (
                <tr key={rowT}>
                  <th className="sticky left-0 z-10 bg-card p-1.5 text-left font-mono font-medium whitespace-nowrap">
                    {rowT}
                  </th>
                  {tickers.map((colT, j) => {
                    const v = matrix[i][j];
                    const isDiag = i === j;
                    const flagged = !isDiag && v != null && Math.abs(v) >= highCorrThreshold;
                    return (
                      <td
                        key={colT}
                        style={isDiag ? undefined : corrCellStyle(v)}
                        className={cn(
                          'p-1.5 text-center font-mono tabular-nums border border-border/40 min-w-[3rem]',
                          isDiag && 'text-muted-foreground/60',
                          flagged && 'font-bold ring-1 ring-down/60',
                        )}
                        title={`${rowT} / ${colT}: ${fmtCorr(v)}`}
                      >
                        {isDiag ? '1.00' : fmtCorr(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Most correlated pairs */}
      {highlyCorrelatedPairs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="w-4 h-4" /> Mest samvarierande par (≥ {thresholdPct}%)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {highlyCorrelatedPairs.slice(0, 8).map((p) => (
              <div key={`${p.a}-${p.b}`} className="flex items-center justify-between text-sm">
                <span className="font-mono">
                  {p.a} ↔ {p.b}
                </span>
                <span className={cn('font-mono font-medium', p.corr >= 0 ? 'text-down' : 'text-up')}>
                  {(p.corr * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Footnotes */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground px-1">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          Pearson-korrelation på dagliga avkastningar de senaste ~3 månaderna. Positiv (röd) = rör sig åt samma håll;
          negativ (grön) = diversifierande.
          {skipped.length > 0 && (
            <> Uteslutna p.g.a. för lite prishistorik: <span className="font-mono">{skipped.join(', ')}</span>.</>
          )}
        </p>
      </div>
    </div>
  );
}

import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RegimeBadge } from './RegimeBadge';
import { StrategyStatusBadge } from './StrategyStatusBadge';
import { Users, Filter, TrendingUp, Briefcase, Clock } from 'lucide-react';

interface OverviewProps {
  candidates: any[];
  positions: any[];
  universeSources: string[];
}

export function StrategyOverview({ candidates, positions, universeSources }: OverviewProps) {
  const passing = candidates.filter(c => c.status !== 'blocked');
  const momentum = candidates.filter(c => c.regime === 'MOMENTUM');
  const fundamental = candidates.filter(c => c.regime === 'FUNDAMENTAL');
  const meanRev = candidates.filter(c => c.regime === 'MEAN_REVERSION');
  const openPositions = positions.filter(p => p.status === 'open');

  const kpis = [
    { label: 'Universumstorlek', value: candidates.length, icon: Users, color: 'text-blue-400' },
    { label: 'Passerar filter', value: passing.length, icon: Filter, color: 'text-emerald-400' },
    { label: 'Momentum', value: momentum.length, icon: TrendingUp, color: 'text-blue-400' },
    { label: 'Fundamental', value: fundamental.length, icon: Briefcase, color: 'text-emerald-400' },
    { label: 'Öppna positioner', value: openPositions.length, icon: Clock, color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${kpi.color}`} />
                  <span className="text-xs text-muted-foreground">{kpi.label}</span>
                </div>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Candidate Table */}
      {candidates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Inga kandidater ännu. Välj datakällor i Universum-fliken och kör en utvärdering.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Källa</TableHead>
                  <TableHead>Regim</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Konfidens</TableHead>
                  <TableHead>StopLoss</TableHead>
                  <TableHead>R:R</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.slice(0, 50).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-medium">{c.ticker}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.source}</TableCell>
                    <TableCell><RegimeBadge regime={c.regime} /></TableCell>
                    <TableCell className="font-mono">{c.total_score ?? '–'}</TableCell>
                    <TableCell className="font-mono">{c.confidence ?? '–'}%</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.stop_loss_price ? `${Number(c.stop_loss_price).toFixed(2)}` : '–'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.rr_ratio ? `${Number(c.rr_ratio).toFixed(1)}:1` : '–'}
                    </TableCell>
                    <TableCell><StrategyStatusBadge status={c.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

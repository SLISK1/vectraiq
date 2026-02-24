import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RegimeBadge } from './RegimeBadge';
import { StrategyStatusBadge } from './StrategyStatusBadge';
import { CandidateDetailModal } from './CandidateDetailModal';
import { Users, Filter, TrendingUp, Briefcase, Clock, Ban, Hourglass, ChevronRight, AlertTriangle } from 'lucide-react';

interface OverviewProps {
  candidates: any[];
  positions: any[];
  universeSources: string[];
  latestRunLog?: any;
  configDirty?: boolean;
}

type StatusFilter = 'all' | 'candidate' | 'waiting' | 'blocked';

export function StrategyOverview({ candidates, positions, universeSources, latestRunLog, configDirty }: OverviewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);

  const candidateCount = candidates.filter(c => c.status === 'candidate').length;
  const waitingCount = candidates.filter(c => c.status === 'waiting').length;
  const blockedCount = candidates.filter(c => c.status === 'blocked').length;
  const openPositions = positions.filter(p => p.status === 'open');
  const momentum = candidates.filter(c => c.regime === 'MOMENTUM');
  const fundamental = candidates.filter(c => c.regime === 'FUNDAMENTAL');

  const kpis = [
    { label: 'Universum', value: candidates.length, icon: Users, color: 'text-blue-400' },
    { label: 'Kandidater', value: candidateCount, icon: Filter, color: 'text-emerald-400' },
    { label: 'Väntar', value: waitingCount, icon: Hourglass, color: 'text-yellow-400' },
    { label: 'Blockerade', value: blockedCount, icon: Ban, color: 'text-red-400' },
    { label: 'Öppna pos.', value: openPositions.length, icon: Clock, color: 'text-purple-400' },
  ];

  const filtered = statusFilter === 'all' ? candidates : candidates.filter(c => c.status === statusFilter);

  // Config sync warning
  const runStartConfig = latestRunLog?.details?.configUsed;

  return (
    <div className="space-y-4">
      {/* Config sync warning */}
      {configDirty && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-yellow-200/80">
            UI-konfigurationen har ändrats sedan senaste körning. Spara och kör utvärdering igen för att se uppdaterade resultat.
          </p>
        </div>
      )}

      {/* Run config info */}
      {runStartConfig && (
        <div className="p-2 rounded bg-muted/50 text-[10px] text-muted-foreground font-mono">
          Senaste körning: score≥{runStartConfig.total_score_min} | enighet≥{runStartConfig.agreement_min}% | täckning≥{runStartConfig.coverage_min}% | volRisk≤{runStartConfig.vol_risk_max} | staleness≤{runStartConfig.max_staleness_h}h
          {runStartConfig.debug_force_one_candidate && <Badge variant="outline" className="ml-2 text-yellow-400 border-yellow-500/30 text-[9px]">DEBUG MODE</Badge>}
        </div>
      )}

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

      {/* Status filter chips */}
      <div className="flex gap-2">
        {([
          { key: 'all' as const, label: 'Alla', count: candidates.length },
          { key: 'candidate' as const, label: 'Kandidater', count: candidateCount },
          { key: 'waiting' as const, label: 'Väntar', count: waitingCount },
          { key: 'blocked' as const, label: 'Blockerade', count: blockedCount },
        ]).map(f => (
          <Button
            key={f.key}
            variant={statusFilter === f.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(f.key)}
            className="text-xs"
          >
            {f.label} ({f.count})
          </Button>
        ))}
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
                  <TableHead>Regim</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Enighet</TableHead>
                  <TableHead>Täckning</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 50).map((c) => {
                  const ad = c.analysis_data || {};
                  const br = c.block_reasons || {};
                  return (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setSelectedCandidate(c)}>
                      <TableCell className="font-mono font-medium">{c.ticker}</TableCell>
                      <TableCell><RegimeBadge regime={c.regime} /></TableCell>
                      <TableCell className="font-mono">{c.total_score ?? '–'}</TableCell>
                      <TableCell className="font-mono text-xs">{ad.agreement ?? br?.metrics?.agreement ?? '–'}%</TableCell>
                      <TableCell className="font-mono text-xs">{ad.coverage ?? br?.metrics?.coverage ?? '–'}%</TableCell>
                      <TableCell className="font-mono text-xs">{ad.durationLikelyDays ?? c.trend_duration ?? '–'}d</TableCell>
                      <TableCell><StrategyStatusBadge status={c.status} /></TableCell>
                      <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          open={!!selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
}

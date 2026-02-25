import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RegimeBadge } from './RegimeBadge';
import { StrategyStatusBadge } from './StrategyStatusBadge';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface CandidateDetailModalProps {
  candidate: any;
  open: boolean;
  onClose: () => void;
}

export function CandidateDetailModal({ candidate, open, onClose }: CandidateDetailModalProps) {
  const ad = candidate.analysis_data || {};
  const br = candidate.block_reasons || {};
  const gate = br.gate || {};
  const regime = br.regime || {};
  const metrics = br.metrics || {};
  const moduleKeys = br.moduleKeysSeen || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{candidate.ticker}</span>
            <StrategyStatusBadge status={candidate.status} />
            <RegimeBadge regime={candidate.regime} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Metrics */}
          <div>
            <h4 className="font-medium mb-2">Metrics</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Score', candidate.total_score ?? metrics.totalScore ?? '–'],
                ['Agreement', `${metrics.agreement ?? ad.agreement ?? '–'}%`],
                ['Coverage', `${metrics.coverage ?? ad.coverage ?? '–'}%`],
                ['Vol Risk', `${metrics.volRisk ?? '–'}%`],
                ['Data Age', `${metrics.dataAgeHours ?? '–'}h`],
                ['Duration', `${metrics.durationLikelyDays ?? ad.durationLikelyDays ?? candidate.trend_duration ?? '–'}d`],
                ['Trend Strength', metrics.trendStrength ?? '–'],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between p-1.5 rounded bg-muted/50">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Block reasons */}
          {(candidate.status === 'blocked' || candidate.status === 'waiting') && (
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Varför {candidate.status === 'blocked' ? 'blockerad' : 'väntande'}?
              </h4>

              {gate.failed && gate.failed.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground mb-1">Gate-filter som misslyckades:</p>
                  <ul className="space-y-1">
                    {gate.failed.map((reason: string, i: number) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {gate.passed && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Quality gate: OK</span>
                </div>
              )}

              {regime.failed && regime.failed.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground mb-1">Regimklassificering:</p>
                  <ul className="space-y-1">
                    {regime.failed.map((reason: string, i: number) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Module keys */}
          {moduleKeys.length > 0 && (
            <div>
              <h4 className="text-xs text-muted-foreground mb-1">Moduler (från analys)</h4>
              <div className="flex flex-wrap gap-1">
                {moduleKeys.map((k: string) => (
                  <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Entry / SL / TP */}
          {(candidate.entry_price || candidate.stop_loss_price || candidate.target_price) && (
            <div>
              <h4 className="font-medium mb-2">Pris</h4>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {candidate.entry_price && <div className="p-1.5 rounded bg-muted/50"><span className="text-muted-foreground">Entry</span><br/><span className="font-mono">{candidate.entry_price}</span></div>}
                {candidate.stop_loss_price && <div className="p-1.5 rounded bg-muted/50"><span className="text-muted-foreground">Stop</span><br/><span className="font-mono">{candidate.stop_loss_price}</span></div>}
                {candidate.target_price && <div className="p-1.5 rounded bg-muted/50"><span className="text-muted-foreground">Target</span><br/><span className="font-mono">{candidate.target_price}</span></div>}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

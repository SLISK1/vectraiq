import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { StrategyStatusBadge } from './StrategyStatusBadge';
import { AlertTriangle, CheckCircle, XCircle, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

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

  // Strategic thesis (LLM) — same source as AssetDetailModal: strategic_thesis_cache.
  // Keyed on ticker; only fetched while the modal is open.
  const { data: thesis } = useQuery({
    queryKey: ['candidate-thesis', candidate.ticker],
    queryFn: async () => {
      // Cast to any: strategic_thesis_cache is migration-defined; generated types lag.
      const { data } = await (supabase as any)
        .from('strategic_thesis_cache')
        .select('thesis_score, uniqueness_score, moat_score, market_size, themes, thesis_summary, key_risks, catalysts, updated_at')
        .eq('ticker', candidate.ticker)
        .maybeSingle();
      return data as {
        thesis_score: number; uniqueness_score: number; moat_score: number;
        market_size: string | null; themes: string[]; thesis_summary: string | null;
        key_risks: string[]; catalysts: string[]; updated_at: string;
      } | null;
    },
    enabled: open && !!candidate.ticker,
    staleTime: 1000 * 60 * 10,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{candidate.ticker}</span>
            <StrategyStatusBadge status={candidate.status} />
            {candidate.regime && <Badge variant="outline" className="text-xs">{candidate.regime}</Badge>}
          </DialogTitle>
          <DialogDescription>Detaljerad analys och blockorsaker</DialogDescription>
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

          {/* Strategic Thesis (LLM) */}
          {thesis && thesis.thesis_summary && (
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-purple-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  Strategisk Tes
                </h4>
                <span className={cn(
                  "px-2 py-0.5 rounded font-mono font-bold text-xs",
                  Number(thesis.thesis_score) >= 80 ? "bg-purple-500 text-white"
                  : Number(thesis.thesis_score) >= 65 ? "bg-purple-500/30 text-purple-300"
                  : Number(thesis.thesis_score) >= 50 ? "bg-muted text-muted-foreground"
                  : "bg-red-500/20 text-red-400"
                )}>
                  {Math.round(Number(thesis.thesis_score))}/100
                </span>
              </div>
              <p className="text-xs mb-2">{thesis.thesis_summary}</p>

              {Array.isArray(thesis.themes) && thesis.themes.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(thesis.themes as string[]).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] text-purple-300 border-purple-500/20">{t}</Badge>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                {Array.isArray(thesis.catalysts) && thesis.catalysts.length > 0 && (
                  <div>
                    <div className="font-medium text-emerald-400 mb-1">Triggers framåt</div>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {(thesis.catalysts as string[]).slice(0, 3).map((c, i) => (
                        <li key={i}>· {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(thesis.key_risks) && thesis.key_risks.length > 0 && (
                  <div>
                    <div className="font-medium text-red-400 mb-1">Främsta risker</div>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {(thesis.key_risks as string[]).slice(0, 3).map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-2 pt-2 border-t border-purple-500/20 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                <span>Unikhet: <span className="font-mono text-foreground">{Math.round(Number(thesis.uniqueness_score))}/10</span></span>
                <span>Vallgrav: <span className="font-mono text-foreground">{Math.round(Number(thesis.moat_score))}/10</span></span>
                {thesis.market_size && <span>Marknad: <span className="text-foreground">{thesis.market_size}</span></span>}
              </div>
            </div>
          )}

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

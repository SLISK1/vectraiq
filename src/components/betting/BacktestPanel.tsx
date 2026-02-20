import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, BarChart3, TrendingUp, Target } from 'lucide-react';

interface LeagueStats {
  league: string;
  total: number;
  correct: number;
  accuracy: number;
  vs_market: number | null;
}

interface CalibrationBin {
  range: string;
  predictions: number;
  correct: number;
  accuracy: number;
}

export const BacktestPanel = () => {
  const [open, setOpen] = useState(false);
  const [leagueStats, setLeagueStats] = useState<LeagueStats[]>([]);
  const [calibration, setCalibration] = useState<CalibrationBin[]>([]);
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [roi, setRoi] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadBacktestData = async () => {
    setIsLoading(true);
    try {
      // Get completed predictions with outcomes
      const { data: preds } = await supabase
        .from('betting_predictions')
        .select('*, betting_matches!inner(league, home_team, away_team, home_score, away_score)')
        .not('outcome', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!preds || preds.length === 0) {
        setIsLoading(false);
        return;
      }

      setTotalPredictions(preds.length);

      // League stats
      const leagueMap = new Map<string, { total: number; correct: number; edgeSum: number; edgeCount: number }>();
      for (const p of preds) {
        const match = (p as any).betting_matches;
        const league = match?.league || 'Okänd';
        const correct = p.predicted_winner === p.outcome;

        if (!leagueMap.has(league)) leagueMap.set(league, { total: 0, correct: 0, edgeSum: 0, edgeCount: 0 });
        const entry = leagueMap.get(league)!;
        entry.total++;
        if (correct) entry.correct++;
        if (p.model_edge !== null) {
          entry.edgeSum += Number(p.model_edge);
          entry.edgeCount++;
        }
      }

      const stats: LeagueStats[] = Array.from(leagueMap.entries()).map(([league, s]) => ({
        league,
        total: s.total,
        correct: s.correct,
        accuracy: s.total > 0 ? (s.correct / s.total) * 100 : 0,
        vs_market: s.edgeCount > 0 ? (s.edgeSum / s.edgeCount) * 100 : null,
      })).sort((a, b) => b.total - a.total);

      setLeagueStats(stats);

      // Calibration bins
      const bins = [
        { range: '40–50%', min: 40, max: 50 },
        { range: '50–60%', min: 50, max: 60 },
        { range: '60–70%', min: 60, max: 70 },
        { range: '70–80%', min: 70, max: 80 },
        { range: '80–100%', min: 80, max: 100 },
      ];

      const calBins: CalibrationBin[] = bins.map((bin) => {
        const inBin = preds.filter(
          (p) => p.confidence_capped >= bin.min && p.confidence_capped < bin.max
        );
        const correct = inBin.filter((p) => p.predicted_winner === p.outcome).length;
        return {
          range: bin.range,
          predictions: inBin.length,
          correct,
          accuracy: inBin.length > 0 ? (correct / inBin.length) * 100 : 0,
        };
      }).filter((b) => b.predictions > 0);

      setCalibration(calBins);

      // ROI simulation: assume 1 unit bet on each prediction
      let totalReturn = 0;
      let totalBets = 0;
      for (const p of preds) {
        if (p.market_odds_home && p.outcome) {
          totalBets++;
          const correct = p.predicted_winner === p.outcome;
          let odds = 0;
          if (p.predicted_winner === 'home') odds = Number(p.market_odds_home);
          else if (p.predicted_winner === 'draw') odds = Number(p.market_odds_draw) || 0;
          else odds = Number(p.market_odds_away) || 0;

          if (correct && odds > 0) totalReturn += odds - 1;
          else totalReturn -= 1;
        }
      }

      if (totalBets > 0) setRoi((totalReturn / totalBets) * 100);
    } catch (e) {
      console.error('Backtest load error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadBacktestData();
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full glass-card rounded-xl p-4 hover:border-primary/30 transition-all">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Backtest & Träffsäkerhet</h3>
          {totalPredictions > 0 && (
            <span className="text-xs text-muted-foreground">({totalPredictions} avslutade prediktioner)</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border border-t-0 border-border/50 rounded-b-xl p-4 space-y-5">
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Laddar statistik...</div>
          ) : totalPredictions === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Target className="w-8 h-8 mx-auto text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                Ingen backtest-data ännu. Statistik visas när matcher har avgjorts.
              </p>
              <p className="text-xs text-muted-foreground">
                Minst 10 avslutade prediktioner behövs för meningsfull kalibrering.
              </p>
            </div>
          ) : (
            <>
              {/* ROI */}
              {roi !== null && (
                <div className="rounded-lg bg-muted/30 border border-border/50 p-4 flex items-center gap-4">
                  <TrendingUp className={`w-6 h-6 ${roi > 0 ? 'text-primary' : 'text-destructive'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">ROI-simulering (enhetssats per prediktion)</p>
                    <p className={`text-2xl font-bold font-mono ${roi > 0 ? 'text-primary' : 'text-destructive'}`}>
                      {roi > 0 ? '+' : ''}{roi.toFixed(1)}%
                    </p>
                  </div>
                </div>
              )}

              {/* League accuracy table */}
              {leagueStats.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Träffsäkerhet per liga</h4>
                  <div className="rounded-lg border border-border/50 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b border-border/50">
                          <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Liga</th>
                          <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Pred.</th>
                          <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Rätt</th>
                          <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Accuracy</th>
                          <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">vs Marknad</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {leagueStats.map((row) => (
                          <tr key={row.league} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-medium">{row.league}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{row.total}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{row.correct}</td>
                            <td className={`px-3 py-2 text-right font-bold ${row.accuracy > 50 ? 'text-primary' : 'text-destructive'}`}>
                              {row.accuracy.toFixed(1)}%
                            </td>
                            <td className={`px-3 py-2 text-right ${row.vs_market === null ? 'text-muted-foreground' : row.vs_market > 0 ? 'text-primary' : 'text-destructive'}`}>
                              {row.vs_market === null ? '—' : `${row.vs_market > 0 ? '+' : ''}${row.vs_market.toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Calibration */}
              {calibration.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Kalibrering</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    När modellen säger X% — hur ofta blir det rätt?
                  </p>
                  <div className="space-y-2">
                    {calibration.map((bin) => (
                      <div key={bin.range} className="flex items-center gap-3">
                        <span className="text-xs font-mono w-16 text-muted-foreground">{bin.range}</span>
                        <div className="flex-1 h-5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${bin.accuracy > 55 ? 'bg-primary' : bin.accuracy > 45 ? 'bg-accent-foreground/50' : 'bg-destructive'}`}
                            style={{ width: `${bin.accuracy}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold w-12 text-right ${bin.accuracy > 55 ? 'text-primary' : bin.accuracy > 45 ? 'text-muted-foreground' : 'text-destructive'}`}>
                          {bin.accuracy.toFixed(0)}%
                        </span>
                        <span className="text-xs text-muted-foreground w-12">({bin.predictions}st)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

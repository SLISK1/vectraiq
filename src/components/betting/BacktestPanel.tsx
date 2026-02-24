import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, BarChart3, TrendingUp, Target, CheckCircle, XCircle } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Area, AreaChart,
} from 'recharts';

interface ScoredPrediction {
  id: string;
  predicted_winner: string;
  outcome: string;
  confidence_capped: number;
  predicted_prob: number;
  model_edge: number | null;
  clv: number | null;
  market_odds_home: number | null;
  market_odds_draw: number | null;
  market_odds_away: number | null;
  scored_at: string;
  created_at: string;
  match: {
    league: string;
    home_team: string;
    away_team: string;
    home_score: number | null;
    away_score: number | null;
    match_date: string;
  };
}

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
  expected: number;
}

const normalizeOutcome = (outcome: string) => {
  if (outcome === 'home_win') return 'home';
  if (outcome === 'away_win') return 'away';
  return outcome;
};

export const BacktestPanel = () => {
  const [open, setOpen] = useState(false);
  const [predictions, setPredictions] = useState<ScoredPrediction[]>([]);
  const [leagueStats, setLeagueStats] = useState<LeagueStats[]>([]);
  const [calibration, setCalibration] = useState<CalibrationBin[]>([]);
  const [roi, setRoi] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'clv' | 'history'>('overview');

  const loadBacktestData = async () => {
    setIsLoading(true);
    try {
      const { data: preds } = await supabase
        .from('betting_predictions')
        .select('*, betting_matches!inner(league, home_team, away_team, home_score, away_score, match_date)')
        .not('outcome', 'is', null)
        .order('scored_at', { ascending: true })
        .limit(500);

      if (!preds || preds.length === 0) {
        setIsLoading(false);
        return;
      }

      const mapped: ScoredPrediction[] = preds.map((p: any) => ({
        id: p.id,
        predicted_winner: p.predicted_winner,
        outcome: p.outcome,
        confidence_capped: p.confidence_capped,
        predicted_prob: p.predicted_prob,
        model_edge: p.model_edge,
        clv: p.clv,
        market_odds_home: p.market_odds_home,
        market_odds_draw: p.market_odds_draw,
        market_odds_away: p.market_odds_away,
        scored_at: p.scored_at,
        created_at: p.created_at,
        match: p.betting_matches,
      }));

      setPredictions(mapped);

      // League stats
      const leagueMap = new Map<string, { total: number; correct: number; edgeSum: number; edgeCount: number }>();
      for (const p of mapped) {
        const league = p.match.league;
        const correct = p.predicted_winner === normalizeOutcome(p.outcome);
        if (!leagueMap.has(league)) leagueMap.set(league, { total: 0, correct: 0, edgeSum: 0, edgeCount: 0 });
        const entry = leagueMap.get(league)!;
        entry.total++;
        if (correct) entry.correct++;
        if (p.model_edge !== null) { entry.edgeSum += Number(p.model_edge); entry.edgeCount++; }
      }

      setLeagueStats(Array.from(leagueMap.entries()).map(([league, s]) => ({
        league,
        total: s.total,
        correct: s.correct,
        accuracy: s.total > 0 ? (s.correct / s.total) * 100 : 0,
        vs_market: s.edgeCount > 0 ? (s.edgeSum / s.edgeCount) * 100 : null,
      })).sort((a, b) => b.total - a.total));

      // Calibration
      const bins = [
        { range: '40–50%', min: 40, max: 50, mid: 45 },
        { range: '50–60%', min: 50, max: 60, mid: 55 },
        { range: '60–70%', min: 60, max: 70, mid: 65 },
        { range: '70–80%', min: 70, max: 80, mid: 75 },
        { range: '80–100%', min: 80, max: 100, mid: 90 },
      ];
      setCalibration(bins.map(bin => {
        const inBin = mapped.filter(p => p.confidence_capped >= bin.min && p.confidence_capped < bin.max);
        const correct = inBin.filter(p => p.predicted_winner === normalizeOutcome(p.outcome)).length;
        return { range: bin.range, predictions: inBin.length, correct, accuracy: inBin.length > 0 ? (correct / inBin.length) * 100 : 0, expected: bin.mid };
      }).filter(b => b.predictions > 0));

      // ROI
      let totalReturn = 0, totalBets = 0;
      for (const p of mapped) {
        if (p.market_odds_home && p.outcome) {
          totalBets++;
          const correct = p.predicted_winner === normalizeOutcome(p.outcome);
          let odds = p.predicted_winner === 'home' ? Number(p.market_odds_home) : p.predicted_winner === 'draw' ? Number(p.market_odds_draw) || 0 : Number(p.market_odds_away) || 0;
          totalReturn += correct && odds > 0 ? odds - 1 : -1;
        }
      }
      if (totalBets > 0) setRoi((totalReturn / totalBets) * 100);
    } catch (e) {
      console.error('Backtest load error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (open) loadBacktestData(); }, [open]);

  // Chart data
  const cumulativeData = predictions.map((p, i) => {
    const correct = predictions.slice(0, i + 1).filter(x => x.predicted_winner === normalizeOutcome(x.outcome)).length;
    const total = i + 1;

    // Cumulative ROI
    let cRoi = 0;
    if (predictions.slice(0, i + 1).some(x => x.market_odds_home)) {
      let ret = 0, bets = 0;
      for (const x of predictions.slice(0, i + 1)) {
        if (x.market_odds_home && x.outcome) {
          bets++;
          const hit = x.predicted_winner === normalizeOutcome(x.outcome);
          const odds = x.predicted_winner === 'home' ? Number(x.market_odds_home) : x.predicted_winner === 'draw' ? Number(x.market_odds_draw) || 0 : Number(x.market_odds_away) || 0;
          ret += hit && odds > 0 ? odds - 1 : -1;
        }
      }
      if (bets > 0) cRoi = (ret / bets) * 100;
    }

    return {
      index: total,
      accuracy: (correct / total) * 100,
      roi: cRoi,
      date: new Date(p.scored_at || p.created_at).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' }),
    };
  });

  const leagueChartData = leagueStats.map(s => ({
    name: s.league.length > 12 ? s.league.substring(0, 12) + '…' : s.league,
    accuracy: Number(s.accuracy.toFixed(1)),
    total: s.total,
  }));

  const totalCorrect = predictions.filter(p => p.predicted_winner === normalizeOutcome(p.outcome)).length;
  const overallAccuracy = predictions.length > 0 ? (totalCorrect / predictions.length) * 100 : 0;

  // CLV data
  const clvData = predictions
    .filter(p => p.clv !== null)
    .map((p, i, arr) => {
      const cumClv = arr.slice(0, i + 1).reduce((s, x) => s + Number(x.clv || 0), 0) / (i + 1);
      return {
        index: i + 1,
        clv: Number((Number(p.clv) * 100).toFixed(2)),
        cumClv: Number((cumClv * 100).toFixed(2)),
        date: new Date(p.scored_at || p.created_at).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' }),
      };
    });

  // ROI per odds interval
  const oddsIntervals = [
    { label: '1.4–1.8', min: 1.4, max: 1.8 },
    { label: '1.8–2.2', min: 1.8, max: 2.2 },
    { label: '2.2–3.0', min: 2.2, max: 3.0 },
    { label: '3.0+', min: 3.0, max: 100 },
  ];
  const roiPerOdds = oddsIntervals.map(interval => {
    const inRange = predictions.filter(p => {
      const odds = p.predicted_winner === 'home' ? Number(p.market_odds_home)
        : p.predicted_winner === 'draw' ? Number(p.market_odds_draw)
        : Number(p.market_odds_away);
      return odds >= interval.min && odds < interval.max && p.outcome;
    });
    let intervalRoi = 0;
    if (inRange.length > 0) {
      let ret = 0;
      for (const x of inRange) {
        const hit = x.predicted_winner === normalizeOutcome(x.outcome);
        const odds = x.predicted_winner === 'home' ? Number(x.market_odds_home)
          : x.predicted_winner === 'draw' ? Number(x.market_odds_draw) || 0
          : Number(x.market_odds_away) || 0;
        ret += hit && odds > 0 ? odds - 1 : -1;
      }
      intervalRoi = (ret / inRange.length) * 100;
    }
    return { name: interval.label, roi: Number(intervalRoi.toFixed(1)), count: inRange.length };
  }).filter(d => d.count > 0);

  // Hit rate per edge bucket
  const edgeBuckets = [
    { label: '<0%', min: -100, max: 0 },
    { label: '0–5%', min: 0, max: 0.05 },
    { label: '5–10%', min: 0.05, max: 0.10 },
    { label: '10%+', min: 0.10, max: 100 },
  ];
  const hitRatePerEdge = edgeBuckets.map(bucket => {
    const inRange = predictions.filter(p => {
      const edge = Number(p.model_edge || 0);
      return edge >= bucket.min && edge < bucket.max;
    });
    const correct = inRange.filter(p => p.predicted_winner === normalizeOutcome(p.outcome)).length;
    return {
      name: bucket.label,
      hitRate: inRange.length > 0 ? Number(((correct / inRange.length) * 100).toFixed(1)) : 0,
      count: inRange.length,
    };
  }).filter(d => d.count > 0);

  const avgClv = clvData.length > 0 ? clvData[clvData.length - 1].cumClv : null;

  const tabs = [
    { id: 'overview' as const, label: 'Översikt' },
    { id: 'clv' as const, label: 'CLV & Edge' },
    { id: 'history' as const, label: 'Historik' },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full glass-card rounded-xl p-4 hover:border-primary/30 transition-all">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Backtest & Träffsäkerhet</h3>
          {predictions.length > 0 && (
            <span className="text-xs text-muted-foreground">({predictions.length} avslutade prediktioner)</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border border-t-0 border-border/50 rounded-b-xl p-4 space-y-5">
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Laddar statistik...</div>
          ) : predictions.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Target className="w-8 h-8 mx-auto text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">Ingen backtest-data ännu.</p>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <>
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Prediktioner</p>
                      <p className="text-xl font-bold font-mono">{predictions.length}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Träffsäkerhet</p>
                      <p className={`text-xl font-bold font-mono ${overallAccuracy > 50 ? 'text-primary' : 'text-destructive'}`}>
                        {overallAccuracy.toFixed(1)}%
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Rätt / Fel</p>
                      <p className="text-xl font-bold font-mono">
                        <span className="text-primary">{totalCorrect}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span className="text-destructive">{predictions.length - totalCorrect}</span>
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">ROI</p>
                      <p className={`text-xl font-bold font-mono ${(roi ?? 0) > 0 ? 'text-primary' : 'text-destructive'}`}>
                        {roi !== null ? `${roi > 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Cumulative accuracy + ROI chart */}
                  {cumulativeData.length > 1 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Träffsäkerhet & ROI över tid</h4>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={cumulativeData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="roiGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--accent-foreground))" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="hsl(var(--accent-foreground))" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="index" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              labelFormatter={(v) => `Prediktion #${v}`}
                              formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name === 'accuracy' ? 'Träffsäkerhet' : 'ROI']}
                            />
                            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.3} />
                            <Area type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" fill="url(#accGrad)" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="roi" stroke="hsl(var(--accent-foreground))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div className="flex justify-center gap-6 mt-2">
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="w-3 h-0.5 bg-primary rounded" />
                            <span className="text-muted-foreground">Träffsäkerhet</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="w-3 h-0.5 bg-accent-foreground rounded" style={{ borderBottom: '1px dashed' }} />
                            <span className="text-muted-foreground">ROI</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* League bar chart */}
                  {leagueChartData.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Träffsäkerhet per liga</h4>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={leagueChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number) => [`${value}%`, 'Träffsäkerhet']}
                            />
                            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                              {leagueChartData.map((entry, index) => (
                                <Cell key={index} fill={entry.accuracy > 50 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Calibration */}
                  {calibration.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Kalibrering</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Modellens konfidens vs faktiskt utfall
                      </p>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={calibration} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number, name: string) => [`${value.toFixed(0)}%`, name === 'accuracy' ? 'Faktisk' : 'Förväntad']}
                            />
                            <Bar dataKey="expected" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[4, 4, 0, 0]} name="Förväntad" />
                            <Bar dataKey="accuracy" radius={[4, 4, 0, 0]} name="Faktisk">
                              {calibration.map((entry, index) => (
                                <Cell key={index} fill={entry.accuracy >= entry.expected * 0.8 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        <p className="text-[10px] text-muted-foreground text-center mt-1">
                          Grått = förväntad träff | Färg = faktisk träff ({calibration.reduce((s, b) => s + b.predictions, 0)} prediktioner)
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'clv' && (
                <div className="space-y-5">
                  {/* CLV + Edge KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Snitt CLV</p>
                      <p className={`text-xl font-bold font-mono ${(avgClv ?? 0) > 0 ? 'text-primary' : 'text-destructive'}`}>
                        {avgClv !== null ? `${avgClv > 0 ? '+' : ''}${avgClv.toFixed(2)}%` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">CLV-datapunkter</p>
                      <p className="text-xl font-bold font-mono">{clvData.length}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Odds-intervall</p>
                      <p className="text-xl font-bold font-mono">{roiPerOdds.length}</p>
                    </div>
                  </div>

                  {/* CLV curve */}
                  {clvData.length > 1 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3">CLV över tid (kumulativt snitt)</h4>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={clvData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                              <linearGradient id="clvGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="index" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number) => [`${value.toFixed(2)}%`, 'CLV']}
                            />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <Area type="monotone" dataKey="cumClv" stroke="hsl(var(--primary))" fill="url(#clvGrad)" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* ROI per odds interval */}
                  {roiPerOdds.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3">ROI per odds-intervall</h4>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={roiPerOdds} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number, _: string, props: any) => [`${value}% (n=${props.payload.count})`, 'ROI']}
                            />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                              {roiPerOdds.map((entry, index) => (
                                <Cell key={index} fill={entry.roi > 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Hit rate per edge bucket */}
                  {hitRatePerEdge.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Träffsäkerhet per edge-intervall</h4>
                      <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={hitRatePerEdge} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number, _: string, props: any) => [`${value}% (n=${props.payload.count})`, 'Hit Rate']}
                            />
                            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                            <Bar dataKey="hitRate" radius={[4, 4, 0, 0]}>
                              {hitRatePerEdge.map((entry, index) => (
                                <Cell key={index} fill={entry.hitRate > 50 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div>
                  <h4 className="text-sm font-semibold mb-3">Alla prediktioner</h4>
                  <div className="rounded-lg border border-border/50 overflow-hidden max-h-[400px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted/50 border-b border-border/50">
                          <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Match</th>
                          <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Resultat</th>
                          <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Pred.</th>
                          <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Konf.</th>
                          <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Träff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {[...predictions].reverse().map((p) => {
                          const hit = p.predicted_winner === normalizeOutcome(p.outcome);
                          const predLabel = p.predicted_winner === 'home' ? '1' : p.predicted_winner === 'draw' ? 'X' : '2';
                          const outcomeLabel = normalizeOutcome(p.outcome) === 'home' ? '1' : normalizeOutcome(p.outcome) === 'draw' ? 'X' : '2';
                          return (
                            <tr key={p.id} className={`transition-colors ${hit ? 'hover:bg-primary/5' : 'hover:bg-destructive/5'}`}>
                              <td className="px-3 py-2">
                                <div className="text-xs font-medium truncate max-w-[180px]">
                                  {p.match.home_team} - {p.match.away_team}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{p.match.league}</div>
                              </td>
                              <td className="px-2 py-2 text-center text-xs font-mono">
                                {p.match.home_score}–{p.match.away_score}
                                <span className="ml-1 text-muted-foreground">({outcomeLabel})</span>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
                                  hit ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'
                                }`}>
                                  {predLabel}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-center text-xs font-mono text-muted-foreground">
                                {p.confidence_capped}%
                              </td>
                              <td className="px-2 py-2 text-center">
                                {hit ? (
                                  <CheckCircle className="w-4 h-4 text-primary mx-auto" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-destructive mx-auto" />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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

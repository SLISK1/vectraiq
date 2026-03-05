import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, BarChart3, TrendingUp, Target, CheckCircle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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

// Side bet rows (have market/selection/bet_outcome)
interface SideBetRow {
  id: string;
  match_id: string;
  market: string;
  line: number | null;
  selection: string | null;
  predicted_prob: number;
  bet_outcome: string | null; // 'win' | 'loss' | 'push' | 'void' | null
  created_at: string;
  league: string;
}

interface MarketStats {
  market: string;
  total: number;
  win: number;
  loss: number;
  push: number;
  void: number;
  hitRate: number; // win / (win + loss)
  roiUnits: number; // +1 win, -1 loss, 0 push/void
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

const MARKET_LABELS: Record<string, string> = {
  '1X2': '1X2',
  'OU_GOALS': 'Mål Ö/U',
  'BTTS': 'Båda scorer',
  'HT_OU_GOALS': '1H Mål',
  'CORNERS_OU': 'Hörnor',
  'CARDS_OU': 'Kort',
  'FIRST_TO_SCORE': 'Första mål',
};

export const BacktestPanel = () => {
  const [open, setOpen] = useState(false);
  const [predictions, setPredictions] = useState<ScoredPrediction[]>([]);
  const [sideBets, setSideBets] = useState<SideBetRow[]>([]);
  const [leagueStats, setLeagueStats] = useState<LeagueStats[]>([]);
  const [marketStats, setMarketStats] = useState<MarketStats[]>([]);
  const [calibration, setCalibration] = useState<CalibrationBin[]>([]);
  const [roi, setRoi] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'sidebets' | 'clv' | 'history'>('overview');
  const { toast } = useToast();

  const runScoring = async () => {
    setIsScoring(true);
    try {
      // Step 1: score-predictions (updates match results + scores 1X2 outcomes)
      const { error: scoreErr } = await supabase.functions.invoke('score-predictions', { body: {} });
      if (scoreErr) console.error('score-predictions error:', scoreErr);

      // Step 2: betting-settle (settles side bets)
      const { error: settleErr } = await supabase.functions.invoke('betting-settle', { body: {} });
      if (settleErr) console.error('betting-settle error:', settleErr);

      toast({ title: 'Scoring klar', description: 'Prediktioner och sidomarknader uppdaterade.' });
      await loadBacktestData();
    } catch (e) {
      console.error('Scoring failed:', e);
      toast({ title: 'Scoring misslyckades', variant: 'destructive' });
    } finally {
      setIsScoring(false);
    }
  };

  const loadBacktestData = async () => {
    setIsLoading(true);
    try {
      // Load settled predictions — no market filter at DB level (backward-compatible
      // before the A1 migration is applied to Supabase production)
      const { data: preds } = await supabase
        .from('betting_predictions')
        .select('*, betting_matches!inner(league, home_team, away_team, home_score, away_score, match_date)')
        .not('outcome', 'is', null)
        .order('scored_at', { ascending: true })
        .limit(500);

      // Filter in JS: keep only 1X2 rows (market IS NULL or '1X2')
      const filtered1x2 = (preds || []).filter((p: any) => {
        const market = p.market;
        return market === null || market === undefined || market === '1X2';
      });

      // Load side bet rows — wrapped in try/catch: fails gracefully if market column
      // doesn't exist yet in production
      let sidesRaw: any[] = [];
      try {
        const { data: sidesData } = await (supabase as any)
          .from('betting_predictions')
          .select('id, match_id, market, line, selection, predicted_prob, bet_outcome, created_at, betting_matches!inner(league)')
          .not('market', 'is', null)
          .neq('market', '1X2')
          .not('bet_outcome', 'is', null)
          .order('created_at', { ascending: false })
          .limit(2000);
        sidesRaw = sidesData || [];
      } catch {
        // market column not yet in DB — side bets unavailable
      }

      // Process 1X2 predictions
      const mapped: ScoredPrediction[] = filtered1x2.map((p: any) => ({
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

      // Process side bets
      const mappedSides: SideBetRow[] = sidesRaw.map((s: any) => ({
        id: s.id,
        match_id: s.match_id,
        market: s.market,
        line: s.line,
        selection: s.selection,
        predicted_prob: s.predicted_prob,
        bet_outcome: s.bet_outcome,
        created_at: s.created_at,
        league: s.betting_matches?.league || 'Okänd',
      }));
      setSideBets(mappedSides);

      // League stats (1X2 only)
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

      // Market stats (side bets, excluding void for hit rate)
      const allMarkets = [...new Set(mappedSides.map(s => s.market))];
      const mStats: MarketStats[] = allMarkets.map(market => {
        const rows = mappedSides.filter(s => s.market === market);
        const win = rows.filter(s => s.bet_outcome === 'win').length;
        const loss = rows.filter(s => s.bet_outcome === 'loss').length;
        const push = rows.filter(s => s.bet_outcome === 'push').length;
        const voidCount = rows.filter(s => s.bet_outcome === 'void').length;
        const settled = win + loss; // push/void excluded from hit rate
        const roiUnits = (win * 1) + (loss * -1); // push/void = 0
        return {
          market,
          total: rows.length,
          win,
          loss,
          push,
          void: voidCount,
          hitRate: settled > 0 ? (win / settled) * 100 : 0,
          roiUnits: settled > 0 ? (roiUnits / settled) * 100 : 0,
        };
      }).sort((a, b) => b.total - a.total);
      setMarketStats(mStats);

      // Calibration (1X2)
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

      // ROI (1X2)
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

  const totalSideBets = sideBets.length;
  const settledSideBets = sideBets.filter(s => s.bet_outcome !== 'void').length;

  const tabs = [
    { id: 'overview' as const, label: 'Översikt 1X2' },
    { id: 'sidebets' as const, label: `Sidomarknader${totalSideBets > 0 ? ` (${totalSideBets})` : ''}` },
    { id: 'clv' as const, label: 'CLV & Edge' },
    { id: 'history' as const, label: 'Historik' },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full glass-card rounded-xl p-4 hover:border-primary/30 transition-all">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">ROI & Backtest</h3>
          {predictions.length > 0 && (
            <span className="text-xs text-muted-foreground">({predictions.length} 1X2 | {settledSideBets} sidospel)</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border border-t-0 border-border/50 rounded-b-xl p-4 space-y-5">
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Laddar statistik...</div>
          ) : predictions.length === 0 && sideBets.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Target className="w-8 h-8 mx-auto text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">Ingen backtest-data ännu.</p>
            </div>
          ) : (
            <>
              {/* Scoring button + Tab switcher */}
              <div className="flex items-center gap-2">
                <div className="flex gap-1 bg-muted/30 rounded-lg p-1 flex-1">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                        activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={runScoring}
                  disabled={isScoring}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-muted/30 border border-border/50 hover:border-primary/30 transition-all text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title="Kör scoring av prediktioner och sidomarknader"
                >
                  {isScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Scora
                </button>
              </div>

              {activeTab === 'overview' && (
                <>
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">ROI (1X2)</p>
                      <p className={`text-xl font-bold font-mono ${(roi ?? 0) > 0 ? 'text-primary' : 'text-destructive'}`}>
                        {roi !== null ? `${roi > 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Prediktioner</p>
                      <p className="text-xl font-bold font-mono">{predictions.length}</p>
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
                      <p className="text-xs text-muted-foreground">Träffsäkerhet</p>
                      <p className={`text-xl font-bold font-mono ${overallAccuracy > 50 ? 'text-primary' : 'text-destructive'}`}>
                        {overallAccuracy.toFixed(1)}%
                      </p>
                    </div>
                  </div>

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
                      </div>
                    </div>
                  )}

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

                  {calibration.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Kalibrering</h4>
                      <p className="text-xs text-muted-foreground mb-3">Modellens konfidens vs faktiskt utfall</p>
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

              {activeTab === 'sidebets' && (
                <div className="space-y-5">
                  {sideBets.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <Target className="w-8 h-8 mx-auto text-muted-foreground opacity-40" />
                      <p className="text-sm text-muted-foreground">
                        Inga sidospel avgjorda ännu. Side bets loggas automatiskt vid nästa matchanalys och avgörs av betting-settle.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Overall side bet KPIs */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(() => {
                          const allWin = sideBets.filter(s => s.bet_outcome === 'win').length;
                          const allLoss = sideBets.filter(s => s.bet_outcome === 'loss').length;
                          const allPush = sideBets.filter(s => s.bet_outcome === 'push').length;
                          const allVoid = sideBets.filter(s => s.bet_outcome === 'void').length;
                          const settled = allWin + allLoss;
                          const hr = settled > 0 ? (allWin / settled) * 100 : 0;
                          return (
                            <>
                              <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                                <p className="text-xs text-muted-foreground">Totalt sidospel</p>
                                <p className="text-xl font-bold font-mono">{sideBets.length}</p>
                              </div>
                              <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                                <p className="text-xs text-muted-foreground">Träffsäkerhet</p>
                                <p className={`text-xl font-bold font-mono ${hr > 50 ? 'text-primary' : 'text-destructive'}`}>
                                  {settled > 0 ? `${hr.toFixed(1)}%` : '—'}
                                </p>
                              </div>
                              <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                                <p className="text-xs text-muted-foreground">Rätt / Fel</p>
                                <p className="text-xl font-bold font-mono">
                                  <span className="text-primary">{allWin}</span>
                                  <span className="text-muted-foreground mx-1">/</span>
                                  <span className="text-destructive">{allLoss}</span>
                                </p>
                              </div>
                              <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                                <p className="text-xs text-muted-foreground">Push / Void</p>
                                <p className="text-xl font-bold font-mono text-muted-foreground">
                                  {allPush} / {allVoid}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Per market breakdown */}
                      {marketStats.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-3">Träffsäkerhet per marknad</h4>
                          <div className="rounded-lg border border-border/50 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-muted/50 border-b border-border/50">
                                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Marknad</th>
                                  <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Träff%</th>
                                  <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">W/L</th>
                                  <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">Push/Void</th>
                                  <th className="text-center px-2 py-2 text-xs text-muted-foreground font-medium">ROI</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {marketStats.map(ms => (
                                  <tr key={ms.market} className="hover:bg-muted/20 transition-colors">
                                    <td className="px-3 py-2 text-xs font-medium">
                                      {MARKET_LABELS[ms.market] || ms.market}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                      <span className={`text-xs font-bold font-mono ${ms.hitRate > 50 ? 'text-primary' : ms.hitRate > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                        {ms.win + ms.loss > 0 ? `${ms.hitRate.toFixed(1)}%` : '—'}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 text-center text-xs font-mono">
                                      <span className="text-primary">{ms.win}</span>
                                      <span className="text-muted-foreground mx-1">/</span>
                                      <span className="text-destructive">{ms.loss}</span>
                                    </td>
                                    <td className="px-2 py-2 text-center text-xs font-mono text-muted-foreground">
                                      {ms.push} / {ms.void}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                      <span className={`text-xs font-bold font-mono ${ms.roiUnits > 0 ? 'text-primary' : ms.roiUnits < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                        {ms.win + ms.loss > 0 ? `${ms.roiUnits > 0 ? '+' : ''}${ms.roiUnits.toFixed(1)}%` : '—'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            Push och void exkluderas från träffsäkerhet och ROI. ROI = win/loss-units per avgjort bet.
                          </p>
                        </div>
                      )}

                      {/* Per market hit rate chart */}
                      {marketStats.filter(ms => ms.win + ms.loss > 0).length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-3">Träffsäkerhet per marknad (diagram)</h4>
                          <div className="rounded-lg bg-muted/20 border border-border/50 p-3">
                            <ResponsiveContainer width="100%" height={180}>
                              <BarChart
                                data={marketStats.filter(ms => ms.win + ms.loss > 0).map(ms => ({
                                  name: MARKET_LABELS[ms.market] || ms.market,
                                  hitRate: Number(ms.hitRate.toFixed(1)),
                                  count: ms.win + ms.loss,
                                }))}
                                margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                                  formatter={(value: number, _: string, props: any) => [`${value}% (n=${props.payload.count})`, 'Träffsäkerhet']}
                                />
                                <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                                <Bar dataKey="hitRate" radius={[4, 4, 0, 0]}>
                                  {marketStats.filter(ms => ms.win + ms.loss > 0).map((entry, index) => (
                                    <Cell key={index} fill={entry.hitRate > 50 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'clv' && (
                <div className="space-y-5">
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
                  <h4 className="text-sm font-semibold mb-3">Alla 1X2-prediktioner</h4>
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

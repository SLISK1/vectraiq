import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MatchCard } from '@/components/betting/MatchCard';
import { MarketPicker, type BettingMarket } from '@/components/betting/MarketPicker';
import { BettingCard } from '@/components/betting/BettingCard';
import { ValueFilter } from '@/components/betting/ValueFilter';
import { PoolTipsCard } from '@/components/betting/PoolTipsCard';
import { BacktestPanel } from '@/components/betting/BacktestPanel';
import { AlertTriangle, Trophy, Swords, RefreshCw, Loader2, Dumbbell, ListOrdered, Database, ChevronDown, History } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type Sport = 'football' | 'ufc' | 'topptipset' | 'stryktipset';

type BettingMatch = {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  league: string;
  match_date: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  source_data: Record<string, unknown>;
};

type BettingPrediction = {
  id: string;
  match_id: string;
  predicted_winner: string;
  predicted_prob: number;
  confidence_raw: number;
  confidence_capped: number;
  cap_reason: string | null;
  key_factors: Record<string, unknown> | null;
  ai_reasoning: string | null;
  sources_used: string[] | null;
  market_odds_home: number | null;
  market_odds_draw: number | null;
  market_odds_away: number | null;
  market_implied_prob: number | null;
  model_edge: number | null;
  is_value_bet: boolean | null;
  suggested_stake_pct: number | null;
  created_at: string;
};


type CouponRecommendation = {
  id: string;
  match_id: string;
  market: string;
  selection: string;
  implied_prob: number;
  p_raw: number | null;
  p_proxy: number | null;
  p_cal: number;
  edge: number;
  suggested_stake_pct: number | null;
  phase: number;
  chaos_score: number;
  is_valid: boolean;
};

const sportOptions: { id: Sport; label: string; icon: React.ElementType }[] = [
  { id: 'football', label: 'Fotboll', icon: Trophy },
  { id: 'ufc', label: 'UFC / MMA', icon: Swords },
  { id: 'topptipset', label: 'Topptipset', icon: ListOrdered },
  { id: 'stryktipset', label: 'Stryktipset', icon: Dumbbell },
];

export const BettingPage = () => {
  const [selectedSport, setSelectedSport] = useState<Sport>('football');
  const [matches, setMatches] = useState<BettingMatch[]>([]);
  const [predictions, setPredictions] = useState<Map<string, BettingPrediction>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [poolData, setPoolData] = useState<{ rows?: Record<string, unknown>[]; message?: string } | null>(null);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [showOnlyValueBets, setShowOnlyValueBets] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<BettingMarket>('ALL');
  const [recommendations, setRecommendations] = useState<Map<string, CouponRecommendation[]>>(new Map());
  const [apiBudget, setApiBudget] = useState<{ searches_used: number; daily_limit: number; last_updated: string } | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();

  const isPoolSport = selectedSport === 'topptipset' || selectedSport === 'stryktipset';

  // Load API budget from api_usage_tracker
  const DAILY_SEARCH_LIMIT = 15;

  const loadApiBudget = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('api_usage_tracker')
      .select('searches_used, last_updated')
      .eq('category', 'betting')
      .eq('date_key', todayStr)
      .single();
    if (data) {
      setApiBudget({ searches_used: data.searches_used, daily_limit: DAILY_SEARCH_LIMIT, last_updated: data.last_updated });
    } else {
      setApiBudget({ searches_used: 0, daily_limit: DAILY_SEARCH_LIMIT, last_updated: '' });
    }
  };

  useEffect(() => { loadApiBudget(); }, []);

  // Load matches from DB
  const loadMatches = async () => {
    if (isPoolSport) return;
    setIsLoading(true);
    try {
      // Fetch upcoming matches (next 14 days) + recent finished (last 7 days)
      // Two separate queries so upcoming always shows regardless of how many
      // finished matches exist in the DB.
      const now        = new Date();
      const thirtyDaysAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

      const [upcomingRes, finishedRes] = await Promise.all([
        supabase
          .from('betting_matches')
          .select('*')
          .eq('sport', selectedSport)
          .neq('status', 'budget_tracker')
          .gte('match_date', now.toISOString())
          .lte('match_date', fourteenAhead)
          .order('match_date', { ascending: true })
          .limit(50),
        supabase
          .from('betting_matches')
          .select('*')
          .eq('sport', selectedSport)
          .neq('status', 'budget_tracker')
          .gte('match_date', thirtyDaysAgo)
          .lt('match_date', now.toISOString())
          .order('match_date', { ascending: false })
          .limit(100),
      ]);

      const { data, error } = upcomingRes.error
        ? upcomingRes
        : { data: [...(upcomingRes.data || []), ...(finishedRes.data || [])], error: finishedRes.error };

      if (error) throw error;
      setMatches((data || []) as BettingMatch[]);

      // Load predictions + market recommendations for these matches
      if (data && data.length > 0) {
        const ids = data.map((m) => m.id);
        const [{ data: preds }, { data: recs }] = await Promise.all([
          supabase
            .from('betting_predictions')
            .select('*')
            .in('match_id', ids)
            .order('created_at', { ascending: false }),
          supabase
            .from('coupon_recommendations' as any)
            .select('*')
            .in('match_id', ids)
            .order('generated_at', { ascending: false }),
        ]);

        if (preds) {
          const predMap = new Map<string, BettingPrediction>();
          for (const p of preds) {
            const market = (p as any).market;
            if (market !== null && market !== undefined && market !== '1X2') continue;
            if (!predMap.has(p.match_id)) predMap.set(p.match_id, p as BettingPrediction);
          }
          setPredictions(predMap);
        }

        if (recs) {
          const recMap = new Map<string, CouponRecommendation[]>();
          for (const rec of (recs as unknown as CouponRecommendation[])) {
            const list = recMap.get(rec.match_id) || [];
            if (!list.find((x) => x.market === rec.market)) list.push(rec);
            recMap.set(rec.match_id, list);
          }
          setRecommendations(recMap);
        }
      }
    } catch (err) {
      toast({ title: 'Fel', description: 'Kunde inte ladda matcher.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch new matches from external API
  const handleFetchMatches = async () => {
    setIsFetching(true);
    // Reset the auto-sync cooldown so the next page load also re-fetches
    localStorage.setItem(`match_fetch_${selectedSport}`, String(Date.now()));
    try {
      const { data, error } = await supabase.functions.invoke('fetch-matches', {
        body: { sport: selectedSport === 'ufc' ? 'ufc' : 'football' },
      });

      if (error) throw error;

      // Surface API-key errors returned as success:false from the Edge Function
      if (data?.success === false && data?.error) {
        toast({
          title: 'Konfigurationsfel',
          description: data.error,
          variant: 'destructive',
        });
        return;
      }

      const count = data.inserted || 0;
      toast({
        title: count > 0 ? 'Matcher hämtade' : 'Inga nya matcher',
        description: count > 0
          ? `${count} nya matcher tillagda.`
          : 'Inga nya matcher i perioden, eller API-nyckeln saknas i Supabase Secrets.',
        variant: count > 0 ? 'default' : 'destructive',
      });

      await loadMatches();
    } catch (err) {
      toast({
        title: 'Fel',
        description: 'Kunde inte hämta matcher. Kontrollera att FOOTBALL_DATA_API_KEY är satt under Project Settings → Edge Functions → Secrets.',
        variant: 'destructive',
      });
    } finally {
      setIsFetching(false);
    }
  };

  // Analyze a specific match
  const handleAnalyze = async (matchId: string) => {
    if (!user) {
      toast({ title: 'Logga in', description: 'Du måste vara inloggad för att analysera matcher.', variant: 'destructive' });
      return;
    }

    setAnalyzingId(matchId);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-match', {
        body: { match_id: matchId },
      });

      if (error) throw error;

      if (data?.prediction) {
        setPredictions((prev) => new Map(prev).set(matchId, data.prediction as BettingPrediction));
        await supabase.functions.invoke('recommend_bets', { body: { match_id: matchId } });
        await loadMatches();
        toast({ title: 'Analys klar', description: 'AI-prediktion + marknadsrekommendationer genererade.' });
      }
    } catch (err) {
      toast({
        title: 'Analysfel',
        description: 'Kunde inte analysera matchen.',
        variant: 'destructive',
      });
    } finally {
      setAnalyzingId(null);
    }
  };

  // Save match to watchlist
  const handleSaveMatch = async (matchId: string, predictionId?: string) => {
    if (!user) {
      toast({ title: 'Logga in', description: 'Du måste vara inloggad för att spara.', variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase.from('betting_watchlist').insert({
        user_id: user.id,
        match_id: matchId,
        prediction_id: predictionId || null,
      });

      if (error) throw error;
      toast({ title: 'Sparad', description: 'Matchen sparad till din bevakning.' });
    } catch {
      toast({ title: 'Fel', description: 'Kunde inte spara matchen.', variant: 'destructive' });
    }
  };

  // Load pool tips
  const handleFetchPool = async (maxRows: number, budgetSek: number) => {
    if (!user) {
      toast({ title: 'Logga in', description: 'Du måste vara inloggad för att hämta tips.', variant: 'destructive' });
      return;
    }

    setIsLoadingPool(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-pool-tips', {
        body: { pool_type: selectedSport, max_rows: maxRows, budget_sek: budgetSek },
      });

      if (error) throw error;
      setPoolData(data);

      if (data?.rows?.length === 0) {
        toast({ title: 'Ingen omgång', description: data.message || 'Ingen aktiv omgång just nu.', variant: 'destructive' });
      } else {
        toast({ title: 'Tips hämtade', description: `${data.rows?.length} matcher analyserade.` });
      }
    } catch {
      toast({ title: 'Fel', description: 'Kunde inte hämta pool-tips.', variant: 'destructive' });
    } finally {
      setIsLoadingPool(false);
    }
  };

  // Reload when sport changes — auto-fetch upcoming matches in background if stale (> 2h)
  useEffect(() => {
    if (isPoolSport) { setMatches([]); return; }

    setPoolData(null);
    setSelectedLeague('all');

    const init = async () => {
      await loadMatches(); // Show whatever is in DB immediately

      const key = `match_fetch_${selectedSport}`;
      const lastFetch = parseInt(localStorage.getItem(key) || '0');
      const staleMs = 2 * 60 * 60 * 1000; // 2 hours
      if (Date.now() - lastFetch < staleMs) return; // recent enough, skip

      // Background fetch
      localStorage.setItem(key, String(Date.now()));
      setIsAutoSyncing(true);
      try {
        await supabase.functions.invoke('fetch-matches', {
          body: { sport: selectedSport === 'ufc' ? 'ufc' : 'football' },
        });
        await loadMatches(); // Reload with fresh upcoming matches
      } catch {
        // Fail silently — user can always click "Hämta matcher" manually
      } finally {
        setIsAutoSyncing(false);
      }
    };

    init();
  }, [selectedSport]);

  // Extract unique leagues and filter
  const leagues = [...new Set(matches.map(m => m.league))];
  const filteredMatches = selectedLeague === 'all'
    ? matches
    : matches.filter(m => m.league === selectedLeague);

  // Split into upcoming and finished — the DB query already separates them by date,
  // but filteredMatches may mix them after the league filter, so re-split here.
  const nowTs = Date.now();
  const isMatchPlayed = (m: BettingMatch) => {
    if (m.status === 'FINISHED' || m.status === 'finished') return true;
    return new Date(m.match_date).getTime() < nowTs;
  };
  const upcomingMatchesRaw = filteredMatches
    .filter(m => !isMatchPlayed(m))
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());
  const hasSelectedMarketEdge = (matchId: string) => {
    const recs = recommendations.get(matchId) || [];
    const marketRecs = selectedMarket === 'ALL' ? recs : recs.filter((r) => r.market === selectedMarket);
    return marketRecs.some((r) => r.is_valid);
  };

  const upcomingMatches = showOnlyValueBets
    ? upcomingMatchesRaw.filter((m) => hasSelectedMarketEdge(m.id) || predictions.get(m.id)?.is_value_bet === true)
    : upcomingMatchesRaw;
  const valueBetCount = upcomingMatchesRaw.filter((m) => hasSelectedMarketEdge(m.id)).length;
  const finishedMatches = filteredMatches
    .filter(m => isMatchPlayed(m))
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime());

  const [showFinished, setShowFinished] = useState(false);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
        <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-destructive">Spela ansvarsfullt</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-prediktioner är inte garantier. Spel med förnuft. Stödlinje: 020-81 91 00.
          </p>
        </div>
      </div>

      {/* API Budget */}
      {apiBudget && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
          <Database className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Firecrawl-budget idag</p>
              <span className="text-xs font-semibold">
                {apiBudget.searches_used} / {apiBudget.daily_limit} sökningar
              </span>
            </div>
            {apiBudget.searches_used === 0 && !apiBudget.last_updated ? (
              <p className="text-xs text-muted-foreground mt-1">Inga sökningar registrerade idag</p>
            ) : (
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    apiBudget.searches_used > apiBudget.daily_limit - 2 ? 'bg-destructive' : apiBudget.searches_used > apiBudget.daily_limit - 5 ? 'bg-yellow-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(100, (apiBudget.searches_used / apiBudget.daily_limit) * 100)}%` }}
                />
              </div>
            )}
            {apiBudget.last_updated && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Senast: {new Date(apiBudget.last_updated).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="glass-card rounded-xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Välj sport</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {sportOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedSport(opt.id)}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                selectedSport === opt.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <opt.icon className="w-4 h-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* League filter */}
      {!isPoolSport && leagues.length > 1 && (
        <div className="glass-card rounded-xl p-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedLeague('all')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                selectedLeague === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              Alla ({matches.length})
            </button>
            {leagues.map(league => (
              <button
                key={league}
                onClick={() => setSelectedLeague(league)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  selectedLeague === league
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/50 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {league} ({matches.filter(m => m.league === league).length})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Match view */}
      {!isPoolSport && (
        <>
           <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {selectedSport === 'football' ? 'Fotbollsmatcher' : 'UFC / MMA-matcher'}
            </h2>
            <div className="flex items-center gap-3">
              <MarketPicker value={selectedMarket} onChange={setSelectedMarket} />
              {valueBetCount > 0 && <ValueFilter checked={showOnlyValueBets} onCheckedChange={setShowOnlyValueBets} />}
              {isAutoSyncing && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Synkar...
                </span>
              )}
              <Button
                onClick={handleFetchMatches}
                disabled={isFetching || isAutoSyncing}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isFetching ? 'Hämtar...' : 'Hämta matcher'}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : matches.length === 0 ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
              <h3 className="text-lg font-semibold mb-2">Inga matcher hämtade ännu</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Klicka på "Hämta matcher" för att ladda kommande matcher från football-data.org.
              </p>
              <Button onClick={handleFetchMatches} disabled={isFetching} className="gap-2">
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Hämta matcher
              </Button>
            </div>
          ) : (
            <>
              {upcomingMatches.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {upcomingMatches.map((match) => {
                    const recs = recommendations.get(match.id) || [];
                    const filteredRecs = (selectedMarket === 'ALL' ? recs : recs.filter((r) => r.market === selectedMarket))
                      .filter((r) => !showOnlyValueBets || r.is_valid);
                    return (
                      <div key={match.id} className="space-y-3">
                        <MatchCard
                          match={match}
                          prediction={predictions.get(match.id)}
                          isAnalyzing={analyzingId === match.id}
                          onAnalyze={() => handleAnalyze(match.id)}
                          onSave={() => handleSaveMatch(match.id, predictions.get(match.id)?.id)}
                          isLoggedIn={!!user}
                        />
                        {filteredRecs.map((rec) => (
                          <BettingCard key={`${match.id}-${rec.market}`} match={match} recommendation={rec} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {upcomingMatches.length === 0 && finishedMatches.length > 0 && (
                <div className="glass-card rounded-xl p-8 text-center">
                  <p className="text-sm text-muted-foreground">Inga kommande matcher just nu. Se avslutade nedan.</p>
                </div>
              )}
              {finishedMatches.length > 0 && (
                <Collapsible open={showFinished} onOpenChange={setShowFinished}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 w-full p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors text-sm font-medium text-muted-foreground">
                      <History className="w-4 h-4" />
                      Avslutade matcher ({finishedMatches.length}) — för ROI-uppföljning
                      <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showFinished ? 'rotate-180' : ''}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid gap-4 sm:grid-cols-2 mt-4">
                      {finishedMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={match}
                          prediction={predictions.get(match.id)}
                          isAnalyzing={analyzingId === match.id}
                          onAnalyze={() => handleAnalyze(match.id)}
                          onSave={() => handleSaveMatch(match.id, predictions.get(match.id)?.id)}
                          isLoggedIn={!!user}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </>
      )}

      {/* Pool view */}
      {isPoolSport && (
        <PoolTipsCard
          poolType={selectedSport as 'topptipset' | 'stryktipset'}
          poolData={poolData}
          isLoading={isLoadingPool}
          onFetch={handleFetchPool}
          isLoggedIn={!!user}
          userId={user?.id}
        />
      )}

      {/* Backtest panel */}
      <BacktestPanel />
    </div>
  );
};

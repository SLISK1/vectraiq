import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MatchCard } from '@/components/betting/MatchCard';
import { PoolTipsCard } from '@/components/betting/PoolTipsCard';
import { BacktestPanel } from '@/components/betting/BacktestPanel';
import { AlertTriangle, Trophy, Swords, RefreshCw, Loader2, Dumbbell, ListOrdered, Database, ChevronDown, History, TrendingUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

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
  source_data: any;
};

type BettingPrediction = {
  id: string;
  match_id: string;
  predicted_winner: string;
  predicted_prob: number;
  confidence_raw: number;
  confidence_capped: number;
  cap_reason: string | null;
  key_factors: any;
  ai_reasoning: string | null;
  sources_used: any;
  market_odds_home: number | null;
  market_odds_draw: number | null;
  market_odds_away: number | null;
  market_implied_prob: number | null;
  model_edge: number | null;
  is_value_bet: boolean | null;
  suggested_stake_pct: number | null;
  created_at: string;
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
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [poolData, setPoolData] = useState<any>(null);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [showOnlyValueBets, setShowOnlyValueBets] = useState(false);
  const [apiBudget, setApiBudget] = useState<{ searches_used: number; last_updated: string } | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();

  const isPoolSport = selectedSport === 'topptipset' || selectedSport === 'stryktipset';

  // Load API budget from api_usage_tracker
  const loadApiBudget = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('api_usage_tracker')
      .select('searches_used, last_updated')
      .eq('category', 'betting')
      .eq('date_key', todayStr)
      .single();
    if (data) {
      setApiBudget(data as any);
    } else {
      setApiBudget({ searches_used: 0, last_updated: '' });
    }
  };

  useEffect(() => { loadApiBudget(); }, []);

  // Load matches from DB
  const loadMatches = async () => {
    if (isPoolSport) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('betting_matches')
        .select('*')
        .eq('sport', selectedSport)
        .neq('status', 'budget_tracker')
        .order('match_date', { ascending: false })
        .limit(60);

      if (error) throw error;
      setMatches((data || []) as BettingMatch[]);

      // Load predictions for these matches
      if (data && data.length > 0) {
        const ids = data.map((m) => m.id);
        const { data: preds } = await supabase
          .from('betting_predictions')
          .select('*')
          .in('match_id', ids)
          .order('created_at', { ascending: false });

        if (preds) {
          const predMap = new Map<string, BettingPrediction>();
          // Keep latest prediction per match
          for (const p of preds) {
            if (!predMap.has(p.match_id)) {
              predMap.set(p.match_id, p as BettingPrediction);
            }
          }
          setPredictions(predMap);
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
    try {
      const { data, error } = await supabase.functions.invoke('fetch-matches', {
        body: { sport: selectedSport === 'ufc' ? 'ufc' : 'football' },
      });

      if (error) throw error;

      toast({
        title: 'Matcher hämtade',
        description: `${data.inserted || 0} nya matcher tillagda.`,
      });

      await loadMatches();
    } catch (err) {
      toast({
        title: 'Fel',
        description: 'Kunde inte hämta matcher. Kontrollera API-nyckeln.',
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
        toast({ title: 'Analys klar', description: 'AI-prediktion genererad.' });
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

  // Reload when sport changes
  useEffect(() => {
    if (!isPoolSport) {
      loadMatches();
      setPoolData(null);
      setSelectedLeague('all');
    } else {
      setMatches([]);
    }
  }, [selectedSport]);

  // Extract unique leagues and filter
  const leagues = [...new Set(matches.map(m => m.league))];
  const filteredMatches = selectedLeague === 'all'
    ? matches
    : matches.filter(m => m.league === selectedLeague);

  // Split into upcoming and finished/played
  // A match is considered "played" if status is FINISHED or match_date is in the past
  const now = new Date();
  const isMatchPlayed = (m: BettingMatch) => {
    if (m.status === 'FINISHED' || m.status === 'finished') return true;
    return new Date(m.match_date) < now;
  };
  const upcomingMatchesRaw = filteredMatches
    .filter(m => !isMatchPlayed(m))
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());
  const upcomingMatches = showOnlyValueBets
    ? upcomingMatchesRaw.filter(m => predictions.get(m.id)?.is_value_bet === true)
    : upcomingMatchesRaw;
  const valueBetCount = upcomingMatchesRaw.filter(m => predictions.get(m.id)?.is_value_bet === true).length;
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
                {apiBudget.searches_used} / 15 sökningar
              </span>
            </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  apiBudget.searches_used > 13 ? 'bg-destructive' : apiBudget.searches_used > 10 ? 'bg-yellow-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, (apiBudget.searches_used / 15) * 100)}%` }}
              />
            </div>
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
              {valueBetCount > 0 && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="value-filter"
                    checked={showOnlyValueBets}
                    onCheckedChange={setShowOnlyValueBets}
                  />
                  <Label htmlFor="value-filter" className="text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap">
                    <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                    Value ({valueBetCount})
                  </Label>
                </div>
              )}
              <Button
                onClick={handleFetchMatches}
                disabled={isFetching}
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
                  {upcomingMatches.map((match) => (
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

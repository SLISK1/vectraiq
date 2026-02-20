import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { MatchCard } from '@/components/betting/MatchCard';
import { PoolTipsCard } from '@/components/betting/PoolTipsCard';
import { BacktestPanel } from '@/components/betting/BacktestPanel';
import { AlertTriangle, Trophy, Swords, RefreshCw, Loader2, Dumbbell, ListOrdered } from 'lucide-react';

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

  const { user } = useAuth();
  const { toast } = useToast();

  const isPoolSport = selectedSport === 'topptipset' || selectedSport === 'stryktipset';

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
        .order('match_date', { ascending: true })
        .limit(30);

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
    } else {
      setMatches([]);
    }
  }, [selectedSport]);

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

      {/* Sport Selector */}
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

      {/* Match view */}
      {!isPoolSport && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {selectedSport === 'football' ? 'Fotbollsmatcher' : 'UFC / MMA-matcher'}
            </h2>
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
            <div className="grid gap-4 sm:grid-cols-2">
              {matches.map((match) => (
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

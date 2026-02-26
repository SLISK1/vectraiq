import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MatchDetailModal, SideBetOutcome } from './MatchDetailModal';
import { PredictionSection } from './PredictionSection';
import { Loader2, Bookmark, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Match {
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
}

interface Prediction {
  id: string;
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
}

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onSave: () => void;
  isLoggedIn: boolean;
}

export const MatchCard = ({ match, prediction, isAnalyzing, onAnalyze, onSave, isLoggedIn }: MatchCardProps) => {
  const [showDetail, setShowDetail] = useState(false);
  const [sideBetOutcomes, setSideBetOutcomes] = useState<SideBetOutcome[]>([]);
  const isValueBet = prediction?.is_value_bet === true;

  const handleShowDetail = async () => {
    setShowDetail(true);
    if (prediction?.id) {
      const { data } = await (supabase as any)
        .from('betting_predictions')
        .select('market, line, selection, bet_outcome')
        .eq('match_id', match.id)
        .not('market', 'is', null)
        .neq('market', '1X2');
      if (data) setSideBetOutcomes(data as SideBetOutcome[]);
    }
  };
  const hasNegativeEdge = prediction && prediction.model_edge !== null && prediction.model_edge < 0;

  const matchDate = new Date(match.match_date);
  const dateStr = matchDate.toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = matchDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  const getStatusBadge = () => {
    if (match.status === 'live') return <Badge className="bg-destructive/20 text-destructive border-destructive/30 animate-pulse">● LIVE</Badge>;
    if (match.status === 'finished') return <Badge variant="outline" className="text-muted-foreground">Avslutad</Badge>;
    return null;
  };

  return (
    <>
      <div className={`glass-card rounded-xl p-5 flex flex-col gap-4 border transition-all ${
        isValueBet ? 'border-green-500/50 bg-green-500/5' : hasNegativeEdge ? 'border-border/30 opacity-60' : 'border-border/50 hover:border-primary/30'
      }`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <Badge variant="outline" className="text-xs w-fit">{match.league}</Badge>
            <p className="text-xs text-muted-foreground">{dateStr} · {timeStr}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {isValueBet && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                <TrendingUp className="w-3 h-3" />
                VALUE
              </Badge>
            )}
            {getStatusBadge()}
            {match.status === 'finished' && match.home_score !== null && (
              <span className="text-sm font-mono font-bold">{match.home_score} – {match.away_score}</span>
            )}
          </div>
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 text-center">
            <p className="font-bold text-base leading-tight">{match.home_team}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Hemma</p>
          </div>
          <div className="text-muted-foreground font-bold text-sm px-2">vs</div>
          <div className="flex-1 text-center">
            <p className="font-bold text-base leading-tight">{match.away_team}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Borta</p>
          </div>
        </div>

        {/* Prediction section */}
        {prediction && (
          <PredictionSection
            prediction={prediction}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            onShowDetail={handleShowDetail}
          />
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          {!prediction && (
            <Button onClick={onAnalyze} disabled={isAnalyzing} size="sm" className="flex-1 gap-2">
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isAnalyzing ? 'Analyserar...' : 'Analysera'}
            </Button>
          )}
          {prediction && (
            <Button onClick={handleShowDetail} size="sm" variant="outline" className="flex-1">
              Detaljer
            </Button>
          )}
          {isLoggedIn && (
            <Button onClick={onSave} size="sm" variant="ghost" className="gap-1.5">
              <Bookmark className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {showDetail && prediction && (
        <MatchDetailModal
          match={match}
          prediction={prediction}
          onClose={() => setShowDetail(false)}
          sideBetOutcomes={sideBetOutcomes}
        />
      )}
    </>
  );
};

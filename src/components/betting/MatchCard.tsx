import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScoreRing } from '@/components/ScoreRing';
import { MatchDetailModal } from './MatchDetailModal';
import { Loader2, Bookmark, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

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

  const matchDate = new Date(match.match_date);
  const dateStr = matchDate.toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = matchDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  const getWinnerLabel = () => {
    if (!prediction) return null;
    if (prediction.predicted_winner === 'home') return match.home_team;
    if (prediction.predicted_winner === 'away') return match.away_team;
    return 'Oavgjort';
  };

  const getWinnerColor = () => {
    if (!prediction) return '';
    if (prediction.predicted_winner === 'home') return 'bg-primary/20 text-primary border-primary/30';
    if (prediction.predicted_winner === 'away') return 'bg-destructive/20 text-destructive border-destructive/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  const edge = prediction?.model_edge;
  const isCapped = prediction && prediction.confidence_capped < prediction.confidence_raw;

  const getStatusBadge = () => {
    if (match.status === 'live') return <Badge className="bg-destructive/20 text-destructive border-destructive/30 animate-pulse">● LIVE</Badge>;
    if (match.status === 'finished') return <Badge variant="outline" className="text-muted-foreground">Avslutad</Badge>;
    return null;
  };

  return (
    <>
      <div className="glass-card rounded-xl p-5 flex flex-col gap-4 border border-border/50 hover:border-primary/30 transition-all">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <Badge variant="outline" className="text-xs w-fit">{match.league}</Badge>
            <p className="text-xs text-muted-foreground">{dateStr} · {timeStr}</p>
          </div>
          <div className="flex items-center gap-1">
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
        {prediction ? (
          <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ScoreRing
                  score={prediction.confidence_capped}
                  direction={prediction.predicted_winner === 'home' ? 'UP' : prediction.predicted_winner === 'away' ? 'DOWN' : 'NEUTRAL'}
                  size="sm"
                />
                <div>
                  <Badge className={`text-xs border ${getWinnerColor()}`}>
                    {getWinnerLabel()}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.round(prediction.predicted_prob * 100)}% sannolikhet
                  </p>
                </div>
              </div>

              {/* Market Edge */}
              {edge !== null && edge !== undefined && (
                <div className={`text-right ${edge > 0 ? 'text-primary' : 'text-destructive'}`}>
                  <div className="flex items-center gap-1 justify-end">
                    {edge > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    <span className="text-sm font-bold">{edge > 0 ? '+' : ''}{Math.round(edge * 100)}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">edge vs marknad</p>
                </div>
              )}
            </div>

            {/* Market odds row */}
            {prediction.market_odds_home && (
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>1: {prediction.market_odds_home.toFixed(2)}</span>
                {prediction.market_odds_draw && <span>X: {prediction.market_odds_draw.toFixed(2)}</span>}
                <span>2: {prediction.market_odds_away?.toFixed(2)}</span>
                {prediction.market_implied_prob && (
                  <span className="ml-auto">Marknad: {Math.round(prediction.market_implied_prob * 100)}%</span>
                )}
              </div>
            )}

            {/* Cap warning */}
            {isCapped && prediction.cap_reason && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Begränsad data: {prediction.cap_reason}</span>
              </div>
            )}

            {/* Side prediction badges */}
            {(() => {
              const kf = prediction.key_factors as any;
              const sp = kf?.side_predictions || (kf && !Array.isArray(kf) ? kf : null)?.side_predictions;
              if (!sp) return null;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {sp.total_goals && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
                      ⚽ {sp.total_goals.prediction === 'over' ? 'Ö' : 'U'}{sp.total_goals.line} {Math.round(sp.total_goals.prob * 100)}%
                    </span>
                  )}
                  {sp.btts && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
                      🎯 BTTS {sp.btts.prediction === 'yes' ? 'Ja' : 'Nej'} {Math.round(sp.btts.prob * 100)}%
                    </span>
                  )}
                  {sp.corners && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
                      🚩 Hörnor {sp.corners.prediction === 'over' ? 'Ö' : 'U'}{sp.corners.line} {Math.round(sp.corners.prob * 100)}%
                    </span>
                  )}
                  {sp.cards && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
                      🟨 Kort {sp.cards.prediction === 'over' ? 'Ö' : 'U'}{sp.cards.line} {Math.round(sp.cards.prob * 100)}%
                    </span>
                  )}
                </div>
              );
            })()}

            <button
              onClick={() => setShowDetail(true)}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Se fullständig analys <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          {!prediction && (
            <Button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              size="sm"
              className="flex-1 gap-2"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isAnalyzing ? 'Analyserar...' : 'Analysera'}
            </Button>
          )}

          {prediction && (
            <Button
              onClick={() => setShowDetail(true)}
              size="sm"
              variant="outline"
              className="flex-1"
            >
              Detaljer
            </Button>
          )}

          {isLoggedIn && (
            <Button
              onClick={onSave}
              size="sm"
              variant="ghost"
              className="gap-1.5"
            >
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
        />
      )}
    </>
  );
};

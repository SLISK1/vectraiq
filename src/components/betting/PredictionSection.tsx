import { Badge } from '@/components/ui/badge';
import { ScoreRing } from '@/components/ScoreRing';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { SourceBadges } from './SourceBadges';
import { SidePredictions } from './SidePredictions';

interface Prediction {
  predicted_winner: string;
  predicted_prob: number;
  confidence_raw: number;
  confidence_capped: number;
  cap_reason: string | null;
  key_factors: any;
  sources_used: any;
  market_odds_home: number | null;
  market_odds_draw: number | null;
  market_odds_away: number | null;
  market_implied_prob: number | null;
  model_edge: number | null;
  is_value_bet?: boolean | null;
  suggested_stake_pct?: number | null;
}

interface PredictionSectionProps {
  prediction: Prediction;
  homeTeam: string;
  awayTeam: string;
  onShowDetail: () => void;
}

export const PredictionSection = ({ prediction, homeTeam, awayTeam, onShowDetail }: PredictionSectionProps) => {
  const getWinnerLabel = () => {
    if (prediction.predicted_winner === 'home') return homeTeam;
    if (prediction.predicted_winner === 'away') return awayTeam;
    return 'Oavgjort';
  };

  const getWinnerColor = () => {
    if (prediction.predicted_winner === 'home') return 'bg-primary/20 text-primary border-primary/30';
    if (prediction.predicted_winner === 'away') return 'bg-destructive/20 text-destructive border-destructive/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  const edge = prediction.model_edge;
  const isCapped = prediction.confidence_capped < prediction.confidence_raw;

  return (
    <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help focus:outline-none" aria-label="Vad betyder score?">
                  <ScoreRing
                    score={prediction.confidence_capped}
                    direction={prediction.predicted_winner === 'home' ? 'UP' : prediction.predicted_winner === 'away' ? 'DOWN' : 'NEUTRAL'}
                    size="sm"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                <p className="font-semibold mb-1">Score ≠ sannolikhet</p>
                <p>
                  <strong>Score (0–100)</strong> är modellens kvalitets­poäng för tipset
                  (edge, kalibrering, modul­tillförlitlighet och likviditet vägs samman).
                </p>
                <p className="mt-1">
                  <strong>Sannolikhet</strong> är estimerad chans att utfallet inträffar
                  ({Math.round(prediction.predicted_prob * 100)}% här). Två tips kan ha samma
                  sannolikhet men olika score om edge eller kalibrering skiljer.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <div className="flex items-center gap-1.5">
              <Badge className={`text-xs border ${getWinnerColor()}`}>
                {getWinnerLabel()}
              </Badge>
              {prediction.is_value_bet && (
                <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/40">
                  VALUE {prediction.suggested_stake_pct ? `· ${prediction.suggested_stake_pct.toFixed(2)}%` : ''}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {Math.round(prediction.predicted_prob * 100)}% sannolikhet
            </p>
          </div>
        </div>

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

      {isCapped && prediction.cap_reason && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>Begränsad data: {prediction.cap_reason}</span>
        </div>
      )}

      <SidePredictions keyFactors={prediction.key_factors} />
      <SourceBadges prediction={prediction} />

      <button
        onClick={onShowDetail}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
      >
        Se fullständig analys <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
};

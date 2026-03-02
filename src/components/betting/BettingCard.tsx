import { Badge } from '@/components/ui/badge';
import { OddsOverlay } from './OddsOverlay';

type Recommendation = {
  market: string;
  selection: string;
  edge: number;
  implied_prob: number;
  p_raw?: number | null;
  p_cal?: number | null;
  p_proxy?: number | null;
  suggested_stake_pct?: number | null;
  phase: number;
  is_valid: boolean;
  chaos_score: number;
};

export const BettingCard = ({
  match,
  recommendation,
}: {
  match: { home_team: string; away_team: string; league: string; match_date: string };
  recommendation: Recommendation;
}) => {
  return (
    <div className="glass-card rounded-xl p-4 border border-border/50 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{match.home_team} vs {match.away_team}</p>
          <p className="text-xs text-muted-foreground">{match.league} · {new Date(match.match_date).toLocaleString('sv-SE')}</p>
        </div>
        <div className="flex gap-1">
          <Badge variant="outline">{recommendation.market}</Badge>
          <Badge className={recommendation.is_valid ? 'bg-green-600/20 text-green-400' : ''}>Phase {recommendation.phase}</Badge>
        </div>
      </div>

      <div className="text-sm">
        Spel: <strong>{recommendation.selection.toUpperCase()}</strong> · ChaosScore <strong>{recommendation.chaos_score}</strong>
      </div>

      <OddsOverlay
        implied={recommendation.implied_prob}
        pRaw={recommendation.p_raw}
        pCal={recommendation.p_cal ?? recommendation.p_proxy}
        edge={recommendation.edge}
      />

      <p className="text-xs text-muted-foreground">
        Föreslagen insats: <strong>{recommendation.suggested_stake_pct ? `${recommendation.suggested_stake_pct.toFixed(2)}%` : '—'}</strong>
      </p>
    </div>
  );
};

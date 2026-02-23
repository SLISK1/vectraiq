interface SidePredictionsProps {
  keyFactors: any;
}

const EdgeTag = ({ value }: { value: number | null | undefined }) => {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <span className={`font-bold ${value > 0 ? 'text-primary' : 'text-destructive'}`}>
      {value > 0 ? '+' : ''}{pct}%
    </span>
  );
};

export const SidePredictions = ({ keyFactors }: SidePredictionsProps) => {
  const kf = keyFactors as any;
  const sp = kf?.side_predictions || (kf && !Array.isArray(kf) ? kf : null)?.side_predictions;
  const se = kf?.side_edges as Record<string, number> | null;
  if (!sp) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {sp.total_goals && (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground flex items-center gap-1">
          ⚽ {sp.total_goals.prediction === 'over' ? 'Ö' : 'U'}{sp.total_goals.line} {Math.round(sp.total_goals.prob * 100)}%
          <EdgeTag value={se?.total_goals} />
        </span>
      )}
      {sp.btts && (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground flex items-center gap-1">
          🎯 BTTS {sp.btts.prediction === 'yes' ? 'Ja' : 'Nej'} {Math.round(sp.btts.prob * 100)}%
          <EdgeTag value={se?.btts} />
        </span>
      )}
      {sp.first_half_goals && (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
          ⏱️ 1H {sp.first_half_goals.prediction === 'over' ? 'Ö' : 'U'}{sp.first_half_goals.line} {Math.round(sp.first_half_goals.prob * 100)}%
        </span>
      )}
      {sp.exact_score && (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground">
          📊 {sp.exact_score.home}–{sp.exact_score.away} {Math.round(sp.exact_score.prob * 100)}%
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
};

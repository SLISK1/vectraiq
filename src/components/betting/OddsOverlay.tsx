export const OddsOverlay = ({ implied, pRaw, pCal, edge }: { implied: number; pRaw?: number | null; pCal?: number | null; edge: number }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-muted/30 border border-border/50 rounded-md p-2">
      <span>Implied: <strong>{Math.round(implied * 100)}%</strong></span>
      <span>p_raw: <strong>{pRaw !== null && pRaw !== undefined ? `${Math.round(pRaw * 100)}%` : '—'}</strong></span>
      <span>p_cal: <strong>{pCal !== null && pCal !== undefined ? `${Math.round(pCal * 100)}%` : '—'}</strong></span>
      <span className={edge >= 0 ? 'text-primary' : 'text-destructive'}>Edge: <strong>{edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%</strong></span>
    </div>
  );
};

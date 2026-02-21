import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScoreRing } from '@/components/ScoreRing';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, TrendingUp, TrendingDown, ExternalLink, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface Match {
  home_team: string;
  away_team: string;
  league: string;
  match_date: string;
  sport: string;
}

interface Prediction {
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
}

interface MatchDetailModalProps {
  match: Match;
  prediction: Prediction;
  onClose: () => void;
}

const SOURCE_TYPE_STYLES: Record<string, string> = {
  confirmed_fact: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  stats: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  opinion: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  news: 'bg-muted text-muted-foreground border-border',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  confirmed_fact: 'Fakta',
  stats: 'Statistik',
  opinion: 'Opinion',
  news: 'Nyhet',
};

const SideMarketItem = ({ emoji, label, prob, reasoning, edge }: { emoji: string; label: string; prob: number; reasoning?: string; edge?: number | null }) => (
  <div className="flex items-start gap-2 p-2 rounded-lg bg-background/50">
    <span className="text-lg">{emoji}</span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        {edge !== null && edge !== undefined && (
          <span className={`text-xs font-bold ${edge > 0 ? 'text-primary' : 'text-destructive'}`}>
            Edge: {edge > 0 ? '+' : ''}{Math.round(edge * 100)}%
          </span>
        )}
      </div>
      <p className="text-xs text-primary font-bold">{Math.round(prob * 100)}%</p>
      {reasoning && <p className="text-xs text-muted-foreground mt-0.5">{reasoning}</p>}
    </div>
  </div>
);

export const MatchDetailModal = ({ match, prediction, onClose }: MatchDetailModalProps) => {
  const [keyFactorsOpen, setKeyFactorsOpen] = useState(true);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const matchDate = new Date(match.match_date);
  const dateStr = matchDate.toLocaleDateString('sv-SE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const getWinnerLabel = () => {
    if (prediction.predicted_winner === 'home') return match.home_team;
    if (prediction.predicted_winner === 'away') return match.away_team;
    return 'Oavgjort';
  };

  const winnerDirection = prediction.predicted_winner === 'home' ? 'UP' :
    prediction.predicted_winner === 'away' ? 'DOWN' : 'NEUTRAL';

  const edge = prediction.model_edge;
  const isCapped = prediction.confidence_capped < prediction.confidence_raw;

  const rawKf = prediction.key_factors;
  const keyFactors: any[] = Array.isArray(rawKf) ? rawKf : (rawKf?.factors || []);
  const sidePredictions = !Array.isArray(rawKf) ? rawKf?.side_predictions : null;
  const sideEdges: Record<string, number> | null = !Array.isArray(rawKf) ? rawKf?.side_edges || null : null;
  const sourcesUsed: any[] = Array.isArray(prediction.sources_used) ? prediction.sources_used : [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">{match.league}</Badge>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <DialogTitle className="text-xl">
            {match.home_team} <span className="text-muted-foreground font-normal">vs</span> {match.away_team}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prediction Summary */}
          <div className="rounded-xl bg-muted/30 border border-border/50 p-4">
            <div className="flex items-center gap-4">
              <ScoreRing
                score={prediction.confidence_capped}
                direction={winnerDirection}
                size="lg"
              />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">Prediktion</p>
                <p className="text-xl font-bold">{getWinnerLabel()}</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round(prediction.predicted_prob * 100)}% modellsannolikhet
                </p>
                {isCapped && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                    <AlertTriangle className="w-3 h-3" />
                    Confidence begränsad till {prediction.confidence_capped}%
                    {prediction.cap_reason && ` — ${prediction.cap_reason}`}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Odds Comparison */}
          {(prediction.market_odds_home || prediction.market_implied_prob) && (
            <div className="rounded-xl bg-muted/30 border border-border/50 p-4 space-y-3">
              <h3 className="text-sm font-semibold">Odds & Market Edge</h3>

              {prediction.market_odds_home && (
                <div className="flex gap-3 text-sm">
                  <div className="flex-1 text-center">
                    <p className="text-muted-foreground text-xs">1 (Hemma)</p>
                    <p className="font-mono font-bold">{prediction.market_odds_home.toFixed(2)}</p>
                  </div>
                  {prediction.market_odds_draw && (
                    <div className="flex-1 text-center">
                      <p className="text-muted-foreground text-xs">X (Oavgjort)</p>
                      <p className="font-mono font-bold">{prediction.market_odds_draw.toFixed(2)}</p>
                    </div>
                  )}
                  <div className="flex-1 text-center">
                    <p className="text-muted-foreground text-xs">2 (Borta)</p>
                    <p className="font-mono font-bold">{prediction.market_odds_away?.toFixed(2)}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Modell: {Math.round(prediction.predicted_prob * 100)}%</span>
                {prediction.market_implied_prob && (
                  <span className="text-muted-foreground">Marknad: {Math.round(prediction.market_implied_prob * 100)}%</span>
                )}
                {edge !== null && edge !== undefined && (
                  <div className={`flex items-center gap-1 font-bold ${edge > 0 ? 'text-primary' : 'text-destructive'}`}>
                    {edge > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    Edge: {edge > 0 ? '+' : ''}{Math.round(edge * 100)}%
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Side Predictions */}
          {sidePredictions && (
            <div className="rounded-xl bg-muted/30 border border-border/50 p-4 space-y-3">
              <h3 className="text-sm font-semibold">Sidomarknader</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sidePredictions.total_goals && (
                  <SideMarketItem
                    emoji="⚽"
                    label={`Mål ${sidePredictions.total_goals.prediction === 'over' ? 'Över' : 'Under'} ${sidePredictions.total_goals.line}`}
                    prob={sidePredictions.total_goals.prob}
                    reasoning={sidePredictions.total_goals.reasoning}
                    edge={sideEdges?.total_goals}
                  />
                )}
                {sidePredictions.btts && (
                  <SideMarketItem
                    emoji="🎯"
                    label={`BTTS ${sidePredictions.btts.prediction === 'yes' ? 'Ja' : 'Nej'}`}
                    prob={sidePredictions.btts.prob}
                    reasoning={sidePredictions.btts.reasoning}
                    edge={sideEdges?.btts}
                  />
                )}
                {sidePredictions.corners && (
                  <SideMarketItem
                    emoji="🚩"
                    label={`Hörnor ${sidePredictions.corners.prediction === 'over' ? 'Över' : 'Under'} ${sidePredictions.corners.line}`}
                    prob={sidePredictions.corners.prob}
                    reasoning={sidePredictions.corners.reasoning}
                  />
                )}
                {sidePredictions.cards && (
                  <SideMarketItem
                    emoji="🟨"
                    label={`Kort ${sidePredictions.cards.prediction === 'over' ? 'Över' : 'Under'} ${sidePredictions.cards.line}`}
                    prob={sidePredictions.cards.prob}
                    reasoning={sidePredictions.cards.reasoning}
                  />
                )}
                {sidePredictions.first_half_goals && (
                  <SideMarketItem
                    emoji="⏱️"
                    label={`1:a halvlek ${sidePredictions.first_half_goals.prediction === 'over' ? 'Ö' : 'U'}${sidePredictions.first_half_goals.line} mål`}
                    prob={sidePredictions.first_half_goals.prob}
                    reasoning={sidePredictions.first_half_goals.reasoning}
                  />
                )}
                {sidePredictions.first_to_score && (
                  <SideMarketItem
                    emoji="🥇"
                    label={`Första mål: ${sidePredictions.first_to_score.prediction === 'home' ? match.home_team : sidePredictions.first_to_score.prediction === 'away' ? match.away_team : 'Ingen'}`}
                    prob={sidePredictions.first_to_score.prob}
                    reasoning={sidePredictions.first_to_score.reasoning}
                  />
                )}
                {sidePredictions.exact_score && (
                  <SideMarketItem
                    emoji="📊"
                    label={`Exakt resultat: ${sidePredictions.exact_score.home}–${sidePredictions.exact_score.away}`}
                    prob={sidePredictions.exact_score.prob}
                    reasoning={sidePredictions.exact_score.reasoning}
                  />
                )}
              </div>
            </div>
          )}

          {/* Key Factors */}
          {keyFactors.length > 0 && (
            <Collapsible open={keyFactorsOpen} onOpenChange={setKeyFactorsOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full rounded-xl bg-muted/30 border border-border/50 p-4">
                <h3 className="text-sm font-semibold">Nyckelfaktorer ({keyFactors.length})</h3>
                <ChevronDown className={`w-4 h-4 transition-transform ${keyFactorsOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border border-t-0 border-border/50 rounded-b-xl p-4 space-y-3">
                  {keyFactors.map((factor: any, i: number) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className={`mt-1 flex-shrink-0 ${factor.direction === 'positive' ? 'text-green-400' : factor.direction === 'negative' ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {factor.direction === 'positive' ? <TrendingUp className="w-4 h-4" /> :
                          factor.direction === 'negative' ? <TrendingDown className="w-4 h-4" /> :
                            <span className="text-sm">—</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{factor.factor}</p>
                        {factor.source && (
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-xs ${SOURCE_TYPE_STYLES[factor.source.type] || SOURCE_TYPE_STYLES.news}`}
                            >
                              {SOURCE_TYPE_LABELS[factor.source.type] || factor.source.type}
                            </Badge>
                            {factor.source.date && (
                              <span className="text-xs text-muted-foreground">{factor.source.date}</span>
                            )}
                            {factor.source.url && factor.source.url.startsWith('http') && (
                              <a
                                href={factor.source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                Källa <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* AI Reasoning */}
          {prediction.ai_reasoning && (
            <Collapsible open={reasoningOpen} onOpenChange={setReasoningOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full rounded-xl bg-muted/30 border border-border/50 p-4">
                <h3 className="text-sm font-semibold">AI-analys</h3>
                <ChevronDown className={`w-4 h-4 transition-transform ${reasoningOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border border-t-0 border-border/50 rounded-b-xl p-4">
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {prediction.ai_reasoning}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Sources */}
          {sourcesUsed.length > 0 && (
            <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full rounded-xl bg-muted/30 border border-border/50 p-4">
                <h3 className="text-sm font-semibold">Källor ({sourcesUsed.length})</h3>
                <ChevronDown className={`w-4 h-4 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border border-t-0 border-border/50 rounded-b-xl p-4 space-y-2">
                  {sourcesUsed.map((source: any, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={`text-xs flex-shrink-0 mt-0.5 ${SOURCE_TYPE_STYLES[source.type] || SOURCE_TYPE_STYLES.news}`}
                      >
                        {SOURCE_TYPE_LABELS[source.type] || source.type}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs text-foreground line-clamp-1">{source.title || source.url}</p>
                        {source.url && source.url.startsWith('http') && (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                          >
                            Öppna <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Footer disclaimer */}
          <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
            AI-prediktioner är inte garantier. Spela ansvarsfullt.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

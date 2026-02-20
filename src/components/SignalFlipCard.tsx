import { ModuleSignal, Direction, MODULE_NAMES } from '@/types/market';
import { cn } from '@/lib/utils';
import { ArrowUpCircle, ArrowDownCircle, HelpCircle, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface SignalFlipCardProps {
  signals: ModuleSignal[];
  direction: Direction;
  assetType: 'stock' | 'crypto' | 'metal';
  className?: string;
}

// Per-module "what would flip the signal" descriptions
const FLIP_CONDITIONS: Record<string, Record<Direction, string>> = {
  technical: {
    UP: 'RSI > 70 + negativ MACD-korsning + brott under SMA20',
    DOWN: 'RSI < 30 + positiv MACD-korsning + SMA20 bryter upp',
    NEUTRAL: 'Tydlig trend uppstår (RSI < 30 eller > 70)',
  },
  fundamental: {
    UP: 'P/E > 30 eller earnings miss > 10% eller negativ FCF',
    DOWN: 'P/E under sektormedel + stigande ROE + stark FCF',
    NEUTRAL: 'Fundamental data förbättras eller försämras markant',
  },
  quant: {
    UP: '20d momentum vänder negativt (< -5%)',
    DOWN: '20d momentum vänder positivt (> +5%)',
    NEUTRAL: 'Momentum > 5% eller < -5%',
  },
  volatility: {
    UP: 'Annualiserad vol > 50% (risk-off regime)',
    DOWN: 'Volatilitet normaliseras under 25%',
    NEUTRAL: 'Volatilitetsregim förändras',
  },
  macro: {
    UP: 'Riksbanken höjer räntan > 4.5% eller recession signal',
    DOWN: 'Riksbanken sänker räntan < 2% + stabil tillväxt',
    NEUTRAL: 'Makroregim förskjuts i en riktning',
  },
  sentiment: {
    UP: 'Negativ nyhetsflöde + 5d prismomentum < -3%',
    DOWN: 'Positiva nyheter + 5d prismomentum > +3%',
    NEUTRAL: 'Sentiment polariseras tydligt',
  },
  seasonal: {
    UP: 'Säsongsmönster vänder (nästa kvartal historiskt svagt)',
    DOWN: 'Säsongsmönster vänder (nästa kvartal historiskt starkt)',
    NEUTRAL: 'Säsongseffekt tar slut',
  },
  orderFlow: {
    UP: 'Volym ökar på nedsidan (distribution)',
    DOWN: 'Volym ökar på uppsidan (ackumulation)',
    NEUTRAL: 'Tydligt volymmönster uppstår',
  },
  measuredMoves: {
    UP: 'Measured move target uppnått + reversal-pattern',
    DOWN: 'Ny bullish measured move formation',
    NEUTRAL: 'Measured move bildas',
  },
  ml: {
    UP: 'ML-modell identifierar bearish mönster i prishistorik',
    DOWN: 'ML-modell identifierar bullish mönster i prishistorik',
    NEUTRAL: 'ML-signal förstärks',
  },
};

export const SignalFlipCard = ({ signals, direction, assetType, className }: SignalFlipCardProps) => {
  const [expanded, setExpanded] = useState(false);

  // Top positive and negative contributors
  const sameDir = signals.filter(s => s.direction === direction).sort((a, b) => b.strength * b.weight - a.strength * a.weight);
  const oppositeDir = signals.filter(s => s.direction !== direction && s.direction !== 'NEUTRAL').sort((a, b) => b.strength * b.weight - a.strength * a.weight);

  const topPositive = sameDir[0];
  const topNegative = oppositeDir[0];

  const flipDir: Direction = direction === 'UP' ? 'DOWN' : direction === 'DOWN' ? 'UP' : 'NEUTRAL';

  return (
    <div className={cn('rounded-xl border border-border/50 overflow-hidden', className)}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 bg-muted/20 hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Signalanalys — Varför & vad skulle ändra åsikt?</span>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Top contributors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {topPositive && (
              <div className="p-3 rounded-lg bg-up/10 border border-up/20">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpCircle className="w-4 h-4 text-up" />
                  <span className="text-xs font-semibold text-up">Starkaste positiva signal</span>
                </div>
                <div className="text-sm font-medium">{MODULE_NAMES[topPositive.module] || topPositive.module}</div>
                {topPositive.evidence?.[0] && (
                  <div className="text-xs text-muted-foreground mt-1">{topPositive.evidence[0].description}</div>
                )}
              </div>
            )}
            {topNegative && (
              <div className="p-3 rounded-lg bg-down/10 border border-down/20">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownCircle className="w-4 h-4 text-down" />
                  <span className="text-xs font-semibold text-down">Starkaste negativa signal</span>
                </div>
                <div className="text-sm font-medium">{MODULE_NAMES[topNegative.module] || topNegative.module}</div>
                {topNegative.evidence?.[0] && (
                  <div className="text-xs text-muted-foreground mt-1">{topNegative.evidence[0].description}</div>
                )}
              </div>
            )}
          </div>

          {/* What would flip the signal */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Vad skulle vända signalen till {flipDir === 'UP' ? '↑ KÖP' : flipDir === 'DOWN' ? '↓ SÄLJ' : 'NEUTRAL'}?
            </div>
            <div className="space-y-2">
              {sameDir.slice(0, 4).map(signal => {
                const flipCond = FLIP_CONDITIONS[signal.module]?.[direction];
                if (!flipCond) return null;
                return (
                  <div key={signal.module} className="flex items-start gap-2 text-xs">
                    <span className="font-medium text-foreground min-w-[90px]">
                      {MODULE_NAMES[signal.module]?.split(' ')[0]}:
                    </span>
                    <span className="text-muted-foreground">{flipCond}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* All module contributions */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Bidrag per modul
            </div>
            <div className="space-y-1">
              {signals.filter(s => s.weight > 0).sort((a, b) => b.strength * b.weight - a.strength * a.weight).map(s => {
                const contribution = s.direction === 'UP' ? s.strength * (s.weight / 100) : s.direction === 'DOWN' ? -s.strength * (s.weight / 100) : 0;
                const isPositive = contribution > 0;
                return (
                  <div key={s.module} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-28 truncate">{MODULE_NAMES[s.module] || s.module}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', isPositive ? 'bg-up' : contribution < 0 ? 'bg-down' : 'bg-muted-foreground')}
                        style={{ width: `${Math.min(100, Math.abs(contribution) * 2)}%` }}
                      />
                    </div>
                    <span className={cn('text-xs font-mono w-12 text-right', isPositive ? 'text-up' : contribution < 0 ? 'text-down' : 'text-muted-foreground')}>
                      {isPositive ? '+' : ''}{contribution.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

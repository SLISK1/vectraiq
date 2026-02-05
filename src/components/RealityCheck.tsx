import { HORIZON_LABELS, HORIZON_SUPPORT, Horizon } from '@/types/market';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';

export const RealityCheck = () => {
  const [isOpen, setIsOpen] = useState(false);

  const horizonData: { horizon: Horizon; support: 'full' | 'limited' | 'unsupported'; notes: string }[] = [
    { horizon: '1s', support: 'unsupported', notes: 'Kräver tick-data och orderbok. Ej tillgängligt med offentliga källor.' },
    { horizon: '1m', support: 'unsupported', notes: 'Kräver realtidsdata på sekundnivå. Ej praktiskt genomförbart.' },
    { horizon: '1h', support: 'limited', notes: 'Kräver intraday-data. Endast proxy-analys tillgänglig.' },
    { horizon: '1d', support: 'full', notes: 'Full support med dagliga priser, nyheter och rapporter.' },
    { horizon: '1w', support: 'full', notes: 'Full support. Optimal för de flesta analysmoduler.' },
    { horizon: '1mo', support: 'full', notes: 'Full support. Fundamental analys får större vikt.' },
    { horizon: '1y', support: 'full', notes: 'Full support. Långsiktig fundamental och makroanalys.' },
  ];

  const getSupportIcon = (support: 'full' | 'limited' | 'unsupported') => {
    if (support === 'full') return <CheckCircle className="w-4 h-4 text-up" />;
    if (support === 'limited') return <AlertTriangle className="w-4 h-4 text-neutral" />;
    return <XCircle className="w-4 h-4 text-down" />;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="glass-card rounded-xl overflow-hidden">
      <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-accent/30 transition-colors">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <Info className="w-5 h-5 text-primary" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold">Reality Check: Databegränsningar</h3>
            <p className="text-sm text-muted-foreground">Vilka horisonter stöds med offentlig data?</p>
          </div>
        </div>
        <span className="text-sm text-muted-foreground">{isOpen ? 'Dölj' : 'Visa'}</span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-4">
          <div className="grid gap-2">
            {horizonData.map(({ horizon, support, notes }) => (
              <div
                key={horizon}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg",
                  support === 'full' && "bg-up/5 border border-up/20",
                  support === 'limited' && "bg-neutral/5 border border-neutral/20",
                  support === 'unsupported' && "bg-down/5 border border-down/20"
                )}
              >
                {getSupportIcon(support)}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-medium">{HORIZON_LABELS[horizon]}</span>
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded",
                      support === 'full' && "bg-up/20 text-up",
                      support === 'limited' && "bg-neutral/20 text-neutral",
                      support === 'unsupported' && "bg-down/20 text-down"
                    )}>
                      {support === 'full' ? 'Full support' : support === 'limited' ? 'Begränsat' : 'Ej stöds'}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{notes}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <h4 className="font-medium text-sm">Orderflöde (Order Flow Lite)</h4>
            <p className="text-sm text-muted-foreground">
              Utan tillgång till orderbok/tick-data används proxy-indikatorer som OBV (On-Balance Volume), 
              A/D Line och volymanalys. Dessa ger indikationer om ackumulering/distribution men är 
              mindre precisa än riktig orderflödesanalys.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <h4 className="font-medium text-sm">Datakällor</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Dagliga priser: Yahoo Finance, Börsdata</li>
              <li>• Nyheter: DI, SvD, Affärsvärlden (via RSS/scraping)</li>
              <li>• Rapporter: Bolagsverket, Nasdaq OMX</li>
              <li>• Makrodata: SCB, Riksbanken, Konjunkturinstitutet</li>
              <li>• Krypto: CoinGecko, CoinMarketCap</li>
              <li>• Metaller: LBMA, Kitco</li>
            </ul>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

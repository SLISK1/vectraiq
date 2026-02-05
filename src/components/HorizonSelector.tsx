import { Horizon, HORIZON_LABELS, HORIZON_SUPPORT } from '@/types/market';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, MinusCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HorizonSelectorProps {
  selected: Horizon;
  onSelect: (horizon: Horizon) => void;
  className?: string;
}

const horizons: Horizon[] = ['1d', '1w', '1mo', '1y', '1h', '1m', '1s'];

const SupportIcon = ({ support }: { support: 'full' | 'limited' | 'unsupported' }) => {
  if (support === 'full') return <CheckCircle className="w-3 h-3 text-up" />;
  if (support === 'limited') return <MinusCircle className="w-3 h-3 text-neutral" />;
  return <AlertCircle className="w-3 h-3 text-down" />;
};

const supportText: Record<string, string> = {
  full: 'Full support med dagliga priser',
  limited: 'Begränsat: kräver intraday-data',
  unsupported: 'Ej stöds: kräver tick/orderbok-data',
};

export const HorizonSelector = ({ selected, onSelect, className }: HorizonSelectorProps) => {
  const mainHorizons = horizons.filter(h => HORIZON_SUPPORT[h] === 'full');
  const limitedHorizons = horizons.filter(h => HORIZON_SUPPORT[h] !== 'full');

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap gap-2">
        {mainHorizons.map((horizon) => (
          <button
            key={horizon}
            onClick={() => onSelect(horizon)}
            className={cn(
              "horizon-badge transition-all duration-200 flex items-center gap-1.5",
              selected === horizon
                ? "bg-primary text-primary-foreground glow-primary"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            )}
          >
            <SupportIcon support={HORIZON_SUPPORT[horizon]} />
            {HORIZON_LABELS[horizon]}
          </button>
        ))}
      </div>
      
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Begränsade:</span>
        <div className="flex gap-1.5">
          {limitedHorizons.map((horizon) => (
            <Tooltip key={horizon}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => HORIZON_SUPPORT[horizon] === 'limited' && onSelect(horizon)}
                  disabled={HORIZON_SUPPORT[horizon] === 'unsupported'}
                  className={cn(
                    "horizon-badge transition-all duration-200 flex items-center gap-1",
                    HORIZON_SUPPORT[horizon] === 'unsupported' && "opacity-40 cursor-not-allowed",
                    selected === horizon
                      ? "bg-neutral/30 text-neutral border border-neutral/50"
                      : "bg-muted text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <SupportIcon support={HORIZON_SUPPORT[horizon]} />
                  {HORIZON_LABELS[horizon]}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{supportText[HORIZON_SUPPORT[horizon]]}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
};

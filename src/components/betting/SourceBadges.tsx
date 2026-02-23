import { useMemo } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Database, DollarSign, Flame, Globe, Newspaper, Users, type LucideIcon } from 'lucide-react';

interface Prediction {
  sources_used: any;
  market_odds_home: number | null;
}

interface SourceBadgesProps {
  prediction: Prediction;
}

interface DetectedSource {
  key: string;
  label: string;
  Icon: LucideIcon;
  colorClass: string;
  tooltip: string;
}

export const SourceBadges = ({ prediction }: SourceBadgesProps) => {
  const detectedSources = useMemo(() => {
    const sources: DetectedSource[] = [];
    const seen = new Set<string>();
    const add = (key: string, label: string, Icon: LucideIcon, colorClass: string, tooltip: string) => {
      if (!seen.has(key)) { seen.add(key); sources.push({ key, label, Icon, colorClass, tooltip }); }
    };

    const items = Array.isArray(prediction.sources_used) ? prediction.sources_used as any[] : [];
    for (const s of items) {
      const url = (s?.url || '').toLowerCase();
      const title = (s?.title || '').toLowerCase();
      const type = (s?.type || '').toLowerCase();
      if (url.includes('football-data.org')) { add('h2h', 'H2H', Database, 'bg-blue-500/15 text-blue-400 border-blue-500/30', 'Football-Data.org (H2H & tabell)'); continue; }
      if (url.includes('forzafootball.com')) { add('forza', 'Forza', Flame, 'bg-orange-500/15 text-orange-400 border-orange-500/30', 'Forza Football'); continue; }
      if (type === 'news' || title.includes('[newsapi]')) { add('news', 'News', Newspaper, 'bg-purple-500/15 text-purple-400 border-purple-500/30', 'Nyheter (GNews / NewsAPI)'); continue; }
      if (title.includes('pool_tips') || title.includes('pool tips')) { add('pool', 'Pool', Users, 'bg-teal-500/15 text-teal-400 border-teal-500/30', 'Pool Tips'); continue; }
      if (url) { add('web', 'Web', Globe, 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', 'Firecrawl (skrapade artiklar)'); }
    }
    if (prediction.market_odds_home !== null && prediction.market_odds_home !== undefined) {
      add('odds', 'Odds', DollarSign, 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', 'The Odds API (marknadsodds)');
    }
    return sources;
  }, [prediction]);

  if (detectedSources.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground mr-0.5">{detectedSources.length} källor:</span>
        {detectedSources.map(src => (
          <Tooltip key={src.key}>
            <TooltipTrigger asChild>
              <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-default", src.colorClass)}>
                <src.Icon className="w-3 h-3" />
                {src.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{src.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
};

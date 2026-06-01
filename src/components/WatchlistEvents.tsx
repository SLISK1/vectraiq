import { useUpcomingEvents } from '@/hooks/useMarketData';
import { CalendarClock, Coins } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

interface WatchlistEventsProps {
  ticker: string;
}

// Swedish labels for the event types we surface on a watchlist card.
const EVENT_LABELS: Record<string, string> = {
  earnings: 'Rapport',
  dividend: 'Utdelning',
  split: 'Split',
};

// Compact list of upcoming events (earnings + dividends) for one ticker.
// Rendered inside WatchlistCard so alerts stay visible without a separate page.
export const WatchlistEvents = ({ ticker }: WatchlistEventsProps) => {
  const { data: events } = useUpcomingEvents(ticker);

  if (!events || events.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {events.map((ev, i) => {
        const label = EVENT_LABELS[ev.type] || ev.type;
        const Icon = ev.type === 'dividend' ? Coins : CalendarClock;
        return (
          <span key={`${ev.type}-${ev.date}-${i}`} className="inline-flex items-center gap-1">
            <Icon className="w-3 h-3" />
            {label} {format(new Date(ev.date), 'yyyy-MM-dd', { locale: sv })}
          </span>
        );
      })}
    </div>
  );
};

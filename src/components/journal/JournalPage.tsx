import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { NotebookPen, BookOpen, Loader2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import {
  useJournalEntries,
  type JournalEntry,
  type JournalDecision,
  type JournalOutcome,
} from '@/hooks/useDecisionJournal';
import { AddJournalEntryModal } from './AddJournalEntryModal';
import { CloseJournalEntryModal } from './CloseJournalEntryModal';

const DECISION_LABELS: Record<JournalDecision, string> = {
  buy: 'Köp',
  sell: 'Sälj',
  skip: 'Avstå',
  watch: 'Bevaka',
};

const OUTCOME_LABELS: Record<JournalOutcome, string> = {
  win: 'Vinst',
  loss: 'Förlust',
  breakeven: 'Nollresultat',
  abandoned: 'Övergiven',
};

const DIRECTION_LABELS: Record<string, string> = {
  UP: 'Upp',
  DOWN: 'Ned',
  NEUTRAL: 'Neutral',
};

const decisionVariant = (d: JournalDecision): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (d) {
    case 'buy':
      return 'default';
    case 'sell':
      return 'destructive';
    case 'watch':
      return 'secondary';
    default:
      return 'outline';
  }
};

export const JournalPage = () => {
  const { user } = useAuth();
  const { data: entries, isLoading } = useJournalEntries();
  const [addOpen, setAddOpen] = useState(false);
  const [closingEntry, setClosingEntry] = useState<JournalEntry | null>(null);

  if (!user) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold mb-2">Logga in för att se din beslutsdagbok</h3>
        <p className="text-muted-foreground">
          Logga varje beslut med tes och utfall för att mäta edge mot tur.
        </p>
      </div>
    );
  }

  const list = entries || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Beslutsdagbok</h2>
            <p className="text-sm text-muted-foreground">
              Logga tes, beslut och utfall — mät edge mot tur.
            </p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <NotebookPen className="w-4 h-4" />
          Ny anteckning
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : list.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Inga anteckningar ännu. Logga ditt första beslut!</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Riktning</TableHead>
                <TableHead>Beslut</TableHead>
                <TableHead className="text-center">Övertygelse</TableHead>
                <TableHead>Tes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Avkastning</TableHead>
                <TableHead className="text-right">Åtgärd</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((entry) => {
                const isClosed = entry.status === 'closed';
                const ret = entry.realized_return_pct;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-semibold">
                      {entry.ticker || '—'}
                      <div className="text-xs font-normal text-muted-foreground">
                        {format(new Date(entry.created_at), 'dd MMM yyyy', { locale: sv })}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.direction ? DIRECTION_LABELS[entry.direction] || entry.direction : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={decisionVariant(entry.decision)}>
                        {DECISION_LABELS[entry.decision]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">
                      {entry.conviction ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <span className="text-sm text-muted-foreground line-clamp-2" title={entry.thesis}>
                        {entry.thesis}
                      </span>
                    </TableCell>
                    <TableCell>
                      {isClosed ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {entry.outcome ? OUTCOME_LABELS[entry.outcome] : 'Stängd'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Öppen</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {isClosed && ret !== null && ret !== undefined ? (
                        <span className={cn(ret >= 0 ? 'text-up' : 'text-down')}>
                          {ret >= 0 ? '+' : ''}
                          {Number(ret).toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isClosed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setClosingEntry(entry)}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Stäng / registrera utfall
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modals */}
      <AddJournalEntryModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
      <CloseJournalEntryModal
        entry={closingEntry}
        isOpen={!!closingEntry}
        onClose={() => setClosingEntry(null)}
      />
    </div>
  );
};

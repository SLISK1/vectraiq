import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  useCloseJournalEntry,
  type JournalEntry,
  type JournalOutcome,
} from '@/hooks/useDecisionJournal';
import { useToast } from '@/hooks/use-toast';

interface CloseJournalEntryModalProps {
  entry: JournalEntry | null;
  isOpen: boolean;
  onClose: () => void;
}

const OUTCOME_LABELS: Record<JournalOutcome, string> = {
  win: 'Vinst',
  loss: 'Förlust',
  breakeven: 'Nollresultat',
  abandoned: 'Övergiven',
};

export const CloseJournalEntryModal = ({ entry, isOpen, onClose }: CloseJournalEntryModalProps) => {
  const { toast } = useToast();
  const closeEntry = useCloseJournalEntry();

  const [outcome, setOutcome] = useState<JournalOutcome | ''>('');
  const [exitPrice, setExitPrice] = useState('');
  const [returnPct, setReturnPct] = useState('');

  const reset = () => {
    setOutcome('');
    setExitPrice('');
    setReturnPct('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const parseNum = (v: string): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  if (!entry) return null;

  const handleSubmit = async () => {
    if (!outcome) {
      toast({
        title: 'Utfall krävs',
        description: 'Välj hur beslutet slutade.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await closeEntry.mutateAsync({
        id: entry.id,
        outcome,
        exit_price: parseNum(exitPrice),
        realized_return_pct: parseNum(returnPct),
      });
      toast({
        title: 'Utfall registrerat',
        description: 'Anteckningen är stängd och resultatet sparat.',
      });
      handleClose();
    } catch (error: any) {
      toast({
        title: 'Fel',
        description: error?.message || 'Kunde inte stänga anteckningen.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Registrera utfall {entry.ticker ? `· ${entry.ticker}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Utfall *</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as JournalOutcome)}>
              <SelectTrigger>
                <SelectValue placeholder="Välj utfall" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(OUTCOME_LABELS) as JournalOutcome[]).map((o) => (
                  <SelectItem key={o} value={o}>
                    {OUTCOME_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="close-exit">Exit-kurs</Label>
              <Input
                id="close-exit"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-return">Avkastning %</Label>
              <Input
                id="close-return"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={returnPct}
                onChange={(e) => setReturnPct(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={closeEntry.isPending}>
            Avbryt
          </Button>
          <Button onClick={handleSubmit} disabled={closeEntry.isPending} className="gap-2">
            {closeEntry.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Stäng anteckning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

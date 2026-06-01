import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NotebookPen, Loader2 } from 'lucide-react';
import { useCreateJournalEntry, type JournalDecision } from '@/hooks/useDecisionJournal';
import { useToast } from '@/hooks/use-toast';

interface AddJournalEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DECISION_LABELS: Record<JournalDecision, string> = {
  buy: 'Köp',
  sell: 'Sälj',
  skip: 'Avstå',
  watch: 'Bevaka',
};

const DIRECTION_OPTIONS = [
  { value: 'UP', label: 'Upp' },
  { value: 'DOWN', label: 'Ned' },
  { value: 'NEUTRAL', label: 'Neutral' },
];

export const AddJournalEntryModal = ({ isOpen, onClose }: AddJournalEntryModalProps) => {
  const { toast } = useToast();
  const createEntry = useCreateJournalEntry();

  const [ticker, setTicker] = useState('');
  const [direction, setDirection] = useState('');
  const [decision, setDecision] = useState<JournalDecision | ''>('');
  const [conviction, setConviction] = useState('');
  const [thesis, setThesis] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [targetPrice, setTargetPrice] = useState('');

  const resetForm = () => {
    setTicker('');
    setDirection('');
    setDecision('');
    setConviction('');
    setThesis('');
    setEntryPrice('');
    setStopLoss('');
    setTargetPrice('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const parseNum = (v: string): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const handleSubmit = async () => {
    if (!thesis.trim()) {
      toast({
        title: 'Tes krävs',
        description: 'Skriv din tes innan du sparar anteckningen.',
        variant: 'destructive',
      });
      return;
    }
    if (!decision) {
      toast({
        title: 'Beslut krävs',
        description: 'Välj vilket beslut du fattade.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createEntry.mutateAsync({
        ticker: ticker.trim() || null,
        direction: direction || null,
        decision,
        conviction: conviction ? Number(conviction) : null,
        thesis: thesis.trim(),
        entry_price: parseNum(entryPrice),
        stop_loss: parseNum(stopLoss),
        target_price: parseNum(targetPrice),
      });
      toast({
        title: 'Anteckning sparad',
        description: 'Ditt beslut har loggats i dagboken.',
      });
      handleClose();
    } catch (error: any) {
      toast({
        title: 'Fel',
        description: error?.message || 'Kunde inte spara anteckningen.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-primary" />
            Ny anteckning
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ticker + Direction */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="journal-ticker">Ticker</Label>
              <Input
                id="journal-ticker"
                placeholder="t.ex. VOLV-B"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label>Riktning</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj" />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Decision + Conviction */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Beslut *</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as JournalDecision)}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj beslut" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DECISION_LABELS) as JournalDecision[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DECISION_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Övertygelse</Label>
              <Select value={conviction} onValueChange={setConviction}>
                <SelectTrigger>
                  <SelectValue placeholder="1–5" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Thesis */}
          <div className="space-y-2">
            <Label htmlFor="journal-thesis">Tes (varför?) *</Label>
            <Textarea
              id="journal-thesis"
              placeholder="Beskriv din rationale: varför fattar du detta beslut?"
              rows={4}
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
            />
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="journal-entry">Entry</Label>
              <Input
                id="journal-entry"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journal-stop">Stop loss</Label>
              <Input
                id="journal-stop"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journal-target">Målkurs</Label>
              <Input
                id="journal-target"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={createEntry.isPending}>
            Avbryt
          </Button>
          <Button onClick={handleSubmit} disabled={createEntry.isPending} className="gap-2">
            {createEntry.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <NotebookPen className="w-4 h-4" />
            )}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

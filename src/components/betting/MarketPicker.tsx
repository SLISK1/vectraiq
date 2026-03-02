import { Button } from '@/components/ui/button';

export type BettingMarket = 'ALL' | 'BTTS' | 'O25' | 'CRN_O95' | 'CRD_O35';

const OPTIONS: { id: BettingMarket; label: string }[] = [
  { id: 'ALL', label: 'Alla' },
  { id: 'BTTS', label: 'BTTS' },
  { id: 'O25', label: 'Över 2.5' },
  { id: 'CRN_O95', label: 'Hörnor Ö 9.5' },
  { id: 'CRD_O35', label: 'Kort Ö 3.5' },
];

export const MarketPicker = ({ value, onChange }: { value: BettingMarket; onChange: (v: BettingMarket) => void }) => (
  <div className="flex flex-wrap gap-2">
    {OPTIONS.map((o) => (
      <Button key={o.id} size="sm" variant={value === o.id ? 'default' : 'outline'} onClick={() => onChange(o.id)}>
        {o.label}
      </Button>
    ))}
  </div>
);

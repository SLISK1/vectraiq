import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export const ValueFilter = ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
  <div className="flex items-center gap-2">
    <Switch checked={checked} onCheckedChange={onCheckedChange} />
    <Label>Visa endast edge-marknader</Label>
  </div>
);

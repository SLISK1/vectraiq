import { Badge } from '@/components/ui/badge';
import { TrendingUp, Landmark, ArrowLeftRight } from 'lucide-react';

const regimeConfig = {
  MOMENTUM: { label: 'Momentum', icon: TrendingUp, className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  FUNDAMENTAL: { label: 'Fundamental', icon: Landmark, className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  MEAN_REVERSION: { label: 'Mean Reversion', icon: ArrowLeftRight, className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
};

export function RegimeBadge({ regime }: { regime: string | null | undefined }) {
  if (!regime) return <Badge variant="outline" className="text-muted-foreground">Ingen regim</Badge>;
  const cfg = regimeConfig[regime as keyof typeof regimeConfig];
  if (!cfg) return <Badge variant="outline">{regime}</Badge>;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cfg.className}>
      <Icon className="w-3 h-3 mr-1" />
      {cfg.label}
    </Badge>
  );
}

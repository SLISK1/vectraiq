import { Badge } from '@/components/ui/badge';

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: 'Klar att agera', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  candidate: { label: 'Kandidat', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  blocked: { label: 'Blockerad', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  waiting: { label: 'Vänta', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  open: { label: 'Öppen position', className: 'bg-primary/20 text-primary border-primary/30' },
  closed: { label: 'Stängd', className: 'bg-muted text-muted-foreground border-border' },
  stopped: { label: 'Stoppad', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  simulate: { label: 'Simulering', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

export function StrategyStatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status, className: '' };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

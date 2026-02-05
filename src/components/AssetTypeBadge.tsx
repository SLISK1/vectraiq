import { AssetType } from '@/types/market';
import { cn } from '@/lib/utils';
import { TrendingUp, Bitcoin, CircleDollarSign } from 'lucide-react';

interface AssetTypeBadgeProps {
  type: AssetType;
  className?: string;
}

const config: Record<AssetType, { icon: typeof TrendingUp; label: string; color: string }> = {
  stock: { icon: TrendingUp, label: 'Aktie', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  crypto: { icon: Bitcoin, label: 'Krypto', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  metal: { icon: CircleDollarSign, label: 'Metall', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

export const AssetTypeBadge = ({ type, className }: AssetTypeBadgeProps) => {
  const { icon: Icon, label, color } = config[type];
  
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium", color, className)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
};

import { AssetType } from '@/types/market';
import { cn } from '@/lib/utils';
import { TrendingUp, Bitcoin, CircleDollarSign, Briefcase } from 'lucide-react';

interface AssetTypeBadgeProps {
  type: AssetType;
  className?: string;
  size?: 'sm' | 'md';
}

const config: Record<AssetType, { icon: typeof TrendingUp; label: string; color: string }> = {
  stock: { icon: TrendingUp, label: 'Aktie', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  crypto: { icon: Bitcoin, label: 'Krypto', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  metal: { icon: CircleDollarSign, label: 'Metall', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  fund: { icon: Briefcase, label: 'Fond', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

export const AssetTypeBadge = ({ type, className, size = 'md' }: AssetTypeBadgeProps) => {
  const configItem = config[type] || config.stock;
  const { icon: Icon, label, color } = configItem;
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded border font-medium",
      size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      color, 
      className
    )}>
      <Icon className={cn(size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
      {label}
    </span>
  );
};

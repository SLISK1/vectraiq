import { cn } from '@/lib/utils';
import { AssetType } from '@/types/market';
import { TrendingUp, Coins, CircleDollarSign, Landmark } from 'lucide-react';

interface AssetTypeFilterProps {
  selected: AssetType | 'all';
  onSelect: (type: AssetType | 'all') => void;
}

const assetTypes: { id: AssetType | 'all'; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'Alla', icon: TrendingUp },
  { id: 'stock', label: 'Aktier', icon: Landmark },
  { id: 'fund', label: 'Fonder', icon: CircleDollarSign },
  { id: 'crypto', label: 'Krypto', icon: Coins },
  { id: 'metal', label: 'Metaller', icon: CircleDollarSign },
];

export const AssetTypeFilter = ({ selected, onSelect }: AssetTypeFilterProps) => {
  return (
    <div className="flex flex-wrap gap-2">
      {assetTypes.map((type) => {
        const Icon = type.icon;
        return (
          <button
            key={type.id}
            onClick={() => onSelect(type.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
              selected === type.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {type.label}
          </button>
        );
      })}
    </div>
  );
};

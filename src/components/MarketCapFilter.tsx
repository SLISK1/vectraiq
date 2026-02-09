import { MarketCapCategory } from '@/types/market';
import { cn } from '@/lib/utils';
import { Rocket } from 'lucide-react';

interface MarketCapFilterProps {
  selected: MarketCapCategory;
  onSelect: (category: MarketCapCategory) => void;
}

const categories: { value: MarketCapCategory; label: string; description: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'Alla', description: 'Alla tillgångar' },
  { value: 'large', label: 'Large Cap', description: '>$10B' },
  { value: 'medium', label: 'Mid Cap', description: '$2B-$10B' },
  { value: 'small', label: 'Small Cap', description: '<$2B' },
  { 
    value: 'rocket', 
    label: 'Raket', 
    description: 'Top 10 med högst konfidens & tillväxtpotential',
    icon: <Rocket className="w-4 h-4" />
  },
];

export const MarketCapFilter = ({ selected, onSelect }: MarketCapFilterProps) => {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => (
        <button
          key={cat.value}
          onClick={() => onSelect(cat.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5",
            selected === cat.value
              ? cat.value === 'rocket' 
                ? "bg-gradient-to-r from-orange-500 to-red-500 text-white"
                : "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-accent text-muted-foreground"
          )}
          title={cat.description}
        >
          {cat.icon}
          {cat.label}
        </button>
      ))}
    </div>
  );
};

// Helper to categorize by market cap
export const getMarketCapCategory = (marketCap?: number): MarketCapCategory => {
  if (!marketCap) return 'small';
  if (marketCap >= 10_000_000_000) return 'large';
  if (marketCap >= 2_000_000_000) return 'medium';
  return 'small';
};

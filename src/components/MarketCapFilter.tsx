import { MarketCapCategory } from '@/types/market';
import { cn } from '@/lib/utils';

interface MarketCapFilterProps {
  selected: MarketCapCategory;
  onSelect: (category: MarketCapCategory) => void;
}

const categories: { value: MarketCapCategory; label: string; description: string }[] = [
  { value: 'all', label: 'Alla', description: 'Alla tillgångar' },
  { value: 'large', label: 'Large Cap', description: '>$10B' },
  { value: 'medium', label: 'Mid Cap', description: '$2B-$10B' },
  { value: 'small', label: 'Small Cap', description: '<$2B' },
];

export const MarketCapFilter = ({ selected, onSelect }: MarketCapFilterProps) => {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => (
        <button
          key={cat.value}
          onClick={() => onSelect(cat.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            selected === cat.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-accent text-muted-foreground"
          )}
          title={cat.description}
        >
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

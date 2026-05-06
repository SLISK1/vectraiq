import { MarketCapCategory } from '@/types/market';
import { cn } from '@/lib/utils';
import { Rocket } from 'lucide-react';

interface MarketCapFilterProps {
  selected: MarketCapCategory;
  onSelect: (category: MarketCapCategory) => void;
}

const categories: { value: MarketCapCategory; label: string; description: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'Alla', description: 'Alla tillgångar' },
  { value: 'large', label: 'Large Cap', description: '>10 Md' },
  { value: 'medium', label: 'Mid Cap', description: '2-10 Md' },
  { value: 'small', label: 'Small Cap', description: '500 Mkr - 2 Md' },
  { value: 'micro', label: 'Micro Cap', description: '100 - 500 Mkr (högre tillväxtpotential)' },
  { value: 'nano', label: 'Nano Cap', description: '<100 Mkr (spekulativt — låg datatäckning)' },
  {
    value: 'rocket',
    label: 'Raket',
    description: 'Bolag med konkreta raket-mönster (insider, breakout, PEAD, growth, RS)',
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

// Helper to categorize by market cap. Thresholds in SEK (or local currency
// used by the symbol — most are SEK for Nordic stocks, USD for US stocks).
// 'rocket' is not produced here — it's a virtual filter computed from raketScore.
export const getMarketCapCategory = (marketCap?: number): MarketCapCategory => {
  if (!marketCap) return 'small';
  if (marketCap >= 10_000_000_000) return 'large';     // >10 Md
  if (marketCap >= 2_000_000_000) return 'medium';      // 2-10 Md
  if (marketCap >= 500_000_000) return 'small';         // 500 Mkr - 2 Md
  if (marketCap >= 100_000_000) return 'micro';         // 100 - 500 Mkr
  return 'nano';                                        // <100 Mkr
};

import { Zap, Landmark, Cpu, HeartPulse, Factory, Building2, Gem, ShoppingBag, Radio, Lightbulb } from 'lucide-react';

const SECTORS = [
  { id: 'Energy', label: 'Energi', icon: Zap },
  { id: 'Financial Services', label: 'Finans', icon: Landmark },
  { id: 'Technology', label: 'Teknologi', icon: Cpu },
  { id: 'Healthcare', label: 'Hälsovård', icon: HeartPulse },
  { id: 'Industrials', label: 'Industri', icon: Factory },
  { id: 'Real Estate', label: 'Fastigheter', icon: Building2 },
  { id: 'Materials', label: 'Material', icon: Gem },
  { id: 'Consumer Discretionary', label: 'Konsument', icon: ShoppingBag },
  { id: 'Communication Services', label: 'Kommunikation', icon: Radio },
  { id: 'Utilities', label: 'Utilities', icon: Lightbulb },
];

interface SectorCategoriesProps {
  selectedSector: string | null;
  onSectorSelect: (sector: string | null) => void;
}

export const SectorCategories = ({ selectedSector, onSectorSelect }: SectorCategoriesProps) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {SECTORS.map((sector) => {
        const isActive = selectedSector === sector.id;
        return (
          <button
            key={sector.id}
            onClick={() => onSectorSelect(isActive ? null : sector.id)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 ${
              isActive
                ? 'bg-primary text-primary-foreground border-primary shadow-lg'
                : 'bg-card text-card-foreground border-border hover:border-primary/50 hover:bg-accent'
            }`}
          >
            <sector.icon className="w-6 h-6" />
            <span className="text-xs font-medium">{sector.label}</span>
          </button>
        );
      })}
    </div>
  );
};

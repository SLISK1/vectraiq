import { cn } from '@/lib/utils';
import { Leaf, Atom, Cpu, ShieldCheck, Bot, Heart, Pill, Banknote, Rocket as RocketIcon, Bolt, Globe2, Wheat, Droplet, Car, Activity } from 'lucide-react';

export type ThemeFilterValue = 'all' | 'cleantech' | 'nuclear' | 'energy_storage' | 'electrification'
  | 'ai' | 'cybersecurity' | 'robotics' | 'autonomous' | 'biotech' | 'healthtech' | 'longevity'
  | 'glp1_obesity' | 'fintech' | 'space' | 'defense' | 'consumer' | 'agtech' | 'water' | 'quantum';

interface ThemeFilterProps {
  selected: ThemeFilterValue;
  onSelect: (theme: ThemeFilterValue) => void;
}

const themes: { value: ThemeFilterValue; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all',             label: 'Alla teman',  icon: <Globe2 className="w-3.5 h-3.5" />,       color: 'text-foreground' },
  { value: 'ai',              label: 'AI',          icon: <Cpu className="w-3.5 h-3.5" />,          color: 'text-blue-400' },
  { value: 'cleantech',       label: 'Cleantech',   icon: <Leaf className="w-3.5 h-3.5" />,         color: 'text-green-400' },
  { value: 'nuclear',         label: 'Kärnkraft',   icon: <Atom className="w-3.5 h-3.5" />,         color: 'text-yellow-400' },
  { value: 'energy_storage',  label: 'Batterier',   icon: <Bolt className="w-3.5 h-3.5" />,         color: 'text-amber-400' },
  { value: 'electrification', label: 'EV / Laddning', icon: <Car className="w-3.5 h-3.5" />,        color: 'text-cyan-400' },
  { value: 'biotech',         label: 'Biotech',     icon: <Pill className="w-3.5 h-3.5" />,         color: 'text-pink-400' },
  { value: 'healthtech',      label: 'Healthtech',  icon: <Heart className="w-3.5 h-3.5" />,        color: 'text-red-400' },
  { value: 'robotics',        label: 'Robotik',     icon: <Bot className="w-3.5 h-3.5" />,          color: 'text-purple-400' },
  { value: 'autonomous',      label: 'Autonom',     icon: <Activity className="w-3.5 h-3.5" />,     color: 'text-indigo-400' },
  { value: 'cybersecurity',   label: 'Cybersäk',    icon: <ShieldCheck className="w-3.5 h-3.5" />,  color: 'text-emerald-400' },
  { value: 'fintech',         label: 'Fintech',     icon: <Banknote className="w-3.5 h-3.5" />,     color: 'text-lime-400' },
  { value: 'space',           label: 'Rymd / Defense', icon: <RocketIcon className="w-3.5 h-3.5" />, color: 'text-sky-400' },
  { value: 'agtech',          label: 'Agtech',      icon: <Wheat className="w-3.5 h-3.5" />,        color: 'text-orange-400' },
  { value: 'water',           label: 'Vatten',      icon: <Droplet className="w-3.5 h-3.5" />,      color: 'text-blue-300' },
];

export const ThemeFilter = ({ selected, onSelect }: ThemeFilterProps) => {
  return (
    <div className="flex flex-wrap gap-1.5">
      {themes.map((t) => (
        <button
          key={t.value}
          onClick={() => onSelect(t.value)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            selected === t.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-accent text-muted-foreground"
          )}
        >
          <span className={selected === t.value ? '' : t.color}>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
};

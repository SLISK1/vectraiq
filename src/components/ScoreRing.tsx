import { Direction } from '@/types/market';
import { cn } from '@/lib/utils';

interface ScoreRingProps {
  score: number;
  direction: Direction;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { ring: 48, stroke: 3, text: 'text-sm' },
  md: { ring: 64, stroke: 4, text: 'text-lg' },
  lg: { ring: 80, stroke: 5, text: 'text-2xl' },
};

export const ScoreRing = ({ score, direction, size = 'md', showLabel = true, className }: ScoreRingProps) => {
  const { ring, stroke, text } = sizeMap[size];
  const radius = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const colorClass = direction === 'UP' ? 'text-up' : direction === 'DOWN' ? 'text-down' : 'text-neutral';
  const glowClass = direction === 'UP' ? 'glow-up' : direction === 'DOWN' ? 'glow-down' : '';

  return (
    <div className={cn("score-ring", glowClass, className)} style={{ width: ring, height: ring }}>
      <svg width={ring} height={ring} className="transform -rotate-90">
        <circle
          cx={ring / 2}
          cy={ring / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted/30"
        />
        <circle
          cx={ring / 2}
          cy={ring / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(colorClass, "transition-all duration-700 ease-out")}
        />
      </svg>
      {showLabel && (
        <div className={cn("absolute inset-0 flex items-center justify-center font-mono font-bold", text, colorClass)}>
          {score}
        </div>
      )}
    </div>
  );
};

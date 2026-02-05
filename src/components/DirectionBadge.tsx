import { Direction } from '@/types/market';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DirectionBadgeProps {
  direction: Direction;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-1',
  lg: 'text-base px-3 py-1.5',
};

const iconSizes = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

export const DirectionBadge = ({ direction, size = 'md', showIcon = true, className }: DirectionBadgeProps) => {
  const Icon = direction === 'UP' ? TrendingUp : direction === 'DOWN' ? TrendingDown : Minus;
  
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold rounded-md",
        direction === 'UP' && "signal-up",
        direction === 'DOWN' && "signal-down",
        direction === 'NEUTRAL' && "signal-neutral",
        sizeClasses[size],
        className
      )}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {direction}
    </span>
  );
};

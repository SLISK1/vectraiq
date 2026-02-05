import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { usePortfolioHistory } from '@/hooks/usePortfolioHistory';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type TimeRange = '30d' | '90d' | '1y';

const chartConfig: ChartConfig = {
  value: {
    label: 'Värde',
    color: 'hsl(var(--primary))',
  },
  invested: {
    label: 'Investerat',
    color: 'hsl(var(--muted-foreground))',
  },
};

export const PortfolioChart = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');
  
  const days = useMemo(() => {
    switch (timeRange) {
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      default: return 90;
    }
  }, [timeRange]);

  const { data: history, isLoading } = usePortfolioHistory(days);

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    
    return history.map(point => ({
      date: point.date,
      value: point.value,
      invested: point.invested,
      profitLoss: point.profitLoss,
      profitLossPct: point.profitLossPct,
    }));
  }, [history]);

  // Calculate performance metrics
  const performance = useMemo(() => {
    if (!chartData || chartData.length < 2) return null;
    
    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const change = last.value - first.value;
    const changePercent = first.value > 0 ? (change / first.value) * 100 : 0;
    
    return {
      startValue: first.value,
      endValue: last.value,
      change,
      changePercent,
      isPositive: change >= 0,
    };
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Portfolio-utveckling</h3>
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <p>Ingen historisk data tillgänglig ännu.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Portfolio-utveckling</h3>
          {performance && (
            <div className="flex items-center gap-2 mt-1">
              {performance.isPositive ? (
                <TrendingUp className="w-4 h-4 text-bullish" />
              ) : (
                <TrendingDown className="w-4 h-4 text-bearish" />
              )}
              <span className={performance.isPositive ? 'text-bullish' : 'text-bearish'}>
                {performance.isPositive ? '+' : ''}{formatCurrency(performance.change, 'SEK')}
                {' '}
                ({performance.isPositive ? '+' : ''}{performance.changePercent.toFixed(2)}%)
              </span>
              <span className="text-muted-foreground text-sm">
                senaste {timeRange === '30d' ? '30 dagarna' : timeRange === '90d' ? '90 dagarna' : 'året'}
              </span>
            </div>
          )}
        </div>
        
        {/* Time range buttons */}
        <div className="flex gap-1">
          {(['30d', '90d', '1y'] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setTimeRange(range)}
            >
              {range === '30d' ? '1M' : range === '90d' ? '3M' : '1Å'}
            </Button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
              <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => format(parseISO(value), 'd MMM', { locale: sv })}
            minTickGap={30}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => format(parseISO(value as string), 'd MMMM yyyy', { locale: sv })}
                formatter={(value, name) => {
                  const label = name === 'value' ? 'Värde' : 'Investerat';
                  return (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium">{formatCurrency(Number(value), 'SEK')}</span>
                    </div>
                  );
                }}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="invested"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1}
            strokeDasharray="4 4"
            fill="url(#colorInvested)"
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#colorValue)"
          />
        </AreaChart>
      </ChartContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-muted-foreground">Aktuellt värde</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-muted-foreground" style={{ borderStyle: 'dashed' }} />
          <span className="text-muted-foreground">Investerat</span>
        </div>
      </div>
    </div>
  );
};

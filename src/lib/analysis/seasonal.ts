// Seasonal Analysis Module
// Historical seasonal patterns, monthly/quarterly returns analysis

import { AnalysisResult, PriceData, SeasonalPattern } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate average returns by month
const calculateMonthlyReturns = (priceHistory: PriceData[]): Record<number, number> => {
  const monthlyReturns: Record<number, number[]> = {};
  
  for (let i = 1; i < priceHistory.length; i++) {
    const currentDate = new Date(priceHistory[i].timestamp);
    const prevDate = new Date(priceHistory[i - 1].timestamp);
    
    // Only compare if same month transition
    if (currentDate.getMonth() !== prevDate.getMonth()) {
      const month = currentDate.getMonth() + 1; // 1-12
      const returnPct = ((priceHistory[i].price - priceHistory[i - 1].price) / priceHistory[i - 1].price) * 100;
      
      if (!monthlyReturns[month]) monthlyReturns[month] = [];
      monthlyReturns[month].push(returnPct);
    }
  }
  
  // Calculate averages
  const averages: Record<number, number> = {};
  for (const [month, returns] of Object.entries(monthlyReturns)) {
    averages[Number(month)] = returns.reduce((a, b) => a + b, 0) / returns.length;
  }
  
  return averages;
};

// Known seasonal patterns (historical averages from market data)
const STOCK_MONTHLY_BIAS: Record<number, number> = {
  1: 1.2,   // January effect
  2: 0.1,
  3: 0.8,
  4: 1.5,   // April typically strong
  5: 0.2,   // Sell in May...
  6: -0.3,
  7: 0.5,
  8: -0.5,
  9: -1.2,  // September historically weak
  10: 0.8,
  11: 1.8,  // November rally
  12: 1.5,  // December rally
};

const CRYPTO_MONTHLY_BIAS: Record<number, number> = {
  1: 5.0,
  2: 3.0,
  3: 2.0,
  4: 4.0,
  5: -2.0,
  6: -3.0,
  7: 1.0,
  8: 2.0,
  9: -1.0,
  10: 6.0,  // Uptober
  11: 8.0,
  12: 4.0,
};

const METAL_MONTHLY_BIAS: Record<number, number> = {
  1: 2.0,
  2: 1.5,
  3: 0.5,
  4: 0.3,
  5: -0.5,
  6: -1.0,
  7: 1.0,
  8: 2.0,
  9: 2.5,  // Gold tends to rise in Sept
  10: 0.5,
  11: -0.5,
  12: 1.0,
};

// Quarter patterns
const getQuarterlyBias = (quarter: number, assetType: 'stock' | 'crypto' | 'metal'): number => {
  const quarterBias: Record<string, Record<number, number>> = {
    stock: { 1: 2.5, 2: 1.0, 3: -0.5, 4: 4.0 },
    crypto: { 1: 10, 2: 3, 3: 0, 4: 15 },
    metal: { 1: 3, 2: 0, 3: 2, 4: 1 },
  };
  return quarterBias[assetType]?.[quarter] ?? 0;
};

// Day of week patterns (1 = Monday, 5 = Friday)
const getDayOfWeekBias = (day: number, assetType: 'stock' | 'crypto' | 'metal'): number => {
  // Monday effect (stocks tend to be weak), Friday tends to be positive
  const dayBias: Record<string, Record<number, number>> = {
    stock: { 1: -0.3, 2: 0.1, 3: 0.2, 4: 0.2, 5: 0.3 },
    crypto: { 1: 0.1, 2: 0.0, 3: 0.1, 4: 0.1, 5: 0.0, 6: 0.2, 0: 0.3 },
    metal: { 1: 0.0, 2: 0.1, 3: 0.1, 4: 0.0, 5: 0.1 },
  };
  return dayBias[assetType]?.[day] ?? 0;
};

// Main seasonal analysis function
export const analyzeSeasonal = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  assetType: 'stock' | 'crypto' | 'metal'
): AnalysisResult => {
  const evidence: Evidence[] = [];
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentQuarter = Math.ceil(currentMonth / 3);
  const currentDayOfWeek = now.getDay();
  
  // Get monthly bias
  const monthlyBias = assetType === 'stock' ? STOCK_MONTHLY_BIAS :
                      assetType === 'crypto' ? CRYPTO_MONTHLY_BIAS :
                      METAL_MONTHLY_BIAS;
  
  const monthNames = ['', 'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 
                      'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'];
  
  // Calculate projected seasonal return based on horizon
  let projectedSeasonalReturn = 0;
  let monthsToAnalyze: number[] = [];
  
  switch (horizon) {
    case '1d':
      projectedSeasonalReturn = getDayOfWeekBias(currentDayOfWeek, assetType);
      break;
    case '1w':
      projectedSeasonalReturn = monthlyBias[currentMonth] / 4;
      monthsToAnalyze = [currentMonth];
      break;
    case '1mo':
      projectedSeasonalReturn = monthlyBias[currentMonth];
      monthsToAnalyze = [currentMonth];
      break;
    case '1y':
      // Sum up expected returns for next 12 months
      for (let i = 0; i < 12; i++) {
        const month = ((currentMonth - 1 + i) % 12) + 1;
        projectedSeasonalReturn += monthlyBias[month];
      }
      monthsToAnalyze = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      break;
    default:
      projectedSeasonalReturn = monthlyBias[currentMonth];
      monthsToAnalyze = [currentMonth];
  }
  
  // Add monthly evidence
  if (horizon !== '1d') {
    const currentMonthBias = monthlyBias[currentMonth];
    evidence.push({
      type: 'monthly',
      description: `${monthNames[currentMonth]} historiskt mönster`,
      value: `${currentMonthBias >= 0 ? '+' : ''}${currentMonthBias.toFixed(1)}% genomsnitt`,
      timestamp: new Date().toISOString(),
      source: 'Monthly Seasonality',
    });
    
    // Best and worst months
    const sortedMonths = Object.entries(monthlyBias).sort(([, a], [, b]) => b - a);
    const bestMonth = sortedMonths[0];
    const worstMonth = sortedMonths[sortedMonths.length - 1];
    
    evidence.push({
      type: 'pattern',
      description: 'Bästa/sämsta månader historiskt',
      value: `Bäst: ${monthNames[Number(bestMonth[0])]} (+${bestMonth[1].toFixed(1)}%), Sämst: ${monthNames[Number(worstMonth[0])]} (${worstMonth[1].toFixed(1)}%)`,
      timestamp: new Date().toISOString(),
      source: 'Historical Patterns',
    });
  }
  
  // Quarterly analysis
  const quarterlyBias = getQuarterlyBias(currentQuarter, assetType);
  evidence.push({
    type: 'quarterly',
    description: `Q${currentQuarter} historiskt mönster`,
    value: `${quarterlyBias >= 0 ? '+' : ''}${quarterlyBias.toFixed(1)}% genomsnitt`,
    timestamp: new Date().toISOString(),
    source: 'Quarterly Seasonality',
  });
  
  // Day of week for short-term
  if (horizon === '1d' || horizon === '1w') {
    const dayNames = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    const dayBias = getDayOfWeekBias(currentDayOfWeek, assetType);
    evidence.push({
      type: 'daily',
      description: `${dayNames[currentDayOfWeek]} historiskt mönster`,
      value: `${dayBias >= 0 ? '+' : ''}${(dayBias * 100).toFixed(2)}% genomsnitt`,
      timestamp: new Date().toISOString(),
      source: 'Day-of-Week Effect',
    });
  }
  
  // Determine direction based on projected seasonal return
  const direction: Direction = projectedSeasonalReturn > 1 ? 'UP' : 
                               projectedSeasonalReturn < -1 ? 'DOWN' : 'NEUTRAL';
  
  // Strength based on magnitude of seasonal effect
  const strength = Math.min(100, Math.round(50 + Math.abs(projectedSeasonalReturn) * 5));
  
  // Calculate historical data from price history
  const calculatedMonthlyReturns = calculateMonthlyReturns(priceHistory);
  const hasHistoricalData = Object.keys(calculatedMonthlyReturns).length > 0;
  
  if (hasHistoricalData) {
    const historicalMonthReturn = calculatedMonthlyReturns[currentMonth];
    if (historicalMonthReturn !== undefined) {
      evidence.push({
        type: 'historical',
        description: 'Faktisk historik för denna tillgång',
        value: `${monthNames[currentMonth]}: ${historicalMonthReturn >= 0 ? '+' : ''}${historicalMonthReturn.toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        source: 'Asset History',
      });
    }
  }
  
  // Coverage - seasonal patterns are always available (based on market averages)
  // but confidence varies based on how much historical data we have
  const coverage = 100; // Seasonal patterns always available
  
  // Confidence based on historical consistency
  const confidence = hasHistoricalData ? 70 : 55;
  
  return {
    module: 'seasonal',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: {
      currentMonth,
      currentQuarter,
      projectedSeasonalReturn,
      monthlyBias: monthlyBias[currentMonth],
      quarterlyBias,
      calculatedMonthlyReturns,
    },
  };
};

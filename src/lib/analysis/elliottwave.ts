// Elliott Wave Analysis Module
// Simplified wave pattern detection

import { AnalysisResult, PriceData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

interface WavePoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: string;
}

// Find swing highs and lows
const findSwingPoints = (priceHistory: PriceData[], lookback: number = 5): WavePoint[] => {
  const points: WavePoint[] = [];
  const prices = priceHistory.map(p => p.close ?? p.price);
  
  for (let i = lookback; i < prices.length - lookback; i++) {
    const leftPrices = prices.slice(i - lookback, i);
    const rightPrices = prices.slice(i + 1, i + lookback + 1);
    const currentPrice = prices[i];
    
    const isSwingHigh = leftPrices.every(p => p < currentPrice) && 
                        rightPrices.every(p => p < currentPrice);
    const isSwingLow = leftPrices.every(p => p > currentPrice) && 
                       rightPrices.every(p => p > currentPrice);
    
    if (isSwingHigh) {
      points.push({
        index: i,
        price: currentPrice,
        type: 'high',
        timestamp: priceHistory[i].timestamp,
      });
    } else if (isSwingLow) {
      points.push({
        index: i,
        price: currentPrice,
        type: 'low',
        timestamp: priceHistory[i].timestamp,
      });
    }
  }
  
  return points;
};

// Check for impulse wave structure (5 waves)
const detectImpulseWave = (points: WavePoint[]): {
  detected: boolean;
  direction: Direction;
  currentWave: number;
  confidence: number;
} => {
  if (points.length < 5) {
    return { detected: false, direction: 'NEUTRAL', currentWave: 0, confidence: 0 };
  }
  
  const recentPoints = points.slice(-7);
  
  // Look for alternating highs and lows
  let alternating = true;
  for (let i = 1; i < recentPoints.length; i++) {
    if (recentPoints[i].type === recentPoints[i - 1].type) {
      alternating = false;
      break;
    }
  }
  
  if (!alternating) {
    return { detected: false, direction: 'NEUTRAL', currentWave: 0, confidence: 0 };
  }
  
  // Determine if uptrend or downtrend impulse
  const firstPoint = recentPoints[0];
  const lastPoint = recentPoints[recentPoints.length - 1];
  
  const direction: Direction = lastPoint.price > firstPoint.price ? 'UP' : 'DOWN';
  
  // Estimate which wave we're in (simplified)
  const waveCount = recentPoints.length;
  const currentWave = Math.min(5, Math.ceil(waveCount / 2));
  
  // Calculate confidence based on wave structure
  const confidence = Math.min(70, 40 + waveCount * 5);
  
  return { detected: true, direction, currentWave, confidence };
};

// Check for corrective wave structure (ABC)
const detectCorrectiveWave = (points: WavePoint[]): {
  detected: boolean;
  direction: Direction;
  phase: 'A' | 'B' | 'C' | 'unknown';
  confidence: number;
} => {
  if (points.length < 3) {
    return { detected: false, direction: 'NEUTRAL', phase: 'unknown', confidence: 0 };
  }
  
  const recentPoints = points.slice(-4);
  
  // Simple ABC pattern: needs at least 3 alternating points
  if (recentPoints.length >= 3) {
    const [a, b, c] = recentPoints.slice(-3);
    
    // Check for ABC structure
    if (a.type !== b.type && b.type !== c.type) {
      // Downward correction in uptrend
      if (a.type === 'high' && b.type === 'low' && c.type === 'high') {
        if (c.price < a.price) {
          return { detected: true, direction: 'DOWN', phase: 'C', confidence: 50 };
        }
      }
      // Upward correction in downtrend
      if (a.type === 'low' && b.type === 'high' && c.type === 'low') {
        if (c.price > a.price) {
          return { detected: true, direction: 'UP', phase: 'C', confidence: 50 };
        }
      }
    }
  }
  
  return { detected: false, direction: 'NEUTRAL', phase: 'unknown', confidence: 0 };
};

// Fibonacci retracement levels
const FIBONACCI_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];

// Check for Fibonacci retracement alignment
const checkFibonacciAlignment = (
  currentPrice: number,
  swingHigh: number,
  swingLow: number
): { level: number | null; type: 'support' | 'resistance' | null } => {
  const range = swingHigh - swingLow;
  
  for (const level of FIBONACCI_LEVELS) {
    const fibPrice = swingLow + range * level;
    const tolerance = range * 0.02; // 2% tolerance
    
    if (Math.abs(currentPrice - fibPrice) < tolerance) {
      return { level, type: currentPrice > fibPrice ? 'support' : 'resistance' };
    }
  }
  
  return { level: null, type: null };
};

// Main Elliott Wave analysis function
export const analyzeElliottWave = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Need sufficient data for wave analysis
  if (priceHistory.length < 30) {
    evidence.push({
      type: 'limitation',
      description: 'Otillräcklig data för våganalys',
      value: `Behöver minst 30 datapunkter, har ${priceHistory.length}`,
      timestamp: new Date().toISOString(),
      source: 'Elliott Wave',
    });
    
    return {
      module: 'elliottWave',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 20,
      coverage: Math.round((priceHistory.length / 30) * 100),
      evidence,
      metadata: { reason: 'Insufficient data' },
    };
  }
  
  // Find swing points
  const lookback = horizon === '1d' ? 3 : horizon === '1w' ? 5 : 7;
  const swingPoints = findSwingPoints(priceHistory, lookback);
  
  if (swingPoints.length < 3) {
    evidence.push({
      type: 'pattern',
      description: 'Inga tydliga vågmönster identifierade',
      value: 'Marknaden är i konsolidering',
      timestamp: new Date().toISOString(),
      source: 'Elliott Wave',
    });
    
    return {
      module: 'elliottWave',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 40,
      coverage: 70,
      evidence,
      metadata: { swingPoints: swingPoints.length },
    };
  }
  
  // Check for impulse wave
  const impulse = detectImpulseWave(swingPoints);
  
  // Check for corrective wave
  const corrective = detectCorrectiveWave(swingPoints);
  
  let direction: Direction = 'NEUTRAL';
  let strength = 50;
  let confidence = 40;
  
  if (impulse.detected) {
    direction = impulse.direction;
    strength = 50 + impulse.currentWave * 8;
    confidence = impulse.confidence;
    
    evidence.push({
      type: 'impulse_wave',
      description: `Impulsvåg ${impulse.direction === 'UP' ? 'uppåt' : 'nedåt'}`,
      value: `Våg ${impulse.currentWave} av 5`,
      timestamp: new Date().toISOString(),
      source: 'Elliott Wave',
    });
    
    // Wave-specific signals
    if (impulse.currentWave <= 2) {
      evidence.push({
        type: 'wave_position',
        description: 'Tidig fas i impulsvåg',
        value: 'Potential för fortsatt rörelse i trendriktning',
        timestamp: new Date().toISOString(),
        source: 'Wave Analysis',
      });
    } else if (impulse.currentWave >= 4) {
      evidence.push({
        type: 'wave_position',
        description: 'Sen fas i impulsvåg',
        value: 'Förvänta korrektion efter våg 5',
        timestamp: new Date().toISOString(),
        source: 'Wave Analysis',
      });
    }
  } else if (corrective.detected) {
    // Corrective wave suggests opposite direction when complete
    direction = corrective.direction === 'UP' ? 'DOWN' : 'UP';
    strength = 45;
    confidence = corrective.confidence;
    
    evidence.push({
      type: 'corrective_wave',
      description: `Korrigerande ABC-mönster`,
      value: `Fas: ${corrective.phase}`,
      timestamp: new Date().toISOString(),
      source: 'Elliott Wave',
    });
  }
  
  // Check Fibonacci alignment
  if (swingPoints.length >= 2) {
    const highs = swingPoints.filter(p => p.type === 'high').map(p => p.price);
    const lows = swingPoints.filter(p => p.type === 'low').map(p => p.price);
    
    if (highs.length > 0 && lows.length > 0) {
      const recentHigh = Math.max(...highs.slice(-3));
      const recentLow = Math.min(...lows.slice(-3));
      const fibAlignment = checkFibonacciAlignment(currentPrice, recentHigh, recentLow);
      
      if (fibAlignment.level !== null) {
        evidence.push({
          type: 'fibonacci',
          description: `Pris vid Fibonacci ${(fibAlignment.level * 100).toFixed(1)}% nivå`,
          value: `Potentiellt ${fibAlignment.type === 'support' ? 'stöd' : 'motstånd'}`,
          timestamp: new Date().toISOString(),
          source: 'Fibonacci Analysis',
        });
      }
    }
  }
  
  // Add disclaimer
  evidence.push({
    type: 'disclaimer',
    description: '⚠️ Förenklad våganalys',
    value: 'Elliott Wave kräver manuell validering',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  const coverage = Math.min(100, Math.round((swingPoints.length / 10) * 100));
  
  return {
    module: 'elliottWave',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: {
      swingPoints: swingPoints.length,
      impulse,
      corrective,
    },
  };
};

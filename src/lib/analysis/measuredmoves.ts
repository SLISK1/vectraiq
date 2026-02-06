// Measured Moves Analysis Module
// Calculates price targets based on historical move patterns

import { AnalysisResult, PriceData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

interface MoveSegment {
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  movePercent: number;
  duration: number;
  type: 'up' | 'down';
}

// Find significant price moves
const findSignificantMoves = (priceHistory: PriceData[], minMovePercent: number = 3): MoveSegment[] => {
  const moves: MoveSegment[] = [];
  const prices = priceHistory.map(p => p.close ?? p.price);
  
  if (prices.length < 5) return moves;
  
  let currentStart = 0;
  let currentHigh = prices[0];
  let currentLow = prices[0];
  let highIndex = 0;
  let lowIndex = 0;
  
  for (let i = 1; i < prices.length; i++) {
    const price = prices[i];
    
    if (price > currentHigh) {
      currentHigh = price;
      highIndex = i;
    }
    if (price < currentLow) {
      currentLow = price;
      lowIndex = i;
    }
    
    // Check if we have a significant move
    const upMove = ((currentHigh - prices[currentStart]) / prices[currentStart]) * 100;
    const downMove = ((prices[currentStart] - currentLow) / prices[currentStart]) * 100;
    
    // If price reverses significantly from the high/low
    if (highIndex < i && upMove >= minMovePercent) {
      const reversal = ((currentHigh - price) / currentHigh) * 100;
      if (reversal >= minMovePercent * 0.5) {
        moves.push({
          startIndex: currentStart,
          endIndex: highIndex,
          startPrice: prices[currentStart],
          endPrice: currentHigh,
          movePercent: upMove,
          duration: highIndex - currentStart,
          type: 'up',
        });
        currentStart = highIndex;
        currentHigh = price;
        currentLow = price;
        highIndex = i;
        lowIndex = i;
      }
    }
    
    if (lowIndex < i && downMove >= minMovePercent) {
      const reversal = ((price - currentLow) / currentLow) * 100;
      if (reversal >= minMovePercent * 0.5) {
        moves.push({
          startIndex: currentStart,
          endIndex: lowIndex,
          startPrice: prices[currentStart],
          endPrice: currentLow,
          movePercent: -downMove,
          duration: lowIndex - currentStart,
          type: 'down',
        });
        currentStart = lowIndex;
        currentHigh = price;
        currentLow = price;
        highIndex = i;
        lowIndex = i;
      }
    }
  }
  
  return moves;
};

// Calculate average move characteristics
const calculateMoveStats = (moves: MoveSegment[]): {
  avgUpMove: number;
  avgDownMove: number;
  avgUpDuration: number;
  avgDownDuration: number;
  upMoveCount: number;
  downMoveCount: number;
} => {
  const upMoves = moves.filter(m => m.type === 'up');
  const downMoves = moves.filter(m => m.type === 'down');
  
  return {
    avgUpMove: upMoves.length > 0 
      ? upMoves.reduce((sum, m) => sum + m.movePercent, 0) / upMoves.length 
      : 0,
    avgDownMove: downMoves.length > 0 
      ? Math.abs(downMoves.reduce((sum, m) => sum + m.movePercent, 0) / downMoves.length)
      : 0,
    avgUpDuration: upMoves.length > 0 
      ? upMoves.reduce((sum, m) => sum + m.duration, 0) / upMoves.length 
      : 0,
    avgDownDuration: downMoves.length > 0 
      ? downMoves.reduce((sum, m) => sum + m.duration, 0) / downMoves.length 
      : 0,
    upMoveCount: upMoves.length,
    downMoveCount: downMoves.length,
  };
};

// Detect current move phase
const detectCurrentPhase = (
  priceHistory: PriceData[],
  moves: MoveSegment[]
): { phase: 'impulse' | 'correction' | 'consolidation'; direction: Direction; progress: number } => {
  if (moves.length < 2) {
    return { phase: 'consolidation', direction: 'NEUTRAL', progress: 50 };
  }
  
  const prices = priceHistory.map(p => p.close ?? p.price);
  const currentPrice = prices[prices.length - 1];
  const lastMove = moves[moves.length - 1];
  const prevMove = moves.length > 1 ? moves[moves.length - 2] : null;
  
  // Check if current price extends the last move or reverses
  const lastMoveEnd = lastMove.endPrice;
  const priceChange = ((currentPrice - lastMoveEnd) / lastMoveEnd) * 100;
  
  // Determine if we're in impulse or correction
  if (lastMove.type === 'up') {
    if (priceChange > 1) {
      // Continuing up
      return { 
        phase: 'impulse', 
        direction: 'UP', 
        progress: Math.min(100, (priceChange / lastMove.movePercent) * 100) 
      };
    } else if (priceChange < -1) {
      // Correcting down
      const correctionPercent = Math.abs(priceChange) / lastMove.movePercent * 100;
      return { 
        phase: 'correction', 
        direction: 'DOWN', 
        progress: Math.min(100, correctionPercent) 
      };
    }
  } else {
    if (priceChange < -1) {
      // Continuing down
      return { 
        phase: 'impulse', 
        direction: 'DOWN', 
        progress: Math.min(100, (Math.abs(priceChange) / Math.abs(lastMove.movePercent)) * 100) 
      };
    } else if (priceChange > 1) {
      // Correcting up
      const correctionPercent = priceChange / Math.abs(lastMove.movePercent) * 100;
      return { 
        phase: 'correction', 
        direction: 'UP', 
        progress: Math.min(100, correctionPercent) 
      };
    }
  }
  
  return { phase: 'consolidation', direction: 'NEUTRAL', progress: 50 };
};

// Calculate measured move target
const calculateMeasuredTarget = (
  currentPrice: number,
  avgMove: number,
  direction: 'up' | 'down',
  progress: number
): number => {
  const remainingMove = (100 - progress) / 100;
  if (direction === 'up') {
    return currentPrice * (1 + (avgMove / 100) * remainingMove);
  } else {
    return currentPrice * (1 - (avgMove / 100) * remainingMove);
  }
};

// Main Measured Moves analysis function
export const analyzeMeasuredMoves = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Need sufficient data for move analysis
  if (priceHistory.length < 20) {
    evidence.push({
      type: 'limitation',
      description: 'Otillräcklig data för rörelseanalys',
      value: `Behöver minst 20 datapunkter, har ${priceHistory.length}`,
      timestamp: new Date().toISOString(),
      source: 'Measured Moves',
    });
    
    return {
      module: 'measuredMoves',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 20,
      coverage: Math.round((priceHistory.length / 20) * 100),
      evidence,
      metadata: { reason: 'Insufficient data' },
    };
  }
  
  // Adjust min move percent based on horizon
  const minMovePercent = horizon === '1d' ? 2 : horizon === '1w' ? 3 : horizon === '1mo' ? 5 : 8;
  
  // Find significant moves
  const moves = findSignificantMoves(priceHistory, minMovePercent);
  
  if (moves.length < 2) {
    evidence.push({
      type: 'pattern',
      description: 'Inga tydliga rörelsemönster identifierade',
      value: 'Marknaden saknar definierade trender',
      timestamp: new Date().toISOString(),
      source: 'Measured Moves',
    });
    
    return {
      module: 'measuredMoves',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 35,
      coverage: 60,
      evidence,
      metadata: { movesFound: moves.length },
    };
  }
  
  // Calculate move statistics
  const stats = calculateMoveStats(moves);
  
  evidence.push({
    type: 'statistics',
    description: 'Historiska rörelsemönster',
    value: `Snitt uppgång: ${stats.avgUpMove.toFixed(1)}%, Snitt nedgång: ${stats.avgDownMove.toFixed(1)}%`,
    timestamp: new Date().toISOString(),
    source: 'Move Statistics',
  });
  
  // Detect current phase
  const currentPhase = detectCurrentPhase(priceHistory, moves);
  
  let direction: Direction = currentPhase.direction;
  let strength = 50;
  let confidence = 45;
  
  // Calculate targets based on phase
  if (currentPhase.phase === 'impulse') {
    const targetMove = direction === 'UP' ? stats.avgUpMove : stats.avgDownMove;
    const target = calculateMeasuredTarget(currentPrice, targetMove, direction === 'UP' ? 'up' : 'down', currentPhase.progress);
    const targetPercent = ((target - currentPrice) / currentPrice) * 100;
    
    evidence.push({
      type: 'target',
      description: `Uppmätt mål (${direction === 'UP' ? 'uppåt' : 'nedåt'})`,
      value: `Mål: ${target.toFixed(2)} (${targetPercent >= 0 ? '+' : ''}${targetPercent.toFixed(1)}%)`,
      timestamp: new Date().toISOString(),
      source: 'Measured Moves',
    });
    
    strength = Math.min(80, 55 + Math.abs(targetPercent) * 2);
    confidence = Math.min(70, 50 + (100 - currentPhase.progress) / 3);
    
    evidence.push({
      type: 'phase',
      description: 'Impulsfas pågår',
      value: `${currentPhase.progress.toFixed(0)}% av genomsnittlig rörelse`,
      timestamp: new Date().toISOString(),
      source: 'Phase Analysis',
    });
    
  } else if (currentPhase.phase === 'correction') {
    // In correction, expect reversal back to trend
    const lastTrend = moves[moves.length - 1].type;
    direction = lastTrend === 'up' ? 'UP' : 'DOWN';
    
    // Calculate expected correction depth
    const avgCorrectionDepth = lastTrend === 'up' 
      ? stats.avgDownMove / stats.avgUpMove * 100 
      : stats.avgUpMove / stats.avgDownMove * 100;
    
    const expectedCorrectionEnd = avgCorrectionDepth > 0 ? Math.min(61.8, avgCorrectionDepth) : 38.2;
    
    evidence.push({
      type: 'correction',
      description: 'Korrektionsfas',
      value: `${currentPhase.progress.toFixed(0)}% korrigerat, förväntat: ~${expectedCorrectionEnd.toFixed(0)}%`,
      timestamp: new Date().toISOString(),
      source: 'Correction Analysis',
    });
    
    // Higher strength if correction is near expected end
    if (currentPhase.progress >= expectedCorrectionEnd * 0.8) {
      strength = 60 + (currentPhase.progress - expectedCorrectionEnd * 0.8) / 2;
      confidence = 55;
      evidence.push({
        type: 'signal',
        description: 'Korrektion närmar sig slut',
        value: `Potentiell återupptagning av ${lastTrend === 'up' ? 'upptrend' : 'nedtrend'}`,
        timestamp: new Date().toISOString(),
        source: 'Measured Moves',
      });
    } else {
      strength = 45;
      confidence = 40;
    }
  } else {
    // Consolidation
    direction = 'NEUTRAL';
    strength = 50;
    confidence = 35;
    
    evidence.push({
      type: 'phase',
      description: 'Konsolideringsfas',
      value: 'Väntar på nästa riktningsrörelse',
      timestamp: new Date().toISOString(),
      source: 'Phase Analysis',
    });
  }
  
  // Add symmetry analysis
  if (moves.length >= 4) {
    const recentMoves = moves.slice(-4);
    const upMoves = recentMoves.filter(m => m.type === 'up');
    const downMoves = recentMoves.filter(m => m.type === 'down');
    
    if (upMoves.length === 2 && downMoves.length === 2) {
      const upSymmetry = Math.abs(upMoves[0].movePercent - upMoves[1].movePercent) / upMoves[0].movePercent;
      const downSymmetry = Math.abs(downMoves[0].movePercent - downMoves[1].movePercent) / downMoves[0].movePercent;
      
      if (upSymmetry < 0.3 && downSymmetry < 0.3) {
        confidence += 10;
        evidence.push({
          type: 'symmetry',
          description: 'Symmetriska rörelsemönster',
          value: 'Hög förutsägbarhet i prisrörelser',
          timestamp: new Date().toISOString(),
          source: 'Pattern Symmetry',
        });
      }
    }
  }
  
  // Calculate coverage based on data quality
  const coverage = Math.min(100, Math.round((moves.length / 6) * 100));
  
  return {
    module: 'measuredMoves',
    direction,
    strength: Math.max(0, Math.min(100, Math.round(strength))),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    coverage,
    evidence,
    metadata: {
      movesFound: moves.length,
      stats,
      currentPhase,
    },
  };
};

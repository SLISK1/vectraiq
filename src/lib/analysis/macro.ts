// Macro Analysis Module
// Interest rates, inflation, GDP, currency effects

import { AnalysisResult, PriceData, MacroData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Current macro environment estimates (would come from API in production)
const getCurrentMacroData = (): MacroData => {
  // Swedish/European macro data estimates (Feb 2026)
  return {
    interestRate: 3.25, // Riksbank policy rate
    inflation: 2.1, // CPIF
    gdpGrowth: 1.8, // Annual
    unemploymentRate: 7.2,
    currencyStrength: 0.5, // SEK relative strength (-1 to 1)
  };
};

// Analyze how macro affects different asset types
const analyzeMacroImpact = (
  macro: MacroData,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon
): { score: number; signals: Evidence[] } => {
  let score = 0;
  const signals: Evidence[] = [];
  
  // Interest Rate Impact
  if (macro.interestRate !== undefined) {
    if (assetType === 'stock') {
      // High rates generally negative for stocks
      if (macro.interestRate > 4) {
        score -= 1;
        signals.push({
          type: 'interest_rate',
          description: 'Höga räntor pressar aktievärderingar',
          value: `Styrränta: ${macro.interestRate}%`,
          timestamp: new Date().toISOString(),
          source: 'Riksbanken',
        });
      } else if (macro.interestRate < 2) {
        score += 1;
        signals.push({
          type: 'interest_rate',
          description: 'Låga räntor stödjer aktievärderingar',
          value: `Styrränta: ${macro.interestRate}%`,
          timestamp: new Date().toISOString(),
          source: 'Riksbanken',
        });
      }
    } else if (assetType === 'crypto') {
      // High rates historically negative for crypto (risk-off)
      if (macro.interestRate > 4) {
        score -= 2;
        signals.push({
          type: 'interest_rate',
          description: 'Höga räntor driver kapital från riskfyllda tillgångar',
          value: `Styrränta: ${macro.interestRate}%`,
          timestamp: new Date().toISOString(),
          source: 'Riksbanken',
        });
      }
    } else if (assetType === 'metal') {
      // Gold benefits from negative real rates
      const realRate = macro.interestRate - (macro.inflation ?? 2);
      if (realRate < 0) {
        score += 1;
        signals.push({
          type: 'real_rate',
          description: 'Negativ realränta stödjer guldpriset',
          value: `Realränta: ${realRate.toFixed(1)}%`,
          timestamp: new Date().toISOString(),
          source: 'Ränte/Inflationsanalys',
        });
      }
    }
  }
  
  // Inflation Impact
  if (macro.inflation !== undefined) {
    if (macro.inflation > 4) {
      if (assetType === 'metal') {
        score += 2;
        signals.push({
          type: 'inflation',
          description: 'Hög inflation driver efterfrågan på ädelmetaller',
          value: `Inflation: ${macro.inflation}%`,
          timestamp: new Date().toISOString(),
          source: 'SCB',
        });
      } else if (assetType === 'stock') {
        score -= 1;
        signals.push({
          type: 'inflation',
          description: 'Hög inflation pressar konsumtion och marginaler',
          value: `Inflation: ${macro.inflation}%`,
          timestamp: new Date().toISOString(),
          source: 'SCB',
        });
      }
    } else if (macro.inflation >= 1 && macro.inflation <= 3) {
      signals.push({
        type: 'inflation',
        description: 'Stabil inflation inom målintervall',
        value: `Inflation: ${macro.inflation}%`,
        timestamp: new Date().toISOString(),
        source: 'SCB',
      });
    }
  }
  
  // GDP Growth Impact
  if (macro.gdpGrowth !== undefined) {
    if (macro.gdpGrowth > 2.5) {
      if (assetType === 'stock') {
        score += 2;
        signals.push({
          type: 'gdp',
          description: 'Stark ekonomisk tillväxt gynnar företagsvinster',
          value: `BNP-tillväxt: ${macro.gdpGrowth}%`,
          timestamp: new Date().toISOString(),
          source: 'SCB',
        });
      }
    } else if (macro.gdpGrowth < 0) {
      if (assetType === 'stock') {
        score -= 2;
        signals.push({
          type: 'gdp',
          description: 'Recession riskerar företagsvinster',
          value: `BNP-tillväxt: ${macro.gdpGrowth}%`,
          timestamp: new Date().toISOString(),
          source: 'SCB',
        });
      } else if (assetType === 'metal') {
        score += 1;
        signals.push({
          type: 'gdp',
          description: 'Ekonomisk osäkerhet driver safe-haven efterfrågan',
          value: `BNP-tillväxt: ${macro.gdpGrowth}%`,
          timestamp: new Date().toISOString(),
          source: 'SCB',
        });
      }
    }
  }
  
  // Currency Strength (for SEK-denominated assets)
  if (macro.currencyStrength !== undefined) {
    if (macro.currencyStrength < -0.3) {
      // Weak SEK
      if (assetType === 'stock') {
        signals.push({
          type: 'currency',
          description: 'Svag krona gynnar exportbolag',
          value: 'SEK relativt svag',
          timestamp: new Date().toISOString(),
          source: 'Valutaanalys',
        });
      }
    }
  }
  
  // Unemployment
  if (macro.unemploymentRate !== undefined) {
    signals.push({
      type: 'labor',
      description: 'Arbetsmarknadsläge',
      value: `Arbetslöshet: ${macro.unemploymentRate}%`,
      timestamp: new Date().toISOString(),
      source: 'Arbetsförmedlingen',
    });
  }
  
  return { score, signals };
};

// Main macro analysis function
export const analyzeMacro = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  assetType: 'stock' | 'crypto' | 'metal'
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Macro analysis is more relevant for longer horizons
  const horizonWeight = horizon === '1y' ? 1.0 :
                        horizon === '1mo' ? 0.7 :
                        horizon === '1w' ? 0.3 : 0.1;
  
  // Get current macro data
  const macroData = getCurrentMacroData();
  
  // Analyze impact
  const { score, signals } = analyzeMacroImpact(macroData, assetType, horizon);
  evidence.push(...signals);
  
  // Add general market conditions
  evidence.push({
    type: 'environment',
    description: 'Makromiljö',
    value: score > 0 ? 'Gynnsam för tillgångsklassen' : 
           score < 0 ? 'Utmanande för tillgångsklassen' : 'Neutral',
    timestamp: new Date().toISOString(),
    source: 'Macro Analysis',
  });
  
  // Add disclaimer
  evidence.push({
    type: 'disclaimer',
    description: '⚠️ Makrodata uppdateras inte i realtid',
    value: 'Kräver integration med ekonomisk datakälla',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  // Determine direction
  const direction: Direction = score > 1 ? 'UP' : score < -1 ? 'DOWN' : 'NEUTRAL';
  
  // Strength adjusted by horizon
  const baseStrength = Math.min(100, Math.max(0, 50 + score * 12));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  
  // Coverage - macro data is available but may not be current
  const coverage = 60;
  
  // Confidence based on horizon relevance
  const confidence = Math.round(40 + horizonWeight * 30);
  
  return {
    module: 'macro',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: { macroData, score, horizonWeight },
  };
};

// Macro Analysis Module
// Interest rates, inflation, GDP, currency effects
// Fetches live data from macro_cache (populated by fetch-macro edge function)

import { AnalysisResult, PriceData, MacroData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';

// Cache macro data client-side for 1 hour
let macroCacheData: MacroData | null = null;
let macroCacheTime = 0;
const MACRO_CLIENT_TTL = 60 * 60 * 1000; // 1 hour

// Fetch macro data from DB (populated by fetch-macro edge function)
const fetchMacroFromDB = async (): Promise<MacroData> => {
  // Return cached if fresh
  if (macroCacheData && Date.now() - macroCacheTime < MACRO_CLIENT_TTL) {
    return macroCacheData;
  }
  
  try {
    const { data, error } = await supabase
      .from('macro_cache')
      .select('series_key, value, fetched_at, valid_until');
    
    if (error || !data || data.length === 0) {
      throw new Error('No macro cache data');
    }
    
    const byKey: Record<string, number> = {};
    for (const row of data) {
      byKey[row.series_key] = Number(row.value);
    }
    
    const result: MacroData = {
      interestRate: byKey['riksbank_rate'] ?? 3.25,
      inflation: byKey['scb_cpif'] ?? 2.1,
      gdpGrowth: byKey['scb_gdp_growth'] ?? 1.8,
      unemploymentRate: 7.2, // SCB unemployment not yet fetched — kept as static
      currencyStrength: byKey['sek_strength'] ?? 0.5,
    };
    
    // Check freshness — if data is stale (> 7 days), reduce confidence later
    const oldestFetchTime = Math.min(
      ...data.map(d => new Date(d.fetched_at).getTime())
    );
    const isStale = Date.now() - oldestFetchTime > 7 * 24 * 60 * 60 * 1000;
    (result as any)._isStale = isStale;
    
    macroCacheData = result;
    macroCacheTime = Date.now();
    return result;
  } catch {
    // Fallback to static values if DB unavailable
    return {
      interestRate: 3.25,
      inflation: 2.1,
      gdpGrowth: 1.8,
      unemploymentRate: 7.2,
      currencyStrength: 0.5,
    };
  }
};

// Sync fallback for use in synchronous analysis flow
const getStaticMacroData = (): MacroData => {
  if (macroCacheData) return macroCacheData;
  return {
    interestRate: 3.25,
    inflation: 2.1,
    gdpGrowth: 1.8,
    unemploymentRate: 7.2,
    currencyStrength: 0.5,
  };
};

// Analyze how macro affects different asset types
const analyzeMacroImpact = (
  macro: MacroData,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  horizon: Horizon
): { score: number; signals: Evidence[] } => {
  let score = 0;
  const signals: Evidence[] = [];
  
  if (macro.interestRate !== undefined) {
    if (assetType === 'stock') {
      if (macro.interestRate > 4) {
        score -= 1;
        signals.push({ type: 'interest_rate', description: 'Höga räntor pressar aktievärderingar', value: `Styrränta: ${macro.interestRate}%`, timestamp: new Date().toISOString(), source: 'Riksbanken' });
      } else if (macro.interestRate < 2) {
        score += 1;
        signals.push({ type: 'interest_rate', description: 'Låga räntor stödjer aktievärderingar', value: `Styrränta: ${macro.interestRate}%`, timestamp: new Date().toISOString(), source: 'Riksbanken' });
      }
    } else if (assetType === 'crypto') {
      if (macro.interestRate > 4) {
        score -= 2;
        signals.push({ type: 'interest_rate', description: 'Höga räntor driver kapital från riskfyllda tillgångar', value: `Styrränta: ${macro.interestRate}%`, timestamp: new Date().toISOString(), source: 'Riksbanken' });
      } else if (macro.interestRate < 2) {
        score += 1;
        signals.push({ type: 'interest_rate', description: 'Låga räntor gynnar riskfyllda tillgångar', value: `Styrränta: ${macro.interestRate}%`, timestamp: new Date().toISOString(), source: 'Riksbanken' });
      }
    } else if (assetType === 'metal') {
      const realRate = macro.interestRate - (macro.inflation ?? 2);
      if (realRate < 0) {
        score += 1;
        signals.push({ type: 'real_rate', description: 'Negativ realränta stödjer guldpriset', value: `Realränta: ${realRate.toFixed(1)}%`, timestamp: new Date().toISOString(), source: 'Ränte/Inflationsanalys' });
      }
    }
  }
  
  if (macro.inflation !== undefined) {
    if (macro.inflation > 4) {
      if (assetType === 'metal') {
        score += 2;
        signals.push({ type: 'inflation', description: 'Hög inflation driver efterfrågan på ädelmetaller', value: `Inflation: ${macro.inflation}%`, timestamp: new Date().toISOString(), source: 'SCB' });
      } else if (assetType === 'stock') {
        score -= 1;
        signals.push({ type: 'inflation', description: 'Hög inflation pressar konsumtion och marginaler', value: `Inflation: ${macro.inflation}%`, timestamp: new Date().toISOString(), source: 'SCB' });
      }
    } else if (macro.inflation >= 1 && macro.inflation <= 3) {
      signals.push({ type: 'inflation', description: 'Stabil inflation inom målintervall', value: `Inflation: ${macro.inflation}%`, timestamp: new Date().toISOString(), source: 'SCB' });
    }
  }
  
  if (macro.gdpGrowth !== undefined) {
    if (macro.gdpGrowth > 2.5) {
      if (assetType === 'stock') {
        score += 2;
        signals.push({ type: 'gdp', description: 'Stark ekonomisk tillväxt gynnar företagsvinster', value: `BNP-tillväxt: ${macro.gdpGrowth}%`, timestamp: new Date().toISOString(), source: 'SCB' });
      }
    } else if (macro.gdpGrowth < 0) {
      if (assetType === 'stock') {
        score -= 2;
        signals.push({ type: 'gdp', description: 'Recession riskerar företagsvinster', value: `BNP-tillväxt: ${macro.gdpGrowth}%`, timestamp: new Date().toISOString(), source: 'SCB' });
      } else if (assetType === 'metal') {
        score += 1;
        signals.push({ type: 'gdp', description: 'Ekonomisk osäkerhet driver safe-haven efterfrågan', value: `BNP-tillväxt: ${macro.gdpGrowth}%`, timestamp: new Date().toISOString(), source: 'SCB' });
      }
    }
  }
  
  if (macro.currencyStrength !== undefined) {
    if (macro.currencyStrength < -0.3) {
      if (assetType === 'stock') {
        signals.push({ type: 'currency', description: 'Svag krona gynnar exportbolag', value: 'SEK relativt svag', timestamp: new Date().toISOString(), source: 'Valutaanalys' });
      }
    } else if (macro.currencyStrength > 0.3) {
      if (assetType === 'stock') {
        signals.push({ type: 'currency', description: 'Stark krona kan trycka ner exportintäkter', value: 'SEK relativt stark', timestamp: new Date().toISOString(), source: 'Valutaanalys' });
      }
    }
  }
  
  if (macro.unemploymentRate !== undefined) {
    signals.push({ type: 'labor', description: 'Arbetsmarknadsläge', value: `Arbetslöshet: ${macro.unemploymentRate}%`, timestamp: new Date().toISOString(), source: 'Arbetsförmedlingen' });
  }
  
  return { score, signals };
};

// Main macro analysis function (synchronous — uses cached data)
export const analyzeMacro = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund'
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  const horizonWeight = horizon === '1y' ? 1.0 :
                        horizon === '1mo' ? 0.7 :
                        horizon === '1w' ? 0.3 : 0.1;
  
  // Use cached data (populated async by initMacroCache)
  const macroData = getStaticMacroData();
  const isStale = (macroData as any)._isStale === true;
  
  const { score, signals } = analyzeMacroImpact(macroData, assetType, horizon);
  evidence.push(...signals);
  
  evidence.push({
    type: 'environment',
    description: 'Makromiljö',
    value: score > 0 ? 'Gynnsam för tillgångsklassen' : 
           score < 0 ? 'Utmanande för tillgångsklassen' : 'Neutral',
    timestamp: new Date().toISOString(),
    source: isStale ? 'Macro Analysis (föråldrad data)' : 'Macro Analysis (live data)',
  });
  
  if (isStale) {
    evidence.push({
      type: 'disclaimer',
      description: '⚠️ Makrodata är äldre än 7 dagar',
      value: 'Uppdateras automatiskt varje vecka',
      timestamp: new Date().toISOString(),
      source: 'System',
    });
  }
  
  const direction: Direction = score > 1 ? 'UP' : score < -1 ? 'DOWN' : 'NEUTRAL';
  const baseStrength = Math.min(100, Math.max(0, 50 + score * 12));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  const coverage = isStale ? 40 : 65; // Lower coverage if stale
  
  // Reduce confidence if data is stale
  const baseConfidence = Math.round(40 + horizonWeight * 30);
  const confidence = isStale ? Math.min(baseConfidence, 50) : baseConfidence;
  
  return {
    module: 'macro',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: { macroData, score, horizonWeight, isStale },
  };
};

// Initialize macro cache from DB (call once at app startup)
export const initMacroCache = async (): Promise<void> => {
  try {
    await fetchMacroFromDB();
    console.log('Macro cache initialized from DB');
  } catch {
    console.log('Macro cache using static fallback values');
  }
};

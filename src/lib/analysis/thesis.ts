// Strategic Thesis Module
//
// Reads pre-fetched LLM-generated qualitative analysis from
// strategic_thesis_cache (populated by analyze-thesis edge fn).
//
// IMPORTANT — intellectual honesty:
// This module reflects an LLM's qualitative reasoning about a company's
// strategic positioning. The LLM is good at pattern-matching against known
// secular themes, identifying moats from public data, and flagging risks.
// It is BAD at predicting the future — it cannot tell you "Ozempic will be
// huge" before the data shows it.
//
// Two safety valves are applied:
//   1. The signal is dampened when it diverges sharply from observed price
//      action (relative strength). LLM thesis is not a substitute for the market.
//   2. Confidence is capped by risk_class — pre-revenue/spotlight names get
//      heavy caps because the model cannot reliably evaluate them.

import { AnalysisResult, AnalysisContext, StrategicThesisData } from './types';
import { Direction, Evidence } from '@/types/market';

// Convert thesis score (0-100) to signal direction & strength.
// Thesis is fundamentally a slow-moving signal, so we use generous deadbands.
function thesisToSignal(thesis: StrategicThesisData, context: AnalysisContext): AnalysisResult {
  const evidence: Evidence[] = [];
  const ageDays = (Date.now() - new Date(thesis.updatedAt).getTime()) / (1000 * 60 * 60 * 24);

  // Direction with wide deadband — tepid theses don't generate signals
  let direction: Direction = 'NEUTRAL';
  if (thesis.thesisScore >= 65) direction = 'UP';
  else if (thesis.thesisScore <= 35) direction = 'DOWN';

  // Strength: thesis score in 50-100 range maps to strength 50-90
  const distFromNeutral = Math.abs(thesis.thesisScore - 50);
  const strength = Math.round(50 + Math.min(40, distFromNeutral));

  // Confidence reflects how much we trust the thesis itself
  let confidence = 40;
  // Strong moat + high uniqueness = trust the thesis more
  confidence += Math.min(15, (thesis.moatScore + thesis.uniquenessScore) * 0.75);
  // Massive market = bigger payoff = thesis matters more
  if (thesis.marketSize === 'massive') confidence += 8;
  else if (thesis.marketSize === 'large') confidence += 4;
  else if (thesis.marketSize === 'small') confidence -= 6;
  // Stale thesis = less trust
  if (ageDays > 90) confidence -= 10;
  else if (ageDays > 60) confidence -= 5;

  confidence = Math.max(20, Math.min(80, Math.round(confidence)));

  // Coverage based on how much detail the thesis has
  const coverage = Math.min(80,
    30 +
    (thesis.thesisSummary.length > 100 ? 15 : 0) +
    Math.min(15, thesis.themes.length * 5) +
    Math.min(10, thesis.keyRisks.length * 3) +
    Math.min(10, thesis.catalysts.length * 3)
  );

  // SAFETY VALVE 1: Dampen if thesis disagrees with relative strength.
  // If LLM says "great thesis" (UP) but stock is underperforming sector (DOWN RS),
  // the LLM is probably wrong or premature. Halve the signal.
  const rs = context.relativeStrength;
  if (rs && rs.sectorReturn1m !== null && context.priceHistory.length >= 22) {
    const recent = context.priceHistory[context.priceHistory.length - 1];
    const past = context.priceHistory[context.priceHistory.length - 22];
    const r = recent?.close ?? recent?.price;
    const p = past?.close ?? past?.price;
    if (r && p && p > 0) {
      const own1m = (r - p) / p;
      const rsVsSector = own1m - (rs.sectorReturn1m ?? 0);
      // Disagreement: thesis UP but stock badly underperforming sector (>5pp)
      if (direction === 'UP' && rsVsSector < -0.05) {
        confidence = Math.round(confidence * 0.6);
        evidence.push({
          type: 'thesis_rs_divergence',
          description: 'Tes positiv men priset svagare än sektorn',
          value: `RS ${(rsVsSector * 100).toFixed(1)}pp — modellen kan ha fel eller vara för tidig`,
          timestamp: new Date().toISOString(),
          source: 'Safety Valve',
        });
      }
      // Disagreement: thesis DOWN but stock outperforming
      if (direction === 'DOWN' && rsVsSector > 0.05) {
        confidence = Math.round(confidence * 0.6);
        evidence.push({
          type: 'thesis_rs_divergence',
          description: 'Tes negativ men priset starkare än sektorn',
          value: `RS +${(rsVsSector * 100).toFixed(1)}pp — modellen kan ha fel`,
          timestamp: new Date().toISOString(),
          source: 'Safety Valve',
        });
      }
    }
  }

  // SAFETY VALVE 2: Cap by risk class — done in engine.ts via riskClassConfidenceMultiplier

  // Build evidence
  evidence.push({
    type: 'thesis_score',
    description: 'Strategisk tes (LLM-baserad)',
    value: `${thesis.thesisScore}/100 — Unikhet ${thesis.uniquenessScore}/10, Vallgrav ${thesis.moatScore}/10`,
    timestamp: thesis.updatedAt,
    source: thesis.modelUsed,
  });

  if (thesis.themes.length > 0) {
    evidence.push({
      type: 'themes',
      description: 'Sekulära teman',
      value: thesis.themes.slice(0, 3).join(', '),
      timestamp: thesis.updatedAt,
      source: 'LLM',
    });
  }

  evidence.push({
    type: 'market_size',
    description: 'Marknadsstorlek',
    value: thesis.marketSize,
    timestamp: thesis.updatedAt,
    source: 'LLM',
  });

  if (thesis.catalysts.length > 0) {
    evidence.push({
      type: 'catalyst',
      description: 'Triggers framåt',
      value: thesis.catalysts[0],
      timestamp: thesis.updatedAt,
      source: 'LLM',
    });
  }

  if (thesis.keyRisks.length > 0) {
    evidence.push({
      type: 'risk',
      description: 'Främsta risk',
      value: thesis.keyRisks[0],
      timestamp: thesis.updatedAt,
      source: 'LLM',
    });
  }

  if (ageDays > 60) {
    evidence.push({
      type: 'stale',
      description: 'Tes är inte färsk',
      value: `${Math.round(ageDays)}d sedan senaste analys`,
      timestamp: thesis.updatedAt,
      source: 'System',
    });
  }

  return {
    module: 'thesis',
    direction,
    strength,
    confidence,
    coverage,
    evidence,
    metadata: {
      source: 'strategic_thesis_cache',
      thesisScore: thesis.thesisScore,
      moatScore: thesis.moatScore,
      uniquenessScore: thesis.uniquenessScore,
      marketSize: thesis.marketSize,
      themes: thesis.themes,
      ageDays: Math.round(ageDays),
    },
  };
}

function noDataResult(reason: string): AnalysisResult {
  return {
    module: 'thesis',
    direction: 'NEUTRAL',
    strength: 50,
    confidence: 25,
    coverage: 10,
    evidence: [{
      type: 'no_data',
      description: 'Strategisk tes saknas',
      value: reason,
      timestamp: new Date().toISOString(),
      source: 'System',
    }],
    metadata: { source: 'no_data', reason },
  };
}

export const analyzeThesis = (context: AnalysisContext): AnalysisResult => {
  const thesis = context.strategicThesis;
  if (!thesis) {
    return noDataResult('strategic_thesis_cache miss — kör analyze-thesis för denna ticker');
  }
  return thesisToSignal(thesis, context);
};

// ============================================================
// Risk-class confidence multipliers
// Used by engine.ts to cap total confidence when risk_class indicates
// the model has limited ability to evaluate the asset.
// ============================================================
export const RISK_CLASS_CONFIDENCE_MULTIPLIER: Record<string, number> = {
  'main': 1.0,
  'first_north': 0.85,
  'growth': 0.85,
  'spotlight': 0.65,
  'ngm': 0.65,
  'high_risk': 0.70,
  'pre_revenue': 0.55,
};

export const getRiskClassMultiplier = (riskClass?: string): number => {
  if (!riskClass) return 1.0;
  return RISK_CLASS_CONFIDENCE_MULTIPLIER[riskClass] ?? 1.0;
};

// Raket Score — composite "moonshot" score that prefers small companies showing
// concrete forward-looking catalysts. 0-100 weighted sum across five orthogonal
// signals; each capped at 20.
//
// Rationale: the previous rocket filter (Index.tsx) just multiplied confidence
// by predicted return, which over-rewarded large stable assets with small
// reliable expected moves. The real "explosive growth" pattern is a
// confluence of: insider conviction + recent earnings beat + technical
// breakout + high revenue growth + outperformance vs peers.

import { AnalysisContext, FundamentalMetrics, EventSignalData, RelativeStrengthData } from './types';
import { RaketScore } from '@/types/market';

interface RaketInputs {
  context: AnalysisContext;
  marketCap?: number;
  fundamentals?: FundamentalMetrics;
}

// 1. Insider score: net buys in last 90d
//    +5 net buys = full credit. Sells deduct.
function scoreInsider(eventSignals?: EventSignalData): { score: number; reason?: string } {
  const insider = eventSignals?.insiderActivity;
  if (!insider) return { score: 0 };
  const net = insider.netBuysLast90d;
  if (net <= 0) return { score: 0 };
  const score = Math.min(20, net * 4);
  if (net >= 3) {
    return { score, reason: `${net} netto insider-köp 90d` };
  }
  return { score };
}

// 2. PEAD score: post-earnings drift, recent positive surprise.
//    25% surprise within last 7 days = full credit. Decays linearly to day 60.
function scorePead(eventSignals?: EventSignalData): { score: number; reason?: string } {
  const surprise = eventSignals?.recentSurprise;
  if (!surprise) return { score: 0 };
  if (surprise.surprisePct <= 0.05) return { score: 0 };
  const decay = Math.max(0, 1 - surprise.daysSinceReport / 60);
  const magnitude = Math.min(1, (surprise.surprisePct - 0.05) / 0.20);
  const score = Math.round(20 * magnitude * decay);
  if (score >= 8) {
    return {
      score,
      reason: `Rapportbeat +${(surprise.surprisePct * 100).toFixed(0)}% (${surprise.daysSinceReport}d sen)`,
    };
  }
  return { score };
}

// 3. Breakout score: closing above 50-day high with volume spike.
function scoreBreakout(priceHistory: AnalysisContext['priceHistory']): { score: number; reason?: string } {
  if (priceHistory.length < 50) return { score: 0 };

  const recent = priceHistory[priceHistory.length - 1];
  const window50 = priceHistory.slice(-51, -1); // last 50 closes excluding today
  const high50 = Math.max(...window50.map(p => p.high ?? p.close ?? p.price));
  const closesPrice = recent.close ?? recent.price;

  // Recent volume vs 20-day avg
  const recentVol = recent.volume || 0;
  const avgVol20 = priceHistory.slice(-21, -1)
    .map(p => p.volume || 0)
    .reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol20 > 0 ? recentVol / avgVol20 : 0;

  // Pure breakout: closes > 50d high AND volume > 1.5× avg
  if (closesPrice > high50 && volRatio >= 1.5) {
    const breakoutPct = ((closesPrice - high50) / high50) * 100;
    const magnitude = Math.min(1, breakoutPct / 5); // 5% above prior high = full
    const volBonus = Math.min(0.5, (volRatio - 1.5) / 4); // up to +0.5 for huge volume
    const score = Math.round(20 * (magnitude * 0.7 + volBonus));
    return {
      score: Math.min(20, score + 8), // +8 base for any clean breakout
      reason: `Breakout +${breakoutPct.toFixed(1)}% över 50d-high (vol ${volRatio.toFixed(1)}×)`,
    };
  }

  // Near-breakout: within 2% of 50d high with rising volume
  if (closesPrice >= high50 * 0.98 && volRatio >= 1.2) {
    return {
      score: 6,
      reason: `Nära 50d-high (${((closesPrice / high50) * 100).toFixed(1)}%) med stigande volym`,
    };
  }

  return { score: 0 };
}

// 4. Growth score: revenue growth + earnings growth.
//    50% YoY revenue growth = full credit. Profitable & growing = bonus.
function scoreGrowth(fundamentals?: FundamentalMetrics): { score: number; reason?: string } {
  if (!fundamentals) return { score: 0 };
  const revGrowth = fundamentals.revenueGrowth ?? null;
  const epsGrowth = fundamentals.earningsGrowth ?? null;

  if (revGrowth === null && epsGrowth === null) return { score: 0 };

  let score = 0;
  if (revGrowth !== null && revGrowth > 10) {
    score += Math.min(12, (revGrowth / 50) * 12); // 50% rev growth = 12 of 20
  }
  if (epsGrowth !== null && epsGrowth > 15) {
    score += Math.min(8, (epsGrowth / 100) * 8); // 100% earnings growth = 8 of 20
  }
  score = Math.round(Math.min(20, score));
  if (score >= 10) {
    const parts: string[] = [];
    if (revGrowth !== null && revGrowth > 10) parts.push(`omsättning +${revGrowth.toFixed(0)}%`);
    if (epsGrowth !== null && epsGrowth > 15) parts.push(`vinst +${epsGrowth.toFixed(0)}%`);
    return { score, reason: parts.join(', ') };
  }
  return { score };
}

// 5. Relative strength score: outperforming sector AND benchmark.
//    +20pp vs sector OR vs index = full credit.
function scoreRelativeStrength(
  rs: RelativeStrengthData | undefined,
  priceHistory: AnalysisContext['priceHistory']
): { score: number; reason?: string } {
  if (!rs || priceHistory.length < 22) return { score: 0 };

  // Compute own 1m return
  const recent = priceHistory[priceHistory.length - 1];
  const past = priceHistory[priceHistory.length - 22];
  const r = recent?.close ?? recent?.price;
  const p = past?.close ?? past?.price;
  if (!r || !p || p <= 0) return { score: 0 };
  const own1m = (r - p) / p;

  const rsSector = rs.sectorReturn1m !== null ? own1m - rs.sectorReturn1m : null;
  const rsIndex = rs.indexReturn1m !== null ? own1m - rs.indexReturn1m : null;

  // Both must be positive — otherwise it's not relative strength, just absolute beta
  const both = rsSector !== null && rsIndex !== null;
  const sectorPositive = rsSector !== null && rsSector > 0;
  const indexPositive = rsIndex !== null && rsIndex > 0;

  if (!sectorPositive && !indexPositive) return { score: 0 };

  // Average outperformance
  const components: number[] = [];
  if (sectorPositive) components.push(rsSector!);
  if (indexPositive) components.push(rsIndex!);
  const avgRs = components.reduce((a, b) => a + b, 0) / components.length;

  const magnitude = Math.min(1, avgRs / 0.20); // +20pp = full
  let score = Math.round(20 * magnitude);

  // Bonus if outperforming on BOTH dimensions
  if (both && sectorPositive && indexPositive) {
    score = Math.min(20, score + 4);
  }

  if (score >= 10) {
    const reason = `+${(avgRs * 100).toFixed(1)}pp vs ${both ? 'sektor & index' : sectorPositive ? 'sektor' : rs.benchmark}`;
    return { score, reason };
  }
  return { score };
}

export function calculateRaketScore(inputs: RaketInputs): RaketScore {
  const { context, fundamentals } = inputs;

  const insiderResult = scoreInsider(context.eventSignals);
  const peadResult = scorePead(context.eventSignals);
  const breakoutResult = scoreBreakout(context.priceHistory);
  const growthResult = scoreGrowth(fundamentals);
  const rsResult = scoreRelativeStrength(context.relativeStrength, context.priceHistory);

  const reasons: string[] = [];
  for (const r of [insiderResult, peadResult, breakoutResult, growthResult, rsResult]) {
    if (r.reason) reasons.push(r.reason);
  }

  const total = insiderResult.score + peadResult.score + breakoutResult.score
    + growthResult.score + rsResult.score;

  return {
    total,
    insider: insiderResult.score,
    pead: peadResult.score,
    breakout: breakoutResult.score,
    growth: growthResult.score,
    relativeStrength: rsResult.score,
    reasons,
  };
}

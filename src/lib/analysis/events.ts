// Events Module — combines three forward-looking signals:
//   1. Event blackout: caps confidence ±2 trading days around earnings,
//      ±1 day around macro events (CPI, Fed, ECB, Riksbank, NFP) for index/macro-sensitive assets.
//   2. Post-Earnings Announcement Drift (PEAD): recent positive surprise → UP for ~30 days.
//   3. Insider buying / analyst upgrades → UP, insider selling / downgrades → DOWN.
//
// All inputs come pre-fetched in AnalysisContext (upcomingEvents + eventSignals).

import { AnalysisResult, AnalysisContext } from './types';
import { Direction, Evidence } from '@/types/market';

// --- Blackout helpers ---

const TICKER_EVENT_TYPES = new Set(['earnings', 'dividend', 'split']);
const MACRO_EVENT_TYPES = new Set(['cpi', 'fed', 'ecb', 'riksbank', 'nfp', 'gdp']);

export interface EventBlackoutResult {
  active: boolean;
  reason?: string;
  daysAway?: number;
  eventType?: string;
}

// Returns the strongest active blackout, or { active: false }.
export const detectEventBlackout = (context: AnalysisContext): EventBlackoutResult => {
  const events = context.upcomingEvents;
  if (!events || events.length === 0) return { active: false };

  for (const ev of events) {
    const days = ev.daysAway;
    // Earnings blackout: ±2 days for the specific ticker
    if (TICKER_EVENT_TYPES.has(ev.type) && Math.abs(days) <= 2 && !ev.isMarketWide) {
      return {
        active: true,
        reason: `${ev.type === 'earnings' ? 'Rapport' : ev.type === 'dividend' ? 'Utdelning' : 'Split'} ${days <= 0 ? 'för' : 'om'} ${Math.abs(days)}d`,
        daysAway: days,
        eventType: ev.type,
      };
    }
    // Macro blackout: ±1 day, only for high-importance market-wide events
    if (MACRO_EVENT_TYPES.has(ev.type) && Math.abs(days) <= 1 && ev.isMarketWide && ev.importance >= 2) {
      return {
        active: true,
        reason: `Makroevent (${ev.type.toUpperCase()}) ${days <= 0 ? 'för' : 'om'} ${Math.abs(days)}d`,
        daysAway: days,
        eventType: ev.type,
      };
    }
  }
  return { active: false };
};

// --- PEAD scorer ---

interface PeadScore {
  direction: Direction;
  strength: number;       // 50..90
  evidence: Evidence[];
}

function scorePead(context: AnalysisContext): PeadScore | null {
  const surprise = context.eventSignals?.recentSurprise;
  if (!surprise) return null;

  // PEAD effect strongest 1-30 days post-earnings, fades by day 60
  const daysSince = surprise.daysSinceReport;
  if (daysSince < 0 || daysSince > 60) return null;

  const decay = Math.max(0, 1 - daysSince / 60);
  const surprisePct = surprise.surprisePct;

  // Surprises < 5% are noise. Cap mapping at 25% surprise = full strength.
  const absSurprise = Math.abs(surprisePct);
  if (absSurprise < 0.05) return null;

  const magnitude = Math.min(1, (absSurprise - 0.05) / 0.20);
  const strength = Math.round(50 + 40 * magnitude * decay);
  const direction: Direction = surprisePct > 0 ? 'UP' : 'DOWN';

  return {
    direction,
    strength,
    evidence: [{
      type: 'pead',
      description: `Rapportöverraskning ${surprise.period}`,
      value: `${surprisePct >= 0 ? '+' : ''}${(surprisePct * 100).toFixed(1)}% (${daysSince}d sen)`,
      timestamp: new Date().toISOString(),
      source: 'Earnings Surprises',
    }],
  };
}

// --- Insider/analyst scorer ---

interface InsiderAnalystScore {
  direction: Direction;
  strength: number;
  evidence: Evidence[];
}

function scoreInsiderAnalyst(context: AnalysisContext): InsiderAnalystScore | null {
  const insider = context.eventSignals?.insiderActivity;
  const revisions = context.eventSignals?.analystRevisions;
  if (!insider && !revisions) return null;

  let signedScore = 0; // -1 .. +1
  let weightSum = 0;
  const evidence: Evidence[] = [];

  if (insider) {
    // Insider buying is a strong positive signal (well-documented in literature).
    // Net buys > 2 in 90d → bullish; net sells > 5 → bearish.
    const netBuys = insider.netBuysLast90d;
    if (Math.abs(netBuys) >= 2) {
      const insiderSignal = Math.max(-1, Math.min(1, netBuys / 6));
      signedScore += insiderSignal * 0.6;
      weightSum += 0.6;
      evidence.push({
        type: 'insider',
        description: 'Insider-aktivitet 90d',
        value: `${netBuys > 0 ? '+' : ''}${netBuys} netto köp`,
        timestamp: new Date().toISOString(),
        source: 'Insider Trades',
      });
    }
  }

  if (revisions) {
    const net = revisions.netRevisions30d;
    if (Math.abs(net) >= 2) {
      const revSignal = Math.max(-1, Math.min(1, net / 5));
      signedScore += revSignal * 0.4;
      weightSum += 0.4;
      evidence.push({
        type: 'revisions',
        description: 'Analytiker-revisioner 30d',
        value: `${net > 0 ? '+' : ''}${net} netto`,
        timestamp: new Date().toISOString(),
        source: 'Analyst Revisions',
      });
    }
    if (revisions.targetPctUpside != null && Math.abs(revisions.targetPctUpside) >= 5) {
      evidence.push({
        type: 'price_target',
        description: 'Konsensus riktkurs',
        value: `${revisions.targetPctUpside >= 0 ? '+' : ''}${revisions.targetPctUpside.toFixed(1)}% upside`,
        timestamp: new Date().toISOString(),
        source: 'Analyst Targets',
      });
    }
  }

  if (weightSum === 0) return null;
  const normalized = signedScore / weightSum;
  if (Math.abs(normalized) < 0.15) return null;

  const direction: Direction = normalized > 0 ? 'UP' : 'DOWN';
  const strength = Math.round(50 + Math.abs(normalized) * 35);
  return { direction, strength, evidence };
}

// --- Combined module result ---

export const analyzeEvents = (context: AnalysisContext): AnalysisResult => {
  const evidence: Evidence[] = [];
  const blackout = detectEventBlackout(context);
  const pead = scorePead(context);
  const ia = scoreInsiderAnalyst(context);

  if (blackout.active) {
    evidence.push({
      type: 'blackout',
      description: 'Event blackout aktivt',
      value: blackout.reason || 'Kommande event',
      timestamp: new Date().toISOString(),
      source: 'Event Calendar',
    });
  }

  // Combine PEAD + insider/analyst into a single direction
  let direction: Direction = 'NEUTRAL';
  let strength = 50;
  let confidence = 30;
  let coverage = 25;

  if (pead || ia) {
    // Weighted combination: PEAD 0.55, insider/analyst 0.45
    const peadVec = pead
      ? (pead.direction === 'UP' ? 1 : pead.direction === 'DOWN' ? -1 : 0) * (pead.strength - 50) / 40
      : 0;
    const iaVec = ia
      ? (ia.direction === 'UP' ? 1 : ia.direction === 'DOWN' ? -1 : 0) * (ia.strength - 50) / 35
      : 0;
    const w1 = pead ? 0.55 : 0;
    const w2 = ia ? 0.45 : 0;
    const wSum = w1 + w2;
    const combined = wSum > 0 ? (peadVec * w1 + iaVec * w2) / wSum : 0;

    if (combined > 0.15) direction = 'UP';
    else if (combined < -0.15) direction = 'DOWN';
    strength = Math.round(50 + Math.abs(combined) * 40);

    if (pead) evidence.push(...pead.evidence);
    if (ia) evidence.push(...ia.evidence);

    // Confidence reflects how many sub-signals agreed
    const sourceBonus = (pead ? 15 : 0) + (ia ? 15 : 0);
    confidence = 35 + sourceBonus;
    coverage = 35 + (pead ? 25 : 0) + (ia ? 20 : 0);
  } else {
    evidence.push({
      type: 'no_data',
      description: 'Ingen event-data',
      value: 'Inga rapporter, insider eller revisioner registrerade',
      timestamp: new Date().toISOString(),
      source: 'System',
    });
  }

  // If blackout is active, force NEUTRAL with low confidence — we shouldn't take
  // a directional position right before/after a major event.
  if (blackout.active) {
    direction = 'NEUTRAL';
    strength = 50;
    confidence = Math.min(confidence, 20);
  }

  return {
    module: 'events',
    direction,
    strength: Math.max(35, Math.min(90, strength)),
    confidence: Math.max(15, Math.min(85, confidence)),
    coverage: Math.max(10, Math.min(85, coverage)),
    evidence,
    metadata: {
      blackoutActive: blackout.active,
      blackoutReason: blackout.reason,
      peadActive: !!pead,
      insiderActive: !!ia,
    },
  };
};

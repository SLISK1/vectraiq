"""
Leg selection with correlation filter — THE FIX for the correlation problem.

Problem:
  BTTS and O2.5 are correlated ~0.7.  If both appear in the same parlay,
  we'd calculate p_parlay = p_btts × p_o25, which assumes independence.
  That overestimates the true probability and inflates the apparent edge.

Solution (simple, robust, conservative):
  FORBIDDEN_COMBOS: market pairs that cannot coexist in the same coupon.
  When both pass all gates, we keep the one with higher edge and drop the other.

Allowed combinations (low correlation):
  btts/o25  + corners_o95   (~0.30)  ✓
  btts/o25  + cards_o35     (~0.20)  ✓
  corners   + cards          (~0.30)  ✓

Maximum legs:
  Phase 1: 2 legs
  Phase 2: 3 legs
  Phase 3: 3 legs  (4 only if explicitly enabled later)

Gate checks at coupon level (all phases):
  - ChaosScore >= CHAOS_SCORE_MIN
  - At least N_SUBSCORES_MIN subscores >= SUBSCORE_MIN

Phase 1 additional gates:
  - ChaosScore >= PHASE1_CHAOS_MIN (75)
  - At least PHASE1_N_SUBSCORES subscores >= PHASE1_SUBSCORE_MIN (70)
"""
import math
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from scoring.subscores import Subscores

# Market pairs that must not appear together in the same parlay.
# When both qualify, higher-edge leg is kept.
FORBIDDEN_COMBOS: list[frozenset] = [
    frozenset({"btts", "o25"}),
]

# Which subscore is responsible for which market
MARKET_TO_SUBSCORE = {
    "btts":        "goal_chaos",
    "o25":         "goal_chaos",
    "corners_o95": "corner_pressure",
    "cards_o35":   "card_heat",
}


def _max_legs(phase: int) -> int:
    return (config.MAX_LEGS_PHASE1 if phase == 1
            else config.MAX_LEGS_PHASE2 if phase == 2
            else config.MAX_LEGS_PHASE3)


def _subscore_value(subscores: Subscores, market: str) -> float:
    attr = MARKET_TO_SUBSCORE.get(market, "chaos_score")
    val = getattr(subscores, attr, None)
    return val if val is not None else 0.0


def chaos_gates_pass(subscores: Subscores, phase: int) -> tuple[bool, str]:
    """
    Returns (passes: bool, reason: str).
    Checks ChaosScore + subscore gate for the given calibration phase.
    """
    all_phases_chaos_min = config.CHAOS_SCORE_MIN
    all_phases_n         = config.N_SUBSCORES_MIN
    all_phases_sub_min   = config.SUBSCORE_MIN

    if phase == 1:
        chaos_min = config.PHASE1_CHAOS_MIN
        sub_min   = config.PHASE1_SUBSCORE_MIN
        n_req     = config.PHASE1_N_SUBSCORES
    else:
        chaos_min = all_phases_chaos_min
        sub_min   = all_phases_sub_min
        n_req     = all_phases_n

    if subscores.chaos_score < chaos_min:
        return False, f"ChaosScore {subscores.chaos_score} < {chaos_min}"

    available = [subscores.goal_chaos, subscores.card_heat, subscores.volatility]
    if subscores.corner_pressure is not None:
        available.append(subscores.corner_pressure)

    n_passing = sum(1 for s in available if s >= sub_min)
    if n_passing < n_req:
        return False, (
            f"Only {n_passing}/{n_req} subscores >= {sub_min}: "
            f"GC={subscores.goal_chaos} CP={subscores.corner_pressure} "
            f"CH={subscores.card_heat} V={subscores.volatility}"
        )

    return True, "ok"


def select_legs(
    candidate_legs: list[dict],
    subscores: Subscores,
    min_combined_odds: float = config.MIN_ODDS,
) -> tuple[list[dict], str]:
    """
    Select the best legs from candidates, enforcing:
      1. Correlation filter (FORBIDDEN_COMBOS)
      2. Max legs per phase
      3. Min combined parlay odds

    candidate_legs: list of leg dicts from betting.edge.build_leg()
                    (already edge-gated individually)
    subscores: to determine max_legs via min calibration phase

    Returns (selected_legs, reason) where reason = "ok" or rejection message.
    """
    if not candidate_legs:
        return [], "no legs pass edge gate"

    # Sort by edge descending (greedy: take best edge first)
    ranked = sorted(candidate_legs, key=lambda l: l["edge"], reverse=True)

    # Determine phase for leg limit (use minimum phase = most conservative)
    min_phase = min(l["calibration_phase"] for l in ranked)
    max_n     = _max_legs(min_phase)

    selected: list[dict] = []
    selected_markets: set[str] = set()

    for leg in ranked:
        if len(selected) >= max_n:
            break

        market = leg["market"]

        # Skip if adding this market creates a forbidden combination
        would_have = selected_markets | {market}
        if any(combo <= would_have for combo in FORBIDDEN_COMBOS):
            continue

        # Skip if market's required subscore is NULL (e.g. corners_o95 without data)
        if market == "corners_o95" and subscores.corner_pressure is None:
            continue

        selected.append(leg)
        selected_markets.add(market)

    if not selected:
        return [], "no legs survive correlation filter"

    # Check combined parlay odds
    combined_odds = math.prod(l["odds"] for l in selected)
    if combined_odds < min_combined_odds:
        return [], (
            f"combined odds {combined_odds:.2f} < minimum {min_combined_odds}"
        )

    return selected, "ok"


def combined_odds(legs: list[dict]) -> float:
    return math.prod(l["odds"] for l in legs)


def parlay_p_estimate(legs: list[dict]) -> float:
    """
    Conservative parlay probability estimate.
    We use p_cal per leg and assume independence (after correlation filter
    has already ensured low-correlation legs only).
    """
    p = 1.0
    for leg in legs:
        p *= leg["p_cal"]
    return p

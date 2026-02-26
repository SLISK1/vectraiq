"""
Four subscores, each in [0, 100]:

  GoalChaos      — both teams likely to score + high total goals
  CornerPressure — high corner volume expected
  CardHeat       — many cards expected (+ optional Firecrawl derby/referee bonus)
  Volatility     — swing risk / unpredictability (FORM-based, distinct from GoalChaos)

Design note on Volatility:
  GoalChaos uses goals, btts, over25, clean sheets — raw scoring ability.
  Volatility uses form_pts_std, form_pts_diff, draw_rate — result unpredictability.
  Empirically these two are weakly correlated (r~0.2) because a team can be
  consistently high-scoring but very predictable (e.g. dominant title contender).

ChaosScore — weighted combination, with optional learned weights.
"""
from dataclasses import dataclass
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from scoring.normalizer import LeagueNormalizer, score_from_raw


@dataclass
class Subscores:
    goal_chaos:      float
    corner_pressure: Optional[float]   # None if corners data absent
    card_heat:       float
    volatility:      float
    chaos_score:     float


def _goal_chaos(norm: LeagueNormalizer, h: dict, a: dict) -> float:
    """
    Targets: "both teams likely to score AND match likely high-scoring."
    Inputs: over25_rate, btts_rate, goals_for_avg, goals_against_avg,
            clean_sheet_rate (negative), failed_to_score_rate (negative).
    """
    gf   = norm.z(h["goals_for_avg"],  "goals_for_avg")   + norm.z(a["goals_for_avg"],  "goals_for_avg")
    ga   = norm.z(h["goals_against_avg"], "goals_against_avg") + norm.z(a["goals_against_avg"], "goals_against_avg")
    btts = norm.z(h["btts_rate"],  "btts_rate")  + norm.z(a["btts_rate"],  "btts_rate")
    o25  = norm.z(h["over25_rate"], "over25_rate") + norm.z(a["over25_rate"], "over25_rate")
    cs   = norm.z(h["clean_sheet_rate"], "clean_sheet_rate") + norm.z(a["clean_sheet_rate"], "clean_sheet_rate")
    fts  = norm.z(h["failed_to_score_rate"], "failed_to_score_rate") + norm.z(a["failed_to_score_rate"], "failed_to_score_rate")

    raw = (0.30 * o25
           + 0.30 * btts
           + 0.20 * gf
           + 0.20 * ga
           - 0.25 * cs
           - 0.20 * fts)
    return score_from_raw(raw)


def _corner_pressure(norm: LeagueNormalizer, h: dict, a: dict) -> Optional[float]:
    """
    Targets: "high total corner volume."
    Returns None if neither team has corner data.
    """
    if (h.get("corners_for_avg") is None and h.get("corners_against_avg") is None
            and a.get("corners_for_avg") is None):
        return None

    cf = (norm.z(h["corners_for_avg"],     "corners_for_avg")
          + norm.z(a["corners_for_avg"],    "corners_for_avg"))
    ca = (norm.z(h["corners_against_avg"], "corners_against_avg")
          + norm.z(a["corners_against_avg"], "corners_against_avg"))

    raw = 0.55 * cf + 0.45 * ca
    return score_from_raw(raw)


def _card_heat(norm: LeagueNormalizer, h: dict, a: dict,
               derby_bonus: float = 0.0, referee_bonus: float = 0.0) -> float:
    """
    Targets: "high total card count."
    Optional bonuses (applied to raw BEFORE sigmoid, capped at MAX_CARD_RAW_BONUS):
      derby_bonus     = config.DERBY_BONUS    if derby match
      referee_bonus   = config.REFEREE_BONUS  if strict referee
    """
    cards_total = (
        norm.z(h.get("cards_for_avg"),    "cards_for_avg")
        + norm.z(h.get("cards_against_avg"), "cards_against_avg")
        + norm.z(a.get("cards_for_avg"),  "cards_for_avg")
        + norm.z(a.get("cards_against_avg"), "cards_against_avg")
    )
    cards_against = (
        norm.z(h.get("cards_against_avg"), "cards_against_avg")
        + norm.z(a.get("cards_against_avg"), "cards_against_avg")
    )

    raw = 0.65 * cards_total + 0.35 * cards_against
    bonus = min(derby_bonus + referee_bonus, config.MAX_CARD_RAW_BONUS)
    return score_from_raw(raw + bonus)


def _volatility(norm: LeagueNormalizer, h: dict, a: dict) -> float:
    """
    Targets: "swing risk / result unpredictability."

    Deliberately uses FORM-based features, NOT goals, to stay distinct
    from GoalChaos:

      form_pts_std  — high intra-team form variance → results are erratic
      form_evenness — teams close in recent form → outcome is uncertain
                      (computed as: 3 - |form_diff|, so more even = higher)
      draw_rate     — teams that draw a lot → volatile final state

    A dominant top-4 side playing a relegated team scores LOW on Volatility
    even if GoalChaos is high (many goals but result is predictable).
    Two mid-table sides of similar form with high draw rates score HIGH.
    """
    # Form variance: how consistent is each team's results?
    fstd_h = norm.z(h.get("form_pts_std"), "form_pts_std")
    fstd_a = norm.z(a.get("form_pts_std"), "form_pts_std")
    form_variance = fstd_h + fstd_a   # high = erratic

    # Form evenness: 3 - |diff| normalised → high when teams are evenly matched
    h_pts = h.get("form_pts_avg") or 1.5
    a_pts = a.get("form_pts_avg") or 1.5
    form_diff_raw = abs(h_pts - a_pts)          # 0 = perfectly even, 3 = max gap
    form_evenness_val = 3.0 - form_diff_raw     # high = even
    form_evenness = norm.z(form_evenness_val, "form_pts_avg")

    # Draw tendency
    draw_combined = (norm.z(h.get("draw_rate"), "draw_rate")
                     + norm.z(a.get("draw_rate"), "draw_rate"))

    raw = 0.40 * form_variance + 0.35 * form_evenness + 0.25 * draw_combined
    return score_from_raw(raw)


def _chaos_score(goal_chaos: float, corner_pressure: Optional[float],
                 card_heat: float, volatility: float,
                 weights: Optional[dict] = None) -> float:
    """
    Weighted combination.  Weights come from:
      1. DB (learned logistic-regression weights, if available)
      2. config v0 heuristic (baseline)
    Falls back to no-corners variant when corner_pressure is None.
    """
    if weights is None:
        if corner_pressure is not None:
            weights = config.CHAOS_WEIGHTS_V0
        else:
            weights = config.CHAOS_WEIGHTS_V0_NO_CORNERS

    if corner_pressure is not None:
        scores = {
            "goal_chaos":      goal_chaos,
            "corner_pressure": corner_pressure,
            "card_heat":       card_heat,
            "volatility":      volatility,
        }
        keys = ["goal_chaos", "corner_pressure", "card_heat", "volatility"]
    else:
        scores = {
            "goal_chaos": goal_chaos,
            "card_heat":  card_heat,
            "volatility": volatility,
        }
        keys = ["goal_chaos", "card_heat", "volatility"]

    # Normalise weights so they sum to 1 (handles partial weight dicts)
    total_w = sum(weights.get(k, 0.0) for k in keys)
    if total_w <= 0:
        total_w = 1.0

    weighted = sum(scores[k] * weights.get(k, 0.0) for k in keys) / total_w
    return round(weighted, 1)


def compute_subscores(
    home_stats: dict,
    away_stats: dict,
    norm: LeagueNormalizer,
    derby_bonus: float = 0.0,
    referee_bonus: float = 0.0,
    weights: Optional[dict] = None,
) -> Subscores:
    """
    Main entry point.  Returns a Subscores dataclass.
    home_stats / away_stats: rows from team_stats table.
    """
    gc = _goal_chaos(norm, home_stats, away_stats)
    cp = _corner_pressure(norm, home_stats, away_stats)
    ch = _card_heat(norm, home_stats, away_stats, derby_bonus, referee_bonus)
    vo = _volatility(norm, home_stats, away_stats)
    cs = _chaos_score(gc, cp, ch, vo, weights)

    return Subscores(
        goal_chaos=gc,
        corner_pressure=cp,
        card_heat=ch,
        volatility=vo,
        chaos_score=cs,
    )

"""
Edge calculation and per-leg gate checks.

edge = p_cal - implied
implied = 1 / odds

A leg passes if:
  1. edge >= EDGE_THRESHOLD[phase]
  2. combined (parlay) odds >= MIN_ODDS (checked at coupon level, not leg level)

Phase 1 also requires stricter gates applied at the coupon level
(ChaosScore >= 75, at least 2 subscores >= 70 — handled in leg_selector.py).
"""
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config


def implied_probability(odds: float) -> float:
    if odds <= 1.0:
        raise ValueError(f"Odds must be > 1.0, got {odds}")
    return 1.0 / odds


def compute_edge(p_cal: float, odds: float) -> float:
    return p_cal - implied_probability(odds)


def edge_passes(edge: float, phase: int) -> bool:
    return edge >= config.EDGE_THRESHOLD[phase]


def build_leg(
    fixture_id: str,
    rec_id: str,
    market: str,
    odds: float,
    p_raw: float,
    cal_result: dict,
    line: Optional[float] = None,
) -> Optional[dict]:
    """
    Construct a leg dict if it passes the edge gate.
    Returns None if the leg should be rejected.

    cal_result: output of calibrator.calibrate()
    """
    phase   = cal_result["phase"]
    p_proxy = cal_result.get("p_proxy")
    p_cal   = cal_result["p_cal"]
    implied = implied_probability(odds)
    edge    = compute_edge(p_cal, odds)

    if not edge_passes(edge, phase):
        return None

    import uuid
    return {
        "leg_id":            str(uuid.uuid4()),
        "rec_id":            rec_id,
        "fixture_id":        fixture_id,
        "market":            market,
        "line":              line,
        "odds":              odds,
        "p_raw":             p_raw,
        "p_proxy":           p_proxy,
        "p_cal":             p_cal,
        "implied":           implied,
        "edge":              round(edge, 4),
        "calibration_phase": phase,
    }

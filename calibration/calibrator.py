"""
Three-phase calibration system.

Phase 1  (N < 80):
  p_proxy = clamp(p_raw * 0.85, 0.01, 0.99)
  p_cal   = p_proxy
  edge_threshold = 0.08

Phase 2  (80 ≤ N < 200):
  p_bucket = Laplace-smoothed empirical rate for the matching decile bucket
  w        = N / 200  (grows from 0.4 → 1.0 as N grows from 80 → 200)
  p_cal    = (1 - w) * p_proxy + w * p_bucket
  edge_threshold = 0.06

Phase 3  (N ≥ 200):
  p_bucket = Laplace-smoothed empirical rate
  p_cal    = p_bucket  (full empirical calibration)
  edge_threshold = 0.05

N is the total number of resolved bets for that market in our DB.

The N-dependent weight in Phase 2 provides a smooth transition instead of
a hard switch, so the system doesn't flip behaviour at exactly N=80.
"""
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db


def _clamp(v: float, lo: float = 0.01, hi: float = 0.99) -> float:
    return max(lo, min(hi, v))


def _bucket_idx(p: float) -> int:
    """Map probability to decile bucket index 0–9."""
    return min(int(p * 10), 9)


def _laplace_p(n_bets: int, n_wins: int) -> float:
    """Laplace-smoothed empirical win rate."""
    return (n_wins + 1) / (n_bets + 2)


def get_calibration_phase(market: str) -> int:
    n = db.get_market_total_bets(market)
    if n < config.PHASE2_N:
        return 1
    if n < config.PHASE3_N:
        return 2
    return 3


def calibrate(p_raw: float, market: str) -> dict:
    """
    Main entry point.  Given p_raw for a market, returns:
    {
        phase:   int,
        p_proxy: float,
        p_cal:   float,
        n_bets:  int,
    }
    """
    n_bets = db.get_market_total_bets(market)
    phase  = (1 if n_bets < config.PHASE2_N
              else 2 if n_bets < config.PHASE3_N
              else 3)

    p_proxy = _clamp(p_raw * 0.85)

    if phase == 1:
        return {
            "phase":   1,
            "p_proxy": p_proxy,
            "p_cal":   p_proxy,
            "n_bets":  n_bets,
        }

    # Phase 2 or 3: look up empirical bucket
    buckets = db.get_calibration_buckets(market)
    idx     = _bucket_idx(p_raw)
    # Ensure bucket list is sorted and has enough entries
    bucket  = next((b for b in buckets if b["bucket_idx"] == idx), None)

    if bucket is None or bucket["n_bets"] == 0:
        # No data in this bucket yet — fall back to proxy
        p_bucket = p_proxy
    else:
        p_bucket = _clamp(_laplace_p(bucket["n_bets"], bucket["n_wins"]))

    if phase == 2:
        # N-dependent weight: grows from 0.4 → 1.0 as N grows from PHASE2_N → PHASE3_N
        w = (n_bets - config.PHASE2_N) / (config.PHASE3_N - config.PHASE2_N)
        w = _clamp(w, 0.0, 1.0)
        p_cal = _clamp((1 - w) * p_proxy + w * p_bucket)
    else:
        p_cal = p_bucket

    return {
        "phase":    phase,
        "p_proxy":  p_proxy,
        "p_cal":    p_cal,
        "n_bets":   n_bets,
    }


def update_buckets(market: str, p_raw: float, won: bool):
    """
    Called after outcome is recorded.
    Increments the appropriate decile bucket.
    """
    idx = _bucket_idx(p_raw)
    db.update_calibration_bucket(
        market=market,
        bucket_idx=idx,
        n_bets_delta=1,
        n_wins_delta=1 if won else 0,
    )

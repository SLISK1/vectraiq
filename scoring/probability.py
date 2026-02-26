"""
p_raw per market — THE FIX for the previously undefined probability layer.

Each p_raw is the geometric mean of the two teams' empirical rates for that market.

Why geometric mean (not arithmetic)?
  - Conservative when rates differ significantly: geomean(0.8, 0.2) = 0.40
    vs arithmetic mean = 0.50.  We prefer to underestimate rather than over.
  - Natural for multiplicative relationships: if both teams independently
    show rate r_h and r_a, a rough joint proxy is sqrt(r_h * r_a).
  - Always stays within [0, 1].

Why NOT a full Poisson model?
  - Requires parameters we don't have (xG, home/away split by fixture).
  - Geometric mean of empirical rates is already a reasonable approximation
    and is transparent/debuggable.

Fallback:
  If a team is missing a rate (None), we use the league-average rate
  from league_norms (de-normalised).  If that's also unavailable, the
  market is considered unplayable (returns None).
"""
import math
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from scoring.normalizer import LeagueNormalizer

EPS = 0.01   # floor probability to avoid log(0)


def _geomean(a: float, b: float) -> float:
    a = max(a, EPS)
    b = max(b, EPS)
    return math.sqrt(a * b)


def _rate_or_league(value: Optional[float], metric: str,
                    norm: LeagueNormalizer) -> Optional[float]:
    """Return value if present, else reconstruct league-average from norms."""
    if value is not None:
        return value
    n = norm._norms.get(metric)
    if n:
        return max(n["mean"], EPS)
    return None


def p_raw_btts(home: dict, away: dict, norm: LeagueNormalizer) -> Optional[float]:
    """P(both teams score) proxy."""
    h = _rate_or_league(home.get("btts_rate"), "btts_rate", norm)
    a = _rate_or_league(away.get("btts_rate"), "btts_rate", norm)
    if h is None or a is None:
        return None
    return _geomean(h, a)


def p_raw_o25(home: dict, away: dict, norm: LeagueNormalizer) -> Optional[float]:
    """P(over 2.5 total goals) proxy."""
    h = _rate_or_league(home.get("over25_rate"), "over25_rate", norm)
    a = _rate_or_league(away.get("over25_rate"), "over25_rate", norm)
    if h is None or a is None:
        return None
    return _geomean(h, a)


def p_raw_corners_over95(home: dict, away: dict,
                         norm: LeagueNormalizer) -> Optional[float]:
    """P(over 9.5 total corners) proxy.  Returns None if no corners data."""
    h = _rate_or_league(home.get("corners_over95_rate"), "corners_over95_rate", norm)
    a = _rate_or_league(away.get("corners_over95_rate"), "corners_over95_rate", norm)
    if h is None or a is None:
        return None
    return _geomean(h, a)


def p_raw_cards_over35(home: dict, away: dict,
                       norm: LeagueNormalizer) -> Optional[float]:
    """P(over 3.5 total cards) proxy.  Returns None if no cards data."""
    h = _rate_or_league(home.get("cards_over35_rate"), "cards_over35_rate", norm)
    a = _rate_or_league(away.get("cards_over35_rate"), "cards_over35_rate", norm)
    if h is None or a is None:
        return None
    return _geomean(h, a)


def compute_all_p_raw(
    home: dict,
    away: dict,
    norm: LeagueNormalizer,
) -> dict[str, Optional[float]]:
    """
    Compute p_raw for all four markets in one call.
    Returns dict: {market: p_raw or None}
    """
    return {
        "btts":        p_raw_btts(home, away, norm),
        "o25":         p_raw_o25(home, away, norm),
        "corners_o95": p_raw_corners_over95(home, away, norm),
        "cards_o35":   p_raw_cards_over35(home, away, norm),
    }

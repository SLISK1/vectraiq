"""
League-level z-score normalisation.

For each metric m in a league:
    z(m) = (m - league_mean(m)) / max(league_std(m), eps)

Normalisation parameters are pre-computed once per day during the batch
and stored in league_norms.  This module computes and loads those params.

Important: if fewer than MIN_LEAGUE_TEAMS teams have data for a metric,
the z-score is unreliable → we return 0.0 (neutral) for that team/metric.
"""
import math
import logging
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db

logger = logging.getLogger(__name__)

EPS = 1e-6

# Metrics we normalise; must match column names in team_stats
NORM_METRICS = [
    "goals_for_avg",
    "goals_against_avg",
    "btts_rate",
    "over25_rate",
    "clean_sheet_rate",
    "failed_to_score_rate",
    "corners_for_avg",
    "corners_against_avg",
    "corners_over95_rate",
    "cards_for_avg",
    "cards_against_avg",
    "cards_over35_rate",
    "form_pts_avg",
    "form_pts_std",
    "draw_rate",
]


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def score_from_raw(raw: float) -> float:
    """Map an unbounded raw score → [0, 100] via sigmoid."""
    return round(100.0 * sigmoid(raw), 1)


def compute_and_store_league_norms(league_id: int, season: int):
    """
    Compute mean/std per metric from all team_stats rows for this league/season.
    Stores results in league_norms.  Call once per day in batch.
    """
    team_rows = db.get_league_team_stats(league_id, season)
    if len(team_rows) < config.MIN_LEAGUE_TEAMS:
        logger.warning(
            "League %d only has %d teams with stats — norms not updated",
            league_id, len(team_rows),
        )
        return

    for metric in NORM_METRICS:
        values = [r[metric] for r in team_rows if r.get(metric) is not None]
        if len(values) < config.MIN_LEAGUE_TEAMS:
            continue
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        std = math.sqrt(variance)
        db.upsert_league_norm(league_id, season, metric, mean, max(std, EPS), len(values))

    logger.info("League %d norms updated (%d teams)", league_id, len(team_rows))


class LeagueNormalizer:
    """
    Loaded once per match evaluation.  Provides z(team_stat, metric).
    Falls back to 0.0 (neutral) when norm is missing or n_teams < threshold.
    """

    def __init__(self, league_id: int, season: int):
        self.league_id = league_id
        self.season    = season
        self._norms    = db.get_league_norms(league_id, season)

    def z(self, value: Optional[float], metric: str) -> float:
        """
        Z-score a single value for a metric.
        Returns 0.0 (neutral) when data is missing or norm is unreliable.
        """
        if value is None:
            return 0.0
        norm = self._norms.get(metric)
        if norm is None or norm["n_teams"] < config.MIN_LEAGUE_TEAMS:
            return 0.0
        return (value - norm["mean"]) / norm["std"]

    def has_norm(self, metric: str) -> bool:
        return (metric in self._norms
                and self._norms[metric]["n_teams"] >= config.MIN_LEAGUE_TEAMS)

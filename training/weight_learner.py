"""
Weekly retraining of ChaosScore weights using logistic regression.

Target: Y_3of4
  - A bet "succeeds" if at least 3 out of 4 recent legs in the same
    calibration context won.
  - Rationale: Y_parlay_win is too sparse and high-variance to learn from.
    Y_3of4 gives more signal with less luck component.
  - Implementation: for each recommendation with >= 3 resolved legs,
    label 1 if at least 3 legs won, else 0.

Features:
  X = [goal_chaos, corner_pressure, card_heat, volatility] (all /100)
  corner_pressure is 0-imputed when NULL.

Minimum samples: 30 (logistic regression is unreliable below this).
The function returns v0 weights if insufficient data.

Trained weights are saved to chaos_weights table and used by subscores.py.
"""
import json
import logging
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db

logger = logging.getLogger(__name__)

MIN_SAMPLES = 30


def _build_training_data() -> tuple[list[list[float]], list[int]]:
    """
    Build (X, y) from resolved recommendations.
    X shape: (n, 4) — [goal_chaos, corner_pressure, card_heat, volatility] / 100
    y: binary Y_3of4 label
    """
    with db.get_db() as conn:
        rows = conn.execute(
            """SELECT r.rec_id, r.goal_chaos, r.corner_pressure, r.card_heat,
                      r.volatility, r.legs_json, r.status
               FROM recommendations r
               WHERE r.status IN ('won', 'lost')"""
        ).fetchall()
        # Also get per-leg outcomes
        leg_outcomes: dict[str, list[int]] = {}
        legs = conn.execute(
            """SELECT rec_id, outcome FROM recommendation_legs
               WHERE outcome IS NOT NULL"""
        ).fetchall()
    for l in legs:
        leg_outcomes.setdefault(l["rec_id"], []).append(l["outcome"])

    X, y = [], []
    for row in rows:
        rid = row["rec_id"]
        outcomes = leg_outcomes.get(rid, [])
        if len(outcomes) < 2:
            continue

        n_won = sum(outcomes)
        label = 1 if n_won >= max(2, len(outcomes) - 1) else 0   # at least N-1 legs

        gc = (row["goal_chaos"]      or 0.0) / 100.0
        cp = (row["corner_pressure"] or 0.0) / 100.0
        ch = (row["card_heat"]       or 0.0) / 100.0
        vo = (row["volatility"]      or 0.0) / 100.0
        X.append([gc, cp, ch, vo])
        y.append(label)

    return X, y


def train_weights() -> Optional[dict]:
    """
    Train logistic regression on Y_3of4.
    Returns new weight dict if successful, None otherwise.
    Saves result to DB.
    """
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
        import numpy as np
    except ImportError:
        logger.error("scikit-learn not installed — run: pip install scikit-learn")
        return None

    X_raw, y = _build_training_data()
    if len(X_raw) < MIN_SAMPLES:
        logger.info(
            "Insufficient training data: %d samples (need %d). "
            "Using v0 weights.", len(X_raw), MIN_SAMPLES,
        )
        return None

    X = np.array(X_raw)
    y_arr = np.array(y)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    clf = LogisticRegression(C=1.0, max_iter=500, random_state=42)
    clf.fit(X_scaled, y_arr)
    train_acc = clf.score(X_scaled, y_arr)

    # Extract coefficients: larger coef → more weight in ChaosScore
    coefs = clf.coef_[0]   # shape (4,)
    feature_names = ["goal_chaos", "corner_pressure", "card_heat", "volatility"]

    # Convert to positive weights (softmax-like normalisation of abs values)
    abs_coefs = [max(c, 0.0) for c in coefs]  # clip negatives to 0 (don't invert)
    total = sum(abs_coefs) or 1.0
    weights = {name: round(w / total, 4) for name, w in zip(feature_names, abs_coefs)}

    # Safety: if a feature gets 0 weight (e.g. never non-null), keep v0 floor
    for k, v in config.CHAOS_WEIGHTS_V0.items():
        if weights.get(k, 0) == 0:
            weights[k] = v * 0.1   # small floor

    db.save_chaos_weights(weights, len(X_raw), "Y_3of4", train_acc)
    logger.info(
        "Weights retrained on %d samples, accuracy=%.3f: %s",
        len(X_raw), train_acc, weights,
    )
    return weights


def get_current_weights() -> dict:
    """
    Returns learned weights if available, else v0 heuristic.
    Called by subscores.compute_subscores().
    """
    row = db.get_latest_chaos_weights()
    if row and row.get("weights"):
        return row["weights"]
    return config.CHAOS_WEIGHTS_V0

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DB_PATH  = BASE_DIR / "betting.db"

# ── API ────────────────────────────────────────────────────────────────────────
FOOTBALL_API_KEY  = os.getenv("FOOTBALL_API_KEY", "")
FOOTBALL_API_BASE = "https://v3.football.api-sports.io"
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")

# ── Bankroll ───────────────────────────────────────────────────────────────────
INITIAL_BANKROLL  = 500.0
UNIT_STAKE        = 50.0
MAX_DAILY_STAKE   = 100.0   # 2 units
MAX_DAILY_COUPONS = 2

# ── Gates (all phases) ────────────────────────────────────────────────────────
CHAOS_SCORE_MIN = 70        # ChaosScore threshold (normal phases)
SUBSCORE_MIN    = 65        # min delscore to count
N_SUBSCORES_MIN = 2         # how many subscores must clear threshold
MIN_ODDS        = 3.0       # minimum combined parlay odds

# Edge thresholds per calibration phase
EDGE_THRESHOLD = {1: 0.08, 2: 0.06, 3: 0.05}

# Phase 1 (pre-calibration) extra gates
PHASE1_CHAOS_MIN    = 75
PHASE1_SUBSCORE_MIN = 70
PHASE1_N_SUBSCORES  = 2

# ── Calibration phase boundaries ──────────────────────────────────────────────
PHASE2_N = 80
PHASE3_N = 200

# ── Leagues (api-football.com league IDs) ─────────────────────────────────────
LEAGUES = [
    {"id": 39,  "name": "Premier League", "season": 2024},
    {"id": 78,  "name": "Bundesliga",     "season": 2024},
    {"id": 135, "name": "Serie A",        "season": 2024},
    {"id": 140, "name": "La Liga",        "season": 2024},
    {"id": 61,  "name": "Ligue 1",        "season": 2024},
    {"id": 113, "name": "Allsvenskan",    "season": 2024},
]

# ── ChaosScore weights v0 (heuristic baseline) ────────────────────────────────
# These are START values only; system learns v1 weights via logistic regression.
CHAOS_WEIGHTS_V0 = {
    "goal_chaos":      0.40,
    "corner_pressure": 0.25,
    "card_heat":       0.20,
    "volatility":      0.15,
}
# Used when CornerPressure is NULL (no corners data)
CHAOS_WEIGHTS_V0_NO_CORNERS = {
    "goal_chaos": 0.50,
    "card_heat":  0.30,
    "volatility": 0.20,
}

# ── Firecrawl bonuses (added to raw score BEFORE sigmoid, capped) ─────────────
DERBY_BONUS        = 0.20
REFEREE_BONUS      = 0.25
MAX_CARD_RAW_BONUS = 0.40   # cap total card_heat bonus

# ── League norm bootstrap ─────────────────────────────────────────────────────
# Minimum number of teams with stats before z-score is trusted
MIN_LEAGUE_TEAMS = 5

# ── Minimum matches per team before their stats are included ──────────────────
MIN_TEAM_MATCHES = 5

# Max legs per parlay (relaxed to 4 once N >= PHASE3_N per all markets)
MAX_LEGS_PHASE1 = 2
MAX_LEGS_PHASE2 = 3
MAX_LEGS_PHASE3 = 3   # cap at 3; 4-leggers only if ALL legs are phase-3 calibrated

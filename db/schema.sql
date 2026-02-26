-- ── League normalisation stats ──────────────────────────────────────────────
-- Refreshed once per day per league via batch.
CREATE TABLE IF NOT EXISTS league_norms (
    league_id   INTEGER NOT NULL,
    season      INTEGER NOT NULL,
    metric      TEXT    NOT NULL,
    mean        REAL    NOT NULL,
    std         REAL    NOT NULL,
    n_teams     INTEGER NOT NULL,
    updated_at  TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (league_id, season, metric)
);

-- ── Team statistics ──────────────────────────────────────────────────────────
-- Built from cached fixture history; refreshed daily.
CREATE TABLE IF NOT EXISTS team_stats (
    team_id              TEXT    NOT NULL,
    league_id            INTEGER NOT NULL,
    season               INTEGER NOT NULL,
    matches_played       INTEGER DEFAULT 0,

    -- Goal stats
    goals_for_avg        REAL,
    goals_against_avg    REAL,
    btts_rate            REAL,   -- both teams scored
    over25_rate          REAL,   -- total goals > 2.5
    clean_sheet_rate     REAL,
    failed_to_score_rate REAL,

    -- Corner stats (NULL when data unavailable)
    corners_for_avg      REAL,
    corners_against_avg  REAL,
    corners_over95_rate  REAL,   -- total corners > 9.5

    -- Card stats (NULL when data unavailable)
    cards_for_avg        REAL,
    cards_against_avg    REAL,
    cards_over35_rate    REAL,   -- total cards > 3.5

    -- Form stats (last 5-10 matches) — used for Volatility (distinct from goals)
    form_pts_avg         REAL,   -- mean pts/game (W=3,D=1,L=0)
    form_pts_std         REAL,   -- std of pts/game → form consistency
    draw_rate            REAL,   -- draw rate in last 10 matches

    updated_at           TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, league_id, season)
);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fixtures (
    fixture_id    TEXT    PRIMARY KEY,
    league_id     INTEGER NOT NULL,
    season        INTEGER NOT NULL,
    home_team_id  TEXT    NOT NULL,
    away_team_id  TEXT    NOT NULL,
    home_team_name TEXT,
    away_team_name TEXT,
    kickoff       TEXT    NOT NULL,   -- ISO datetime UTC
    status        TEXT    DEFAULT 'scheduled',
    -- Outcomes (filled after match)
    home_goals    INTEGER,
    away_goals    INTEGER,
    home_corners  INTEGER,
    away_corners  INTEGER,
    home_cards    INTEGER,
    away_cards    INTEGER,
    created_at    TEXT    DEFAULT (datetime('now')),
    updated_at    TEXT    DEFAULT (datetime('now'))
);

-- ── Recommendations ──────────────────────────────────────────────────────────
-- One row per betting coupon generated.
CREATE TABLE IF NOT EXISTS recommendations (
    rec_id           TEXT PRIMARY KEY,
    fixture_id       TEXT NOT NULL,
    created_at       TEXT DEFAULT (datetime('now')),

    -- Subscores
    goal_chaos       REAL,
    corner_pressure  REAL,
    card_heat        REAL,
    volatility       REAL,
    chaos_score      REAL NOT NULL,

    -- Parlay
    legs_json        TEXT NOT NULL,   -- JSON: [{market, odds, p_cal, edge}, ...]
    combined_odds    REAL NOT NULL,
    stake            REAL NOT NULL,
    potential_payout REAL NOT NULL,

    -- Outcome
    status           TEXT DEFAULT 'pending',  -- pending/won/lost/void
    pnl              REAL,
    outcome_at       TEXT,

    FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
);

-- ── Individual legs ──────────────────────────────────────────────────────────
-- One row per market per coupon — this is what feeds calibration.
CREATE TABLE IF NOT EXISTS recommendation_legs (
    leg_id             TEXT PRIMARY KEY,
    rec_id             TEXT    NOT NULL,
    fixture_id         TEXT    NOT NULL,
    market             TEXT    NOT NULL,  -- btts | o25 | corners_o95 | cards_o35
    line               REAL,             -- e.g. 9.5 for corners
    odds               REAL    NOT NULL,
    p_raw              REAL    NOT NULL,  -- empirical rate from team stats
    p_proxy            REAL,             -- p_raw * 0.85 (phase 1)
    p_cal              REAL    NOT NULL,  -- calibrated p used for edge calc
    implied            REAL    NOT NULL,  -- 1/odds
    edge               REAL    NOT NULL,  -- p_cal - implied
    calibration_phase  INTEGER NOT NULL,  -- 1 | 2 | 3
    outcome            INTEGER,           -- 1=win 0=loss NULL=pending
    created_at         TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (rec_id) REFERENCES recommendations(rec_id)
);

-- ── Calibration buckets per market ───────────────────────────────────────────
-- 10 equal-width buckets over [0, 1] probability space.
CREATE TABLE IF NOT EXISTS calibration_buckets (
    market      TEXT    NOT NULL,
    bucket_idx  INTEGER NOT NULL,   -- 0..9
    bucket_min  REAL    NOT NULL,
    bucket_max  REAL    NOT NULL,
    n_bets      INTEGER DEFAULT 0,
    n_wins      INTEGER DEFAULT 0,
    updated_at  TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (market, bucket_idx)
);

-- ── Bankroll daily log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bankroll_log (
    date            TEXT PRIMARY KEY,   -- YYYY-MM-DD
    opening_balance REAL NOT NULL,
    closing_balance REAL,
    stake_used      REAL DEFAULT 0,
    coupons_placed  INTEGER DEFAULT 0
);

-- ── API cache ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_cache (
    cache_key   TEXT PRIMARY KEY,
    response    TEXT    NOT NULL,   -- JSON blob
    fetched_at  TEXT    DEFAULT (datetime('now')),
    ttl_seconds INTEGER DEFAULT 3600
);

-- ── Learned ChaosScore weights ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chaos_weights (
    version        INTEGER PRIMARY KEY,
    weights_json   TEXT    NOT NULL,   -- {"goal_chaos": w, ...}
    n_samples      INTEGER NOT NULL,
    target         TEXT    NOT NULL,   -- Y_3of4
    train_accuracy REAL,
    trained_at     TEXT    DEFAULT (datetime('now'))
);

-- Seed calibration buckets for all 4 markets
INSERT OR IGNORE INTO calibration_buckets
    (market, bucket_idx, bucket_min, bucket_max)
SELECT m.market, b.idx, b.idx * 0.1, (b.idx + 1) * 0.1
FROM (
    SELECT 'btts'        AS market UNION ALL
    SELECT 'o25'         UNION ALL
    SELECT 'corners_o95' UNION ALL
    SELECT 'cards_o35'
) m
CROSS JOIN (
    SELECT 0 AS idx UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
    UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
    UNION ALL SELECT 8 UNION ALL SELECT 9
) b;

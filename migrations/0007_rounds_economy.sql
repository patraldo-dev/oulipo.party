-- 0007: rounds, the craft grade, and the purse.
-- The Duel stops being once a day: a member plays rounds — prepare (a fresh
-- hidden piece against the day's prompt), write, send, play again. Scoring
-- gains the writing itself: the pot is the piece (words ÷ 15), Sappho grades
-- the craft (✦–✦✦✦✦, ×0.75–×1.5), and the score is banked to a purse. The
-- purse stakes side bets on the round's own hidden piece, and her rewrite can
-- free hostages for a dividend. The Siege is untouched.
-- Apply to a database BEFORE deploying the code that reads these columns and
-- tables (as always).
-- The rounds table is rebuilt rather than altered: a round is now born before
-- its piece, so draft_id must be allowed to wait. Old rows come across as
-- status 'locked' with craft NULL (shown as ✦✦); they are found through their
-- own draft_id, which nothing changes. Two indexes die with the rebuild:
--   idx_duel_rounds_player_day (one duel per member per day) — rounds exist now;
-- the board index is laid again. The drafts' day index is dropped in favour of
-- one per round.

CREATE TABLE IF NOT EXISTS oulipo_duel_rounds_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  duel_date TEXT NOT NULL,
  draft_id TEXT,
  story TEXT NOT NULL,
  policy TEXT NOT NULL,
  ropes TEXT NOT NULL,
  rope_count INTEGER NOT NULL,
  story_types INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  misses INTEGER NOT NULL,
  score INTEGER NOT NULL,
  muzzle_pct INTEGER NOT NULL,
  draft_tokens INTEGER NOT NULL,
  rewrite TEXT,
  rewrite_status TEXT NOT NULL DEFAULT 'pending',
  rewrite_attempts INTEGER NOT NULL DEFAULT 0,
  rewrite_violations TEXT,
  rewrite_slipped TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'writing',
  craft INTEGER,
  hostage_bonus INTEGER,
  locked_at TEXT
);
INSERT INTO oulipo_duel_rounds_new
  (id, user_id, locale, duel_date, draft_id, story, policy, ropes, rope_count,
   story_types, hits, misses, score, muzzle_pct, draft_tokens,
   rewrite, rewrite_status, rewrite_attempts, rewrite_violations, rewrite_slipped,
   created_at, updated_at, status, locked_at)
SELECT
  id, user_id, locale, duel_date, draft_id, story, policy, ropes, rope_count,
  story_types, hits, misses, score, muzzle_pct, draft_tokens,
  rewrite, rewrite_status, rewrite_attempts, rewrite_violations, rewrite_slipped,
  created_at, updated_at, 'locked', updated_at
FROM oulipo_duel_rounds;
DROP TABLE oulipo_duel_rounds;
ALTER TABLE oulipo_duel_rounds_new RENAME TO oulipo_duel_rounds;
CREATE INDEX IF NOT EXISTS idx_duel_rounds_board ON oulipo_duel_rounds (duel_date, locale, score DESC);

-- One hidden piece per round, whoever else played today.
ALTER TABLE oulipo_duel_drafts ADD COLUMN round_id TEXT;
DROP INDEX IF EXISTS idx_duel_drafts_day;
CREATE UNIQUE INDEX IF NOT EXISTS idx_duel_drafts_round ON oulipo_duel_drafts(round_id);

-- What the member has banked. Created lazily, seeded by the code (10).
CREATE TABLE IF NOT EXISTS duel_purse (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- A side bet: staked before the lock, settled by the round's hidden piece.
CREATE TABLE IF NOT EXISTS duel_wagers (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  duel_date TEXT NOT NULL,
  word_key TEXT NOT NULL,
  word_form TEXT NOT NULL,
  side TEXT NOT NULL,
  stake INTEGER NOT NULL,
  odds REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_duel_wagers_round ON duel_wagers (round_id);
CREATE INDEX IF NOT EXISTS idx_duel_wagers_user ON duel_wagers (user_id, duel_date);

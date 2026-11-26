-- 0005: the Siege.
-- A room has a code and keeps it from day to day. Each day a room has one
-- round, a hidden piece of Sappho's own for that day, and one entry per
-- player who opened the room that day. There are no foreign keys, as the rest
-- of the database keeps none.
-- Nothing before the Siege reads these tables, so a Worker deployed without
-- them goes on serving the Duel; the Siege's own pages fail until they exist.
-- Apply before deploying the code that reads them.

CREATE TABLE IF NOT EXISTS siege_rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  locale TEXT NOT NULL,
  created_by TEXT NOT NULL,
  -- The game's day the room was started in, so that a daily limit is counted
  -- in the game's own calendar and not by the server's clock.
  start_day TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_siege_rooms_code ON siege_rooms(code);

CREATE TABLE IF NOT EXISTS siege_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);

-- One round per room per day. `status` is 'writing' while players are still
-- locking, 'resolved' once scored, or 'lapsed' when the day ended with fewer
-- than two players locked. The union of every locked word is kept with the
-- round, for her rewrite.
CREATE TABLE IF NOT EXISTS siege_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  duel_date TEXT NOT NULL,
  draft_id TEXT,
  status TEXT NOT NULL DEFAULT 'writing',
  players INTEGER NOT NULL DEFAULT 0,
  union_size INTEGER,
  union_keys TEXT,
  union_forms TEXT,
  muzzle_pct INTEGER,
  rewrite TEXT,
  rewrite_status TEXT NOT NULL DEFAULT 'pending',
  rewrite_attempts INTEGER NOT NULL DEFAULT 0,
  rewrite_violations TEXT,
  rewrite_slipped TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_siege_rounds_room_day ON siege_rounds(room_id, duel_date);
CREATE INDEX IF NOT EXISTS idx_siege_rounds_day ON siege_rounds(duel_date, status);

-- The room's own hidden piece for the day. It is never the site's piece for
-- that day: anyone who had played the Duel would already know every hit.
CREATE TABLE IF NOT EXISTS siege_drafts (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  prompt_id TEXT,
  prompt_text TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_siege_drafts_round ON siege_drafts(round_id);

-- One entry per player per round. A player counts for the day's siege from
-- the moment they open the room (`present`), until they lock, sit out, or the
-- day ends. How they did is written when the round resolves.
CREATE TABLE IF NOT EXISTS siege_entries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  present INTEGER NOT NULL DEFAULT 1,
  story TEXT,
  policy TEXT,
  ropes TEXT,
  rope_count INTEGER,
  story_types INTEGER,
  locked_at TEXT,
  hits INTEGER,
  misses INTEGER,
  original INTEGER,
  unanimous INTEGER,
  bonus INTEGER,
  score INTEGER,
  verdict TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_siege_entries_round_player ON siege_entries(round_id, user_id);

-- The wrong codes a member tried in a day, to slow a search for rooms that
-- are not theirs to see.
CREATE TABLE IF NOT EXISTS siege_join_misses (
  user_id TEXT NOT NULL,
  miss_date TEXT NOT NULL,
  misses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, miss_date)
);

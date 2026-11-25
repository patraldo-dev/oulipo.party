-- 0003: the day's prompt, one per language.
-- On patrouch.ca the duel rode on the prompt its community of writers saw
-- that day. Here the site makes its own: the first player to ask for a day in
-- a language has the model write it, and it is kept for everyone after.

CREATE TABLE daily_prompts (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  prompt_date TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One prompt per language per day. The unique index settles the race when two
-- players ask for the same day at the same moment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_prompts_day
  ON daily_prompts(locale, prompt_date);

-- 0006: the ledger — every word sent against Sappho, recorded.
-- The wager scoring (fewer words sent, the more a hit pays) was tuned on a
-- handful of test rounds. This table is what retunes it on real play: one
-- row per sent word, with the day, which measured band the word fell in,
-- whether it hit, and the contract it was sent under.
-- Additive only: nothing existing is touched. Written before the code that
-- fills it, so the deploy order stays the usual one.
-- band is 'prompt' or 'other': today a word of the prompt cannot be sent at
-- all (the picker greys it out), so rows are 'other'; the column is there for
-- the finer bands that come later.

CREATE TABLE IF NOT EXISTS duel_ledger (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  duel_date TEXT NOT NULL,
  word_key TEXT NOT NULL,
  word_form TEXT NOT NULL,
  band TEXT NOT NULL,
  hit INTEGER NOT NULL,
  contract INTEGER NOT NULL,
  pays REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS duel_ledger_day ON duel_ledger (duel_date, locale);
CREATE INDEX IF NOT EXISTS duel_ledger_word ON duel_ledger (word_key, hit);

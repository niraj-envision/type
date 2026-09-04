-- The leaderboard database. Run once against your D1 database:
--   wrangler d1 execute type-leaderboard --remote --file=schema.sql

-- every accepted run: the last-24-hours board and the rate limit come from here
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board       TEXT    NOT NULL,
  device      TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  wpm         REAL    NOT NULL,
  raw         REAL,
  acc         REAL,
  consistency REAL,
  seconds     REAL,
  ts          INTEGER NOT NULL,   -- ms since the epoch, when it was accepted
  ip          TEXT                -- salted hash of the submitting address
);
CREATE INDEX IF NOT EXISTS runs_board_ts ON runs (board, ts);
CREATE INDEX IF NOT EXISTS runs_ip_ts    ON runs (ip, ts);

-- one row per device per board: the best run, which is the all-time board
CREATE TABLE IF NOT EXISTS scores (
  board       TEXT    NOT NULL,
  device      TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  wpm         REAL    NOT NULL,
  raw         REAL,
  acc         REAL,
  consistency REAL,
  seconds     REAL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (board, device)
);
CREATE INDEX IF NOT EXISTS scores_board_wpm ON scores (board, wpm DESC);

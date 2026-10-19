-- Vantage · Cloudflare D1 schema (SQLite)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, verifier_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, recovery TEXT DEFAULT '[]',
  created REAL, last_login REAL, last_ip TEXT, prev_login REAL, prev_ip TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER, created REAL, last_seen REAL, expires REAL,
  ip TEXT, ua TEXT, space TEXT DEFAULT 'live', mfa_pending INTEGER DEFAULT 0, remember INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attempts (ts REAL, ip TEXT, username TEXT, ok INTEGER);
CREATE INDEX IF NOT EXISTS attempts_ts ON attempts(ts);
CREATE TABLE IF NOT EXISTS audit (ts REAL, event TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, updated REAL);
CREATE TABLE IF NOT EXISTS settings (space TEXT, key TEXT, value TEXT, PRIMARY KEY (space, key));
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, space TEXT, kind TEXT, data TEXT, created REAL, updated REAL, deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS records_kind ON records(space, kind, deleted);
CREATE INDEX IF NOT EXISTS records_updated ON records(space, updated);
CREATE TABLE IF NOT EXISTS revisions (rid INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, ts REAL, action TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS revisions_rec ON revisions(record_id);
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, feed TEXT, source TEXT, topic TEXT, title TEXT, link TEXT, summary TEXT, published REAL, fetched REAL
);
CREATE INDEX IF NOT EXISTS news_pub ON news(published);
CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, data TEXT, updated REAL, ok REAL, error TEXT, tried REAL);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, space TEXT, key TEXT, kind TEXT, title TEXT, body TEXT,
  relevance REAL, impact REAL, urgency REAL, confidence REAL, score REAL,
  created REAL, updated REAL, status TEXT DEFAULT 'open', feedback TEXT, group_key TEXT, origin TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_key ON alerts(space, key);
CREATE TABLE IF NOT EXISTS snapshots (space TEXT, day TEXT, ts REAL, data TEXT, PRIMARY KEY (space, day));
CREATE TABLE IF NOT EXISTS seen (space TEXT, key TEXT, ts REAL, PRIMARY KEY (space, key));
CREATE TABLE IF NOT EXISTS jobs (name TEXT PRIMARY KEY, last_run REAL, last_ok REAL, last_error TEXT, runs INTEGER DEFAULT 0, note TEXT);

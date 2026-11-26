CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  studio_name TEXT NOT NULL,
  studio_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

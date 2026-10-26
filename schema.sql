CREATE TABLE IF NOT EXISTS guides (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  category TEXT NOT NULL,
  rating TEXT,
  comment TEXT NOT NULL,
  tester_name TEXT,
  question TEXT,
  answer TEXT,
  answer_type TEXT,
  guide_version TEXT,
  model TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback(created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);

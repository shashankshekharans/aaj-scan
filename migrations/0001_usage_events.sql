CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'cloudflare')),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'rate_limited', 'error')),
  tokens INTEGER CHECK (tokens IS NULL OR tokens >= 0),
  fallback_used INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0, 1))
);

CREATE INDEX IF NOT EXISTS usage_events_occurred_at_idx ON usage_events (occurred_at);
CREATE INDEX IF NOT EXISTS usage_events_scan_id_idx ON usage_events (scan_id);

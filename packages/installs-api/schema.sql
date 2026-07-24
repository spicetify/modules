-- installs: one row per (module, verified account); counts are unique
-- installers, never raw request volume.
CREATE TABLE IF NOT EXISTS installs (
	module TEXT NOT NULL,
	user_hash TEXT NOT NULL,
	first_version TEXT NOT NULL,
	first_at INTEGER NOT NULL,
	PRIMARY KEY (module, user_hash)
);
CREATE INDEX IF NOT EXISTS installs_by_module ON installs (module);

CREATE TABLE IF NOT EXISTS rate_limits (
	bucket TEXT PRIMARY KEY,
	count INTEGER NOT NULL,
	reset_at INTEGER NOT NULL
);

-- The consent database (CONSENT-1 CN-R7/R8): a dedicated D1 database per Site
-- and stage, created with jurisdiction "eu", separate from the publication
-- database. One row per decision; rows are never updated. Rows are deleted
-- only by the retention purge (CN-R10). No IP address, user agent or account
-- link is stored.
CREATE TABLE consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consent_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  -- Server UTC time, ISO 8601 with milliseconds.
  recorded_at TEXT NOT NULL,
  -- The browser's decision time: with consent_id, a retried post's identity.
  decided_at TEXT NOT NULL,
  -- When the decision expires if nothing supersedes it (6 months).
  expires_at TEXT NOT NULL,
  config_version TEXT NOT NULL,
  legal_revisions TEXT NOT NULL,
  preferences INTEGER NOT NULL CHECK (preferences IN (0, 1)),
  analytics INTEGER NOT NULL CHECK (analytics IN (0, 1)),
  marketing INTEGER NOT NULL CHECK (marketing IN (0, 1)),
  external_media INTEGER NOT NULL CHECK (external_media IN (0, 1)),
  action TEXT NOT NULL CHECK (action IN ('accept_all', 'reject_all', 'custom', 'withdraw', 'renew')),
  language TEXT NOT NULL,
  ui_version TEXT NOT NULL,
  UNIQUE (consent_id, decided_at)
);

CREATE INDEX consent_records_by_time ON consent_records (recorded_at);

CREATE TRIGGER consent_records_append_only
BEFORE UPDATE ON consent_records
BEGIN
  SELECT RAISE(ABORT, 'consent records are append-only');
END;

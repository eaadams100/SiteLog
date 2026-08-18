-- SiteLog backend schema (PostgreSQL / Neon.tech)
--
-- Run via: npm run db:migrate  (see src/db/migrate.js)
-- or paste directly into the Neon SQL editor.
--
-- Notes on deviations from spec, called out explicitly:
--   1. sync_status on daily_logs gets a CHECK constraint with extra
--      values beyond pending/synced/failed: 'conflict' (Phase 3) and
--      'conflict_resolved' (Phase 5). See src/services/conflictResolver.js
--      for the reasoning behind each.
--   2. daily_logs.supervisor_id has no FK constraint, since no `users`
--      table exists yet ("optional for MVP" per the spec) — it's just a
--      plain nullable UUID column for now.
--   3. (Phase 5) Conflicting logs are NOT deleted or replaced by a merge —
--      every submitted log keeps its own row (full audit trail of who
--      submitted what). One log per conflicting date is chosen as
--      "primary" and updated in place with the merged data
--      (conflict_resolved=true, merged_from_logs tracking every log_id
--      folded in). See conflictResolver.js and syncController.js.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- projects
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  location VARCHAR(300),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- daily_logs (mirrors the mobile app's `logs` SQLite table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS daily_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  supervisor_id UUID, -- no FK yet; no `users` table in the MVP
  log_date DATE NOT NULL,
  weather JSONB DEFAULT '{}'::jsonb,
  workers JSONB DEFAULT '[]'::jsonb,
  materials JSONB DEFAULT '[]'::jsonb,
  issues JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  supervisor_name VARCHAR(100),
  sync_status VARCHAR(20) NOT NULL DEFAULT 'synced',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Phase 5: conflict resolution tracking. ADD COLUMN IF NOT EXISTS is
-- idempotent (Postgres 9.6+, supported on Neon), so re-running this
-- migration against a database that already has these columns is a safe
-- no-op — same pattern as the rest of this file.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS conflict_resolved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS merged_from_logs UUID[] NOT NULL DEFAULT '{}';

-- sync_status CHECK constraint, defined separately (rather than inline on
-- the column) so it can be dropped and recreated idempotently as the set
-- of allowed values grows across phases, without needing a full table
-- rebuild. Phase 5 adds 'conflict_resolved' — a log that was
-- automatically merged during sync, distinct from the older 'conflict'
-- value (kept for defensive/backward compatibility, though the normal
-- flow no longer leaves a log sitting in that state — see
-- conflictResolver.js for why).
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_sync_status_check;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_sync_status_check
  CHECK (sync_status IN ('pending', 'synced', 'failed', 'conflict', 'conflict_resolved'));

-- =============================================================================
-- photos (mirrors the mobile app's `photos` SQLite table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS photos (
  photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs (log_id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL, -- cloud storage path/URL, not a local device path
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('pending', 'synced', 'failed')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- sync_errors
-- =============================================================================
-- log_id is intentionally NOT a foreign key to daily_logs. The whole point
-- of this table is to record sync failures — including the exact case
-- where the daily_logs INSERT itself failed (e.g. a bad project_id). If
-- log_id were a FK, that's precisely the case where writing the error row
-- would itself fail with a FK violation, since the referenced log never
-- got created. So this is a plain UUID for traceability, not an enforced
-- relationship.
CREATE TABLE IF NOT EXISTS sync_errors (
  error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID,
  error_message TEXT,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- conflict_log (Phase 5) — audit trail of every automatic conflict merge
-- =============================================================================
-- log_id points at the PRIMARY log (the row that received the merged
-- data), not at every log involved — the full set of involved logs is on
-- daily_logs.merged_from_logs for that primary row. No ON DELETE behavior
-- specified beyond the default (RESTRICT) — an audit table intentionally
-- makes it harder to delete the log it's auditing out from under it.
CREATE TABLE IF NOT EXISTS conflict_log (
  conflict_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID REFERENCES daily_logs (log_id),
  conflict_date DATE NOT NULL,
  resolution_strategy VARCHAR(50), -- 'lww' | 'union' | 'manual'
  resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution_details JSONB
);

CREATE INDEX IF NOT EXISTS idx_conflict_log_log_id ON conflict_log (log_id);
CREATE INDEX IF NOT EXISTS idx_conflict_log_conflict_date ON conflict_log (conflict_date);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_daily_logs_project_date ON daily_logs (project_id, log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_sync_status ON daily_logs (sync_status);
CREATE INDEX IF NOT EXISTS idx_daily_logs_conflict_resolved ON daily_logs (conflict_resolved) WHERE conflict_resolved = TRUE;
CREATE INDEX IF NOT EXISTS idx_photos_log_id ON photos (log_id);
CREATE INDEX IF NOT EXISTS idx_photos_sync_status ON photos (sync_status);
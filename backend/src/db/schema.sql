CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- projects
CREATE TABLE IF NOT EXISTS projects (
  project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  location VARCHAR(300),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- daily_logs (mirrors the mobile app's `logs` SQLite table)
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
  sync_status VARCHAR(20) NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'conflict')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- photos (mirrors the mobile app's `photos` SQLite table)
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

-- sync_errors
CREATE TABLE IF NOT EXISTS sync_errors (
  error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID,
  error_message TEXT,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_logs_project_date ON daily_logs (project_id, log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_sync_status ON daily_logs (sync_status);
CREATE INDEX IF NOT EXISTS idx_photos_log_id ON photos (log_id);
CREATE INDEX IF NOT EXISTS idx_photos_sync_status ON photos (sync_status);

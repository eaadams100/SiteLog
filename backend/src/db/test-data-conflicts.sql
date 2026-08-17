-- test-data-conflicts.sql
--
-- Reference SQL for the Phase 5 test scenarios. This sets up BASELINE
-- data only (projects, and for scenarios that need an "already synced"
-- log to conflict against). It intentionally does NOT insert the second,
-- conflicting log directly via SQL — conflict detection and resolution
-- only run inside the sync controller (POST /api/v1/sync), not as a
-- database trigger, so the actual conflict has to be created by calling
-- the API. See scripts/test-conflict-scenarios.sh, which runs this SQL
-- and then exercises every scenario via curl end to end (this is exactly
-- the script used to verify Phase 5 while building it).
--
-- Safe to run against a scratch/test database only — not idempotent
-- (plain INSERTs, no ON CONFLICT DO NOTHING), and not intended for
-- production use.

-- Two projects, for the "different project" no-conflict scenario.
INSERT INTO projects (project_id, name, location) VALUES
  ('76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0', 'Default Project', NULL),
  ('11111111-2222-3333-4444-555555555555', 'Second Project', 'Kumasi');

-- Scenario 1 / 4 / 5 / 6 / 7 baseline: "Log A" already synced, representing
-- what a first supervisor submitted earlier. Everything downstream tests
-- what happens when a conflicting "Log B" is synced against this.
INSERT INTO daily_logs (
  log_id, project_id, log_date, weather, workers, materials, issues,
  notes, supervisor_name, sync_status, created_at, updated_at
) VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0',
  '2026-08-01',
  '{"condition": "Sunny", "temp": 88}'::jsonb,
  '[{"trade": "Mason", "count": 4}]'::jsonb,
  '[{"name": "Cement", "quantity": 20, "unit": "bags"}]'::jsonb,
  '[]'::jsonb,
  'Morning update.',
  'John Mensah',
  'synced',
  '2026-08-01T08:00:00.000Z',
  '2026-08-01T08:00:00.000Z'
);

/**
 * src/db/seed.js
 *
 * Seeds the single default project the mobile app currently syncs
 * against. The mobile app (mobile/app/log-entry.js) hardcodes
 * DEFAULT_PROJECT_ID as a fixed UUID rather than letting the user pick a
 * project — there's no project picker UI yet. For that hardcoded UUID to
 * actually work, a matching row has to exist in this database's
 * `projects` table, or every sync will fail with a foreign key violation
 * on daily_logs.project_id.
 *
 * This is a stopgap, not the long-term design — see backend/README.md's
 * "What's next" section for the real fix (a project picker on mobile,
 * project_id stored locally instead of hardcoded). Once that exists, this
 * script (and the mobile constant it matches) can go away.
 *
 * Idempotent: safe to run multiple times — uses the same upsert-by-id
 * pattern as Project.create(), so re-running just confirms the row still
 * exists rather than erroring or duplicating it.
 *
 * Usage: npm run db:seed
 */

require('dotenv').config();
const { pool } = require('../config/db');
const Project = require('../models/Project');

// Must match DEFAULT_PROJECT_ID in mobile/app/log-entry.js exactly.
const DEFAULT_PROJECT = {
  id: '76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0',
  name: 'Default Project',
  location: null,
};

async function seed() {
  try {
    const existing = await Project.getById(DEFAULT_PROJECT.id);
    if (existing) {
      console.log('Default project already exists, nothing to do:', existing);
      return;
    }

    const project = await Project.create(DEFAULT_PROJECT);
    console.log('Default project created:', project);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
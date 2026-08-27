/**
 * src/db/seed.js
 *
 * Seeds:
 *   1. The single default project the mobile app currently syncs
 *      against. The mobile app (mobile/app/log-entry.js) hardcodes
 *      DEFAULT_PROJECT_ID as a fixed UUID rather than letting the user
 *      pick a project — there's no project picker UI yet. For that
 *      hardcoded UUID to actually work, a matching row has to exist in
 *      this database's `projects` table, or every sync will fail with a
 *      foreign key violation on daily_logs.project_id.
 *   2. (Phase 7) Two test accounts — one 'supervisor', one 'pm' — so you
 *      can log into the mobile app and dashboard immediately without
 *      first hitting POST /api/v1/auth/register by hand.
 *
 *      ⚠ CHANGE OR REMOVE THESE BEFORE ANY REAL DEPLOYMENT. Fixed,
 *      published test credentials are fine for local/dev setup and are
 *      exactly why they're printed below — but shipping them as-is to
 *      production is a real security hole.
 *
 * The project seed is a stopgap, not the long-term design — see
 * backend/README.md's "What's next" section for the real fix (a project
 * picker on mobile, project_id stored locally instead of hardcoded).
 * Once that exists, this script (and the mobile constant it matches) can
 * go away.
 *
 * Idempotent: safe to run multiple times.
 *
 * Usage: npm run db:seed
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const Project = require('../models/Project');
const User = require('../models/User');

// Must match DEFAULT_PROJECT_ID in mobile/app/log-entry.js exactly.
const DEFAULT_PROJECT = {
  id: '76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0',
  name: 'Default Project',
  location: null,
};

const TEST_USERS = [
  { email: 'supervisor@sitelog.test', password: 'supervisor123', name: 'Test Supervisor', role: 'supervisor' },
  { email: 'pm@sitelog.test', password: 'manager123', name: 'Test Manager', role: 'pm' },
];

async function seedProject() {
  const existing = await Project.getById(DEFAULT_PROJECT.id);
  if (existing) {
    console.log('Default project already exists, nothing to do:', existing);
    return;
  }
  const project = await Project.create(DEFAULT_PROJECT);
  console.log('Default project created:', project);
}

async function seedUsers() {
  for (const testUser of TEST_USERS) {
    const alreadyExists = await User.emailExists(testUser.email);
    if (alreadyExists) {
      console.log(`User ${testUser.email} already exists, skipping.`);
      continue;
    }
    const passwordHash = await bcrypt.hash(testUser.password, 10);
    const created = await User.create({
      email: testUser.email,
      passwordHash,
      name: testUser.name,
      role: testUser.role,
    });
    console.log(`Created ${testUser.role} account:`, created.email);
  }

  console.log('\nTest login credentials (change/remove before real deployment):');
  for (const testUser of TEST_USERS) {
    console.log(`  ${testUser.role.padEnd(10)} ${testUser.email}  /  ${testUser.password}`);
  }
}

async function seed() {
  try {
    await seedProject();
    await seedUsers();
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();

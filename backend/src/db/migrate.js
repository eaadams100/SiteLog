/**
 * src/db/migrate.js
 *
 * One-shot script to apply schema.sql against DATABASE_URL. Not a full
 * migration framework (no up/down tracking) — for a Phase 3 MVP this is
 * "run once against a fresh Neon database", not an evolving migration
 * history. Revisit with a proper tool (node-pg-migrate, Prisma Migrate,
 * etc.) if the schema needs to evolve after data already exists in it.
 *
 * Usage: npm run db:migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Add it to your .env file (see .env.example).');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    console.log(`Applying schema.sql to ${isLocal ? 'local' : 'remote'} database...`);
    await pool.query(schemaSql);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();

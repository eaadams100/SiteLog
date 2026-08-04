/**
 * src/models/Project.js
 *
 * All database access for the projects table.
 */

const { query } = require('../config/db');

/**
 * Creates a new project. If `id` isn't provided, Postgres generates one
 * via the column's DEFAULT gen_random_uuid().
 *
 * @param {Object} projectData
 * @param {string} [projectData.id]
 * @param {string} projectData.name
 * @param {string} [projectData.location]
 * @returns {Promise<Object>} the created row
 */
async function create(projectData) {
  const { id = null, name, location = null } = projectData;

  const result = await query(
    `INSERT INTO projects (project_id, name, location)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
     RETURNING *;`,
    [id, name, location]
  );

  return result.rows[0];
}

/**
 * Retrieves every project along with a count of how many daily logs each
 * one has (useful for a dashboard project list without a second round
 * trip per project).
 *
 * @returns {Promise<Array<Object>>}
 */
async function getAll() {
  const result = await query(
    `SELECT p.*, COUNT(dl.log_id)::int AS log_count
     FROM projects p
     LEFT JOIN daily_logs dl ON dl.project_id = p.project_id
     GROUP BY p.project_id
     ORDER BY p.created_at DESC;`
  );
  return result.rows;
}

/**
 * Retrieves a single project by id. Returns null if not found.
 *
 * @param {string} projectId
 * @returns {Promise<Object|null>}
 */
async function getById(projectId) {
  const result = await query(`SELECT * FROM projects WHERE project_id = $1;`, [projectId]);
  return result.rows[0] || null;
}

module.exports = { create, getAll, getById };

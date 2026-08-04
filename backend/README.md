# SiteLog Backend (Phase 3)

REST API that receives synced daily logs and photos from the SiteLog
mobile app, stores them in PostgreSQL (Neon.tech), resolves conflicts when
multiple supervisors log the same project/date offline, and serves data
to the Phase 6 web dashboard.

## Stack

Node.js + Express, `pg` (node-postgres) with connection pooling, deployed
to Render.com against a Neon Postgres database.

## Project structure

```
backend/
├── index.js                          # Entry point: Express app, middleware, graceful shutdown
├── package.json
├── .env.example
├── .gitignore
└── src/
    ├── config/
    │   └── db.js                     # Connection pool, query() wrapper, slow-query logging
    ├── db/
    │   ├── schema.sql                # Full schema (tables, constraints, indexes)
    │   └── migrate.js                # One-shot script: applies schema.sql to DATABASE_URL
    ├── models/
    │   ├── DailyLog.js                # upsert, getByProject, getById, exists, getConflictingLogs, markConflicting, getUnresolvedConflicts
    │   ├── Photo.js                   # create (idempotent), getByLogId, deleteByLogId
    │   └── Project.js                 # create, getAll, getById
    ├── services/
    │   └── conflictResolver.js       # LWW + array-merge conflict resolution logic
    ├── controllers/
    │   ├── syncController.js
    │   ├── logController.js
    │   └── projectController.js
    ├── middleware/
    │   ├── validateSyncPayload.js
    │   └── errorHandler.js
    └── routes/
        ├── index.js                   # Aggregates all routes under /api/v1
        ├── syncRoutes.js
        ├── logRoutes.js
        ├── conflictRoutes.js
        └── projectRoutes.js
```

## Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: paste your Neon connection string into DATABASE_URL

npm run db:migrate   # applies src/db/schema.sql to your database
npm run dev           # starts the server with auto-restart on file changes
```

Health check: `GET http://localhost:3000/health` — pings the database and
reports connection status.

## Field naming: mobile `id` vs backend `log_id` / `photo_id`

The mobile app's SQLite tables use `id` as the primary key column (see the
mobile `db/DatabaseManager.js`). This backend's Postgres schema uses
`log_id` / `photo_id` per the Phase 3 spec. The translation happens at the
edges:
- **Incoming sync payloads** use `id` (matching what the mobile app sends).
- **Database rows and API responses** use `log_id` / `photo_id`.
- `syncController.js` and the models are where this mapping happens — look there first if a field seems to "disappear" between request and response.

## API

All endpoints are mounted under `/api/v1`.

### `POST /api/v1/sync`
Body:
```json
{
  "logs": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "log_date": "2026-08-01",
      "supervisor_name": "John Mensah",
      "weather": { "condition": "Sunny", "temp": 88 },
      "workers": [{ "trade": "Mason", "count": 4 }],
      "materials": [{ "name": "Cement", "quantity": 20, "unit": "bags" }],
      "issues": [{ "description": "Delayed delivery", "flagged": true }],
      "notes": "Foundation work progressing well.",
      "created_at": "2026-08-01T08:00:00.000Z",
      "updated_at": "2026-08-01T14:30:00.000Z",
      "photos": [
        { "id": "uuid", "file_path": "https://.../photo.jpg", "file_size": 245000, "width": 800, "height": 600, "created_at": "2026-08-01T09:00:00.000Z" }
      ]
    }
  ]
}
```
Response:
```json
{
  "success": true,
  "summary": { "processed": 1, "conflicts": 0, "errors": 0 },
  "details": [
    { "log_id": "uuid", "status": "synced", "photosSynced": 1, "conflict": null }
  ]
}
```
When a conflict is detected, that entry's `status` is `"conflict"` and
`conflict` contains `conflictingLogIds` plus a `suggestedMerge` (see
below). One bad log in the batch doesn't fail the whole request — it's
recorded in `sync_errors` and counted under `summary.errors`.

### `GET /api/v1/logs?projectId=...&startDate=...&endDate=...&limit=...&offset=...`
`projectId` is required; date range and pagination are optional
(`limit` defaults to 50, capped at 200).

### `GET /api/v1/logs/:id`
Returns a single log with its photos nested under `photos`.

### `GET /api/v1/conflicts?projectId=...`
Returns unresolved conflicts grouped by `(project_id, log_date)`, each
with all the conflicting log rows attached under `logs`. `projectId` is
optional — omit it to see conflicts across every project.

### `GET /api/v1/projects` · `POST /api/v1/projects` · `GET /api/v1/projects/:id`
Standard CRUD-lite for projects. `POST` requires `name`; `location` is optional.

## Conflict resolution — how it actually works

The Phase 3 spec didn't fully pin down what "resolving" a conflict means
in terms of what gets written to the database, so here's the design
decision made and why, spelled out (also commented in
`conflictResolver.js`):

**A conflict happens when** two supervisors, both offline, independently
create a log (separate `log_id`, generated on-device) for the same
`project_id` + `log_date`. Neither device can know about the other's
unsynced log, so this can only be caught when both finally sync.

**What happens on conflict:** both logs are kept as separate rows —
neither supervisor's submission is silently overwritten or discarded, since
for a construction site's daily record, losing one version quietly would
be worse than surfacing the conflict for a human to review. Both rows get
`sync_status = 'conflict'` (a value added to the schema's CHECK constraint
beyond the spec's `pending`/`synced`/`failed` — needed as somewhere to
park "this needs review"). `conflictResolver.js` also computes a
*suggested* merged version (Last-Write-Wins for `weather`/`notes`/
`supervisor_name`, based on `updated_at`; union-by-key for
`workers`/`materials`/`issues`, keeping the most-recently-updated log's
version of any item that appears in more than one log) — this is returned
in the sync response and via `GET /api/v1/conflicts`, but **not** applied
automatically. Actually merging is left for a human via the Phase 6
dashboard (or a future `PATCH /api/v1/conflicts/:id/resolve` endpoint,
which isn't built yet).

**One judgment call worth knowing about:** for `workers`, if two
conflicting logs both list `"Mason"` with a count, the merge keeps
whichever entry is from the more-recently-updated log — it does **not**
sum the counts. That's because two "Mason: 4" entries are more likely the
same real crew logged twice than two genuinely different crews. If your
actual usage pattern is "different supervisors, different crews, counts
should add" — that's a one-line change in `mergeArrayField` inside
`conflictResolver.js`, just flagging it wasn't obvious from the spec which
behavior was wanted.

## Deviations from the spec, summarized

- **`sync_status = 'conflict'`** added to `daily_logs`' allowed values (schema + model), for the reason above.
- **`DailyLog.markConflicting(logIds)`** — not in the original model list, but needed to flag the *pre-existing* logs in a conflicting group, not just the newly-synced one.
- **`DailyLog.getUnresolvedConflicts(projectId)`** — not in the original model list; backs `GET /api/v1/conflicts` since the schema has no dedicated `conflicts` table (conflicts are computed by grouping `daily_logs` rows with `sync_status = 'conflict'` by project + date, rather than persisted separately).
- **`Photo.create()` is an idempotent upsert** (`ON CONFLICT (photo_id) DO UPDATE`), not a plain `INSERT`, so retried/partial sync batches don't error on a duplicate `photo_id`.
- **Cloud photo storage isn't implemented.** The spec's `photos.file_path` is documented as "Cloud storage path", but no storage provider (S3, Cloudinary, etc.) was specified. Right now the backend just stores whatever `file_path` string the mobile app sends — actually uploading photo bytes to cloud storage and generating that path is out of scope for this pass. `Photo.deleteByLogId()` likewise only removes database rows; add a storage-provider delete call wherever cascading deletes are triggered once that's wired up.

## Deployment to Render.com

1. Create a new **Web Service** in Render, pointed at this repo with the **root directory set to `backend`**.
2. Build command: `npm install`. Start command: `npm start`.
3. Set environment variables in the Render dashboard: `DATABASE_URL` (your Neon connection string), `NODE_ENV=production`, `CORS_ORIGIN` (your deployed dashboard's origin), and optionally `DB_POOL_MAX` / `RATE_LIMIT_MAX`.
4. Run `npm run db:migrate` once against your Neon database before first deploy (locally, with `DATABASE_URL` pointed at Neon) — Render doesn't run this automatically.
5. Render sends `SIGTERM` on deploys/restarts; `index.js` already handles that for a graceful shutdown (closes the HTTP server and the DB pool before exiting).

## What's next (not in Phase 3)

- Cloud photo storage integration (upload + `file_path` generation, delete-on-cascade)
- Auth (the spec notes `supervisor_id`/`users` as "optional for MVP" — no auth exists yet, so every endpoint is currently open)
- A conflict-resolution endpoint that actually applies a chosen merge, rather than just suggesting one
- Automated tests

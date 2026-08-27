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

### `PUT /api/v1/logs/:id/flag` (Phase 6)
Toggles a single issue's `flagged` status. Body: `{ "issueIndex": number, "flagged": boolean }`.
`issueIndex` addresses the issue by its position in the log's `issues`
array (issues don't have their own id). Returns `400` if `issueIndex` is
out of range for that log, `404` if the log doesn't exist, or
`{ success: true, log }` with the updated log on success.

### `GET /api/v1/conflicts?projectId=...`
Returns conflict **history** — every automatic merge that's happened, via
the `conflict_log` audit table — not a review queue. Since Phase 5,
conflicts resolve automatically during sync, so nothing normally sits
"unresolved" waiting for a person. `projectId` is optional — omit it to
see history across every project.

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

---

# Phase 5 — Automatic Conflict Resolution

Extends Phase 3's conflict *detection* into automatic conflict
*resolution*: when two logs exist for the same project + date, the sync
endpoint now merges them synchronously, inside a database transaction,
with a full audit trail — rather than flagging both and waiting for a
human to review.

## Behavior change from Phase 3 (read this first)

Phase 3 deliberately never auto-merged conflicting logs — both logs were
kept as separate rows, flagged `sync_status = 'conflict'`, with a
*suggested* merge computed but not applied. The reasoning at the time:
silently merging two supervisors' independent submissions risked losing
or altering someone's data without them knowing.

Phase 5 was explicitly asked to do the opposite: automatic, synchronous
merging, no review step. That's what's implemented now. The audit-trail
concern that motivated Phase 3's original design is still addressed, just
differently:
- **Every submitted log keeps its own row.** Nothing is deleted or
  overwritten in a way that loses the original submission.
- **One log per conflict group becomes "primary"** and gets updated in
  place with the merged data (`conflict_resolved = true`,
  `merged_from_logs` recording every log_id folded in).
- **Every resolution is recorded in `conflict_log`** — an explicit,
  queryable audit trail of exactly what got merged, when, and how (see
  `resolution_details` JSONB, which stores the full resolved field values
  and every log_id involved).

## Primary selection

When a new log conflicts with existing ones, one of the group becomes
"primary" — deterministically, so resolving the same conflict twice
never disagrees with itself:
1. If one of the existing logs is already a primary from an earlier merge
   (`conflict_resolved = true`), it stays primary — this is what lets a
   3rd, 4th, ... late-arriving conflicting log join an existing merge
   group instead of starting a new one.
2. Otherwise, whichever log has the earliest `created_at` wins.

Note that the **incoming** log can become primary — if a device syncs
late (e.g. it was offline for days) but its log's `created_at` predates
what's already stored, it correctly takes over as primary.

## Per-field merge semantics

- **`weather`, `notes`, `supervisor_name`** — Last-Write-Wins, based on
  each log's `updated_at`.
- **`workers`** — union keyed by `trade`. If the same trade appears in
  more than one log, the most-recently-updated log's entry wins (this can
  mean a worker COUNT gets overwritten, not summed — two "Mason: 4"
  entries are treated as more likely the same crew logged twice than two
  different crews; change `conflictResolver.js` if your usage pattern
  needs summing instead).
- **`materials`, `issues`** — union with **exact**-duplicate removal
  only. Two materials are the same only if name AND quantity AND unit all
  match (issues: description AND flagged). Unlike `workers`, this never
  collapses two entries that share a name but differ elsewhere — both are
  kept. This matches the spec's literal wording rather than the
  partial-key "latest wins" approach used for workers.
- **Photos are not merged as a stored field** — they aren't a JSONB
  column on `daily_logs`, they're rows in the separate `photos` table,
  each already tied to whichever log_id they were submitted under.
  "Merging" them means `DailyLog.getById()` aggregates photos across the
  primary log AND everything in its `merged_from_logs` at *read* time,
  rather than computing and storing a merged photo array that wouldn't
  map onto the actual schema.

## A real bug this caught (documented so it isn't silently reintroduced)

While testing this against real Postgres, Last-Write-Wins resolution
initially picked the WRONG log's data — consistently the older log,
regardless of which one actually had the later `updated_at`. Root cause:
`DailyLog.upsert()` was unconditionally stamping `updated_at =
CURRENT_TIMESTAMP` on every insert, discarding whatever `updated_at` the
client actually sent. So by the time a later conflict check re-read an
already-synced log from the database, its stored `updated_at` reflected
*when it happened to sync*, not *when its content was actually last
edited* — which silently defeats the entire point of Last-Write-Wins.
This bug existed since Phase 3 but was never caught, because Phase 3
never persisted or re-inspected resolved field values closely enough to
expose it.

Fixed in two places (both were necessary — fixing only one wouldn't have
worked):
1. `DailyLog.upsert()` now trusts a client-supplied `updated_at`,
   falling back to `CURRENT_TIMESTAMP` only if none was provided (the
   same pattern already used for `created_at`).
2. `syncController.js` was actually missing `updated_at: incoming.updated_at`
   in the objects passed to `upsert()` — the model fix alone did nothing
   until the controller was also passing the value through.

Verified fixed via `scripts/test-conflict-scenarios.sh` end to end against
real Postgres — see that script's Scenario 4/5 assertions.

## Files new/changed

```
backend/
├── src/
│   ├── db/
│   │   ├── schema.sql                    # updated — conflict_resolved, merged_from_logs, conflict_log table (idempotent ALTER COLUMN IF NOT EXISTS)
│   │   └── test-data-conflicts.sql       # NEW — baseline data for the 7 test scenarios
│   ├── models/
│   │   ├── DailyLog.js                   # updated — applyConflictResolution(), transaction-aware upsert(), updated_at fix
│   │   ├── Photo.js                      # updated — transaction-aware create()
│   │   └── ConflictLog.js                # NEW — audit trail model
│   ├── services/
│   │   └── conflictResolver.js           # rewritten — auto-merge logic, primary selection, per-field merge semantics
│   ├── controllers/
│   │   ├── syncController.js             # rewritten — transactional conflict resolution flow
│   │   ├── logController.js              # slimmed — conflict logic moved out
│   │   └── conflictController.js         # NEW — GET /api/v1/conflicts, now serves audit history
│   └── routes/
│       └── conflictRoutes.js             # updated — points at conflictController
└── scripts/
    └── test-conflict-scenarios.sh        # NEW — runnable end-to-end test for all 7 scenarios, verified passing
```

## Response shape (kept, not replaced)

The doc proposed wrapping the sync response in a `data` field. That's
**not** what's implemented — the existing, already-tested
`{ success, summary, details }` shape is kept, since switching to a
`data` wrapper now would break the already-working Phase 4 mobile sync
code for no functional benefit. `details[]` items just gained new fields:

```json
{
  "log_id": "uuid",
  "status": "conflict_resolved",
  "conflict_resolved": true,
  "primary_log_id": "uuid",
  "merged_from": ["uuid1", "uuid2"],
  "updated_at": "2026-08-01T15:00:00.000Z",
  "photosSynced": 1
}
```

`primary_log_id` may differ from `log_id` — it's whichever log in the
conflict group was chosen as primary, which might not be the log that was
just synced (see "Primary selection" above).

## `GET /api/v1/conflicts` — now conflict history, not a review queue

Phase 3's version of this endpoint listed logs stuck in
`sync_status = 'conflict'`, awaiting human review. Since Phase 5 resolves
automatically, nothing normally stays in that state — so this endpoint
now serves the `conflict_log` audit trail instead: "here's every
automatic merge that's happened," not "here's what's waiting on you."

```
GET /api/v1/conflicts?projectId=...&limit=...&offset=...
```

Each entry includes `resolution_details` (the full merged field values
and every log_id involved) and the primary log's current state.

## Atomicity

Each log's entire processing — conflict detection's writes, the primary
log update, the audit log entry, the incoming log's own upsert, and all
of its photos — runs inside a single database transaction
(`BEGIN`/`COMMIT`/`ROLLBACK` via `getClient()`). If any step fails, the
whole thing rolls back and the failure is recorded to `sync_errors` (per
Phase 3's existing per-log isolation — one bad log in a batch still
doesn't fail the whole sync request).

## Running the test scenarios yourself

```bash
cd backend
# Point at a SCRATCH database — this inserts test data, don't run against production
DATABASE_URL="postgresql://...scratch-db..." npm run db:migrate
psql "$DATABASE_URL" -f src/db/test-data-conflicts.sql
DATABASE_URL="postgresql://...scratch-db..." npm start &

API_BASE_URL=http://localhost:3000 ./scripts/test-conflict-scenarios.sh
```

Covers all 7 scenarios from the spec: same project+date conflict,
different-project no-conflict, different-date no-conflict, LWW picking
local-newer, LWW picking cloud-newer, array union removing exact
duplicates, array union keeping unique items.

## What's next

- Manual conflict override/re-resolution endpoint (the spec's "allows
  manual resolution (future)" — still future)
- Cloud photo storage (unchanged from Phase 3 — still metadata-only sync)
- Auth

---

# Phase 7 — Authentication

Roll-your-own JWT + bcrypt auth, covering both mobile (supervisors) and
the dashboard (project managers). Every API endpoint except `/health`,
`POST /api/v1/auth/register`, and `POST /api/v1/auth/login` now requires
a valid `Authorization: Bearer <token>` header.

## New endpoints

- **`POST /api/v1/auth/register`** — `{ email, password, name, role? }` → `{ success, token, user }`. `role` defaults to `'supervisor'` if omitted; must be `'supervisor'` or `'pm'` if provided.
- **`POST /api/v1/auth/login`** — `{ email, password }` → `{ success, token, user }`, or 401 on bad credentials (same generic error for "no such email" and "wrong password" — doesn't let a caller enumerate registered emails).
- **`GET /api/v1/auth/me`** — requires auth, returns the current user's profile.

## Role gating

| Route | Requires |
|---|---|
| `POST /api/v1/sync` | any authenticated user |
| `GET /api/v1/logs`, `GET /api/v1/logs/:id` | any authenticated user |
| `PUT /api/v1/logs/:id/flag` | `pm` |
| `GET /api/v1/conflicts` | `pm` |
| `GET /api/v1/projects`, `GET /api/v1/projects/:id` | any authenticated user |
| `POST /api/v1/projects` | `pm` |

## ⚠️ Security gap, deliberately left open — read before real deployment

**Registration is open, and the caller picks their own role.** Anyone who
can reach `POST /api/v1/auth/register` can grant themselves `'pm'`
privileges — flagging issues, viewing conflict history, creating
projects — just by choosing that role at signup. This is fine for
initial setup and a trusted internal rollout, but it's a real gap before
wider use. Two reasonable fixes, not implemented here since they're a
product decision:
1. Strip `role` from the public registration payload; everyone registers
   as `'supervisor'`, and promoting someone to `'pm'` becomes a separate
   admin-only action (needs an admin/superuser concept that doesn't
   exist yet).
2. Invite-code or admin-approval-gated registration.

## Identity, not free text

Before this phase, `supervisor_name` was whatever string the mobile
client happened to send — no verification, no way to know if it was
accurate. Now, `syncController.js` **ignores** `supervisor_name` in the
sync payload entirely and derives both `supervisor_id` and
`supervisor_name` from the authenticated JWT (`req.user`). Verified with
a real test: a supervisor's device tried to sync a log claiming
`"supervisor_name": "SOMEONE ELSE ENTIRELY"` — the stored row correctly
shows the authenticated user's real name, not the claimed one.

## Token lifetime

Tokens default to 30 days (`JWT_EXPIRES_IN` in `.env`), not the more
typical 15min-1hr for a web app. Deliberate: mobile supervisors are
offline-first and may not reconnect for days — a short-lived token would
force a re-login right when someone finally has signal and wants to sync.
There's no refresh-token flow or revocation list; a role change or
account issue won't take effect until the current token naturally
expires. Worth revisiting if that trade-off doesn't fit your needs.

## Password hashing

`bcryptjs` (pure JS), not `bcrypt` (native bindings) — avoids native
-module compile risk on Render, the same reasoning already applied
elsewhere in this project.

## Setup

```bash
cd backend
npm install
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # generate JWT_SECRET
# add JWT_SECRET (and optionally JWT_EXPIRES_IN) to .env
npm run db:migrate   # adds the users table + supervisor_id FK, idempotent
npm run db:seed      # also now seeds two test accounts — see below
```

`npm run db:seed` now prints test login credentials:
```
supervisor supervisor@sitelog.test  /  supervisor123
pm         pm@sitelog.test          /  manager123
```
**Change or remove these before any real deployment** — they're
published in this repo/README, so they're not a secret.

## Verified

Full auth flow tested against real Postgres: unauthenticated request
correctly 401s, login/register work, wrong password correctly 401s,
`GET /auth/me` returns the right profile, a supervisor attempting a
`pm`-only action correctly 403s, a `pm` succeeds at the same action, and
the identity-spoofing prevention in `syncController.js` was confirmed
with a live request.

## What's next

- Fix the open-registration role-selection gap above, before real deployment
- Refresh tokens / revocation list
- Password reset flow (currently none — a forgotten password has no self-service recovery)
- Rate limiting specifically on `/auth/login` (currently just the app-wide rate limiter, not a tighter brute-force-specific one)
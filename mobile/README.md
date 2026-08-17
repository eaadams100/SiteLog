# SiteLog — Phase 2 (Photo Capture)

Offline-first construction site daily log app, on Expo Router + **Expo SDK
54**. Phase 2 adds photo capture/gallery-picking to the daily log form and
detail view, still fully offline — photos are compressed and stored as
files in the app's private directory, with only the file path and metadata
in SQLite.

## Project structure

```
SiteLog/
├── app/
│   ├── log-detail/
│   │   └── [id].js               # Route "/log-detail/:id" — ⬅ updated: photo grid/modal
│   ├── _layout.js                # Root layout: init DB, render <Stack/> — unchanged
│   ├── index.js                  # Route "/" — log list — unchanged
│   └── log-entry.js              # Route "/log-entry" — ⬅ updated: photo capture/grid/modal
├── db/
│   └── DatabaseManager.js        # ⬅ updated: photos table + photo/updateLog methods
├── utils/
│   └── helpers.js                # unchanged
├── app.json                      # ⬅ merged: expo-image-picker plugin config added
└── package.json                  # unchanged — Phase 2 deps already present
```

`app/index.js`, `app/_layout.js`, and `utils/helpers.js` needed no changes
for Phase 2 — `_layout.js` already calls `initDatabase()`, which now also
creates the `photos` table, so nothing extra had to be wired in there.

## Important: this project is on Expo SDK 54 — expo-file-system changed

Your `package.json` is on Expo SDK 54, and **expo-file-system got a
breaking API overhaul in that release (v19)**. The old functional API
(`FileSystem.documentDirectory`, `getInfoAsync`, `copyAsync`,
`deleteAsync`, `makeDirectoryAsync`) now **throws at runtime** when
imported from `'expo-file-system'` directly — it only works via the
explicit `'expo-file-system/legacy'` import, and legacy is itself on a
deprecation path.

`DatabaseManager.js` has been written against the **new class-based API**
(`File`, `Directory`, `Paths`, all synchronous property/method access via
JSI) rather than the old promise-based functions:

| Old (throws on SDK 54)                          | New (used here)                                      |
|---------------------------------------------------|--------------------------------------------------------|
| `FileSystem.documentDirectory`                    | `Paths.document`                                       |
| `FileSystem.getInfoAsync(path)`                   | `new File(path).exists` / `.size` (sync properties)     |
| `FileSystem.makeDirectoryAsync(path, {...})`      | `new Directory(parent, name).create()`                 |
| `FileSystem.copyAsync({ from, to })`              | `new File(from).copy(new File(parent, name))`          |
| `FileSystem.deleteAsync(path, { idempotent })`    | check `.exists`, then `await file.delete()` (wrapped in a try/catch helper, `_deleteFileIfExists`, to reproduce the old idempotent behavior) |

If you ever downgrade this project below SDK 54, or maintain a separate
branch on an older SDK, swap these back for the classic
`import * as FileSystem from 'expo-file-system'` functional calls — the
Phase 1 version of this file (before Phase 2) used that older API and will
still work fine on SDK ≤53.

## Also fixed: deprecated ImagePicker media type

Your installed `expo-image-picker` (~17.0.11) has deprecated
`ImagePicker.MediaTypeOptions.Images` in favor of an array syntax. In
`app/log-entry.js`, `pickPhoto()` now uses:

```js
mediaTypes: ['images']
```

instead of `mediaTypes: ImagePicker.MediaTypeOptions.Images`.

## What's new in `DatabaseManager.js`

**Schema** — a `photos` table, foreign-keyed to `logs` with cascade delete:

| Column      | Type | Notes                                      |
|-------------|------|---------------------------------------------|
| id          | TEXT | UUID v4, primary key                        |
| log_id      | TEXT | FK → `logs.id`, `ON DELETE CASCADE`         |
| file_path   | TEXT | Full `file://...` URI under the app's private dir |
| file_size   | INTEGER | Bytes, after compression                 |
| width       | INTEGER | Pixels, after compression                |
| height      | INTEGER | Pixels, after compression                |
| sync_status | TEXT | `pending` \| `synced` \| `failed`           |
| created_at  | TEXT | ISO timestamp                               |

Indexed on `log_id` and `sync_status`, same pattern as `logs`.

**Methods added:**
- `ensurePhotosDirectory()` — creates a `Directory` at `${Paths.document}/photos` if missing, returns it (called automatically from `initDatabase()`)
- `savePhoto(photoUri, logId)` — the one method screens should call: compresses to 800px width / JPEG quality 0.7 via `expo-image-manipulator`, copies the result into the photos directory via the new `File.copy()`, and inserts the DB row — all in one call
- `insertPhoto(photoData)` — lower-level DB-only insert, for cases where a file already exists on disk
- `getPhotosForLog(logId)`, `getPendingPhotos()`, `updatePhotoSyncStatus(photoId, status)`
- `deletePhoto(photoId, filePath)` — deletes the file (idempotent, via the new `_deleteFileIfExists` helper) then the row
- `deletePhotosForLog(logId)` — deletes every photo file + row for a log
- `deleteLog(logId)` — **updated**: now calls `deletePhotosForLog()` first, since SQLite's cascade only removes the *database rows*, not the image files sitting on disk
- `updateLog(logId, logData)` — **new, not in your original list**, but required for the auto-save flow below to work correctly

## Auto-save flow (important behavior to know)

A photo can't exist without a `log_id` to attach to. So in `app/log-entry.js`:

1. User fills in at least **supervisor name** and **one worker row**, then taps "Take Photo" or "Pick from Gallery" *before* pressing the main Save button.
2. `ensureLogSaved()` checks whether a log has been saved yet (`currentLogId` state). If not, it validates just those two fields and inserts the log immediately via `insertLog()`, storing the returned id in `currentLogId`.
3. The photo is compressed and saved against that `logId`.
4. If the user adds more photos, they attach to the same `currentLogId` — no repeated auto-save.
5. When the user finally taps **"Save Daily Log"**: if `currentLogId` is set, it calls `updateLog(currentLogId, payload)` (updates the same row); otherwise it calls `insertLog()` as in Phase 1.

Without `updateLog()`, step 5 would always insert, creating a duplicate log every time a user added a photo before hitting Save.

## Photo UI (`app/log-entry.js` and `app/log-detail/[id].js`)

- **Take Photo / Pick from Gallery** buttons request the relevant permission first, with a friendly alert pointing to Settings if denied
- **Thumbnail grid** — 90×90 rounded squares, wraps to multiple rows
- **Sync status badge** overlaid on each thumbnail (entry screen only)
- **Tap** a thumbnail → full-screen modal (`resizeMode="contain"`, black background)
- **Long press** a thumbnail (entry screen) → confirmation alert → delete
- **Loading spinner** next to the "Photos" label while a photo is being captured/compressed/saved; both photo buttons disabled during that window
- Detail screen's photo grid is **read-only** — tap to view, no delete/capture

## app.json — what was merged in

Your existing `app.json` (icon, splash, adaptiveIcon, edge-to-edge,
`expo-splash-screen` config, `expo-sqlite` plugin, `experiments` block,
etc.) is untouched. The only addition is one new entry in `plugins`:

```json
[
  "expo-image-picker",
  {
    "cameraPermission": "SiteLog uses your camera to capture photos of site conditions for daily logs.",
    "photosPermission": "SiteLog uses your photo library so you can attach existing photos to daily logs."
  }
]
```

Two things deliberately **not** added, on purpose:
- No manual `ios.infoPlist` entries — the `expo-image-picker` plugin above already writes `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` into Info.plist from the `cameraPermission`/`photosPermission` strings. Adding both would just duplicate/risk conflicting with what the plugin generates.
- No manual `android.permissions` entries — recent `expo-image-picker` versions add `CAMERA` to the Android manifest automatically, and gallery picking goes through the system Photo Picker on modern Android, which doesn't require a `READ_MEDIA_IMAGES` runtime permission declaration at all. Adding it manually would be a no-op at best, and at worst trips Play Store's "sensitive permission needs justification" review for a permission you don't actually use.

## package.json — no changes needed

`expo-image-picker` (~17.0.11), `expo-file-system` (~19.0.23), and
`expo-image-manipulator` (~14.0.8) are already in your `package.json` at
versions matched to Expo SDK 54. Nothing to install.

## Rebuild required for permissions

Since `app.json` now includes the `expo-image-picker` config plugin, you
need a fresh native build for the permission strings to take effect if
you're on a dev client or standalone build:

```bash
npx expo prebuild --clean
npx expo start
```

If you're testing purely in **Expo Go**, permissions are handled by Expo Go
itself at runtime — no prebuild needed, you'll just get the OS permission
prompt the first time you tap "Take Photo" or "Pick from Gallery".

## Testing checklist

**Photo capture**
- [ ] Tap "Take Photo" on a fresh log (no supervisor/workers filled in) → blocked with a clear alert, no crash
- [ ] Fill in supervisor + one worker, tap "Take Photo" → camera opens, permission prompt appears on first use
- [ ] Cancel out of the camera → no photo added, no error
- [ ] Take a photo → thumbnail appears in the grid with a "Pending" badge
- [ ] Tap "Pick from Gallery" → picker opens, permission prompt on first use, selecting a photo adds it the same way

**Auto-save correctness**
- [ ] Add a photo before pressing Save, then check the Logs list — exactly one log entry exists (not a blank duplicate)
- [ ] After auto-save, fill in the rest of the form and press "Save Daily Log" — confirm the *same* log is updated, not duplicated
- [ ] Add two photos in one session → both attach to the same log

**Photo viewing & deletion**
- [ ] Tap a thumbnail → full-screen modal opens with the correct image
- [ ] Long-press a thumbnail → confirmation alert → confirm → thumbnail disappears immediately
- [ ] Cancel delete → thumbnail remains

**Log Detail screen**
- [ ] Open a saved log with photos → photo grid displays with correct count in the header
- [ ] Tap a thumbnail → full-screen modal opens (no delete button — read-only)
- [ ] Open a saved log with zero photos → "No photos attached" message, no crash

**Cascading delete (file cleanup)**
- [ ] Save a log with 2–3 photos, then delete the log via `deleteLog()` → confirm via Drizzle Studio or `sqlite3` that the `photos` rows are gone
- [ ] Confirm the actual image files are also gone from `${Paths.document}/photos/` — easy to get wrong, since SQLite's cascade only touches the database, not the filesystem

**Permissions**
- [ ] Deny camera permission → friendly alert shown, no crash, gallery picker still works
- [ ] Deny gallery permission → friendly alert shown, no crash, camera still works

**Offline**
- [ ] Airplane Mode, repeat the full flow above — everything should work identically, since Phase 2 never touches the network

## What's next (not in Phase 2)

- Sync engine to upload `pending` photos (and logs) to a backend, updating `sync_status` on success
- Editing/removing photos from an already-saved log via the Detail screen
- Multi-project support

---

# Phase 4 — Sync Engine

Pushes pending logs (and their photos) from local SQLite up to the backend
at `https://sitelog-api.onrender.com`, in batches, only when online,
without blocking the UI.

## New/changed files

```
mobile/
├── constants/
│   └── api.js                  # NEW — base URL, endpoints, timeout, batch size
├── services/
│   └── SyncService.js          # NEW — the sync engine itself
├── hooks/
│   ├── useNetworkStatus.js     # NEW — connectivity for UI
│   └── useSyncStatus.js        # NEW — bridges SyncService state into React
├── components/
│   └── SyncButton.js           # NEW — self-contained status bar + button
├── app/
│   ├── _layout.js              # updated — wires up auto-sync on mount
│   ├── index.js                # updated — <SyncButton /> + emoji badges
│   └── log-entry.js            # updated — fire-and-forget sync after save
├── db/
│   └── DatabaseManager.js      # updated — added getSetting/setSetting only
└── utils/
    └── helpers.js              # updated — added formatRelativeTime()
```

## Important corrections made to the Phase 4 spec

**Payload/response format.** The planning doc described a sync payload
with a top-level `projectId`, `log_id` as each log's key, and a separate
`photos` object keyed by log id — plus a response wrapped in `data`. That
doesn't match the Phase 3 backend that's actually deployed. The real,
tested contract (verified against the live backend in Phase 3) is:

```json
{
  "logs": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "log_date": "2026-08-04",
      "weather": { "condition": "Rain", "temp": 20 },
      "workers": [{ "trade": "General Labor", "count": 8 }],
      "materials": [],
      "issues": [{ "description": "Site flooding", "flagged": false }],
      "notes": "",
      "supervisor_name": "John Doe",
      "created_at": "2026-08-04T10:31:00.000Z",
      "updated_at": "2026-08-04T10:31:00.000Z",
      "photos": [
        { "id": "uuid", "file_path": "...", "file_size": 245678, "width": 800, "height": 600, "created_at": "..." }
      ]
    }
  ]
}
```
Response: `{ "success": true, "summary": { "processed", "conflicts", "errors" }, "details": [...] }` — not `{ success, data: {...} }`. `SyncService.js` is written against this real shape; see `backend/README.md`'s API section for the authoritative reference.

**`DatabaseManager` already had almost everything Phase 4 asked for.**
`getPendingLogs()`, `getPendingPhotos()`, `updateSyncStatus(logId, status)`
(the doc called this `updateLogSyncStatus` — same thing, existing name
kept rather than adding a duplicate), `updatePhotoSyncStatus()`, and
`getLogsByDateRange()` were all already built in Phases 1–2. The only
actual addition is a tiny `app_settings` key-value table (`getSetting`/
`setSetting`) to persist "last synced at" across app restarts.

## `project_id` — resolved, and verified end-to-end

An earlier draft of this README incorrectly stated that
`DEFAULT_PROJECT_ID` was still the placeholder string `'default-project'`
and described it as an open blocker. That was wrong — it was written
without re-checking the actual file first. The real state:

```js
// mobile/app/log-entry.js
const DEFAULT_PROJECT_ID = '76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0';
```

This UUID matches a project row created by `backend/src/db/seed.js`
(run once via `npm run db:seed` against your database — see the backend
README). This has been verified end-to-end against a real local Postgres
instance: a payload shaped exactly like `SyncService.js`'s
`_buildPayload()` output, sent to a freshly migrated + seeded database,
comes back:

```json
{"success":true,"summary":{"processed":1,"conflicts":0,"errors":0},"details":[{"log_id":"...","status":"synced","photosSynced":1,"conflict":null}]}
```

with the row genuinely present in `daily_logs` afterward — not just a
theoretical claim.

**What this is not:** a real project picker. It's a single hardcoded
default project, fine for one-project MVP testing. If/when multi-project
support matters, `DEFAULT_PROJECT_ID` needs to become a real per-user
selection (stored via `getSetting`/`setSetting`, which already exists) —
see `backend/README.md`'s "What's next" section.

**Before syncing against your deployed Render backend**, make sure you've
run `npm run db:seed` against your **production** Neon database (not just
locally) — otherwise the deployed backend won't have this project row
yet, and syncs will fail with a foreign key violation there even though
local testing succeeds.

## How the pieces fit together

- **`SyncService.js`** is a plain singleton module (not a hook or
  component), so it can be triggered from anywhere: a button press, a
  network reconnect, the app coming to the foreground, or a timer.
  - `syncNow()` — runs a sync immediately, in batches of `SYNC_BATCH_SIZE`
    (25 logs/request), retrying whole-request network failures (timeout,
    dropped connection) up to `SYNC_RETRY_ATTEMPTS` times with a short
    delay. Per-log errors from the server (e.g. bad `project_id`) are
    **not** retried — retrying identical invalid data would just fail
    again, so those get marked `'failed'` immediately.
  - `syncIfNeeded()` — the auto-trigger-safe wrapper: no-ops if already
    syncing or if there's nothing pending, never throws.
  - `startAutoSync({ NetInfo, AppState, intervalMs })` — wires up all
    three automatic triggers (reconnect, foreground, interval), called
    once from `app/_layout.js`. Returns a cleanup function.
  - Publishes state via a simple pub/sub (`subscribe()`/`_emit()`) rather
    than pulling in a state management library — `useSyncStatus.js` is the
    only consumer, and one hook didn't justify a new dependency.
- **A log with backend status `"conflict"` is treated as a successful
  sync from the device's side.** The backend safely stored the data (see
  `backend/README.md`'s conflict resolution notes) — it's the *server*
  that has something to reconcile, not this device. Only `"error"` marks
  the log `'failed'` locally.
- **Render's free-tier cold start** (spins down after inactivity, ~30-50s
  to wake back up) is why `API_TIMEOUT_MS` is a generous 60 seconds rather
  than a typical request timeout — a shorter timeout would make almost
  every "first sync of the day" look like a network failure.

## Installation

```bash
cd mobile
npx expo install @react-native-community/netinfo
```

Using `npx expo install` rather than a hand-picked version deliberately —
the version pinned in `package.json` (`^12.0.1`) is a reasonable guess,
but `expo install` resolves the exact version matched to your installed
Expo SDK (54) automatically, the same lesson learned the hard way with
`expo-file-system` in Phase 2.

No other new dependencies — sync requests use the built-in `fetch` (with
a manual `AbortController`-based timeout, since `fetch` has no timeout
option of its own) rather than adding `axios`.

## Testing checklist

**Manual sync**
- [ ] With pending logs and online: tap "Sync Now" → button shows a spinner, progress bar appears if syncing more than one batch, result alert appears when done
- [ ] With no pending logs: tap "Sync Now" → immediate "you're all caught up" result, no network call needed
- [ ] While offline: tap "Sync Now" → alert explains you're offline, no request attempted

**Automatic sync**
- [ ] Save a new log while offline, then reconnect (Wi-Fi/cellular) → sync fires automatically within a few seconds
- [ ] Background the app, then foreground it with pending logs → sync fires automatically
- [ ] Leave the app open with a pending log for `AUTO_SYNC_INTERVAL_MS` (5 min default) → sync fires without any user action

**Status indicators**
- [ ] Each log card shows the correct emoji badge (⏳/✅/❌) matching its `sync_status`
- [ ] The status bar shows an accurate pending count, and "Last synced X ago" updates after a successful sync
- [ ] Status bar shows "Offline" when disconnected, and the Sync Now button is disabled in that state

**Error handling**
- [ ] A log that fails server-side validation ends up `'failed'` locally, not stuck at `'pending'` forever
- [ ] A genuine network failure (e.g. airplane mode mid-sync) leaves pending logs untouched (still `'pending'`, not incorrectly marked `'failed'`) so the next sync retries them
- [ ] Two logs with the same project/date sync as a conflict → both end up locally `'synced'` (not `'failed'`), since the backend safely stored both

## What's next

- Real project picker, to replace the single hardcoded `DEFAULT_PROJECT_ID` once multi-project support matters
- Surface `'failed'` logs somewhere the user can manually retry (currently they just sit as `'failed'` and are never automatically retried, since the sync query only ever selects `sync_status = 'pending'`)
- Photo upload to cloud storage (still just metadata sync — see `backend/README.md`)

---

# Phase 5 — Mobile handling of automatic conflict resolution

The backend now auto-merges conflicting logs during sync (see
`backend/README.md`'s Phase 5 section for the full design). This section
covers what changed on the mobile side to handle that.

## What changed

- **`db/DatabaseManager.js`** — added `updateLogFields(logId, fields)`: a
  partial-update method (only touches whichever of
  weather/workers/materials/issues/notes/supervisor_name you pass) used to
  overwrite a local log's content with the server's merged version.
- **`services/SyncService.js`** — `_applyResponse()` now recognizes
  `detail.status === 'conflict_resolved'`. When that happens:
  1. The local log is marked `synced` regardless of what happens next —
     the merge already succeeded server-side either way.
  2. `_fetchLog(detail.primary_log_id)` does a `GET /api/v1/logs/:id` to
     pull the canonical merged log — note this might be a **different**
     log_id than the one this device just synced, if the *other* device's
     log was chosen as primary (see backend README's "Primary selection").
  3. `updateLogFields()` overwrites the local row's content with the
     fetched merged values.

  This is the **one intentional exception** to "local data is always the
  source of truth until synced" elsewhere in this app — a resolved
  conflict is the one case where the server is allowed to push data back
  down and overwrite what's on the device.

- **`components/SyncButton.js`** — result message updated from "N
  conflicts (flagged for review)" to "N conflicts automatically merged",
  matching what actually happens now.

## Why this needs an extra network request

The sync response only tells you a conflict happened and which log is now
primary — it doesn't include the merged field values inline. Rather than
bloat every sync response with full log payloads "just in case" a
conflict occurred, `_fetchLog()` does a follow-up `GET` only when needed
(conflicts should be relatively rare — most syncs never hit this path at
all).

## What this means practically

If supervisor A and supervisor B both log the same project/date offline
and later sync, whichever one's device syncs *second* will:
1. See its own log correctly marked `synced` (not `failed` — the data
   wasn't rejected, it was merged).
2. Have its local copy of that log silently updated to reflect the
   merged, canonical version — so if you open that log's detail screen
   afterward, you'll see the combined data (both supervisors' workers,
   materials, issues, and whichever one's weather/notes won on
   Last-Write-Wins), not just what was originally entered on that device.

There's currently no in-app notification distinguishing "this synced
cleanly" from "this got merged with someone else's log" beyond the
`SyncButton`'s result message — the spec's "optionally show notification"
item wasn't built as a separate distinct UI treatment. If a supervisor
attributing specific numbers/notes to their own report matters for your
usage, that's a good next addition — flagging it as a real product
question, not just a technical one: should someone be told when their
submitted numbers got merged with someone else's?

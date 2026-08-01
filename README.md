# SiteLog — Phase 1 (Expo Router)

Offline-first construction site daily log app. Phase 1 covers local storage
only: create a log, view the list, view a single log's detail — all backed
by on-device SQLite, no network required. Navigation is file-based via
**Expo Router**.

## Project structure

```
SiteLog/
├── app/
│   ├── _layout.js                # Root layout: init DB, render <Stack/>
│   ├── index.js                  # Route "/" — list + pull-to-refresh + FAB
│   ├── log-entry.js              # Route "/log-entry" — create a new log
│   └── log-detail/
│       └── [id].js               # Route "/log-detail/:id" — read-only detail
├── app.json                      # Expo config (includes expo-router plugin)
├── package.json
├── db/
│   └── DatabaseManager.js        # All SQLite access (singleton) — unchanged
└── utils/
    └── helpers.js                # UUID, timestamps, date formatting — unchanged
```

There is no `App.js` and no separate navigator file — Expo Router derives
routes from the file names under `app/`, and `app/_layout.js` is where the
old `App.js` + `AppNavigator.js` logic now lives combined.

## What changed from the React Navigation version

| React Navigation                          | Expo Router                                  |
|--------------------------------------------|-----------------------------------------------|
| `App.js` (init DB, `NavigationContainer`) | `app/_layout.js` (init DB, `<Stack/>`)        |
| `navigation/AppNavigator.js`               | *(not needed — routes come from the file tree)* |
| `screens/LogsListScreen.js`                | `app/index.js`                                |
| `screens/LogEntryScreen.js`                | `app/log-entry.js`                            |
| `screens/LogDetailScreen.js`               | `app/log-detail/[id].js`                      |
| `navigation.navigate('LogEntry')`          | `router.push('/log-entry')`                   |
| `navigation.navigate('LogDetail', {logId})`| `router.push(\`/log-detail/\${id}\`)`         |
| `navigation.goBack()`                      | `router.back()`                               |
| `route.params.logId`                       | `useLocalSearchParams().id`                   |

`db/DatabaseManager.js` and `utils/helpers.js` are **identical** to the
React Navigation version — Router only changes how you move between
screens, not how data is stored or read. `useFocusEffect` (used in
`app/index.js` to reload the list on return) still works as-is, since Expo
Router is built on top of React Navigation under the hood.

## Database schema

Table `logs`:

| Column           | Type | Notes                                   |
|-------------------|------|------------------------------------------|
| id                | TEXT | UUID v4, primary key                     |
| project_id        | TEXT | Placeholder single-project id for now    |
| log_date          | TEXT | ISO date `YYYY-MM-DD`                    |
| weather           | TEXT | JSON: `{ condition, temp }`              |
| workers           | TEXT | JSON array: `[{ trade, count }]`         |
| materials         | TEXT | JSON array: `[{ name, quantity, unit }]` |
| issues            | TEXT | JSON array: `[{ description, flagged }]` |
| notes             | TEXT |                                          |
| supervisor_name   | TEXT |                                          |
| sync_status       | TEXT | `pending` \| `synced` \| `failed`        |
| created_at        | TEXT | ISO timestamp                            |
| updated_at        | TEXT | ISO timestamp                            |

Indexes on `log_date`, `sync_status`, and `project_id` support
`getLogsByDateRange`, `getPendingLogs`, and future per-project filtering.

## Installation (fresh project)

```bash
npx create-expo-app@latest SiteLog
cd SiteLog
```

This template already uses Expo Router by default, so its generated
`app/` folder, `app.json`, and `package.json` will look close to what's in
this deliverable.

1. **Delete** the generated `app/index.tsx` (or `.js`) and any other
   starter routes/tabs the template scaffolded (e.g. `app/(tabs)/`).
2. **Copy in** `app/`, `db/`, and `utils/` from this deliverable into your
   project root, overwriting the starter `app/` folder.
3. **Merge `app.json`**: keep the SDK-versioned fields the generator wrote
   (`icon`, `splash.image`, `newArchEnabled`, etc.), and layer in `name`,
   `slug`, `scheme`, `ios.bundleIdentifier`, `android.package`, and
   `plugins: ["expo-router"]` from mine if the generator didn't already
   include them.
4. **Merge `package.json`**: keep what the generator installed (it likely
   already has `expo-router`, `expo-linking`, `expo-constants`,
   `react-native-safe-area-context`, `react-native-screens`), then add
   anything missing:

   ```bash
   npx expo install expo-sqlite
   ```

   Everything else Router needs (`expo-router`, `expo-linking`,
   `expo-constants`, `react-native-screens`,
   `react-native-safe-area-context`, `@react-navigation/native`) should
   already be present from the template — `npx expo install` will fill in
   any gap for your exact SDK version.
5. **Run it:**

   ```bash
   npx expo start
   ```

   Press `i` for iOS simulator, `a` for Android emulator, or scan the QR
   code with Expo Go on a physical device.

## Notes & assumptions

- **expo-sqlite version:** uses the modern async API (`openDatabaseAsync`,
  `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`), which ships with
  `expo-sqlite` ~14 (Expo SDK 51+). Same caveat as before — flag it if
  you're on an older SDK and I'll port to the legacy transaction API.
- **project_id** is still hardcoded to `"default-project"` in
  `app/log-entry.js` pending a real project picker.
- **Weather condition** is still a tappable chip row rather than a native
  picker — same reasoning as before (bigger touch targets, no extra
  dependency).
- **Dynamic route params are always strings.** `useLocalSearchParams().id`
  comes back as a string, which matches `log.id` (a UUID string) with no
  conversion needed — but keep this in mind if you add numeric route
  params later.

## What's next (not in Phase 1)

- Sync engine to push `pending` logs to a backend and update `sync_status`
- Editing an existing log from `app/log-detail/[id].js`
- Multi-project support (project picker, `project_id` wired to a real list)
- Photo attachments per log

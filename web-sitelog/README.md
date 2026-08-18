# SiteLog Dashboard (Phase 6)

Web dashboard for project managers to view, filter, flag, and export
construction site daily logs. React + Vite, talking to the backend at
`https://sitelog-api.onrender.com`.

## Project structure

```
dashboard/
├── index.html
├── vite.config.js
├── package.json
├── .env.example
├── .gitignore
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── App.css
    ├── services/
    │   └── api.js                    # all backend calls live here
    └── components/
        ├── ProjectSelector.jsx
        ├── DateRangePicker.jsx
        ├── StatsCard.jsx
        ├── LogsTable.jsx
        ├── LogDetailModal.jsx        # not in the original file list — see below
        ├── IssueFlag.jsx
        ├── ExportPDF.jsx
        ├── LoadingSpinner.jsx
        └── ErrorDisplay.jsx
```

## Setup

```bash
cd dashboard
npm install
cp .env.example .env    # defaults to the deployed Render backend already
npm run dev
```

Opens on `http://localhost:5173`.

**Before this will actually load data**, make sure your backend's
`CORS_ORIGIN` environment variable (set in the Render dashboard) includes
`http://localhost:5173` for local dev, and your deployed dashboard's URL
once you deploy it (see Deployment below). If `CORS_ORIGIN` is still
unset (defaults to `*`), everything will work without any change — just
know that's an open-CORS setup, worth tightening once you have a real
deployed dashboard URL to allow-list.

## What was verified before delivery

Given how much file-state trouble came up earlier in this project, this
wasn't just written and handed over — `npm install` and `npm run build`
were actually run against these exact files (324 modules, zero errors),
and the built output was served and fetched to confirm it's genuinely
servable. That's the strongest verification possible without a real
browser to click through; visually confirming the UI itself is still
worth doing on your end.

## Deviations from the spec, documented

**`PUT /api/v1/logs/:id/flag` — built, not assumed.** Your spec listed
this as "needs to be built." It's now implemented on the backend:
`DailyLog.updateIssueFlag()` (uses Postgres `jsonb_set` to toggle one
issue's `flagged` field by array index, with bounds-checking that returns
a clear 400 rather than silently no-opping on an out-of-range index),
wired through `logController.flagIssue` and
`PUT /api/v1/logs/:id/flag`. Verified end-to-end against real Postgres
(success case, out-of-range index, and nonexistent log all tested).

**`GET /api/v1/conflicts` is not wired into this dashboard.** Since
Phase 5, this endpoint returns conflict *history* (an audit trail of
automatic merges), not a review queue — there's nothing actionable for a
PM to do with it yet, since no manual-override endpoint exists. `api.js`
exports `getConflicts()` so it's ready to use, but nothing in the UI
calls it. If you want a "Conflict History" panel, that's a reasonable
next addition — the data's already there (`resolution_details` in each
entry has the full merged field values).

**`downloadPDF()` isn't a real API method.** The spec listed it under
`services/api.js`, but PDF generation happens entirely client-side —
`jsPDF` runs in the browser against data already fetched via `getLogs()`.
There's no backend PDF endpoint, and building one wasn't necessary.
`components/ExportPDF.jsx` builds and downloads the PDF directly.

**`LogDetailModal.jsx` isn't in the original file list**, but is
necessary: "View Details button to see full log with photos" (item 6)
needs somewhere to actually show that detail. Photos only ever come back
from `GET /api/v1/logs/:id` — the list endpoint (`GET /api/v1/logs`)
never includes them (see backend's `DailyLog.getByProject` vs
`getById`) — so "View Details" triggers a fetch of the single log and
opens this modal.

**Stats + table pagination are both client-side, over one fetched set.**
`getLogs()` requests up to 200 logs (the backend's own per-request cap)
in a single call for the selected project + date range, rather than
paging server-side. This keeps the stats cards (computed from the full
filtered set) and the table's own 10/25/50 pagination in sync without
juggling multiple network requests — reasonable for the data volumes a
single project/date-range filter will realistically produce. A project
generating more than 200 logs in one filtered range would need real
server-side pagination; not implemented, since it's an unlikely scenario
for a daily-log app.

**No React Router.** The spec offered it "if multiple pages needed" —
this is a single-page dashboard (project selector + filters + stats +
table, no separate routes), so it wasn't added.

**Native `<input type="date">` instead of a date-picker library**, and
**`react-icons` instead of Font Awesome** — both explicitly offered as
either/or choices in the spec; picked the option needing no extra
dependency/CDN setup.

**Single global `App.css`, not CSS Modules or Tailwind.** Also offered as
a choice; the explicit deliverable file list only requested one
`App.css`, which is what's here.

## Deployment

### Vercel

```bash
npm install -g vercel
cd dashboard
vercel
```
Set the environment variable `VITE_API_BASE_URL` in the Vercel project
settings (Settings → Environment Variables) to
`https://sitelog-api.onrender.com`. Build command: `npm run build`.
Output directory: `dist`.

### Netlify

```bash
npm install -g netlify-cli
cd dashboard
netlify deploy --build
```
Or connect the repo directly in the Netlify dashboard: build command
`npm run build`, publish directory `dist`. Set `VITE_API_BASE_URL` under
Site settings → Environment variables.

### After deploying either way

Go back to Render and add your dashboard's deployed URL (e.g.
`https://sitelog-dashboard.vercel.app`) to the backend's `CORS_ORIGIN`
environment variable — comma-separated if you're keeping `localhost:5173`
for local dev too:
```
CORS_ORIGIN=http://localhost:5173,https://sitelog-dashboard.vercel.app
```

## What's next

- Conflict History panel (data's ready via `getConflicts()`, just no UI yet)
- Toast/snackbar for flag-update feedback (currently a plain `window.alert` on failure)
- Server-side pagination if a project ever exceeds ~200 logs in one filtered range
- Auth (matches the rest of the project — still none)

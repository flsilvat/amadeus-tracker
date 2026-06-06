# amadeus-tracker

Local Node.js service that drives the Amadeus JFE on your work PC via clipboard,
captures `AN` (availability) and `LL` (loading list) responses, parses them —
including the staff-travel passenger queue — and stores timeseries snapshots in
SQLite. Designed to be extended with a React/Firestore frontend later.

## How it works

```
   ┌─────────────────┐     focus + type + Alt+D,N      ┌─────────────┐
   │  Node service   │ ──────────────────────────────► │  JFE window │
   │  (this repo)    │ ◄────────── clipboard ───────── │             │
   └────────┬────────┘                                  └─────────────┘
            │
            ├── HTTP API (Express, port 3737)
            ├── Cron scheduler (default every 15 min)
            └── SQLite via node:sqlite (./data/tracker.db)
```

Every JFE action goes through a serial queue, so the cron job and HTTP calls
never collide on the window.

## Setup

Prereqs: **Node 22.5 or newer**, on **Windows** (the box that has JFE).
No Python, no MSVC, no compilers — the only native dep is the keyboard driver
in `@nut-tree-fork/nut-js`, which ships with prebuilt binaries.

```powershell
cd amadeus-tracker
npm install
copy .env.example .env
# edit .env if needed (window-title regex, ports, etc.)
npm run dev
```

First run creates `./data/tracker.db` automatically.

### If `npm install` fails

The common failure modes:

| Symptom | Cause | Fix |
|---|---|---|
| `EBUSY` / `EPERM` rmdir errors during cleanup | A process has files locked | Close VS Code and any other editor/terminal in the project, then `rmdir /S /Q node_modules` and retry. |
| `Cannot find module 'better-sqlite3'` | Old install lingering from a previous version | We no longer use it. `npm install` again from a clean state. |
| ExperimentalWarning about SQLite | Informational only | Harmless. If you want it silenced, add `--no-warnings` to the start scripts. |

### Develop without JFE

Set `DRY_RUN=true` in `.env` and the automator returns canned sample text
instead of driving the window. The samples simulate a **two-page LL response**
so you can validate the pagination + queue parser without leaving your desk.

```bash
npm run test:parser    # parses sample AN + 2-page LL, sorts queue
```

## API

| Method | Path | What it does |
|---|---|---|
| GET  | `/health` | Status + queue stats |
| POST | `/groups` | Create/update a group AND run AN (paginated) on both legs |
| GET  | `/groups` | List groups |
| GET  | `/groups/:id` | Group + its flights |
| DELETE | `/groups/:id` | Delete group (cascades to flights + observations + queue) |
| POST | `/groups/:id/refresh` | Run LL (paginated) on every flight in this group |
| POST | `/refresh-all` | Refresh every active group |
| GET  | `/groups/:id/latest` | Latest observation per flight (UI cards) |
| GET  | `/flights/:id/observations?limit=500` | Timeseries for one flight |
| GET  | `/flights/:id/queue` | Latest queue snapshot, sorted by BA priority |
| POST | `/raw` | Escape hatch: run any cryptic command. `{ command, paginate? }` |

### Example: create a group

```bash
curl -X POST http://localhost:3737/groups -H "Content-Type: application/json" -d '{
  "id": "trip-sea-jul-26",
  "name": "Seattle, late July",
  "outbound": { "origin": "LHR", "destination": "SEA", "date": "2026-07-15" },
  "inbound":  { "origin": "SEA", "destination": "LHR", "date": "2026-07-29" }
}'
```

Runs `AN15JULLHRSEA` and `AN29JULSEALHR` with MD-pagination, filters to
BA-operated flights, stores them. Then trigger LL fan-out:

```bash
curl -X POST http://localhost:3737/groups/trip-sea-jul-26/refresh
```

…or let the cron schedule do it every 15 min. Each LL runs paginated until
`END OF DISPLAY`, so the full staff queue is captured per flight.

## Pagination & queue capture

Both AN and LL responses can spill across multiple pages. The automator:

1. Runs the initial command, copies the clipboard.
2. Sends `MD` (move down), copies again.
3. Concatenates the chunks. The parser dedupes:
   - flights by flight number,
   - cabin rows by cabin letter,
   - queue entries by line number.
4. Stops when it sees `END OF DISPLAY` (LL) or when `MD` returns identical
   content to the previous copy (AN — no explicit end marker). Safety cap
   of 20 pages.

The LL parser also extracts the staff-travel queue (PTC/SBY/BKB/ADT lines
with their OSI BA STF codes and DOJ). The service layer sorts those by
BA's priority rules — STF bucket number → letter → DOJ ascending — and
stamps a `position` field. Sorted entries go into the `queue_entries` table
alongside the load observation, so you can:

- compute "where am I in the queue" later from your own STF code,
- chart queue depth over time per flight,
- correlate queue size at T-N days with eventual upgrade outcomes.

## Data model

- `groups` — one row per journey
- `flights` — discovered BA flights for a group
- `observations` — wide-format timeseries: one row per LL snapshot, all four
  cabins side by side. Includes `days_to_departure` (your X-axis for any
  forecasting work).
- `observation_cabins` — same data in long format (one row per flight × cabin
  × snapshot). Whichever your downstream tooling prefers.
- `queue_entries` — per-observation staff-travel queue snapshot. One row per
  passenger present at the time, with STF bucket/letter/DOJ broken out and
  a computed `position`.

## Tuning knobs (.env)

| Variable | Default | Notes |
|---|---|---|
| `JFE_WINDOW_TITLE_REGEX` | `Customer Management.*Alt[eé]a` | Adjust if your JFE window title differs. |
| `RESPONSE_SETTLE_MS` | `1200` | Wait between typing the command and triggering Copy. Increase if you see truncated output. |
| `CLIPBOARD_TIMEOUT_MS` | `10000` | How long to wait for the clipboard to update. |
| `REFRESH_CRON` | `*/15 * * * *` | Standard 5-field cron. |
| `KEEPALIVE_SECONDS` | `240` | Idle threshold before sending a harmless Enter to dodge JFE's ~5 min inactivity popup. |
| `HOME_AIRPORT` | `LHR` | Used to classify flights as `outbound` vs `inbound`. |

## Known limitations

- **Pagination heuristics for AN are conservative.** If MD behavior on your
  JFE build is different (e.g. it scrolls partial pages with overlap), the
  dedupe in the parser handles it but the page count may inflate. The 20-page
  cap is a safety net.
- **BA-operated filter** assumes "no `OPERATED BY` line attached" = BA metal.
  Confirm on edge cases (BA Cityflyer, Sun-Air franchises etc.) and tell me
  if you see exceptions.
- **Firestore mirror not wired yet** — SQLite is authoritative for now. Add
  it as a second write target in `src/service.js` when the React app needs it.
- **Windows-only** because of nut-js + because JFE only runs on Windows.

## A note on policy

This automates a corporate application on a corporate PC. The clipboard
approach is intentionally low-risk (no network interception, no installed
certs, no process injection), but it's still worth a glance at the
acceptable-use policy. If in doubt, ask.

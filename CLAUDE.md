# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
npm start
```

There is no build step. Electron loads files directly — no bundler, no compilation.

## Architecture

### Process Boundary

The renderer (`renderer/`) runs in a sandboxed browser context with no Node.js access. All communication crosses the IPC boundary:

```
renderer/app.js  →  window.api.*  →  preload.js (contextBridge)  →  main.js (ipcMain.handle)  →  database.js / calendar.js
```

Adding a new feature always requires wiring all four layers: a handler in `database.js`, an IPC handler in `main.js`, a bridge method in `preload.js`, and a `window.api.*` call in `renderer/app.js`.

### Database Persistence

`database.js` uses sql.js (SQLite compiled to WASM), which runs entirely in memory. **Every write function must call `save()`** to flush the in-memory database to `maintenance.db` on disk. Forgetting `save()` means data is lost on app restart.

Schema migrations are additive only: new columns are added with a `try/catch` around `ALTER TABLE` in `initDb()` so existing databases are upgraded without data loss.

### Service Interval Hierarchy

Intervals resolve through three tiers (lowest wins):

1. **Hardcoded** — `DEFAULT_INTERVALS` object in `database.js` (code-level ground truth)
2. **User global defaults** — `default_interval_overrides` table, managed via Settings modal
3. **Per-vehicle overrides** — `vehicle_service_intervals` table, set per vehicle

`getVehicleIntervals(vehicleId)` merges all three tiers. `getDefaultIntervals()` merges tiers 1–2. The `get-service-types` IPC handler intentionally returns only the hardcoded tier-1 values — this is used as the reset target in the Settings modal.

### Upcoming Service Computation

`computeUpcoming()` in `main.js` (not `database.js`) calculates estimated due dates. It calls `getAvgMpd()` to estimate the vehicle's miles-per-day driving rate from service log history and the `current_mileage` snapshot recorded at vehicle creation. Status thresholds: >20% remaining → `good`, 0–20% → `warning`, <0% → `overdue`.

### Google Calendar OAuth

`calendar.js` handles OAuth by spinning up a temporary local HTTP server on a random port, opening the Google auth URL in the system browser, capturing the redirect callback, then immediately closing the server. The token is stored in the `google_tokens` table. Calendar event IDs are tracked in `calendar_events` to allow idempotent upserts on re-sync.

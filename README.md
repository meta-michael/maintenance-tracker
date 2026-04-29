# Maintenance Tracker

A desktop application for tracking vehicle maintenance schedules. Log services, monitor upcoming maintenance by mileage, and export or sync due dates to a calendar.

## Features

- **Multiple vehicles** — manage any number of vehicles, each with a nickname, year, make, model, and current mileage
- **Service tracking** — log one or more service types in a single entry (e.g. oil change + tire rotation at the same visit), with mileage, date, and optional notes
- **Upcoming services** — status cards showing each service type as Good, Due Soon, or Overdue, with a progress bar and estimated due date based on your average driving rate
- **Service history** — full table of past service logs with delete support
- **Calendar view** — monthly calendar highlighting estimated due dates for each service type
- **ICS export** — export upcoming service dates as a standard `.ics` file for import into any calendar app
- **Google Calendar sync** — connect a Google account and sync upcoming service events directly to Google Calendar
- **Default interval settings** — configure the global default service intervals (oil change, tire rotation, etc.) from the settings menu; changes apply to all vehicles using default intervals
- **Per-vehicle custom intervals** — override any interval on a per-vehicle basis when adding or editing a vehicle

### Tracked Service Types

| Service | Default Interval |
|---|---|
| Oil Change | 5,000 miles |
| Tire Rotation | 7,500 miles |
| Engine Air Filter | 15,000 miles |
| Cabin Air Filter | 15,000 miles |
| Brake Inspection | 25,000 miles |
| Transmission Fluid | 30,000 miles |
| Spark Plugs | 30,000 miles |
| Coolant Flush | 30,000 miles |
| Battery Check | 50,000 miles |

Default intervals are configurable via **Settings** (gear icon in the sidebar).

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — cross-platform desktop shell
- **[sql.js](https://sql-tech.github.io/sql.js/)** — SQLite database compiled to WebAssembly, runs in the main process; database persisted to `maintenance.db`
- **[Google Calendar API](https://developers.google.com/calendar)** (`googleapis`) — optional OAuth2 integration for calendar sync
- Vanilla HTML/CSS/JS renderer with no frontend framework

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)

### Install

```bash
npm install
```

### Run

```bash
npm start
```

The app opens as a native desktop window. All data is stored locally in `maintenance.db` in the project directory.

### Google Calendar Integration (optional)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/) and enable the Google Calendar API.
2. Create OAuth 2.0 credentials (Desktop app type) and download the credentials file.
3. Save it as `google-credentials.json` in the project root.
4. Click **Connect** in the Google Calendar section of the sidebar to authorize.

Without `google-credentials.json`, the Google Calendar section shows an informational note and sync features are hidden.

## Project Structure

```
main.js          — Electron main process, IPC handlers, upcoming service computation
preload.js       — Context bridge exposing IPC methods to the renderer
database.js      — SQLite access layer (vehicles, service logs, intervals, tokens)
calendar.js      — Google Calendar OAuth flow and event sync
renderer/
  index.html     — App shell and modal markup
  app.js         — All UI logic and state management
  style.css      — Dark-theme styles
```

## Data Model

- **vehicles** — id, name, make, model, year, current_mileage
- **service_logs** — vehicle_id, service_type, mileage, service_date, notes
- **vehicle_service_intervals** — per-vehicle overrides (vehicle_id, service_type, interval_miles)
- **default_interval_overrides** — global default overrides (service_type, interval_miles)
- **google_tokens** — stored OAuth token for Google Calendar
- **calendar_events** — maps (vehicle_id, service_type) to Google Calendar event IDs for idempotent sync

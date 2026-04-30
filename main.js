const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const calendar = require('./calendar');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(async () => {
  await db.initDb();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Vehicles ──────────────────────────────────────────────────────────────────

ipcMain.handle('get-vehicles', () => db.getVehicles());

ipcMain.handle('create-vehicle', (_, { name, make, model, year, currentMileage, intervals }) => {
  const vehicle = db.createVehicle(name, make, model, year, currentMileage ?? null);
  if (intervals && Object.keys(intervals).length > 0) {
    db.setVehicleIntervals(vehicle.id, intervals);
  }
  return vehicle;
});

ipcMain.handle('update-vehicle', (_, { id, name, make, model, year, currentMileage, intervals }) => {
  const vehicle = db.updateVehicle(id, name, make, model, year, currentMileage ?? null);
  db.setVehicleIntervals(id, intervals ?? {});
  return vehicle;
});

ipcMain.handle('delete-vehicle', (_, id) => {
  db.deleteVehicle(id);
});

// ── Service Intervals ─────────────────────────────────────────────────────────

ipcMain.handle('get-service-types', () => [
  ...Object.entries(db.DEFAULT_INTERVALS).map(([key, v]) => ({ key, name: v.name, miles: v.miles })),
  ...db.getCustomServiceTypes(),
]);

ipcMain.handle('get-vehicle-intervals', (_, vehicleId) => db.getVehicleIntervals(vehicleId));

ipcMain.handle('get-default-intervals', () => db.getDefaultIntervals());

ipcMain.handle('set-default-intervals', (_, intervals) => db.setDefaultIntervals(intervals));

ipcMain.handle('get-custom-service-types', () => db.getCustomServiceTypes());

ipcMain.handle('add-custom-service-type', (_, { name, miles }) => db.addCustomServiceType(name, miles));

ipcMain.handle('delete-custom-service-type', (_, key) => db.deleteCustomServiceType(key));

// ── Service Logs ──────────────────────────────────────────────────────────────

ipcMain.handle('get-service-logs', (_, vehicleId) => db.getServiceLogs(vehicleId));

ipcMain.handle('create-service-log', (_, { vehicleId, serviceType, mileage, serviceDate, notes }) =>
  db.createServiceLog(vehicleId, serviceType, mileage, serviceDate, notes)
);

ipcMain.handle('delete-service-log', (_, id) => {
  db.deleteServiceLog(id);
});

// ── Upcoming Services ─────────────────────────────────────────────────────────

ipcMain.handle('get-upcoming', (_, vehicleId) => computeUpcoming(vehicleId));

function computeUpcoming(vehicleId) {
  const intervals = db.getVehicleIntervals(vehicleId);
  const avgMpd = db.getAvgMpd(vehicleId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = Object.entries(intervals).map(([serviceType, info]) => {
    const last = db.getLastService(vehicleId, serviceType);

    if (!last) {
      return {
        service_type: serviceType,
        name: info.name,
        interval_miles: info.miles,
        last_service_date: null,
        last_service_mileage: null,
        next_due_mileage: null,
        estimated_miles_remaining: null,
        due_date: null,
        pct_remaining: null,
        status: 'unknown',
        avg_mpd: avgMpd ? Math.round(avgMpd * 10) / 10 : null,
      };
    }

    const [ly, lm, ld] = last.service_date.split('-').map(Number);
    const lastDate = new Date(ly, lm - 1, ld);
    const nextDueMileage = last.mileage + info.miles;
    const daysSince = (today - lastDate) / 86400000;
    const estimatedCurrent = avgMpd ? last.mileage + daysSince * avgMpd : last.mileage;
    const milesRemaining = nextDueMileage - estimatedCurrent;

    let dueDate = null;
    if (avgMpd > 0) {
      const d = new Date(today);
      d.setDate(d.getDate() + Math.round(milesRemaining / avgMpd));
      dueDate = d.toISOString().slice(0, 10);
    }

    const pct = (milesRemaining / info.miles) * 100;
    const status = pct > 20 ? 'good' : pct > 0 ? 'warning' : 'overdue';

    return {
      service_type: serviceType,
      name: info.name,
      interval_miles: info.miles,
      last_service_date: last.service_date,
      last_service_mileage: last.mileage,
      next_due_mileage: nextDueMileage,
      estimated_miles_remaining: Math.max(0, Math.round(milesRemaining)),
      due_date: dueDate,
      pct_remaining: Math.max(0, Math.min(100, Math.round(pct * 10) / 10)),
      status,
      avg_mpd: avgMpd ? Math.round(avgMpd * 10) / 10 : null,
    };
  });

  const order = { overdue: 0, warning: 1, good: 2, unknown: 3 };
  results.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (a.pct_remaining ?? 999) - (b.pct_remaining ?? 999);
  });

  return results;
}

// ── Google Calendar ───────────────────────────────────────────────────────────

ipcMain.handle('get-google-status', () => ({
  hasCredentials: calendar.credentialsExist(),
  connected: calendar.credentialsExist() && db.getToken() !== null,
}));

ipcMain.handle('connect-google', async () => {
  try {
    await calendar.startOAuthFlow((json) => db.saveToken(json));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('disconnect-google', () => {
  db.deleteToken();
});

ipcMain.handle('sync-to-calendar', async (_, vehicleId) => {
  const vehicle = db.getVehicle(vehicleId);
  if (!vehicle) return { ok: false, error: 'Vehicle not found' };

  const tokenJson = db.getToken();
  if (!tokenJson) return { ok: false, error: 'Not connected to Google Calendar' };

  const auth = calendar.getAuthedClient(tokenJson, (json) => db.saveToken(json));
  if (!auth) return { ok: false, error: 'Invalid credentials' };

  const vehicleName = vehicle.name
    ? `${vehicle.name} (${vehicle.year} ${vehicle.make} ${vehicle.model})`
    : `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

  const upcoming = computeUpcoming(vehicleId);
  const existingEventIds = db.getCalendarEventsForVehicle(vehicleId);
  const result = await calendar.syncVehicleToCalendar(auth, vehicleName, upcoming, existingEventIds);

  for (const { service_type, event_id } of result.synced) {
    db.upsertCalendarEvent(vehicleId, service_type, event_id);
  }

  return { ok: true, synced: result.synced.length, errors: result.errors };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// ── ICS Export ────────────────────────────────────────────────────────────────

ipcMain.handle('export-ics', async (_, { vehicle, upcoming }) => {
  const vehicleName = vehicle.name
    ? `${vehicle.name} (${vehicle.year} ${vehicle.make} ${vehicle.model})`
    : `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

  const safeName = vehicleName.replace(/[^a-z0-9]/gi, '_');
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export Service Calendar',
    defaultPath: `${safeName}_maintenance.ics`,
    filters: [{ name: 'iCalendar Files', extensions: ['ics'] }],
  });

  if (canceled || !filePath) return { ok: false };

  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maintenance Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${vehicleName} Maintenance`,
  ];

  for (const svc of upcoming) {
    if (!svc.due_date) continue;
    const dateStr = svc.due_date.replace(/-/g, '');
    const prefix = svc.status === 'overdue' ? '[OVERDUE] ' : '';
    const desc = [
      `Vehicle: ${vehicleName}`,
      `Interval: every ${svc.interval_miles.toLocaleString()} miles`,
      svc.next_due_mileage ? `Due at: ${svc.next_due_mileage.toLocaleString()} miles` : '',
      svc.last_service_date
        ? `Last service: ${svc.last_service_date} at ${svc.last_service_mileage?.toLocaleString()} miles`
        : 'No prior service recorded',
    ].filter(Boolean).join('\\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:mt-${vehicle.id}-${svc.service_type}-${svc.due_date}@maintenance-tracker`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `DTEND;VALUE=DATE:${dateStr}`,
      `SUMMARY:${prefix}${svc.name} – ${vehicleName}`,
      `DESCRIPTION:${desc}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
  return { ok: true };
});

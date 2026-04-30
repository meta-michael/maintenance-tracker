const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'maintenance.db');

let db;

function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function one(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

function lastId() {
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

const DEFAULT_INTERVALS = {
  oil_change:         { name: 'Oil Change',          miles: 5000  },
  tire_rotation:      { name: 'Tire Rotation',        miles: 7500  },
  engine_air_filter:  { name: 'Engine Air Filter',    miles: 15000 },
  cabin_air_filter:   { name: 'Cabin Air Filter',     miles: 15000 },
  brake_inspection:   { name: 'Brake Inspection',     miles: 25000 },
  transmission_fluid: { name: 'Transmission Fluid',   miles: 30000 },
  spark_plugs:        { name: 'Spark Plugs',          miles: 30000 },
  coolant_flush:      { name: 'Coolant Flush',        miles: 30000 },
  battery_check:      { name: 'Battery Check',        miles: 50000 },
};

async function initDb() {
  const SQL = await initSqlJs();
  const buffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  db = new SQL.Database(buffer);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL,
      current_mileage INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS service_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      mileage INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS vehicle_service_intervals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      interval_miles INTEGER NOT NULL,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      UNIQUE (vehicle_id, service_type)
    );
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY,
      token_data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      calendar_event_id TEXT NOT NULL,
      UNIQUE(vehicle_id, service_type),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS default_interval_overrides (
      service_type TEXT PRIMARY KEY,
      interval_miles INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_service_types (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      miles INTEGER NOT NULL
    );
  `);
  // Additive migration for existing databases
  try { db.exec('ALTER TABLE vehicles ADD COLUMN current_mileage INTEGER'); } catch (_) {}
  save();
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

function getVehicles() {
  return all('SELECT * FROM vehicles ORDER BY year DESC, make, model');
}

function getVehicle(id) {
  return one('SELECT * FROM vehicles WHERE id = ?', [id]);
}

function createVehicle(name, make, model, year, currentMileage = null) {
  run(
    'INSERT INTO vehicles (name, make, model, year, current_mileage) VALUES (?, ?, ?, ?, ?)',
    [name, make, model, year, currentMileage]
  );
  const id = lastId();
  save();
  return getVehicle(id);
}

function updateVehicle(id, name, make, model, year, currentMileage = null) {
  run(
    'UPDATE vehicles SET name=?, make=?, model=?, year=?, current_mileage=? WHERE id=?',
    [name, make, model, year, currentMileage, id]
  );
  save();
  return getVehicle(id);
}

function deleteVehicle(id) {
  run('DELETE FROM vehicles WHERE id = ?', [id]);
  save();
}

// ── Service Intervals ─────────────────────────────────────────────────────────

function getDefaultIntervals() {
  const rows = all('SELECT service_type, interval_miles FROM default_interval_overrides');
  const overrides = {};
  for (const row of rows) overrides[row.service_type] = row.interval_miles;
  const result = {};
  for (const [key, info] of Object.entries(DEFAULT_INTERVALS)) {
    result[key] = overrides[key] ?? info.miles;
  }
  return result;
}

function setDefaultIntervals(intervals) {
  db.exec('BEGIN');
  try {
    run('DELETE FROM default_interval_overrides');
    for (const [type, miles] of Object.entries(intervals)) {
      if (DEFAULT_INTERVALS[type]) {
        run(
          'INSERT INTO default_interval_overrides (service_type, interval_miles) VALUES (?, ?)',
          [type, miles]
        );
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  save();
}

function getVehicleIntervals(vehicleId) {
  const rows = all(
    'SELECT service_type, interval_miles FROM vehicle_service_intervals WHERE vehicle_id = ?',
    [vehicleId]
  );
  const perVehicle = {};
  for (const row of rows) perVehicle[row.service_type] = row.interval_miles;

  const defaultMiles = getDefaultIntervals();
  const result = {};
  for (const [key, info] of Object.entries(DEFAULT_INTERVALS)) {
    result[key] = {
      name: info.name,
      miles: perVehicle[key] ?? defaultMiles[key],
      is_custom: key in perVehicle,
    };
  }
  for (const ct of getCustomServiceTypes()) {
    result[ct.key] = {
      name: ct.name,
      miles: perVehicle[ct.key] ?? ct.miles,
      is_custom: ct.key in perVehicle,
    };
  }
  return result;
}

function setVehicleIntervals(vehicleId, intervals) {
  db.exec('BEGIN');
  try {
    run('DELETE FROM vehicle_service_intervals WHERE vehicle_id = ?', [vehicleId]);
    for (const [type, miles] of Object.entries(intervals)) {
      run(
        'INSERT INTO vehicle_service_intervals (vehicle_id, service_type, interval_miles) VALUES (?, ?, ?)',
        [vehicleId, type, miles]
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  save();
}

// ── Custom Service Types ──────────────────────────────────────────────────────

function getCustomServiceTypes() {
  return all('SELECT key, name, miles FROM custom_service_types ORDER BY name');
}

function addCustomServiceType(name, miles) {
  const key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (one('SELECT key FROM custom_service_types WHERE key = ?', [key])) {
    throw new Error(`A custom service named "${name}" already exists.`);
  }

  run('INSERT INTO custom_service_types (key, name, miles) VALUES (?, ?, ?)', [key, name, miles]);
  save();

  return { key, name, miles };
}

function deleteCustomServiceType(key) {
  run('DELETE FROM vehicle_service_intervals WHERE service_type = ?', [key]);
  run('DELETE FROM custom_service_types WHERE key = ?', [key]);
  save();
}

// ── Service Logs ──────────────────────────────────────────────────────────────

function getServiceLogs(vehicleId) {
  return all(
    'SELECT * FROM service_logs WHERE vehicle_id = ? ORDER BY service_date DESC, mileage DESC',
    [vehicleId]
  );
}

function createServiceLog(vehicleId, serviceType, mileage, serviceDate, notes) {
  run(
    'INSERT INTO service_logs (vehicle_id, service_type, mileage, service_date, notes) VALUES (?, ?, ?, ?, ?)',
    [vehicleId, serviceType, mileage, serviceDate, notes]
  );
  const id = lastId();
  save();
  return one('SELECT * FROM service_logs WHERE id = ?', [id]);
}

function deleteServiceLog(id) {
  run('DELETE FROM service_logs WHERE id = ?', [id]);
  save();
}

function getLastService(vehicleId, serviceType) {
  return one(
    'SELECT * FROM service_logs WHERE vehicle_id = ? AND service_type = ? ORDER BY service_date DESC, mileage DESC LIMIT 1',
    [vehicleId, serviceType]
  );
}

function getAvgMpd(vehicleId) {
  const rows = all(
    'SELECT mileage, service_date FROM service_logs WHERE vehicle_id = ? ORDER BY service_date ASC, mileage ASC',
    [vehicleId]
  );

  // Include current_mileage (recorded at vehicle creation) as an additional data point
  const vehicle = getVehicle(vehicleId);
  let points = rows.map(r => ({ mileage: r.mileage, date: r.service_date }));
  if (vehicle?.current_mileage) {
    const snapDate = (vehicle.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    points.push({ mileage: vehicle.current_mileage, date: snapDate });
    points.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.mileage - b.mileage);
  }

  if (points.length < 2) return 0;

  const oldest = points[0];
  const newest = points[points.length - 1];

  const [oy, om, od] = oldest.date.split('-').map(Number);
  const [ny, nm, nd] = newest.date.split('-').map(Number);
  const days = (new Date(ny, nm - 1, nd) - new Date(oy, om - 1, od)) / 86400000;

  if (days === 0 || newest.mileage <= oldest.mileage) return 0;
  return (newest.mileage - oldest.mileage) / days;
}

// ── Google OAuth Token ────────────────────────────────────────────────────────

function saveToken(tokenJson) {
  const existing = one('SELECT id FROM google_tokens LIMIT 1');
  if (existing) {
    run("UPDATE google_tokens SET token_data=?, updated_at=datetime('now') WHERE id=?", [tokenJson, existing.id]);
  } else {
    run('INSERT INTO google_tokens (token_data) VALUES (?)', [tokenJson]);
  }
  save();
}

function getToken() {
  const row = one('SELECT token_data FROM google_tokens LIMIT 1');
  return row ? row.token_data : null;
}

function deleteToken() {
  run('DELETE FROM google_tokens');
  save();
}

// ── Calendar Event IDs ────────────────────────────────────────────────────────

function upsertCalendarEvent(vehicleId, serviceType, eventId) {
  run(
    `INSERT INTO calendar_events (vehicle_id, service_type, calendar_event_id) VALUES (?, ?, ?)
     ON CONFLICT(vehicle_id, service_type) DO UPDATE SET calendar_event_id=excluded.calendar_event_id`,
    [vehicleId, serviceType, eventId]
  );
  save();
}

function getCalendarEventsForVehicle(vehicleId) {
  const rows = all(
    'SELECT service_type, calendar_event_id FROM calendar_events WHERE vehicle_id = ?',
    [vehicleId]
  );
  const map = {};
  for (const row of rows) map[row.service_type] = row.calendar_event_id;
  return map;
}

module.exports = {
  DEFAULT_INTERVALS,
  initDb,
  getVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getDefaultIntervals,
  setDefaultIntervals,
  getVehicleIntervals,
  setVehicleIntervals,
  getCustomServiceTypes,
  addCustomServiceType,
  deleteCustomServiceType,
  getServiceLogs,
  createServiceLog,
  deleteServiceLog,
  getLastService,
  getAvgMpd,
  saveToken,
  getToken,
  deleteToken,
  upsertCalendarEvent,
  getCalendarEventsForVehicle,
};

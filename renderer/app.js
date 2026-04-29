// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  vehicles: [],
  serviceTypes: [],
  vehicleIntervals: {},
  upcoming: [],
  currentVehicle: null,
  currentTab: 'upcoming',
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  editingVehicle: null,
  confirmCallback: null,
  googleStatus: { hasCredentials: false, connected: false },
};

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function confirm(title, message, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  state.confirmCallback = onOk;
  openModal('modal-confirm');
}

// ── Render: vehicle list ──────────────────────────────────────────────────────
function renderVehicleList() {
  const ul = document.getElementById('vehicle-list');
  ul.innerHTML = '';

  if (state.vehicles.length === 0) {
    ul.innerHTML = '<li style="padding:12px 16px;color:var(--muted);font-size:0.82rem;">No vehicles yet.</li>';
    return;
  }

  state.vehicles.forEach(v => {
    const li = document.createElement('li');
    li.dataset.id = v.id;
    if (state.currentVehicle?.id === v.id) li.classList.add('active');

    const label = v.name || `${v.year} ${v.make} ${v.model}`;
    const sub = v.name ? `${v.year} ${v.make} ${v.model}` : '';

    li.innerHTML = `
      <div class="vehicle-item-name">${esc(label)}</div>
      ${sub ? `<div class="vehicle-item-sub">${esc(sub)}</div>` : ''}
    `;
    li.addEventListener('click', () => selectVehicle(v));
    ul.appendChild(li);
  });
}

// ── Render: detail header ─────────────────────────────────────────────────────
function renderDetailHeader() {
  const v = state.currentVehicle;
  const title = v.name || `${v.year} ${v.make} ${v.model}`;
  const sub = v.name ? `${v.year} ${v.make} ${v.model}` : '';
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-subtitle').textContent = sub;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('vehicle-detail').classList.remove('hidden');
  document.getElementById('btn-sync-calendar').classList.toggle('hidden', !state.googleStatus.connected);
}

// ── Google Calendar status ────────────────────────────────────────────────────
async function loadGoogleStatus() {
  state.googleStatus = await window.api.getGoogleStatus();
  renderGoogleStatus();
  if (state.currentVehicle) {
    document.getElementById('btn-sync-calendar').classList.toggle('hidden', !state.googleStatus.connected);
  }
}

function renderGoogleStatus() {
  const el = document.getElementById('google-status');
  const { hasCredentials, connected } = state.googleStatus;

  if (!hasCredentials) {
    el.innerHTML = `
      <div class="gcal-status gcal-no-creds">
        <span class="gcal-label">Google Calendar</span>
        <span class="gcal-note">Add <code>google-credentials.json</code> to enable sync</span>
      </div>
    `;
    return;
  }

  if (connected) {
    el.innerHTML = `
      <div class="gcal-status gcal-connected">
        <span class="gcal-label">&#10003; Google Calendar</span>
        <button class="btn-gcal-disconnect" id="btn-gcal-disconnect">Disconnect</button>
      </div>
    `;
    document.getElementById('btn-gcal-disconnect').addEventListener('click', async () => {
      await window.api.disconnectGoogle();
      await loadGoogleStatus();
      toast('Disconnected from Google Calendar', 'info');
    });
  } else {
    el.innerHTML = `
      <div class="gcal-status gcal-disconnected">
        <span class="gcal-label">Google Calendar</span>
        <button class="btn-gcal-connect" id="btn-gcal-connect">Connect</button>
      </div>
    `;
    document.getElementById('btn-gcal-connect').addEventListener('click', async () => {
      const btn = document.getElementById('btn-gcal-connect');
      btn.textContent = 'Connecting…';
      btn.disabled = true;
      const result = await window.api.connectGoogle();
      if (result.ok) {
        await loadGoogleStatus();
        toast('Connected to Google Calendar', 'success');
      } else {
        await loadGoogleStatus();
        toast(result.error || 'Connection failed', 'error');
      }
    });
  }
}

// ── Render: upcoming services ─────────────────────────────────────────────────
function renderUpcoming(upcoming) {
  const grid = document.getElementById('upcoming-grid');
  grid.innerHTML = '';

  const hasHistory = upcoming.some(u => u.last_service_date !== null);
  const mpd = upcoming[0]?.avg_mpd;
  const mpdLabel = document.getElementById('mpd-label');

  if (!hasHistory) {
    mpdLabel.textContent = 'Log your first service to start tracking intervals.';
  } else if (mpd && mpd > 0) {
    mpdLabel.textContent = `Estimated driving rate: ${mpd.toFixed(1)} miles/day`;
  } else {
    mpdLabel.textContent = 'Add at least 2 service entries on different dates to enable date estimates.';
  }

  upcoming.forEach(svc => {
    const card = document.createElement('div');
    card.className = 'service-card';

    const statusLabel = { good: 'Good', warning: 'Due Soon', overdue: 'Overdue', unknown: 'No Data' }[svc.status];
    const pct = svc.pct_remaining ?? 0;

    let dueHtml = '';
    if (svc.status === 'unknown') {
      dueHtml = '<span>Not yet recorded</span>';
    } else if (svc.due_date) {
      const dueClass = svc.status === 'overdue' ? 'overdue-text' : 'service-due-date';
      const milesLabel = svc.estimated_miles_remaining === 0
        ? 'Overdue'
        : `~${svc.estimated_miles_remaining.toLocaleString()} miles remaining`;
      dueHtml = `
        <span>${milesLabel}</span>
        <span class="${dueClass}">Est. due: ${formatDate(svc.due_date)}</span>
      `;
    } else if (svc.last_service_date) {
      const milesLabel = svc.estimated_miles_remaining != null
        ? `~${svc.estimated_miles_remaining.toLocaleString()} miles remaining`
        : '';
      dueHtml = `
        <span>${milesLabel}</span>
        <span>Log more services for date estimates</span>
      `;
    }

    card.innerHTML = `
      <div class="service-card-header">
        <div class="service-name">${esc(svc.name)}</div>
        <span class="status-badge status-${svc.status}">${statusLabel}</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar bar-${svc.status}" style="width:${pct}%"></div>
      </div>
      <div class="service-meta">
        <span>Every ${svc.interval_miles.toLocaleString()} miles</span>
        ${svc.last_service_date
          ? `<span>Last: ${formatDate(svc.last_service_date)} at ${svc.last_service_mileage.toLocaleString()} mi</span>`
          : '<span>Last: Never recorded</span>'}
        ${dueHtml}
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── Render: service history ───────────────────────────────────────────────────
function renderHistory(logs) {
  const tbody = document.getElementById('history-tbody');
  const empty = document.getElementById('history-empty');
  tbody.innerHTML = '';

  if (logs.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  logs.forEach(log => {
    const tr = document.createElement('tr');
    const svcName = state.serviceTypes.find(s => s.key === log.service_type)?.name || log.service_type;
    tr.innerHTML = `
      <td>${formatDate(log.service_date)}</td>
      <td>${esc(svcName)}</td>
      <td>${log.mileage.toLocaleString()} mi</td>
      <td>${esc(log.notes || '—')}</td>
      <td><button class="del-log-btn" data-id="${log.id}">✕ Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.del-log-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const logId = parseInt(btn.dataset.id);
      confirm('Delete service log?', 'This cannot be undone.', async () => {
        await window.api.deleteServiceLog(logId);
        toast('Service log deleted', 'info');
        await refreshVehicleDetail();
      });
    });
  });
}

// ── Select vehicle ────────────────────────────────────────────────────────────
async function selectVehicle(v) {
  state.currentVehicle = v;
  state.currentTab = 'upcoming';
  state.vehicleIntervals = await window.api.getVehicleIntervals(v.id);
  populateServiceTypes();
  renderVehicleList();
  renderDetailHeader();
  setTab('upcoming');
  await refreshVehicleDetail();
}

async function refreshVehicleDetail() {
  if (!state.currentVehicle) return;
  const [upcoming, history] = await Promise.all([
    window.api.getUpcoming(state.currentVehicle.id),
    window.api.getServiceLogs(state.currentVehicle.id),
  ]);
  state.upcoming = upcoming;
  renderUpcoming(upcoming);
  renderHistory(history);
  if (state.currentTab === 'calendar') renderCalendar();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-upcoming').classList.toggle('hidden', tab !== 'upcoming');
  document.getElementById('tab-history').classList.toggle('hidden', tab !== 'history');
  document.getElementById('tab-calendar').classList.toggle('hidden', tab !== 'calendar');
  if (tab === 'calendar') renderCalendar();
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadVehicles() {
  state.vehicles = await window.api.getVehicles();
  renderVehicleList();
}

// ── Populate service type dropdown ────────────────────────────────────────────
function populateServiceTypes() {
  const container = document.getElementById('service-type-list');
  container.innerHTML = '';
  state.serviceTypes.forEach(s => {
    const miles = state.vehicleIntervals[s.key]?.miles ?? s.miles;
    const item = document.createElement('label');
    item.className = 'service-type-item';
    item.innerHTML = `
      <input type="checkbox" class="service-type-cb" value="${esc(s.key)}" />
      <span class="service-type-name">${esc(s.name)}</span>
      <span class="service-type-miles">every ${miles.toLocaleString()} mi</span>
    `;
    container.appendChild(item);
  });
}

// ── Vehicle modal ─────────────────────────────────────────────────────────────
async function openVehicleModal(vehicle = null) {
  state.editingVehicle = vehicle;
  document.getElementById('modal-vehicle-title').textContent = vehicle ? 'Edit Vehicle' : 'Add Vehicle';
  const form = document.getElementById('form-vehicle');
  form.name.value = vehicle?.name || '';
  form.year.value = vehicle?.year || '';
  form.make.value = vehicle?.make || '';
  form.model.value = vehicle?.model || '';
  form.current_mileage.value = vehicle?.current_mileage ?? '';

  let intervalData = {};
  try {
    if (vehicle) intervalData = await window.api.getVehicleIntervals(vehicle.id);
  } catch {
    toast('Failed to load service intervals', 'error');
    return;
  }

  const hasCustom = Object.values(intervalData).some(v => v.is_custom);
  form.querySelectorAll('[name="interval_mode"]').forEach(r => {
    r.checked = r.value === (hasCustom ? 'custom' : 'default');
  });

  const grid = document.getElementById('custom-intervals-grid');
  grid.innerHTML = '';
  state.serviceTypes.forEach(st => {
    const miles = intervalData[st.key]?.miles ?? st.miles;
    const row = document.createElement('div');
    row.className = 'interval-row';
    row.innerHTML = `
      <span class="interval-label">${esc(st.name)}</span>
      <div class="interval-input-wrap">
        <input type="number" class="interval-input" data-key="${st.key}"
          value="${miles}" min="100" step="100" />
        <span class="interval-unit">miles</span>
      </div>
    `;
    grid.appendChild(row);
  });

  document.getElementById('custom-intervals').classList.toggle('hidden', !hasCustom);
  openModal('modal-vehicle');
}

// ── Settings modal ────────────────────────────────────────────────────────────
async function openSettingsModal() {
  const defaults = await window.api.getDefaultIntervals();

  const grid = document.getElementById('settings-intervals-grid');
  grid.innerHTML = '';
  state.serviceTypes.forEach(st => {
    const miles = defaults[st.key] ?? st.miles;
    const row = document.createElement('div');
    row.className = 'interval-row';
    row.innerHTML = `
      <span class="interval-label">${esc(st.name)}</span>
      <div class="interval-input-wrap">
        <input type="number" class="settings-interval-input interval-input" data-key="${esc(st.key)}"
          value="${miles}" min="100" step="100" />
        <span class="interval-unit">miles</span>
      </div>
    `;
    grid.appendChild(row);
  });

  openModal('modal-settings');
}

// ── Service modal ─────────────────────────────────────────────────────────────
function openServiceModal() {
  const form = document.getElementById('form-service');
  form.reset();
  form.service_date.value = new Date().toISOString().slice(0, 10);
  openModal('modal-service');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function renderCalendar() {
  const { calendarYear: year, calendarMonth: month, upcoming } = state;

  document.getElementById('cal-month-label').textContent =
    new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Map due_date -> [svc, ...]
  const eventMap = {};
  for (const svc of upcoming) {
    if (!svc.due_date) continue;
    (eventMap[svc.due_date] ??= []).push(svc);
  }

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let cellDate;
    let isOtherMonth = false;

    if (i < firstDow) {
      cellDate = new Date(year, month - 1, new Date(year, month, 0).getDate() - firstDow + i + 1);
      isOtherMonth = true;
    } else if (i >= firstDow + daysInMonth) {
      cellDate = new Date(year, month + 1, i - firstDow - daysInMonth + 1);
      isOtherMonth = true;
    } else {
      cellDate = new Date(year, month, i - firstDow + 1);
    }

    const isToday = cellDate.getTime() === today.getTime();
    const dateStr = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
    const dayEvents = eventMap[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'cal-day' +
      (isOtherMonth ? ' other-month' : '') +
      (isToday ? ' today' : '') +
      (dayEvents.length > 0 ? ' has-events' : '');

    const numEl = document.createElement('div');
    numEl.className = 'cal-day-num';
    numEl.textContent = cellDate.getDate();
    cell.appendChild(numEl);

    const shown = Math.min(2, dayEvents.length);
    for (let j = 0; j < shown; j++) {
      const chip = document.createElement('div');
      chip.className = `cal-event cal-event-${dayEvents[j].status}`;
      chip.textContent = dayEvents[j].name;
      cell.appendChild(chip);
    }
    if (dayEvents.length > 2) {
      const more = document.createElement('div');
      more.className = 'cal-event-more';
      more.textContent = `+${dayEvents.length - 2} more`;
      cell.appendChild(more);
    }

    if (dayEvents.length > 0) {
      cell.addEventListener('click', () => showDayEvents(cellDate, dayEvents));
    }

    grid.appendChild(cell);
  }

  document.getElementById('cal-day-events').classList.add('hidden');
}

function showDayEvents(date, events) {
  const el = document.getElementById('cal-day-events');
  const dateLabel = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  el.innerHTML = `
    <div class="cal-day-events-date">${dateLabel}</div>
    ${events.map(svc => `
      <div class="cal-event-detail cal-event-${svc.status}">
        <div class="cal-event-detail-name">${esc(svc.name)}</div>
        <div class="cal-event-detail-meta">
          every ${svc.interval_miles.toLocaleString()} mi
          ${svc.next_due_mileage ? `· due at ${svc.next_due_mileage.toLocaleString()} mi` : ''}
        </div>
      </div>
    `).join('')}
  `;
  el.classList.remove('hidden');
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wire() {
  document.getElementById('btn-add-vehicle').addEventListener('click', () => openVehicleModal());

  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));

  document.getElementById('btn-reset-intervals').addEventListener('click', () => {
    document.querySelectorAll('.settings-interval-input').forEach(input => {
      const st = state.serviceTypes.find(s => s.key === input.dataset.key);
      if (st) input.value = st.miles;
    });
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const intervals = {};
    document.querySelectorAll('.settings-interval-input').forEach(input => {
      const miles = parseInt(input.value);
      if (!isNaN(miles) && miles > 0) intervals[input.dataset.key] = miles;
    });
    try {
      await window.api.setDefaultIntervals(intervals);
      if (state.currentVehicle) {
        state.vehicleIntervals = await window.api.getVehicleIntervals(state.currentVehicle.id);
        populateServiceTypes();
        await refreshVehicleDetail();
      }
      closeModal('modal-settings');
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Interval mode toggle
  document.querySelectorAll('[name="interval_mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isCustom = document.querySelector('[name="interval_mode"]:checked').value === 'custom';
      document.getElementById('custom-intervals').classList.toggle('hidden', !isCustom);
    });
  });

  // Vehicle form submit
  document.getElementById('form-vehicle').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const mode = form.querySelector('[name="interval_mode"]:checked').value;

    const intervals = {};
    if (mode === 'custom') {
      form.querySelectorAll('.interval-input').forEach(input => {
        const miles = parseInt(input.value);
        if (!isNaN(miles) && miles > 0) intervals[input.dataset.key] = miles;
      });
    }

    const rawMileage = form.current_mileage.value.trim();
    const body = {
      name: form.name.value.trim(),
      year: parseInt(form.year.value),
      make: form.make.value.trim(),
      model: form.model.value.trim(),
      currentMileage: rawMileage ? parseInt(rawMileage) : null,
      intervals,
    };

    try {
      if (state.editingVehicle) {
        const updated = await window.api.updateVehicle({ id: state.editingVehicle.id, ...body });
        state.currentVehicle = updated;
        state.vehicleIntervals = await window.api.getVehicleIntervals(updated.id);
        populateServiceTypes();
        toast('Vehicle updated', 'success');
        await loadVehicles();
        renderDetailHeader();
        closeModal('modal-vehicle');
      } else {
        const created = await window.api.createVehicle(body);
        toast('Vehicle added', 'success');
        await loadVehicles();
        await selectVehicle(created);
        closeModal('modal-vehicle');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('btn-cancel-vehicle').addEventListener('click', () => closeModal('modal-vehicle'));

  document.getElementById('btn-edit-vehicle').addEventListener('click', () => openVehicleModal(state.currentVehicle));

  document.getElementById('btn-delete-vehicle').addEventListener('click', () => {
    const v = state.currentVehicle;
    confirm(
      'Delete vehicle?',
      `This will permanently delete "${v.name || `${v.year} ${v.make} ${v.model}`}" and all its service history.`,
      async () => {
        await window.api.deleteVehicle(v.id);
        state.currentVehicle = null;
        toast('Vehicle deleted', 'info');
        await loadVehicles();
        document.getElementById('vehicle-detail').classList.add('hidden');
        document.getElementById('empty-state').classList.remove('hidden');
      }
    );
  });

  [document.getElementById('btn-log-service'), document.getElementById('btn-log-service-2')].forEach(btn => {
    btn.addEventListener('click', () => openServiceModal());
  });

  document.getElementById('form-service').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const checkedTypes = Array.from(document.querySelectorAll('.service-type-cb:checked')).map(cb => cb.value);
    if (checkedTypes.length === 0) {
      toast('Select at least one service type', 'error');
      return;
    }
    try {
      await Promise.all(checkedTypes.map(serviceType =>
        window.api.createServiceLog({
          vehicleId: state.currentVehicle.id,
          serviceType,
          mileage: parseInt(form.mileage.value),
          serviceDate: form.service_date.value,
          notes: form.notes.value.trim(),
        })
      ));
      toast(`${checkedTypes.length} service${checkedTypes.length > 1 ? 's' : ''} logged`, 'success');
      closeModal('modal-service');
      await refreshVehicleDetail();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('btn-cancel-service').addEventListener('click', () => closeModal('modal-service'));

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  document.getElementById('btn-confirm-ok').addEventListener('click', async () => {
    closeModal('modal-confirm');
    if (state.confirmCallback) {
      try { await state.confirmCallback(); } catch (err) { toast(err.message, 'error'); }
      state.confirmCallback = null;
    }
  });

  document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
    closeModal('modal-confirm');
    state.confirmCallback = null;
  });

  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });

  // Calendar navigation
  document.getElementById('cal-prev').addEventListener('click', () => {
    const d = new Date(state.calendarYear, state.calendarMonth - 1, 1);
    state.calendarYear = d.getFullYear();
    state.calendarMonth = d.getMonth();
    renderCalendar();
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    const d = new Date(state.calendarYear, state.calendarMonth + 1, 1);
    state.calendarYear = d.getFullYear();
    state.calendarMonth = d.getMonth();
    renderCalendar();
  });

  // Export ICS
  document.getElementById('btn-export-ics').addEventListener('click', async () => {
    if (!state.currentVehicle) return;
    const result = await window.api.exportIcs(state.currentVehicle, state.upcoming);
    if (result.ok) toast('Calendar file saved', 'success');
  });

  // Sync to Google Calendar
  document.getElementById('btn-sync-calendar').addEventListener('click', async () => {
    if (!state.currentVehicle) return;
    const btn = document.getElementById('btn-sync-calendar');
    btn.textContent = 'Syncing…';
    btn.disabled = true;
    try {
      const result = await window.api.syncToCalendar(state.currentVehicle.id);
      if (result.ok) {
        toast(`Synced ${result.synced} event${result.synced === 1 ? '' : 's'} to Google Calendar`, 'success');
      } else {
        toast(result.error || 'Sync failed', 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.textContent = 'Sync to Calendar';
    btn.disabled = false;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [vehicles, serviceTypes, googleStatus] = await Promise.all([
      window.api.getVehicles(),
      window.api.getServiceTypes(),
      window.api.getGoogleStatus(),
    ]);

    state.vehicles = vehicles;
    state.serviceTypes = serviceTypes;
    state.googleStatus = googleStatus;

    populateServiceTypes();
    renderVehicleList();
    renderGoogleStatus();
    wire();

    document.getElementById('empty-state').classList.remove('hidden');

    if (state.vehicles.length > 0) {
      await selectVehicle(state.vehicles[0]);
    }
  } catch (err) {
    console.error('Init failed:', err);
  }
}

init();

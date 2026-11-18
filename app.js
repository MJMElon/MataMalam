// App version: keep in step with version.json and the ?v= tags in index.html when publishing
const APP_VERSION = '2026-11-18e';

let activeStream = null;

// Inline icons (emoji are missing from some phone/PC fonts)
const ICONS = {
  camera: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  route: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>'
};

document.getElementById('year').textContent = new Date().getFullYear();

// Navigation and page view handling
function showHomePage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('home-page').style.display = 'block';
  renderTasks();
  window.scrollTo(0, 0);
}

function showDonePage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('done-module-page').style.display = 'block';
  renderTasks();
  window.scrollTo(0, 0);
}

function showSettingsPage() {
  // Asked here as well as by hiding the link: a hidden link does not stop a call
  if (!canEditSettings()) {
    showHomePage();
    return;
  }
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('settings-module-page').style.display = 'block';
  loadTaskSettingsForm();
  renderLocationSettings();
  loadTaskSlotsForm();
  applySettingsAccess();
  loadCheckpointsForm();
  switchSettingsTab('task-timing');
  syncNow();
  window.scrollTo(0, 0);
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('#settings-module-page .tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#settings-module-page .tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  if (tabName === 'locations') initCheckpointMap();
}

function showReportPage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('report-module-page').style.display = 'block';
  populateReportYearDropdown();
  populateReportLocations();
  generateReport();
  window.scrollTo(0, 0);
}

function stopActiveCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }
}

// To-Do task flow: one task per location per time slot for the current night shift
// Locations come from the MJM AI System's nursery list (Operation > Settings). This built-in
// list is only used until the first successful sync, or when the AI System cannot be reached.
const DEFAULT_LOCATIONS = [
  { code: 'BNN', name: 'BNN' },
  { code: 'UNN1', name: 'UNN 1' },
  { code: 'UNN2', name: 'UNN 2' }
];
const AI_SYSTEM_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const AI_SYSTEM_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

// Checkpoint pins: where each location is on the map, set by the admin in Settings > Locations.
// Saved as { BNN: [lat, lng], UNN1: [lat, lng], ... }; a location without a pin is simply left out.
function getCheckpoints() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_checkpoints'));
    if (saved && typeof saved === 'object') return saved;
  } catch (err) {}
  return {};
}

let checkpointDraft = {};
let checkpointSelected = getActiveLocations()[0];
let checkpointMap = null;
let checkpointMarkers = {};

function loadCheckpointsForm() {
  checkpointDraft = { ...getCheckpoints() };
  checkpointSelected = getActiveLocations()[0];
  document.getElementById('checkpoint-message').textContent = '';
  renderCheckpointPicker();
  if (checkpointMap) {
    drawCheckpointMarkers();
    fitCheckpointMap();
  }
}

function renderCheckpointPicker() {
  const picker = document.getElementById('checkpoint-picker');
  picker.innerHTML = getActiveLocations().map(location => {
    const set = Boolean(checkpointDraft[location]);
    const state = set ? (currentLang === 'BM' ? 'Ditetapkan' : 'Pinned') : (currentLang === 'BM' ? 'Belum ditetapkan' : 'Not set');
    return `<button type="button" class="checkpoint-chip${location === checkpointSelected ? ' active' : ''}${set ? ' is-set' : ''}" data-location="${location}" aria-pressed="${location === checkpointSelected}">
      <span class="checkpoint-chip-name">${location}</span>
      <span class="checkpoint-chip-state">${state}</span>
    </button>`;
  }).join('');
  picker.querySelectorAll('.checkpoint-chip').forEach(btn => {
    btn.onclick = () => selectCheckpoint(btn.dataset.location);
  });
  document.getElementById('checkpoint-clear').disabled = !checkpointDraft[checkpointSelected];
}

function selectCheckpoint(location) {
  checkpointSelected = location;
  renderCheckpointPicker();
  drawCheckpointMarkers();
  drawSiteOutlines();
  const pin = checkpointDraft[location];
  if (pin && checkpointMap) checkpointMap.panTo(pin);
  // No pin yet: go to that nursery's outline, which is where the pin belongs
  else if (checkpointMap && outlineBounds(location)) checkpointMap.fitBounds(outlineBounds(location), { padding: [24, 24], maxZoom: 18 });
}

// Site outlines: the nursery boundaries uploaded on the MJM AI System (System Setting > Boundary),
// drawn on the pin map so whoever is placing a pin can see where each nursery is. They are kept on
// the phone after the first read, so the map still shows them with no signal.
const OUTLINE_COLORS = ['#3fb950', '#d29922', '#a371f7', '#f778ba', '#58a6ff'];
let siteOutlineLayers = [];

function getSiteOutlines() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_outlines'));
    if (saved && Array.isArray(saved.list)) return saved;
  } catch (err) {}
  return null;
}

// The outline of one location, as Leaflet bounds, or null when the AI System has none for it
function outlineBounds(location) {
  if (typeof L === 'undefined') return null;
  const saved = getSiteOutlines();
  const row = saved && saved.list.find(o => locationCode(o.nursery) === location);
  if (!row || !row.geojson) return null;
  try {
    const bounds = L.geoJSON(row.geojson).getBounds();
    return bounds.isValid() ? bounds : null;
  } catch (err) {
    return null;
  }
}

function drawSiteOutlines() {
  if (!checkpointMap || typeof L === 'undefined') return;
  siteOutlineLayers.forEach(layer => layer.remove());
  siteOutlineLayers = [];
  const saved = getSiteOutlines();
  const note = document.getElementById('checkpoint-outline-note');
  const drawn = [];
  ((saved && saved.list) || []).forEach((row, index) => {
    if (!row || !row.geojson) return;
    const code = locationCode(row.nursery);
    const selected = code === checkpointSelected;
    const color = OUTLINE_COLORS[index % OUTLINE_COLORS.length];
    try {
      // Not interactive: a tap inside an outline still reaches the map and places the pin
      const layer = L.geoJSON(row.geojson, {
        interactive: false,
        style: { color, weight: selected ? 3 : 1.5, opacity: selected ? 1 : 0.7, fillColor: color, fillOpacity: selected ? 0.18 : 0.06 }
      }).addTo(checkpointMap);
      const bounds = layer.getBounds();
      // A location that already has a pin is named by the pin, so its outline carries no second label
      if (bounds.isValid() && !checkpointDraft[code]) {
        const label = L.marker(bounds.getCenter(), {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: `outline-label${selected ? ' selected' : ''}`, html: `<span style="border-color:${color}"></span>`, iconSize: [0, 0] })
        }).addTo(checkpointMap);
        const span = label.getElement() && label.getElement().querySelector('span');
        if (span) span.textContent = row.nursery || code;
        siteOutlineLayers.push(label);
      }
      siteOutlineLayers.push(layer);
      drawn.push(row.nursery || code);
    } catch (err) {}
  });
  if (note) {
    note.textContent = drawn.length
      ? `${currentLang === 'BM' ? 'Sempadan daripada AI System' : 'Boundaries from the AI System'}: ${drawn.join(', ')}`
      : '';
  }
}

// Reads the outlines when the pin map is opened: once a day is enough, they change rarely
async function loadSiteOutlines({ force = false } = {}) {
  const session = getSession();
  const saved = getSiteOutlines();
  if (!session) return;
  if (!force && saved && Date.now() - saved.at < 24 * 60 * 60 * 1000) return;
  try {
    const list = await rpc('mata_malam_boundaries', { p_token: session.token });
    if (!Array.isArray(list)) return;
    const hadNone = !saved || saved.list.length === 0;
    localStorage.setItem('mata_malam_outlines', JSON.stringify({ at: Date.now(), list }));
    drawSiteOutlines();
    // First time the outlines arrive on a map with no pins: show the nurseries rather than the default view
    if (hadNone && checkpointMap) fitCheckpointMap();
  } catch (err) {
    // No signal, or the AI System has not got the function yet: the map works as it did without them
  }
}

// The map is created the first time the Locations tab is opened (Leaflet needs a visible container)
function initCheckpointMap() {
  const container = document.getElementById('checkpoint-map');
  if (checkpointMap) {
    checkpointMap.invalidateSize();
    loadSiteOutlines();
    return;
  }
  if (typeof L === 'undefined') {
    container.innerHTML = `<span class="route-map-offline">${currentLang === 'BM' ? 'Peta tidak dapat dimuatkan (tiada internet).' : 'Map could not be loaded (no internet).'}</span>`;
    return;
  }
  checkpointMap = L.map(container);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(checkpointMap);
  checkpointMap.on('click', event => placeCheckpoint([event.latlng.lat, event.latlng.lng]));
  drawCheckpointMarkers();
  drawSiteOutlines();
  fitCheckpointMap();
  loadSiteOutlines();
}

function fitCheckpointMap() {
  const pins = getActiveLocations().map(location => checkpointDraft[location]).filter(Boolean);
  if (pins.length > 1) {
    checkpointMap.fitBounds(pins, { padding: [40, 40], maxZoom: 18 });
  } else if (pins.length === 1) {
    checkpointMap.setView(pins[0], 17);
  } else if (outlineBounds(checkpointSelected)) {
    // No pins yet: start on the selected nursery's outline
    checkpointMap.fitBounds(outlineBounds(checkpointSelected), { padding: [24, 24], maxZoom: 18 });
  } else {
    checkpointMap.setView([3.139, 101.6869], 12);
    // No pins yet: start the map where the admin is standing
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        if (getActiveLocations().some(location => checkpointDraft[location])) return;
        checkpointMap.setView([position.coords.latitude, position.coords.longitude], 17);
      }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }
  }
}

function checkpointIcon(location, selected) {
  return L.divIcon({
    className: `checkpoint-marker${selected ? ' selected' : ''}`,
    html: `<span class="checkpoint-marker-label">${location}</span><span class="checkpoint-marker-dot"></span>`,
    iconSize: [0, 0]
  });
}

function drawCheckpointMarkers() {
  if (!checkpointMap) return;
  Object.values(checkpointMarkers).forEach(marker => marker.remove());
  checkpointMarkers = {};
  getActiveLocations().forEach(location => {
    const pin = checkpointDraft[location];
    if (!pin) return;
    const selected = location === checkpointSelected;
    // Pins can be dragged to fine-tune them; tapping a pin selects its location
    const marker = L.marker(pin, { icon: checkpointIcon(location, selected), draggable: true, zIndexOffset: selected ? 1000 : 0 }).addTo(checkpointMap);
    marker.on('click', () => selectCheckpoint(location));
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      checkpointSelected = location;
      placeCheckpoint([lat, lng]);
    });
    checkpointMarkers[location] = marker;
  });
}

function placeCheckpoint([lat, lng]) {
  checkpointDraft[checkpointSelected] = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  document.getElementById('checkpoint-message').textContent = '';
  renderCheckpointPicker();
  drawCheckpointMarkers();
  drawSiteOutlines();
}

function pinCheckpointHere() {
  const btn = document.getElementById('checkpoint-here');
  const message = document.getElementById('checkpoint-message');
  if (!navigator.geolocation) {
    message.textContent = currentLang === 'BM' ? 'Geolokasi tidak disokong' : 'Geolocation not supported';
    return;
  }
  btn.disabled = true;
  message.textContent = currentLang === 'BM' ? 'Mengesan Lokasi...' : 'Detecting Location...';
  navigator.geolocation.getCurrentPosition(position => {
    btn.disabled = false;
    const point = [position.coords.latitude, position.coords.longitude];
    placeCheckpoint(point);
    if (checkpointMap) checkpointMap.setView(point, Math.max(checkpointMap.getZoom(), 17));
  }, () => {
    btn.disabled = false;
    message.textContent = currentLang === 'BM' ? 'Gagal mendapatkan lokasi. Sila hidupkan GPS.' : 'Could not get your location. Please turn on GPS.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

function clearCheckpoint() {
  delete checkpointDraft[checkpointSelected];
  document.getElementById('checkpoint-message').textContent = '';
  renderCheckpointPicker();
  drawCheckpointMarkers();
  drawSiteOutlines();
}

function resetCheckpoints() {
  loadCheckpointsForm();
}

function saveCheckpoints(event) {
  event.preventDefault();
  const saved = {};
  getActiveLocations().forEach(location => {
    if (checkpointDraft[location]) saved[location] = checkpointDraft[location];
  });
  localStorage.setItem('mata_malam_checkpoints', JSON.stringify(saved));
  checkpointDraft = { ...saved };
  const message = document.getElementById('checkpoint-message');
  message.textContent = currentLang === 'BM' ? 'Disimpan ✓' : 'Saved ✓';
  setTimeout(() => {
    if (message.textContent === 'Disimpan ✓' || message.textContent === 'Saved ✓') message.textContent = '';
  }, 3000);
}

// "35 m from the BNN pin" under the detected location in the task sheet
function describeCheckpointDistance(location, coordText) {
  const pin = getCheckpoints()[location];
  const here = parseCoordinates(coordText);
  if (!pin || !here) return '';
  const meters = distanceMeters(here, pin);
  return currentLang === 'BM'
    ? `${formatDistance(meters)} dari pin ${location}`
    : `${formatDistance(meters)} from the ${location} pin`;
}
// Default photo times (24-hour). Admins can change the schedule in Settings.
const DEFAULT_TASK_SLOTS = ['18:00', '21:00', '00:00', '03:00', '06:00'];
const MAX_TASK_SLOTS = 12;
// Default timing: a task appears 15 minutes before its scheduled time and must be submitted
// within one hour of appearing. Admins can change both in Settings.
const DEFAULT_TASK_SETTINGS = { opensBeforeMinutes: 15, windowMinutes: 60 };
const MINUTE_MS = 60 * 1000;
const HISTORY_SHIFTS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

let pendingTask = null;
let pendingPhoto = null;
let pendingCoordinates = null;
let photoUrls = [];

// The night shift runs 6pm–6am, so anything before noon belongs to the previous day's shift
function getShiftDate(now = new Date()) {
  const d = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTaskSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_task_settings'));
    if (saved && Number.isFinite(saved.opensBeforeMinutes) && Number.isFinite(saved.windowMinutes)) return saved;
  } catch (err) {}
  return { ...DEFAULT_TASK_SETTINGS };
}

// Minutes from midnight at the start of the shift date; times before noon fall on the next morning
function getSlotOffsetMinutes(hours, minutes) {
  return (hours < 12 ? hours + 24 : hours) * 60 + minutes;
}

// "18:00" -> "6pm", "18:30" -> "6:30pm", "00:00" -> "12am"
function formatSlotLabel(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? 'am' : 'pm';
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minutes).padStart(2, '0')}${suffix}`;
}

// Parses a slot label such as "6pm" or "6:30pm" (stored on each log) into its shift offset
function parseSlotLabel(label) {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(label || '');
  if (!match) return NaN;
  const hours = (Number(match[1]) % 12) + (match[3] === 'pm' ? 12 : 0);
  return getSlotOffsetMinutes(hours, Number(match[2] || 0));
}

function sortSlots(slots) {
  const offset = hhmm => {
    const [hours, minutes] = hhmm.split(':').map(Number);
    return getSlotOffsetMinutes(hours, minutes);
  };
  return [...slots].sort((a, b) => offset(a) - offset(b));
}

function isSlotList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(s => /^\d{2}:\d{2}$/.test(s));
}

// The single schedule used before each location had its own; still the starting point for a
// location nobody has set times for yet
function getSharedSlots() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_task_slots'));
    if (isSlotList(saved)) return sortSlots(saved);
  } catch (err) {}
  return [...DEFAULT_TASK_SLOTS];
}

// A location's code is its name without spaces ("UNN 1" -> "UNN1"), the same rule the AI System uses
function locationCode(name) {
  return String(name || '').replace(/\s+/g, '').toUpperCase();
}

// The main nursery (BNN, UNN1, UNN2, ...) is patrolled unless switched off; other places in the
// AI System's list (e.g. PN, UNE) are listed but stay off until switched on
function isMainNursery(code) {
  return /^(BNN|UNN)\d*$/.test(code);
}

function sortLocations(list) {
  const rank = l => (isMainNursery(l.code) ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code, 'en', { numeric: true }));
}

function getLocationCache() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_locations'));
    if (saved && Array.isArray(saved.list) && saved.list.length > 0 && saved.list.every(l => l && l.code)) return saved;
  } catch (err) {}
  return null;
}

// Every location known to the app, as { code, name }
function getLocations() {
  const cache = getLocationCache();
  return sortLocations(cache ? cache.list : DEFAULT_LOCATIONS);
}

function getLocationSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_location_settings'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch (err) {}
  return {};
}

function saveLocationSetting(code, changes) {
  const all = getLocationSettings();
  all[code] = { ...(all[code] || {}), ...changes };
  localStorage.setItem('mata_malam_location_settings', JSON.stringify(all));
}

function isLocationActive(code) {
  const setting = getLocationSettings()[code];
  return setting && typeof setting.active === 'boolean' ? setting.active : isMainNursery(code);
}

// Codes of the locations that get check-in tasks, in display order
function getActiveLocations() {
  return getLocations().map(l => l.code).filter(isLocationActive);
}

function locationOrder(code) {
  const index = getLocations().findIndex(l => l.code === code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

// Each location has its own check-in times
function getTaskSlots(location) {
  const setting = getLocationSettings()[location];
  if (setting && isSlotList(setting.slots)) return sortSlots(setting.slots);
  return getSharedSlots();
}

// Slot labels in shift order, e.g. ['6pm', '9pm', '12am', '3am', '6am']
function getTaskTimes(location) {
  return getTaskSlots(location).map(formatSlotLabel);
}

// The earliest check-in of the shift across the active locations (used for the timing preview)
function getFirstTaskTime() {
  const slots = getActiveLocations().flatMap(getTaskSlots);
  return formatSlotLabel(sortSlots(slots.length ? slots : DEFAULT_TASK_SLOTS)[0]);
}

let locationSyncState = '';

function getTaskWindow(date, time, settings = getTaskSettings()) {
  const [year, month, day] = date.split('-').map(Number);
  const scheduledAt = new Date(year, month - 1, day, 0, parseSlotLabel(time)).getTime();
  const opensAt = scheduledAt - settings.opensBeforeMinutes * MINUTE_MS;
  return { scheduledAt, opensAt, closesAt: opensAt + settings.windowMinutes * MINUTE_MS };
}

// Returns an error message, or null when the timing values are allowed
function validateTaskSettings(settings) {
  const { opensBeforeMinutes, windowMinutes } = settings;
  if (!Number.isInteger(opensBeforeMinutes) || opensBeforeMinutes < 0 || opensBeforeMinutes > 120) {
    return currentLang === 'BM' ? 'Masa paparan mestilah antara 0 hingga 120 minit.' : 'Task appears time must be between 0 and 120 minutes.';
  }
  if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 240) {
    return currentLang === 'BM' ? 'Had masa penghantaran mestilah antara 5 hingga 240 minit.' : 'Submission time limit must be between 5 and 240 minutes.';
  }
  if (windowMinutes <= opensBeforeMinutes) {
    return currentLang === 'BM'
      ? 'Had masa penghantaran mesti lebih panjang daripada masa paparan, supaya tarikh akhir selepas waktu dijadualkan.'
      : 'Submission time limit must be longer than the appear-before time, so the deadline falls after the scheduled time.';
  }
  return null;
}

function readTaskSettingsForm() {
  return {
    opensBeforeMinutes: Number(document.getElementById('setting-opens-before').value),
    windowMinutes: Number(document.getElementById('setting-window').value)
  };
}

function loadTaskSettingsForm(settings = getTaskSettings()) {
  document.getElementById('setting-opens-before').value = settings.opensBeforeMinutes;
  document.getElementById('setting-window').value = settings.windowMinutes;
  document.getElementById('settings-message').textContent = '';
  updateSettingsPreview();
}

// Keeps the deadline after the scheduled time by nudging the other slider when they cross
function onTaskSettingsInput(changed) {
  const opensInput = document.getElementById('setting-opens-before');
  const windowInput = document.getElementById('setting-window');
  const opens = Number(opensInput.value);
  const windowMinutes = Number(windowInput.value);
  if (windowMinutes <= opens) {
    if (changed === 'opens') windowInput.value = opens + 5;
    else opensInput.value = windowMinutes - 5;
  }
  document.getElementById('settings-message').textContent = '';
  updateSettingsPreview();
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const h = currentLang === 'BM' ? 'j' : 'h';
  if (hours === 0) return `${mins} min`;
  return mins === 0 ? `${hours}${h}` : `${hours}${h} ${mins}m`;
}

// Positions the bubble over the slider thumb (thumb is 24px wide, see .slider in styles.css)
function setSliderBubble(inputId, bubbleId, text) {
  const input = document.getElementById(inputId);
  const bubble = document.getElementById(bubbleId);
  const pct = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  bubble.textContent = text;
  bubble.style.left = `calc(${pct * 100}% + ${12 - pct * 24}px)`;
}

function updateSettingsPreview() {
  const settings = readTaskSettingsForm();
  const exampleTime = getFirstTaskTime();
  const { opensAt, closesAt } = getTaskWindow(getShiftDate(), exampleTime, settings);
  // Bubble above each slider thumb shows the duration; the header shows the resulting time for the first task of the shift
  setSliderBubble('setting-opens-before', 'bubble-opens-before', formatDuration(settings.opensBeforeMinutes));
  setSliderBubble('setting-window', 'bubble-window', formatDuration(settings.windowMinutes));
  document.getElementById('value-opens-before').textContent = `${formatSlotTime(exampleTime)} → ${formatClock(opensAt)}`;
  document.getElementById('preview-scheduled').textContent = formatSlotTime(exampleTime);
  document.getElementById('value-window').textContent = `${currentLang === 'BM' ? 'Tamat' : 'Ends'} ${formatClock(closesAt)}`;

  document.getElementById('preview-opens').textContent = formatClock(opensAt);
  document.getElementById('preview-closes').textContent = formatClock(closesAt);
  const markerPct = Math.min(100, (settings.opensBeforeMinutes / settings.windowMinutes) * 100);
  document.getElementById('timing-marker').style.left = `${markerPct}%`;
  const scheduledLabel = document.getElementById('preview-scheduled');
  scheduledLabel.style.left = `${markerPct}%`;
  scheduledLabel.style.transform = markerPct < 10 ? 'none' : markerPct > 90 ? 'translateX(-100%)' : 'translateX(-50%)';
}

function saveTaskSettings(event) {
  event.preventDefault();
  const settings = readTaskSettingsForm();
  const message = document.getElementById('settings-message');
  const error = validateTaskSettings(settings);
  if (error) {
    message.style.color = 'var(--error-color)';
    message.textContent = error;
    return;
  }
  if (denySettingsEdit(message)) return;
  localStorage.setItem('mata_malam_task_settings', JSON.stringify(settings));
  message.style.color = '#3fb950';
  message.textContent = currentLang === 'BM' ? 'Tetapan disimpan.' : 'Settings saved.';
  settingsChanged();
  renderTasks();
}

function resetTaskSettings() {
  loadTaskSettingsForm(DEFAULT_TASK_SETTINGS);
}

// Location tab: the locations read from the AI System, which ones are patrolled, and their times
function renderLocationSettings() {
  const listEl = document.getElementById('location-list');
  if (!listEl) return;
  const bm = currentLang === 'BM';
  const cache = getLocationCache();
  const active = getActiveLocations();
  // The time editor is ONE form that sits inside the location being edited. It is parked before
  // the list is rebuilt (so what is half keyed in it is not thrown away) and put back afterwards.
  const editor = document.getElementById('schedule-editor');
  document.getElementById('tab-location').appendChild(editor);
  editor.hidden = true;
  if (editingLocation && !active.includes(editingLocation)) editingLocation = null;
  listEl.innerHTML = '';
  getLocations().forEach(({ code, name }) => {
    const on = active.includes(code);
    const open = on && code === editingLocation;
    const li = document.createElement('li');
    li.className = on ? 'location-row' : 'location-row location-row-off';
    const times = getTaskSlots(code).map(slot => `<span class="location-time">${formatSlotTime(formatSlotLabel(slot))}</span>`).join('');
    li.innerHTML = `
      <div class="location-head">
        <span class="location-name">${ICONS.pin}<span></span></span>
        <label class="switch">
          <input type="checkbox" ${on ? 'checked' : ''} ${canEditSettings() ? '' : 'disabled'} aria-label="${bm ? 'Aktif' : 'Active'}">
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="location-times">${on ? times : `<span class="location-off-note">${bm ? 'Tidak aktif — tiada tugasan' : 'Off — no check-in tasks'}</span>`}</div>
      <button type="button" class="btn btn-secondary location-edit" ${on ? '' : 'hidden'} aria-expanded="${open}">${open
        ? (bm ? 'Tutup' : 'Close')
        : (canEditSettings() ? (bm ? 'Ubah Masa' : 'Edit Times') : (bm ? 'Lihat Masa' : 'View Times'))}</button>
    `;
    li.querySelector('.location-name span').textContent = name;
    li.querySelector('input').onchange = (event) => setLocationActive(code, event.target.checked);
    li.querySelector('.location-edit').onclick = () => toggleLocationTimes(code);
    if (open) {
      li.classList.add('location-row-editing');
      li.appendChild(editor);
      editor.hidden = false;
    }
    listEl.appendChild(li);
  });

  const status = document.getElementById('location-status');
  let text;
  if (locationSyncState === 'loading') {
    text = bm ? 'Sedang membaca daripada AI System…' : 'Reading from the AI System…';
  } else if (locationSyncState === 'failed') {
    text = cache
      ? (bm ? 'AI System tidak dapat dihubungi. Senarai yang disimpan digunakan.' : 'Could not reach the AI System. Using the saved list.')
      : (bm ? 'AI System tidak dapat dihubungi. Senarai asal digunakan.' : 'Could not reach the AI System. Using the built-in list.');
  } else if (cache) {
    const d = new Date(cache.syncedAt);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    text = `${bm ? 'Daripada AI System • dikemas kini' : 'From the AI System • updated'} ${day} ${formatClock(d)}`;
  } else {
    text = bm ? 'Senarai asal (belum dibaca daripada AI System).' : 'Built-in list (not read from the AI System yet).';
  }
  status.textContent = text;
  status.classList.toggle('location-status-warn', locationSyncState === 'failed');
  document.getElementById('location-refresh').disabled = locationSyncState === 'loading';
}

function setLocationActive(code, active) {
  const message = document.getElementById('location-message');
  message.textContent = '';
  if (denySettingsEdit(message)) {
    renderLocationSettings();
    return;
  }
  if (!active && getActiveLocations().length <= 1 && isLocationActive(code)) {
    message.style.color = 'var(--error-color)';
    message.textContent = currentLang === 'BM' ? 'Sekurang-kurangnya satu lokasi mesti aktif.' : 'At least one location must stay on.';
    renderLocationSettings();
    return;
  }
  // Same rule as a schedule change: settle what was missed so far, then count misses from now
  recordMissedTasks();
  saveLocationSetting(code, { active });
  localStorage.setItem('mata_malam_tracking_start', String(Date.now()));
  settingsChanged();
  renderLocationSettings();
  renderScheduleLocations();
  loadTaskSlotsForm();
  renderTasks();
  updateSettingsPreview();
}

// Schedule tab: each location's own list of check-in times
let scheduleLocation = null;
let scheduleDirty = false;
// The location whose times are open for editing in the Location & Time tab (null = none open)
let editingLocation = null;

// Opens a location's times inside its own card, or closes them again
function toggleLocationTimes(code) {
  const leaveQuestion = currentLang === 'BM'
    ? 'Perubahan masa belum disimpan. Tinggalkan tanpa simpan?'
    : 'The time changes are not saved yet. Leave without saving?';
  if (scheduleDirty && !confirm(leaveQuestion)) return;
  if (editingLocation === code) {
    editingLocation = null;
    scheduleDirty = false;
  } else {
    editingLocation = code;
    scheduleLocation = code;
    loadTaskSlotsForm();
  }
  renderLocationSettings();
  if (editingLocation) document.getElementById('schedule-editor').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function getScheduleLocation() {
  const active = getActiveLocations();
  if (editingLocation && active.includes(editingLocation)) scheduleLocation = editingLocation;
  if (!active.includes(scheduleLocation)) scheduleLocation = active[0] || getLocations()[0].code;
  return scheduleLocation;
}

function renderScheduleLocations() {
  const el = document.getElementById('schedule-locations');
  if (!el) return;
  const current = getScheduleLocation();
  el.innerHTML = '';
  const active = getActiveLocations();
  getLocations().filter(l => active.includes(l.code)).forEach(({ code, name }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = code === current ? 'loc-pill active' : 'loc-pill';
    btn.setAttribute('aria-pressed', String(code === current));
    btn.textContent = name;
    btn.onclick = () => selectScheduleLocation(code);
    el.appendChild(btn);
  });
}

function selectScheduleLocation(code, { force = false } = {}) {
  if (code === scheduleLocation && !force) return;
  if (scheduleDirty && code !== scheduleLocation && !confirm(currentLang === 'BM'
    ? 'Perubahan masa belum disimpan. Tinggalkan tanpa simpan?'
    : 'The time changes are not saved yet. Leave without saving?')) return;
  scheduleLocation = code;
  loadTaskSlotsForm();
}

function loadTaskSlotsForm(slots = getTaskSlots(getScheduleLocation())) {
  renderScheduleLocations();
  const list = document.getElementById('slot-list');
  list.innerHTML = '';
  slots.forEach(slot => addSlotRow(slot));
  updateTimeFormatToggle();
  document.getElementById('schedule-message').textContent = '';
  scheduleDirty = false;
  applySettingsAccess();
}

function updateTimeFormatToggle() {
  const format = getTimeFormat();
  document.querySelectorAll('.segmented button').forEach(btn => {
    const active = btn.dataset.format === format;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}


// Returns the row's time as "HH:MM" (24-hour), or null while any part is still unselected.
// Rows use the app's own selectors so they look and work the same on every phone and computer.
function getSlotRowValue(row) {
  const hourValue = row.querySelector('.slot-hour').value;
  const minuteValue = row.querySelector('.slot-minute').value;
  const ampmSelect = row.querySelector('.slot-ampm');
  if (hourValue === '' || minuteValue === '' || (ampmSelect && ampmSelect.value === '')) return null;
  let hours = Number(hourValue);
  if (ampmSelect) hours = (hours % 12) + (ampmSelect.value === 'PM' ? 12 : 0);
  return `${String(hours).padStart(2, '0')}:${String(Number(minuteValue)).padStart(2, '0')}`;
}

function slotOptions(values, selected, label) {
  const placeholder = selected === null ? '<option value="" selected>--</option>' : '';
  return placeholder + values.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(v)}</option>`).join('');
}

// Adds a time row. With no value it adds an empty row for the user to fill in; if an empty row
// is already waiting, it highlights that row instead of adding another one.
function addSlotRow(value = null, { focus = true } = {}) {
  const list = document.getElementById('slot-list');
  if (value === null && focus) {
    const waiting = [...list.querySelectorAll('.slot-row')].find(row => getSlotRowValue(row) === null);
    if (waiting) {
      waiting.classList.remove('slot-row-attention');
      void waiting.offsetWidth;
      waiting.classList.add('slot-row-attention');
      waiting.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const firstEmpty = [...waiting.querySelectorAll('select')].find(s => s.value === '');
      if (firstEmpty) firstEmpty.focus();
      return;
    }
  }
  if (list.children.length >= MAX_TASK_SLOTS) return;

  const format = getTimeFormat();
  let hours = null;
  let minutes = null;
  if (value) [hours, minutes] = value.split(':').map(Number);
  const pad = n => String(n).padStart(2, '0');

  const minuteValues = [];
  for (let m = 0; m < 60; m += 5) minuteValues.push(m);
  if (minutes !== null && !minuteValues.includes(minutes)) minuteValues.push(minutes);
  minuteValues.sort((a, b) => a - b);

  let hourHtml;
  let ampmHtml = '';
  if (format === '24') {
    hourHtml = slotOptions([...Array(24).keys()], hours, pad);
  } else {
    const hour12 = hours === null ? null : (hours % 12 === 0 ? 12 : hours % 12);
    hourHtml = slotOptions([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], hour12, pad);
    const ampm = hours === null ? null : (hours < 12 ? 'AM' : 'PM');
    ampmHtml = `<select class="slot-select slot-ampm" aria-label="AM / PM">${slotOptions(['AM', 'PM'], ampm, v => v)}</select>`;
  }

  const li = document.createElement('li');
  li.className = value ? 'slot-row' : 'slot-row slot-row-empty';
  li.innerHTML = `
    <span class="slot-clock">${ICONS.clock}</span>
    <div class="slot-time">
      <select class="slot-select slot-hour" aria-label="${currentLang === 'BM' ? 'Jam' : 'Hour'}">${hourHtml}</select>
      <span class="slot-colon">:</span>
      <select class="slot-select slot-minute" aria-label="${currentLang === 'BM' ? 'Minit' : 'Minute'}">${slotOptions(minuteValues, minutes, pad)}</select>
      ${ampmHtml}
    </div>
    <button type="button" class="slot-remove" aria-label="${currentLang === 'BM' ? 'Buang' : 'Remove'}">${ICONS.trash}</button>
  `;
  li.querySelectorAll('select').forEach(select => {
    select.onchange = () => {
      const complete = getSlotRowValue(li) !== null;
      li.classList.toggle('slot-row-empty', !complete);
      if (complete) li.classList.remove('slot-row-error');
      document.getElementById('schedule-message').textContent = '';
      scheduleDirty = true;
    };
  });
  li.querySelector('.slot-remove').onclick = () => {
    if (list.children.length > 1) { li.remove(); scheduleDirty = true; }
    updateSlotButtons();
  };
  list.appendChild(li);
  updateSlotButtons();
  if (!value && focus) {
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.querySelector('.slot-hour').focus();
  }
}
function updateSlotButtons() {
  const count = document.getElementById('slot-list').children.length;
  document.getElementById('slot-add').disabled = count >= MAX_TASK_SLOTS;
  document.querySelectorAll('#slot-list .slot-remove').forEach(btn => { btn.disabled = count <= 1; });
}

function saveTaskSlots(event) {
  event.preventDefault();
  const message = document.getElementById('schedule-message');
  const rows = [...document.querySelectorAll('#slot-list .slot-row')];
  const slots = rows.map(getSlotRowValue);
  rows.forEach((row, i) => row.classList.toggle('slot-row-error', slots[i] === null));

  let error = null;
  if (slots.some(slot => slot === null)) {
    const ampm = getTimeFormat() === '12';
    error = currentLang === 'BM'
      ? `Sila pilih jam, minit${ampm ? ' dan AM/PM' : ''} untuk setiap baris.`
      : `Please select the hour, minute${ampm ? ' and AM/PM' : ''} for every row.`;
  } else if (new Set(slots).size !== slots.length) {
    error = currentLang === 'BM' ? 'Masa yang sama dimasukkan lebih daripada sekali.' : 'The same time is listed more than once.';
  }
  if (error) {
    message.style.color = 'var(--error-color)';
    message.textContent = error;
    return;
  }
  if (denySettingsEdit(message)) return;

  // Record any tasks already missed under the old schedule, then only count misses from now on,
  // so a newly added time whose window has already passed is not marked "Work Not Completed"
  recordMissedTasks();
  const location = getScheduleLocation();
  saveLocationSetting(location, { slots: sortSlots(slots) });
  localStorage.setItem('mata_malam_tracking_start', String(Date.now()));
  settingsChanged();

  loadTaskSlotsForm();
  message.style.color = '#3fb950';
  message.textContent = currentLang === 'BM' ? `Jadual ${location} disimpan.` : `${location} schedule saved.`;
  renderLocationSettings();
  renderTasks();
  updateSettingsPreview();
}

function resetTaskSlots() {
  loadTaskSlotsForm(DEFAULT_TASK_SLOTS);
  scheduleDirty = true;
}

function getLogs() {
  return JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
}

// Every time in the app is shown in 24-hour format (e.g. "18:45"), whatever the device's own setting
function getTimeFormat() {
  return '24';
}

function formatClockParts(hours, minutes) {
  const mm = String(minutes).padStart(2, '0');
  if (getTimeFormat() === '24') return `${String(hours).padStart(2, '0')}:${mm}`;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${mm} ${hours < 12 ? 'AM' : 'PM'}`;
}

// Shows a stored slot label such as "6pm" or "10:30am" as "6:00 PM" / "10:30 AM"
function formatSlotTime(label) {
  const offset = parseSlotLabel(label);
  if (Number.isNaN(offset)) return label;
  return formatClockParts(Math.floor(offset / 60) % 24, offset % 60);
}

function formatClock(time) {
  const d = new Date(time);
  return formatClockParts(d.getHours(), d.getMinutes());
}

// Missed tasks are only counted from the first time the app was used on this device
function getTrackingStart() {
  let start = Number(localStorage.getItem('mata_malam_tracking_start'));
  if (!start) {
    start = Date.now();
    localStorage.setItem('mata_malam_tracking_start', String(start));
  }
  return start;
}

// Records "Work Not Completed" for every task whose window closed without a submission
function recordMissedTasks(now = Date.now()) {
  const trackingStart = getTrackingStart();
  const settings = getTaskSettings();
  const schedule = getActiveLocations().map(location => ({ location, times: getTaskTimes(location) }));
  const logs = getLogs();
  let changed = false;

  for (let i = 31; i >= 0; i--) {
    const date = getShiftDate(new Date(now - i * DAY_MS));
    schedule.forEach(({ location, times }) => {
      times.forEach(time => {
        const { closesAt } = getTaskWindow(date, time, settings);
        if (closesAt > now || closesAt <= trackingStart) return;
        if (logs.some(l => l.date === date && l.time === time && l.location === location)) return;
        logs.push({ location, date, time, coordinates: '-', status: 'missed', recordedAt: new Date(closesAt).toISOString() });
        changed = true;
      });
    });
  }

  if (changed) localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  return changed;
}

function getShiftTasks(date) {
  const logs = getLogs().filter(log => log.date === date);
  const settings = getTaskSettings();
  const tasks = [];
  getActiveLocations().forEach(location => {
    getTaskTimes(location).forEach(time => {
      const log = logs.find(l => l.location === location && l.time === time);
      tasks.push({ location, time, date, log, ...getTaskWindow(date, time, settings) });
    });
  });
  // Each location has its own times, so put the whole shift in clock order
  return tasks.sort((a, b) => a.scheduledAt - b.scheduledAt || locationOrder(a.location) - locationOrder(b.location));
}

function renderTasks() {
  recordMissedTasks();
  closeStalePatrols();
  renderTodo();
  renderHistory();
}

function renderTodo(now = Date.now()) {
  const date = getShiftDate(new Date(now));
  const tasks = getShiftTasks(date);
  // Include the previous shift too, in case an early-morning window runs past the noon changeover
  const candidates = getShiftTasks(getShiftDate(new Date(now - DAY_MS))).concat(tasks);
  const due = candidates.filter(task => !task.log && task.opensAt <= now && now < task.closesAt);
  const next = candidates.find(task => !task.log && now < task.opensAt);
  const completed = tasks.filter(task => task.log && task.log.status !== 'missed').length;
  const inProgress = getInProgressLogs();

  document.getElementById('todo-meta').textContent = `${date} • ${completed} / ${tasks.length} ${currentLang === 'BM' ? 'selesai' : 'done'}`;

  todoPhotoUrls.forEach(url => URL.revokeObjectURL(url));
  todoPhotoUrls = [];
  const todoList = document.getElementById('todo-list');
  if (liveRouteMapEl.closest('#todo-list')) liveRouteMapEl.remove();
  todoList.innerHTML = '';
  inProgress.forEach(log => todoList.appendChild(buildInProgressTask(log)));

  if (due.length === 0) {
    let message;
    if (next) {
      message = currentLang === 'BM'
        ? `Tiada tugasan buat masa ini. Tugasan seterusnya (${formatSlotTime(next.time)}) akan dipaparkan pada ${formatClock(next.opensAt)}.`
        : `No tasks due right now. The next task (${formatSlotTime(next.time)}) appears at ${formatClock(next.opensAt)}.`;
    } else {
      message = currentLang === 'BM' ? 'Tiada lagi tugasan untuk syif ini.' : 'No more tasks for this shift.';
    }
    todoList.insertAdjacentHTML('beforeend', `<li class="task-empty">${message}</li>`);
  }

  due.forEach((task, index) => {
    const minutesLeft = Math.max(1, Math.ceil((task.closesAt - now) / 60000));
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === 0 ? 'task-item task-next' : 'task-item';
    btn.onclick = () => startTask(task);
    btn.innerHTML = `
      <span class="task-time">${formatSlotTime(task.time)}</span>
      <span class="task-location">${task.location}
        <span class="task-deadline">${currentLang === 'BM' ? `Hantar sebelum ${formatClock(task.closesAt)} • ${minutesLeft} min lagi` : `Submit by ${formatClock(task.closesAt)} • ${minutesLeft} min left`}</span>
      </span>
      <span class="task-action task-start">${currentLang === 'BM' ? 'Mula Tugasan' : 'Start Task'}</span>
    `;
    li.appendChild(btn);
    todoList.appendChild(li);
  });
}

function renderHistory(now = Date.now()) {
  const dates = [];
  for (let i = 0; i < HISTORY_SHIFTS; i++) dates.push(getShiftDate(new Date(now - i * DAY_MS)));
  const entries = getLogs()
    .filter(log => dates.includes(log.date) && !log.patrolOpen && !Number.isNaN(parseSlotLabel(log.time)))
    .map(log => ({ log, ...getTaskWindow(log.date, log.time) }))
    .sort((a, b) => b.scheduledAt - a.scheduledAt || locationOrder(a.log.location) - locationOrder(b.log.location));

  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = [];
  historyRouteMaps.forEach(layers => layers.map.remove());
  historyRouteMaps = [];

  const missedCount = entries.filter(e => e.log.status === 'missed').length;
  const completedCount = entries.length - missedCount;
  document.getElementById('done-meta').textContent = currentLang === 'BM'
    ? `${completedCount} selesai • ${missedCount} tidak selesai`
    : `${completedCount} completed • ${missedCount} not completed`;

  const doneList = document.getElementById('done-list');
  doneList.innerHTML = '';
  if (entries.length === 0) {
    doneList.innerHTML = `<li class="task-empty">${currentLang === 'BM' ? 'Tiada sejarah tugasan lagi.' : 'No task history yet.'}</li>`;
    return;
  }

  let currentDate = null;
  entries.forEach(({ log }) => {
    if (log.date !== currentDate) {
      currentDate = log.date;
      const heading = document.createElement('li');
      heading.className = 'task-date-heading';
      heading.textContent = log.date;
      doneList.appendChild(heading);
    }

    const li = document.createElement('li');
    const missed = log.status === 'missed';
    li.className = missed ? 'task-item task-done task-missed' : 'task-item task-done';
    const remark = missed
      ? `<span class="task-remark-missed">${currentLang === 'BM' ? 'Kerja Tidak Disiapkan' : 'Work Not Completed'}</span>`
      : `<span class="task-submitted"><span class="task-check">✓</span> ${log.submittedAt ? formatClock(log.submittedAt) : ''}</span>`;
    li.innerHTML = `
      ${missed ? '<span class="task-thumb task-thumb-missed" aria-hidden="true">✕</span>' : '<img class="task-thumb" alt="">'}
      <span class="task-time">${formatSlotTime(log.time)}</span>
      <span class="task-location">${log.location}<span class="task-deadline task-by"></span></span>
      <span class="task-action">${remark}</span>
    `;
    if (!missed && log.workerName) li.querySelector('.task-by').textContent = log.workerName;
    if (!missed && (log.routeId || log.hasRoute)) {
      li.classList.add('task-has-route');
      li.insertAdjacentHTML('beforeend', `
        <div class="history-route">
          <span class="icon-text">${ICONS.route} ${formatDistance(log.routeDistance || 0)} • ${formatElapsed(log.routeDuration || 0)}</span>
          <button type="button" class="btn btn-secondary history-route-btn">${currentLang === 'BM' ? 'Peta' : 'Map'}</button>
        </div>
        <div class="history-route-map" hidden>
          <div class="route-map"></div>
          <a class="btn btn-secondary history-route-gmaps" target="_blank" rel="noopener">${currentLang === 'BM' ? 'Buka di Google Maps' : 'Open in Google Maps'}</a>
        </div>
      `);
      li.querySelector('.history-route-btn').onclick = (event) => toggleHistoryRoute(event.currentTarget, log);
    }
    const img = li.querySelector('img');
    if (img && log.id) {
      img.alt = `${log.location} ${formatSlotTime(log.time)}`;
      loadPhoto(log.id).then(blob => {
        if (!blob) {
          // Taken on another phone: shown from the AI System
          if (log.photoUrl) img.src = log.photoUrl;
          return;
        }
        const url = URL.createObjectURL(blob);
        photoUrls.push(url);
        img.src = url;
      }).catch(() => { if (log.photoUrl) img.src = log.photoUrl; });
    }
    doneList.appendChild(li);
  });
}

// Keeps the To-Do List in step with the clock: shows tasks as they open and expires them at the deadline
function refreshTaskSchedule() {
  const now = Date.now();
  if (pendingTask && now >= pendingTask.closesAt) {
    closeSubmitSheet();
    alert(currentLang === 'BM'
      ? 'Masa telah tamat. Tugasan ini tidak boleh dihantar lagi.'
      : 'Time is up. This task can no longer be submitted.');
  }
  const changed = recordMissedTasks(now) | closeStalePatrols(now);
  renderTodo(now);
  if (changed) renderHistory(now);
}

setInterval(refreshTaskSchedule, 15000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshTaskSchedule();
});

function startTask(task) {
  if (Date.now() >= task.closesAt) {
    refreshTaskSchedule();
    return;
  }
  const { location, time, date, closesAt } = task;
  // The log id is chosen now so a road track recorded in the sheet can be linked to this task
  const logId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingTask = { location, time, date, closesAt, logId, route: null };
  pendingPhoto = null;
  pendingCoordinates = fetchCoordinates();

  document.getElementById('sheet-task-label').textContent = `${formatSlotTime(time)} • ${location}`;
  const coordEl = document.getElementById('sheet-coord');
  const locationState = document.getElementById('sheet-location-state');
  coordEl.textContent = currentLang === 'BM' ? 'Mengesan Lokasi...' : 'Detecting Location...';
  locationState.textContent = '';
  const current = pendingTask;
  pendingCoordinates.then(coord => {
    if (pendingTask !== current) return;
    coordEl.textContent = coord;
    const distance = describeCheckpointDistance(location, coord);
    if (distance) {
      const note = document.createElement('span');
      note.className = 'checkpoint-distance';
      note.textContent = distance;
      coordEl.appendChild(note);
    }
    locationState.textContent = parseCoordinates(coord) ? '✓' : '';
  });

  document.getElementById('submit-sheet').hidden = false;
  document.querySelector('#submit-sheet .sheet').scrollTop = 0;
  renderSheetRoute();
  openTaskCamera();
}

// Photos come only from the live camera stream, so gallery images cannot be submitted
async function openTaskCamera() {
  const task = pendingTask;
  const video = document.getElementById('camera-video');
  const status = document.getElementById('camera-status');
  const captureBtn = document.getElementById('sheet-capture');

  pendingPhoto = null;
  stopActiveCamera();
  document.getElementById('sheet-photo-img').hidden = true;
  video.hidden = false;
  setSheetMode('capture');
  captureBtn.disabled = true;
  status.hidden = false;
  status.textContent = currentLang === 'BM' ? 'Membuka kamera...' : 'Opening camera...';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent = currentLang === 'BM' ? 'Kamera tidak disokong pada pelayar ini.' : 'Camera is not supported on this browser.';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    if (pendingTask !== task) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    activeStream = stream;
    video.srcObject = stream;
    await video.play();
    status.hidden = true;
    captureBtn.disabled = false;
  } catch (err) {
    status.textContent = currentLang === 'BM'
      ? 'Kamera tidak dapat dibuka. Sila benarkan akses kamera dan cuba lagi.'
      : 'Could not open the camera. Please allow camera access and try again.';
  }
}

function setSheetMode(mode) {
  const capturing = mode === 'capture';
  document.getElementById('sheet-capture').hidden = !capturing;
  document.getElementById('sheet-retake').hidden = capturing;
  document.getElementById('sheet-photo-state').textContent = capturing ? '' : '✓';
  // Submit needs a photo; the road track can be recorded before or after submitting
  document.getElementById('sheet-submit').disabled = capturing;
}

function fetchCoordinates() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(currentLang === 'BM' ? 'Geolokasi tidak disokong' : 'Geolocation not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`),
      () => {
        // While Road Tracking is recording, fall back to its latest fix (if under 2 minutes old)
        const last = activeRoute && activeRoute.points[activeRoute.points.length - 1];
        if (last && Date.now() - last[2] < 2 * 60 * 1000) {
          resolve(`${last[0].toFixed(6)}, ${last[1].toFixed(6)}`);
          return;
        }
        resolve(currentLang === 'BM' ? 'Gagal mendapatkan koordinat (GPS Ditutup)' : 'Failed to retrieve coordinates (GPS Disabled)');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// Grab the current camera frame, resized to keep stored photos small enough for on-device storage
function capturePhoto(maxSize = 1280, quality = 0.7) {
  const video = document.getElementById('camera-video');
  if (!activeStream || !video.videoWidth) return;

  const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (!blob) return;
    pendingPhoto = blob;
    stopActiveCamera();
    video.srcObject = null;
    video.hidden = true;

    const img = document.getElementById('sheet-photo-img');
    const previewUrl = URL.createObjectURL(blob);
    img.onload = () => URL.revokeObjectURL(previewUrl);
    img.src = previewUrl;
    img.hidden = false;

    const submitBtn = document.getElementById('sheet-submit');
    submitBtn.textContent = currentLang === 'BM' ? 'Hantar' : 'Submit';
    setSheetMode('review');
  }, 'image/jpeg', quality);
}

async function submitTask() {
  if (!pendingTask || !pendingPhoto) return;
  if (Date.now() >= pendingTask.closesAt) {
    refreshTaskSchedule();
    return;
  }
  const submitBtn = document.getElementById('sheet-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = currentLang === 'BM' ? 'Menghantar...' : 'Submitting...';

  const coordinates = await pendingCoordinates;
  const id = pendingTask.logId;

  try {
    await savePhoto(id, pendingPhoto);
  } catch (err) {
    alert(currentLang === 'BM' ? 'Gambar tidak dapat disimpan pada peranti ini.' : 'The photo could not be saved on this device.');
    submitBtn.disabled = false;
    submitBtn.textContent = currentLang === 'BM' ? 'Hantar' : 'Submit';
    return;
  }

  let logs = getLogs();
  logs.push({
    id,
    location: pendingTask.location,
    date: pendingTask.date,
    time: pendingTask.time,
    coordinates,
    status: 'completed',
    submittedAt: new Date().toISOString(),
    rev: 1,
    ...(getSession() ? { workerId: getSession().worker.id, workerName: getSession().worker.name } : {}),
    // A task whose road track is not finished stays in the To-Do List until it is
    patrolOpen: !pendingTask.route,
    ...(pendingTask.route ? {
      routeId: pendingTask.route.id,
      routeDistance: Math.round(pendingTask.route.distance),
      routeDuration: pendingTask.route.duration
    } : {})
  });
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));

  closeSubmitSheet({ submitted: true });
  renderTasks();
  syncSoon();
}

// Cancel asks first if a road track is being recorded, since cancelling discards it
function cancelSubmitSheet() {
  const recording = activeRoute && pendingTask && activeRoute.logId === pendingTask.logId;
  if ((recording || (pendingTask && pendingTask.route)) && !confirm(currentLang === 'BM'
    ? 'Batal akan membuang jejak laluan yang direkod. Teruskan?'
    : 'Cancelling will discard the recorded road track. Continue?')) return;
  closeSubmitSheet();
}

function closeSubmitSheet({ submitted = false } = {}) {
  if (!submitted && pendingTask) {
    // The task was not submitted, so its road track is discarded
    if (activeRoute && activeRoute.logId === pendingTask.logId) stopRouteTracking({ discard: true });
    if (pendingTask.route) deleteRoute(pendingTask.route.id).catch(() => {});
  }
  stopActiveCamera();
  document.getElementById('submit-sheet').hidden = true;
  document.getElementById('camera-video').srcObject = null;
  document.getElementById('sheet-photo-img').removeAttribute('src');
  pendingTask = null;
  pendingPhoto = null;
  pendingCoordinates = null;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.getElementById('submit-sheet').hidden) {
    cancelSubmitSheet();
  }
});

// Photos are stored in IndexedDB, keyed by log id (localStorage is too small for images)
let photoDbPromise = null;
function openPhotoDb() {
  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('mata_malam', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    photoDbPromise.catch(() => { photoDbPromise = null; });
  }
  return photoDbPromise;
}

async function savePhoto(id, blob) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function loadPhoto(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos', 'readonly').objectStore('photos').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Road Tracking: each task has three steps — photo, auto-detected location and the patrol route.
// After the photo is submitted the task stays in the To-Do List (log.patrolOpen) so the watchman
// can record the route; stopping the route (or tapping Finish) moves the task to History.
const ROUTE_MIN_STEP_M = 10;        // ignore GPS jitter smaller than this
const ROUTE_MAX_ACCURACY_M = 50;    // ignore fixes less accurate than this

let activeRoute = null;
let routeWatchId = null;
let routeWakeLock = null;
let routeWarning = '';
let liveRouteMap = null;
let historyRouteMaps = [];
let todoPhotoUrls = [];
// One map element is reused for the live route so re-rendering the To-Do List keeps the map
const liveRouteMapEl = document.createElement('div');
liveRouteMapEl.className = 'route-map';

function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

function formatElapsed(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

// Opens the route in Google Maps as walking directions through sampled points of the recorded path
function getGoogleMapsUrl(points) {
  if (points.length === 0) return null;
  const fmt = p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  if (points.length === 1) return `https://www.google.com/maps/search/?api=1&query=${fmt(points[0])}`;
  const waypoints = [];
  const maxWaypoints = 8;
  for (let i = 1; i <= maxWaypoints; i++) {
    const index = Math.round((i * (points.length - 1)) / (maxWaypoints + 1));
    if (index > 0 && index < points.length - 1 && !waypoints.includes(index)) waypoints.push(index);
  }
  const params = new URLSearchParams({
    api: '1',
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    travelmode: 'walking'
  });
  if (waypoints.length) params.set('waypoints', waypoints.map(i => fmt(points[i])).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function saveRoute(route) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('routes', 'readwrite');
    tx.objectStore('routes').put(route);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRoute(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('routes', 'readwrite');
    tx.objectStore('routes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadRoute(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('routes', 'readonly').objectStore('routes').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function routeMarker(latLng, color) {
  return L.circleMarker(latLng, { radius: 7, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 });
}

// Draws a route on a Leaflet map (OpenStreetMap tiles); returns null if the map library is unavailable
function drawRouteMap(container, points, photoLatLng = null) {
  if (typeof L === 'undefined') {
    container.innerHTML = `<span class="route-map-offline">${currentLang === 'BM' ? 'Peta tidak dapat dimuatkan (tiada internet).' : 'Map could not be loaded (no internet).'}</span>`;
    return null;
  }
  const map = L.map(container);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const latLngs = points.map(p => [p[0], p[1]]);
  const layers = { map, line: L.polyline(latLngs, { color: '#58a6ff', weight: 5 }).addTo(map), start: null, end: null };
  if (photoLatLng) routeMarker(photoLatLng, '#d29922').bindTooltip(currentLang === 'BM' ? 'Gambar' : 'Photo').addTo(map);
  if (latLngs.length) {
    layers.start = routeMarker(latLngs[0], '#3fb950').addTo(map);
    layers.end = routeMarker(latLngs[latLngs.length - 1], '#f85149').addTo(map);
    map.fitBounds(layers.line.getBounds(), { padding: [24, 24], maxZoom: 18 });
  } else if (photoLatLng) {
    map.setView(photoLatLng, 17);
  } else {
    map.setView([3.139, 101.6869], 12);
  }
  return layers;
}

function parseCoordinates(text) {
  return /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(text || '') ? text.split(', ').map(Number) : null;
}

function findLog(logId) {
  return getLogs().find(log => log.id === logId);
}

function updateLog(logId, changes) {
  const logs = getLogs();
  const log = logs.find(l => l.id === logId);
  if (!log) return;
  Object.assign(log, changes);
  // Every change to a check-in is sent to the AI System again (see syncNow)
  log.rev = (log.rev || 0) + 1;
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  syncSoon();
}

// Notes kept about a check-in's own sync; these are not changes to send
function markLog(logId, changes) {
  const logs = getLogs();
  const log = logs.find(l => l.id === logId);
  if (!log) return;
  Object.assign(log, changes);
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
}

// A task whose photo is submitted but whose patrol is still open, shown in the To-Do List
function buildInProgressTask(log) {
  const tracking = activeRoute && activeRoute.logId === log.id;
  const otherTracking = activeRoute && !tracking;
  const li = document.createElement('li');
  li.className = tracking ? 'task-item task-active task-tracking' : 'task-item task-active';
  li.innerHTML = `
    <div class="task-active-head">
      <span class="task-time">${formatSlotTime(log.time)}</span>
      <span class="task-location">${log.location}</span>
      ${tracking ? `<span class="route-recording">● ${currentLang === 'BM' ? 'Merekod' : 'Recording'}</span>` : ''}
    </div>
    <ul class="task-steps">
      <li class="task-step step-done">
        <img class="task-thumb task-thumb-small" alt="">
        <span class="step-label">${ICONS.camera} ${currentLang === 'BM' ? 'Gambar' : 'Photo'}</span>
        <span class="step-value"><span class="task-check">✓</span> ${formatClock(log.submittedAt)}</span>
      </li>
      <li class="task-step ${parseCoordinates(log.coordinates) ? 'step-done' : ''}">
        <span class="step-label">${ICONS.pin} ${currentLang === 'BM' ? 'Lokasi' : 'Location'}</span>
        <span class="step-value">${log.coordinates}</span>
      </li>
      <li class="task-step task-step-route">
        <div class="task-step-row">
          <span class="step-label">${ICONS.route} ${currentLang === 'BM' ? 'Jejak Laluan' : 'Road Track'}</span>
          <span class="step-value">${tracking
            ? `<strong id="route-distance">${formatDistance(activeRoute.distance)}</strong> • <span id="route-duration">${formatElapsed(Date.now() - activeRoute.startedAt)}</span>`
            : (currentLang === 'BM' ? 'Belum direkod' : 'Not recorded yet')}</span>
        </div>
        <div class="route-map-slot"></div>
        ${tracking && routeWarning ? `<p class="route-status route-status-warning">${routeWarning}</p>` : ''}
        ${tracking && !routeWarning ? `<p class="route-status">${currentLang === 'BM' ? 'Merekod laluan rondaan... Pastikan aplikasi kekal dibuka.' : 'Recording patrol route... Keep the app open.'}</p>` : ''}
      </li>
    </ul>
    <div class="sheet-actions">
      ${tracking ? '' : `<button type="button" class="btn btn-secondary task-finish">${currentLang === 'BM' ? 'Selesai' : 'Finish'}</button>`}
      <button type="button" class="btn task-route-toggle ${tracking ? 'btn-stop' : ''}" ${otherTracking ? 'disabled' : ''}>${tracking
        ? (currentLang === 'BM' ? 'Henti Jejak Laluan' : 'Stop Road Track')
        : (currentLang === 'BM' ? 'Mula Jejak Laluan' : 'Start Road Track')}</button>
    </div>
  `;

  loadPhoto(log.id).then(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    todoPhotoUrls.push(url);
    li.querySelector('img').src = url;
  }).catch(() => {});

  if (tracking) li.querySelector('.route-map-slot').appendChild(liveRouteMapEl);
  li.querySelector('.task-route-toggle').onclick = () => (tracking ? stopRouteTracking() : startRouteTracking(log.id));
  const finish = li.querySelector('.task-finish');
  if (finish) finish.onclick = () => finishTask(log.id);
  return li;
}

function getInProgressLogs() {
  return getLogs()
    .filter(log => log.patrolOpen)
    .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));
}

// Closes the task without a route (e.g. no patrol needed)
function finishTask(logId) {
  updateLog(logId, { patrolOpen: false });
  renderTasks();
}

// Tasks left open from an earlier shift are closed automatically
function closeStalePatrols(now = Date.now()) {
  const shiftDate = getShiftDate(new Date(now));
  const logs = getLogs();
  let changed = false;
  logs.forEach(log => {
    if (log.patrolOpen && log.date < shiftDate && !(activeRoute && activeRoute.logId === log.id)) {
      log.patrolOpen = false;
      changed = true;
    }
  });
  if (changed) localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  return changed;
}

async function startRouteTracking(logId) {
  if (activeRoute) return;
  if (!navigator.geolocation) {
    alert(currentLang === 'BM' ? 'Geolokasi tidak disokong pada peranti ini.' : 'Location is not supported on this device.');
    return;
  }
  const route = { id: `route-${Date.now().toString(36)}`, logId, startedAt: Date.now(), endedAt: null, points: [], distance: 0 };
  try {
    await saveRoute(route);
  } catch (err) {
    alert(currentLang === 'BM' ? 'Laluan tidak dapat disimpan pada peranti ini.' : 'The route could not be saved on this device.');
    return;
  }
  activeRoute = route;
  localStorage.setItem('mata_malam_active_route', route.id);
  beginRouteWatch();
}

// Starts (or resumes after a reload) GPS watching for the active route
function beginRouteWatch() {
  routeWatchId = navigator.geolocation.watchPosition(onRoutePosition, onRoutePositionError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000
  });
  requestRouteWakeLock();
  routeWarning = '';
  renderTodo();
  renderSheetRoute();
  if (!liveRouteMap) {
    liveRouteMapEl.innerHTML = '';
    liveRouteMap = drawRouteMap(liveRouteMapEl, activeRoute.points);
  }
  if (liveRouteMap) liveRouteMap.map.invalidateSize();
}

function updateRouteStats() {
  const distance = document.getElementById('route-distance');
  const duration = document.getElementById('route-duration');
  if (distance) distance.textContent = formatDistance(activeRoute.distance);
  if (duration) duration.textContent = formatElapsed(Date.now() - activeRoute.startedAt);
  renderSheetRoute();
}

// Road Track step inside the task sheet
function renderSheetRoute() {
  if (!pendingTask) return;
  const recording = activeRoute && activeRoute.logId === pendingTask.logId;
  const otherRecording = activeRoute && !recording;
  const toggle = document.getElementById('sheet-route-toggle');
  const state = document.getElementById('sheet-route-state');
  const status = document.getElementById('sheet-route-status');
  const slot = document.getElementById('sheet-route-slot');

  toggle.hidden = !!pendingTask.route;
  toggle.disabled = !!otherRecording;
  toggle.classList.toggle('btn-stop', !!recording);
  toggle.classList.toggle('btn-secondary', !recording);
  toggle.textContent = recording
    ? (currentLang === 'BM' ? 'Henti Jejak Laluan' : 'Stop Road Track')
    : (currentLang === 'BM' ? 'Mula Jejak Laluan' : 'Start Road Track');
  status.classList.toggle('route-status-warning', !!(recording && routeWarning));

  if (recording) {
    if (liveRouteMapEl.parentNode !== slot) slot.appendChild(liveRouteMapEl);
    state.innerHTML = `<span class="route-recording">● ${currentLang === 'BM' ? 'Merekod' : 'Recording'}</span> ${formatDistance(activeRoute.distance)} • ${formatElapsed(Date.now() - activeRoute.startedAt)}`;
    status.textContent = routeWarning || (currentLang === 'BM'
      ? 'Merekod laluan rondaan. Anda boleh hantar gambar sambil merekod.'
      : 'Recording patrol route. You can submit the photo while recording.');
  } else if (pendingTask.route) {
    state.textContent = `✓ ${formatDistance(pendingTask.route.distance)} • ${formatElapsed(pendingTask.route.duration)}`;
    status.textContent = '';
  } else {
    if (slot.contains(liveRouteMapEl)) liveRouteMapEl.remove();
    state.textContent = '';
    const otherLog = otherRecording ? findLog(activeRoute.logId) : null;
    const otherLabel = otherLog ? `${formatSlotTime(otherLog.time)} • ${otherLog.location}` : '';
    status.textContent = otherRecording
      ? (currentLang === 'BM'
        ? `Jejak laluan ${otherLabel} sedang direkod. Hentikannya dahulu dalam Senarai Tugasan.`
        : `The road track for ${otherLabel} is still recording. Stop it first in the To-Do List.`)
      : (currentLang === 'BM' ? 'Rekod laluan rondaan anda (pilihan sebelum hantar).' : 'Record your patrol route (optional before submitting).');
  }
}

function toggleSheetRoute() {
  if (!pendingTask) return;
  if (activeRoute && activeRoute.logId === pendingTask.logId) stopRouteTracking();
  else startRouteTracking(pendingTask.logId);
}

function onRoutePosition(position) {
  if (!activeRoute) return;
  const { latitude, longitude, accuracy } = position.coords;
  if (accuracy > ROUTE_MAX_ACCURACY_M) return;
  const point = [latitude, longitude, Date.now()];
  const last = activeRoute.points[activeRoute.points.length - 1];
  if (last) {
    const step = distanceMeters(last, point);
    if (step < ROUTE_MIN_STEP_M) return;
    activeRoute.distance += step;
  }
  activeRoute.points.push(point);
  saveRoute(activeRoute).catch(() => {});

  if (liveRouteMap) {
    const latLng = [latitude, longitude];
    liveRouteMap.line.addLatLng(latLng);
    if (!liveRouteMap.start) {
      liveRouteMap.start = routeMarker(latLng, '#3fb950').addTo(liveRouteMap.map);
      liveRouteMap.end = routeMarker(latLng, '#58a6ff').addTo(liveRouteMap.map);
      liveRouteMap.map.setView(latLng, 17);
    } else {
      liveRouteMap.end.setLatLng(latLng);
      liveRouteMap.map.panTo(latLng);
    }
  }
  if (routeWarning) {
    routeWarning = '';
    renderTodo();
  } else {
    updateRouteStats();
  }
}

function onRoutePositionError(error) {
  routeWarning = error.code === error.PERMISSION_DENIED
    ? (currentLang === 'BM' ? 'Akses lokasi ditolak. Sila benarkan lokasi untuk merekod laluan.' : 'Location access denied. Please allow location to record the route.')
    : (currentLang === 'BM' ? 'Mencari isyarat GPS...' : 'Searching for GPS signal...');
  renderTodo();
  renderSheetRoute();
}

async function stopRouteTracking({ discard = false } = {}) {
  if (routeWatchId !== null) navigator.geolocation.clearWatch(routeWatchId);
  routeWatchId = null;
  releaseRouteWakeLock();

  const route = activeRoute;
  activeRoute = null;
  routeWarning = '';
  localStorage.removeItem('mata_malam_active_route');
  if (liveRouteMap) liveRouteMap.map.remove();
  liveRouteMap = null;
  liveRouteMapEl.remove();
  liveRouteMapEl.innerHTML = '';
  if (!route) return;

  if (discard) {
    deleteRoute(route.id).catch(() => {});
    return;
  }
  route.endedAt = Date.now();
  await saveRoute(route).catch(() => {});
  // Still in the task sheet (photo not submitted yet): keep it until Submit
  if (pendingTask && pendingTask.logId === route.logId && !findLog(route.logId)) {
    pendingTask.route = { id: route.id, distance: route.distance, duration: route.endedAt - route.startedAt };
    renderSheetRoute();
    renderTodo();
    return;
  }
  // Link the route to its task and move the task to History
  updateLog(route.logId, {
    patrolOpen: false,
    routeId: route.id,
    routeDistance: Math.round(route.distance),
    routeDuration: route.endedAt - route.startedAt
  });
  renderTasks();
}

// Keeps the screen on while tracking: browsers pause GPS when the screen locks
async function requestRouteWakeLock() {
  if (!('wakeLock' in navigator) || !activeRoute || document.hidden) return;
  try {
    routeWakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    routeWakeLock = null;
  }
}

function releaseRouteWakeLock() {
  if (routeWakeLock) routeWakeLock.release().catch(() => {});
  routeWakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && activeRoute) requestRouteWakeLock();
});

// Resumes a route that was still recording when the app was closed or reloaded
async function resumeActiveRoute() {
  const id = localStorage.getItem('mata_malam_active_route');
  if (!id || !navigator.geolocation) return;
  try {
    const route = await loadRoute(id);
    const log = route && findLog(route.logId);
    if (!route || route.endedAt || !log) {
      // A route from a task sheet that was never submitted cannot be resumed
      if (route && !route.endedAt) deleteRoute(route.id).catch(() => {});
      localStorage.removeItem('mata_malam_active_route');
      return;
    }
    // A recording left running for more than 12 hours is ended at its last GPS point
    if (Date.now() - route.startedAt > 12 * 60 * 60 * 1000) {
      const last = route.points[route.points.length - 1];
      route.endedAt = last ? last[2] : route.startedAt;
      await saveRoute(route);
      localStorage.removeItem('mata_malam_active_route');
      updateLog(route.logId, {
        patrolOpen: false,
        routeId: route.id,
        routeDistance: Math.round(route.distance),
        routeDuration: route.endedAt - route.startedAt
      });
      renderTasks();
      return;
    }
    // Keep the task in the To-Do List so its Stop Road Track button is always reachable
    if (!log.patrolOpen) updateLog(log.id, { patrolOpen: true });
    activeRoute = route;
    beginRouteWatch();
  } catch (err) {}
}

// The road track of a check-in: from this phone when it was recorded here, else from the AI System
async function loadLogRoute(log) {
  if (log.routeId) {
    const local = await loadRoute(log.routeId).catch(() => null);
    if (local) return local;
  }
  const session = getSession();
  if (!log.hasRoute || !session) return null;
  const points = await rpc('mata_malam_route', { p_token: session.token, p_uid: log.id });
  return Array.isArray(points) && points.length ? { points } : null;
}

// History: shows a task's recorded route with a map and a Google Maps link
function toggleHistoryRoute(button, log) {
  const panel = button.closest('li').querySelector('.history-route-map');
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  if (panel.dataset.loaded) return;
  panel.dataset.loaded = '1';
  loadLogRoute(log).then(route => {
    if (!route) return;
    const mapEl = panel.querySelector('.route-map');
    const layers = drawRouteMap(mapEl, route.points, parseCoordinates(log.coordinates));
    if (layers) historyRouteMaps.push(layers);
    const url = getGoogleMapsUrl(route.points);
    const link = panel.querySelector('.history-route-gmaps');
    if (url) link.href = url;
    else link.hidden = true;
  }).catch(() => {});
}

function populateReportYearDropdown() {
  const logs = JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
  const yearSelect = document.getElementById('report-year-select');
  
  yearSelect.innerHTML = `<option value="" id="opt-all-years">${currentLang === 'BM' ? 'Semua Tahun' : 'All Years'}</option>`;
  
  const years = [...new Set(logs.map(log => log.date.split('-')[0]))].sort();
  years.forEach(year => {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    yearSelect.appendChild(opt);
  });
}

// The report's location filter: the current locations, plus any older one that still has logs
function populateReportLocations() {
  const select = document.getElementById('report-module-select');
  if (!select) return;
  const selected = select.value || 'ALL';
  const names = new Map(getLocations().map(l => [l.code, l.name]));
  getLogs().forEach(log => { if (log.location && !names.has(log.location)) names.set(log.location, log.location); });
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'ALL';
  all.id = 'opt-all';
  all.textContent = currentLang === 'BM' ? 'Semua Lokasi' : 'All Locations';
  select.appendChild(all);
  names.forEach((name, code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name;
    select.appendChild(opt);
  });
  select.value = [...select.options].some(o => o.value === selected) ? selected : 'ALL';
}

function generateReport() {
  const logs = JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
  const selectedMonth = document.getElementById('report-month-select').value;
  const selectedYear = document.getElementById('report-year-select').value;
  const selectedModule = document.getElementById('report-module-select').value;

  const tbody = document.getElementById('report-table-body');
  tbody.innerHTML = '';

  const filteredLogs = logs.filter(log => {
    const [year, month] = log.date.split('-');
    const matchMonth = !selectedMonth || month === selectedMonth;
    const matchYear = !selectedYear || year === selectedYear;
    const matchModule = selectedModule === 'ALL' || log.location === selectedModule;
    return matchMonth && matchYear && matchModule;
  });

  if (filteredLogs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align: center; color: var(--text-muted);">${currentLang === 'BM' ? 'Tiada rekod log ditemui.' : 'No log records found.'}</td>`;
    tbody.appendChild(tr);
    return;
  }

  filteredLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${log.location}</strong></td>
      <td class="report-guard"></td>
      <td>${log.date}</td>
      <td>${formatSlotTime(log.time)}</td>
      <td style="font-family: monospace;">${log.coordinates}</td>
      <td>${log.status === 'missed'
        ? `<span class="task-remark-missed">${currentLang === 'BM' ? 'Kerja Tidak Disiapkan' : 'Work Not Completed'}</span>`
        : (currentLang === 'BM' ? 'Selesai' : 'Completed')}</td>
    `;
    tr.querySelector('.report-guard').textContent = log.status === 'missed' ? '-' : (log.workerName || '-');
    tbody.appendChild(tr);
  });
}

function printReport() {
  window.print();
}

function handleClick() {
  syncNow({ manual: true });
}

// Language Toggle logic
let currentLang = 'EN';
function toggleLanguage() {
  currentLang = currentLang === 'EN' ? 'BM' : 'EN';
  const langBtn = document.getElementById('nav-lang');
  langBtn.textContent = `Language (${currentLang})`;

  if (currentLang === 'BM') {
    document.getElementById('nav-signout').textContent = 'Log Keluar';
    document.getElementById('signin-title').textContent = 'Log Masuk';
    document.getElementById('signin-hint').textContent = 'Masukkan PIN anda (sama seperti 555 Worker Portal).';
    document.getElementById('signin-btn').textContent = 'Masuk';
    document.getElementById('signin-lang').textContent = 'English';
    document.getElementById('th-guard').textContent = 'Pengawal';
    document.getElementById('todo-title').textContent = 'Senarai Tugasan';
    document.getElementById('done-title').textContent = 'Sejarah';
    document.getElementById('nav-done').textContent = 'Sejarah';
    document.getElementById('back-home-done').textContent = '← Kembali ke Senarai Tugasan';
    document.getElementById('sheet-cancel').textContent = 'Batal';
    document.getElementById('sheet-retake').textContent = 'Ambil Semula';
    document.getElementById('sheet-capture').textContent = 'Ambil Gambar';
    document.getElementById('sheet-lbl-photo').textContent = 'Ambil Gambar';
    document.getElementById('sheet-lbl-location').textContent = 'Lokasi';
    document.getElementById('sheet-lbl-route').textContent = 'Jejak Laluan';
    document.getElementById('sheet-submit').textContent = 'Hantar';
    document.getElementById('nav-about').textContent = 'Laporan';
    document.getElementById('nav-settings').textContent = 'Tetapan';
    document.getElementById('back-home-settings').textContent = '← Kembali ke Senarai Tugasan';
    document.getElementById('settings-title').textContent = 'Tetapan';
    document.getElementById('tab-btn-task-timing').textContent = 'Masa Tugasan';
    document.getElementById('tab-btn-location').textContent = 'Lokasi & Masa';
    document.getElementById('location-refresh-label').textContent = 'Muat Semula daripada AI System';
    document.getElementById('tab-btn-locations').textContent = 'Pin Peta';
    document.getElementById('checkpoint-hint').textContent = 'Pilih lokasi, kemudian ketik peta untuk meletakkan pin.';
    document.getElementById('checkpoint-here-label').textContent = 'Guna Lokasi Saya';
    document.getElementById('checkpoint-clear').textContent = 'Buang Pin';
    document.getElementById('checkpoint-reset').textContent = 'Set Semula';
    document.getElementById('checkpoint-save').textContent = 'Simpan Perubahan';
    document.getElementById('slot-add-label').textContent = 'Tambah Masa';
    document.getElementById('schedule-reset').textContent = 'Set Semula';
    document.getElementById('schedule-save').textContent = 'Simpan Perubahan';
    document.getElementById('label-opens-before').textContent = 'Dipaparkan awal';
    document.getElementById('label-window').textContent = 'Had masa';
    document.getElementById('settings-reset').textContent = 'Set Semula';
    document.getElementById('settings-save').textContent = 'Simpan';
    document.getElementById('footer-rights').textContent = 'Hak cipta terpelihara.';
    document.getElementById('footer-version-label').textContent = 'Versi';
    document.getElementById('update-banner-text').textContent = 'Versi baharu tersedia.';
    document.getElementById('update-banner-btn').textContent = 'Kemas Kini';
    
    // Report text translation
    document.getElementById('report-title').textContent = 'Laporan Log';
    document.getElementById('report-desc').textContent = 'Tapis entri log yang dihantar mengikut bulan, tahun, dan pilihan lokasi.';
    document.getElementById('btn-print').textContent = 'Cetak Laporan';
    document.getElementById('label-report-month').textContent = 'Pilih Bulan';
    document.getElementById('label-report-year').textContent = 'Pilih Tahun';
    document.getElementById('label-report-module').textContent = 'Pilih Lokasi';
    document.getElementById('opt-all-months').textContent = 'Semua Bulan';
    document.getElementById('opt-all-years').textContent = 'Semua Tahun';
    document.getElementById('opt-all').textContent = 'Semua Lokasi';
    document.getElementById('th-location').textContent = 'Lokasi';
    document.getElementById('th-date').textContent = 'Tarikh';
    document.getElementById('th-timeslot').textContent = 'Slot Masa';
    document.getElementById('th-coordinates').textContent = 'Koordinat';
    document.getElementById('th-status').textContent = 'Status';
  } else {
    document.getElementById('nav-signout').textContent = 'Sign Out';
    document.getElementById('signin-title').textContent = 'Sign In';
    document.getElementById('signin-hint').textContent = 'Enter your PIN (the same one as the 555 Worker Portal).';
    document.getElementById('signin-btn').textContent = 'Enter';
    document.getElementById('signin-lang').textContent = 'Bahasa Melayu';
    document.getElementById('th-guard').textContent = 'Guard';
    document.getElementById('todo-title').textContent = 'To-Do List';
    document.getElementById('done-title').textContent = 'History';
    document.getElementById('nav-done').textContent = 'History';
    document.getElementById('back-home-done').textContent = '← Back to To-Do List';
    document.getElementById('sheet-cancel').textContent = 'Cancel';
    document.getElementById('sheet-retake').textContent = 'Retake';
    document.getElementById('sheet-capture').textContent = 'Capture';
    document.getElementById('sheet-lbl-photo').textContent = 'Take Photo';
    document.getElementById('sheet-lbl-location').textContent = 'Location';
    document.getElementById('sheet-lbl-route').textContent = 'Road Track';
    document.getElementById('sheet-submit').textContent = 'Submit';
    document.getElementById('nav-about').textContent = 'Report';
    document.getElementById('nav-settings').textContent = 'Settings';
    document.getElementById('back-home-settings').textContent = '← Back to To-Do List';
    document.getElementById('settings-title').textContent = 'Settings';
    document.getElementById('tab-btn-task-timing').textContent = 'Task Timing';
    document.getElementById('tab-btn-location').textContent = 'Location & Time';
    document.getElementById('location-refresh-label').textContent = 'Refresh from AI System';
    document.getElementById('tab-btn-locations').textContent = 'Map Pins';
    document.getElementById('checkpoint-hint').textContent = 'Choose a location, then tap the map to place its pin.';
    document.getElementById('checkpoint-here-label').textContent = 'Use My Location';
    document.getElementById('checkpoint-clear').textContent = 'Remove Pin';
    document.getElementById('checkpoint-reset').textContent = 'Reset';
    document.getElementById('checkpoint-save').textContent = 'Save Changes';
    document.getElementById('slot-add-label').textContent = 'Add Time';
    document.getElementById('schedule-reset').textContent = 'Reset';
    document.getElementById('schedule-save').textContent = 'Save Changes';
    document.getElementById('label-opens-before').textContent = 'Appears early';
    document.getElementById('label-window').textContent = 'Time limit';
    document.getElementById('settings-reset').textContent = 'Reset';
    document.getElementById('settings-save').textContent = 'Save';
    document.getElementById('footer-rights').textContent = 'All rights reserved.';
    document.getElementById('footer-version-label').textContent = 'Version';
    document.getElementById('update-banner-text').textContent = 'A new version is available.';
    document.getElementById('update-banner-btn').textContent = 'Update';

    // Report text translation
    document.getElementById('report-title').textContent = 'Log Reports';
    document.getElementById('report-desc').textContent = 'Filter submitted log entries by month, year, and location selection.';
    document.getElementById('btn-print').textContent = 'Print Report';
    document.getElementById('label-report-month').textContent = 'Select Month';
    document.getElementById('label-report-year').textContent = 'Select Year';
    document.getElementById('label-report-module').textContent = 'Select Location';
    document.getElementById('opt-all-months').textContent = 'All Months';
    document.getElementById('opt-all-years').textContent = 'All Years';
    document.getElementById('opt-all').textContent = 'All Locations';
    document.getElementById('th-location').textContent = 'Location';
    document.getElementById('th-date').textContent = 'Date';
    document.getElementById('th-timeslot').textContent = 'Time Slot';
    document.getElementById('th-coordinates').textContent = 'Coordinates';
    document.getElementById('th-status').textContent = 'Status';
  }
  renderTasks();
  updateSettingsPreview();
  renderLocationSettings();
  applySettingsAccess();
  renderSyncStatus();
  renderCheckpointPicker();
  drawSiteOutlines();
}

// ───────────────────────── Link to the MJM AI System ─────────────────────────
// The guard signs in with the PIN on their row of the payroll register (the same door as the
// 555 Worker Portal). The phone holds a token and nothing else: every read and write below is a
// database function that turns the token back into a worker first. Check-ins are always saved on
// the phone first and sent from there, so the app works the same with no signal.

function getSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_session'));
    if (saved && saved.token && saved.worker && saved.worker.name) return saved;
  } catch (err) {}
  return null;
}

function canEditSettings() {
  const session = getSession();
  return !!(session && session.canEdit);
}

// A call that never answers must end that call, not the sync
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(name, body, timeoutMs = 20000) {
  const response = await fetchWithTimeout(`${AI_SYSTEM_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: AI_SYSTEM_KEY, Authorization: `Bearer ${AI_SYSTEM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }, timeoutMs);
  if (!response.ok) {
    let detail = {};
    try { detail = await response.json(); } catch (err) {}
    const error = new Error(detail.message || `HTTP ${response.status}`);
    error.refused = true;            // the AI System answered, and said no
    error.code = detail.code || '';
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function showSignIn(message = '') {
  document.body.classList.add('signed-out');
  document.getElementById('signin-page').hidden = false;
  document.getElementById('signin-message').textContent = message;
  document.getElementById('signin-pin').value = '';
}

async function signIn(event) {
  event.preventDefault();
  const message = document.getElementById('signin-message');
  const button = document.getElementById('signin-btn');
  const pin = document.getElementById('signin-pin').value.trim();
  const bm = currentLang === 'BM';
  if (!pin) {
    message.textContent = bm ? 'Masukkan PIN anda.' : 'Enter your PIN.';
    return;
  }
  button.disabled = true;
  message.textContent = bm ? 'Menyemak…' : 'Checking…';
  try {
    const who = await rpc('worker_signin', { p_pin: pin });
    if (!who || !who.token || !who.worker || !who.worker.name) throw new Error(bm ? 'Jawapan tidak sah. Cuba lagi.' : 'The answer was not a sign-in. Try again.');
    localStorage.setItem('mata_malam_session', JSON.stringify({
      token: who.token,
      worker: { id: who.worker.id, name: who.worker.name, role: who.worker.role || '' },
      canEdit: false
    }));
    document.getElementById('signin-page').hidden = true;
    document.body.classList.remove('signed-out');
    enterApp();
  } catch (err) {
    if (err.refused) {
      message.textContent = /PIN not recognised/i.test(err.message)
        ? (bm ? 'PIN tidak dikenali.' : 'PIN not recognised.')
        : err.message;
    } else {
      message.textContent = bm
        ? 'Tidak dapat menghubungi AI System. Log masuk kali pertama memerlukan isyarat.'
        : 'Could not reach the AI System. Signing in for the first time needs a signal.';
    }
  } finally {
    button.disabled = false;
  }
}

function signOut() {
  const session = getSession();
  const waiting = pendingLogs().length;
  const bm = currentLang === 'BM';
  if (activeRoute) {
    alert(bm ? 'Hentikan jejak laluan dahulu.' : 'Stop the road track first.');
    return;
  }
  const question = waiting
    ? (bm ? `${waiting} rekod belum dihantar. Ia kekal pada telefon ini dan dihantar apabila anda log masuk semula. Log keluar?`
          : `${waiting} check-in(s) are not sent yet. They stay on this phone and are sent when you sign in again. Sign out?`)
    : (bm ? 'Log keluar?' : 'Sign out?');
  if (!confirm(question)) return;
  if (session && !session.fromPortal) rpc('worker_signout', { p_token: session.token }, 8000).catch(() => {});
  localStorage.removeItem('mata_malam_session');
  showSignIn();
}

// Opened from the 555 Worker Portal's Mata Malam button: the portal hands over its PIN session in
// the address (#wt=<token>), so the guard is not asked for the PIN a second time. The token is
// taken out of the address at once, and is only believed after the AI System has said whose it is.
function takeHandedToken() {
  const match = /[#&]wt=([^&]+)/.exec(location.hash || '');
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const token = decodeURIComponent(match[1]);
  return /^[0-9a-fA-F-]{36}$/.test(token) ? token : null;
}

async function startSession() {
  const handed = takeHandedToken();
  const current = getSession();
  if (handed && !(current && current.token === handed)) {
    try {
      const who = await rpc('worker_whoami', { p_token: handed });
      if (who && who.token && who.worker && who.worker.name) {
        // fromPortal: the session is the Worker Portal's too, so signing out here must not end it there
        localStorage.setItem('mata_malam_session', JSON.stringify({
          token: who.token,
          worker: { id: who.worker.id, name: who.worker.name, role: who.worker.role || '' },
          canEdit: false,
          fromPortal: true
        }));
      }
    } catch (err) {
      // No signal: carry on with whoever was already signed in on this phone, if anybody
    }
  }
  if (!getSession()) {
    showSignIn();
    return;
  }
  enterApp();
}

// The guard's name, and Sign Out only for somebody who signed in HERE with a PIN. A guard who came
// in from the 555 Worker Portal is signed in there: that is where they sign out, and coming in
// again as somebody else replaces whoever was here.
function renderUser() {
  const session = getSession();
  document.getElementById('nav-user').textContent = session ? session.worker.name : '';
  document.getElementById('nav-signout').hidden = !session || !!session.fromPortal;
  // Settings is only for the people who may change it; everybody else has nothing to do there
  const settingsLink = document.getElementById('nav-settings');
  (settingsLink.closest('li') || settingsLink).hidden = !canEditSettings();
  if (!canEditSettings() && document.getElementById('settings-module-page').style.display === 'block') showHomePage();
}

function enterApp() {
  const session = getSession();
  renderUser();
  renderTasks();
  renderSyncStatus();
  resumeActiveRoute();
  syncNow();
}

// Only people the office allows may change the locations and times; everybody else reads them
function applySettingsAccess() {
  const page = document.getElementById('settings-module-page');
  if (!page) return;
  const allowed = canEditSettings();
  page.classList.toggle('settings-readonly', !allowed);
  page.querySelectorAll('#tab-task-timing input, #slot-list select').forEach(el => { el.disabled = !allowed; });
  document.getElementById('settings-readonly-note').hidden = allowed;
  const who = getSession() ? getSession().worker : null;
  const as = who ? `${who.name}${who.role ? ` (${who.role})` : ''}` : '';
  document.getElementById('settings-readonly-note').textContent = currentLang === 'BM'
    ? `Anda log masuk sebagai ${as}. Hanya Admin, Pengurus Estet atau Field Conductor boleh mengubah masa dan lokasi, jadi Tambah Masa dan Simpan tidak dipaparkan.`
    : `You are signed in as ${as}. Only an Admin, Estate Manager or Field Conductor can change the times and locations, so Add Time and Save are not shown.`;
}

function denySettingsEdit(messageEl) {
  if (canEditSettings()) return false;
  messageEl.style.color = 'var(--error-color)';
  messageEl.textContent = currentLang === 'BM' ? 'Anda tidak dibenarkan mengubah tetapan.' : 'You are not allowed to change the settings.';
  return true;
}

// The whole configuration as the AI System stores it: every location with its switch and its times
function buildSettingsPayload() {
  const locations = {};
  getLocations().forEach(({ code }) => {
    locations[code] = { active: isLocationActive(code), slots: getTaskSlots(code) };
  });
  return { locations, timing: getTaskSettings() };
}

function settingsChanged() {
  localStorage.setItem('mata_malam_settings_dirty', '1');
  syncSoon();
}

// Takes the company's settings from the AI System onto this phone
function applyRemoteSettings(settings, stamp) {
  if (!settings || typeof settings !== 'object') return;
  const before = JSON.stringify(buildSettingsPayload());
  const next = {};
  Object.entries(settings.locations || {}).forEach(([code, value]) => {
    if (!value || typeof value !== 'object') return;
    next[code] = {
      ...(typeof value.active === 'boolean' ? { active: value.active } : {}),
      ...(isSlotList(value.slots) ? { slots: sortSlots(value.slots) } : {})
    };
  });
  const timing = settings.timing;
  const timingOk = timing && validateTaskSettings(timing) === null;
  // Settle what was missed under the old times before they change, then count misses from now
  recordMissedTasks();
  localStorage.setItem('mata_malam_location_settings', JSON.stringify(next));
  if (timingOk) localStorage.setItem('mata_malam_task_settings', JSON.stringify({ opensBeforeMinutes: timing.opensBeforeMinutes, windowMinutes: timing.windowMinutes }));
  localStorage.setItem('mata_malam_settings_at', stamp || '');
  if (JSON.stringify(buildSettingsPayload()) !== before) {
    localStorage.setItem('mata_malam_tracking_start', String(Date.now()));
  }
}

// Check-ins made on this phone by this guard that the AI System has not got yet (or not the latest of)
function pendingLogs() {
  const session = getSession();
  return getLogs().filter(log =>
    log.status === 'completed' && log.id && !log.remote &&
    (log.rev || 0) !== log.syncedRev &&
    (!log.workerId || (session && log.workerId === session.worker.id)));
}

async function uploadLogPhoto(session, log) {
  const blob = await loadPhoto(log.id).catch(() => null);
  if (!blob) return null;
  const ticket = await rpc('mata_malam_photo_ticket', { p_token: session.token });
  const path = `mata_malam_photos/${ticket}/${log.id}.jpg`;
  const response = await fetchWithTimeout(`${AI_SYSTEM_URL}/storage/v1/object/documents/${path}`, {
    method: 'POST',
    headers: { apikey: AI_SYSTEM_KEY, Authorization: `Bearer ${AI_SYSTEM_KEY}`, 'Content-Type': 'image/jpeg' },
    body: blob
  }, 45000);
  rpc('worker_photo_done', { p_token: session.token, p_ticket: ticket }, 8000).catch(() => {});
  if (!response.ok) throw new Error(`photo upload HTTP ${response.status}`);
  const url = `${AI_SYSTEM_URL}/storage/v1/object/public/documents/${path}`;
  // Remembered at once, so a send that fails after this does not upload the picture again
  markLog(log.id, { photoUrl: url });
  return url;
}

async function pushLog(session, log) {
  const rev = log.rev || 0;
  const photoUrl = log.photoUrl || await uploadLogPhoto(session, log);
  let route = null;
  if (log.routeId) {
    const saved = await loadRoute(log.routeId).catch(() => null);
    if (saved && Array.isArray(saved.points)) route = saved.points;
  }
  await rpc('mata_malam_submit', {
    p_token: session.token,
    p_log: {
      id: log.id, location: log.location, date: log.date, time: log.time,
      coordinates: log.coordinates, submittedAt: log.submittedAt, photoUrl,
      patrolOpen: !!log.patrolOpen, route,
      routeDistance: log.routeDistance == null ? null : log.routeDistance,
      routeDuration: log.routeDuration == null ? null : log.routeDuration
    }
  }, 30000);
  markLog(log.id, { syncedRev: rev, syncError: '' });
}

// Adds check-ins made on other phones, so a task one guard has done is done for everybody
function mergeRemoteLogs(remoteLogs) {
  const logs = getLogs();
  let changed = false;
  (remoteLogs || []).forEach(remote => {
    if (!remote || !remote.id) return;
    const mine = logs.find(l => l.id === remote.id);
    if (mine) {
      if (!mine.workerName && remote.workerName) { mine.workerName = remote.workerName; mine.workerId = remote.workerId; changed = true; }
      if (!mine.photoUrl && remote.photoUrl) { mine.photoUrl = remote.photoUrl; changed = true; }
      return;
    }
    // A task this phone had written off as not done was done on another phone
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (l.status === 'missed' && l.location === remote.location && l.date === remote.date && l.time === remote.time) logs.splice(i, 1);
    }
    logs.push({ ...remote, patrolOpen: false, remote: true, rev: 0, syncedRev: 0 });
    changed = true;
  });
  if (changed) localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  return changed;
}

let syncing = false;
let syncStartedAt = 0;
let syncTimer = null;
let syncState = '';   // '', 'working', 'offline'

function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), 1500);
}

async function syncNow({ manual = false } = {}) {
  const session = getSession();
  if (!session) return;
  // A sync that has been running longer than any sync can is taken over rather than waited on
  if (syncing && Date.now() - syncStartedAt < 5 * 60 * 1000) return;
  syncing = true;
  syncStartedAt = Date.now();
  syncState = 'working';
  locationSyncState = 'loading';
  renderSyncStatus();
  renderLocationSettings();
  let reached = false;
  let signedOut = false;
  try {
    // 1. Settings changed on this phone go up first, so the pull below does not undo them
    if (localStorage.getItem('mata_malam_settings_dirty') && session.canEdit) {
      try {
        const saved = await rpc('mata_malam_save_settings', { p_token: session.token, p_settings: buildSettingsPayload() });
        localStorage.removeItem('mata_malam_settings_dirty');
        localStorage.setItem('mata_malam_settings_at', (saved && saved.settings_at) || '');
        reached = true;
      } catch (err) {
        if (err.refused && err.code === '28000') throw err;
        if (err.refused) localStorage.removeItem('mata_malam_settings_dirty');
      }
    }

    // 2. Check-ins, one at a time: one that fails waits for the next sync, the rest carry on
    for (const log of pendingLogs()) {
      if (log.syncError && !manual) continue;
      try {
        await pushLog(session, log);
        reached = true;
      } catch (err) {
        if (err.refused && err.code === '28000') throw err;
        if (err.refused) markLog(log.id, { syncError: err.message });
      }
      renderSyncStatus();
    }

    // 3. The company's locations, settings and everybody's check-ins come down
    const state = await rpc('mata_malam_state', { p_token: session.token });
    reached = true;
    if (state && state.worker) {
      localStorage.setItem('mata_malam_session', JSON.stringify({
        token: session.token,
        worker: { id: state.worker.id, name: state.worker.name, role: state.worker.role || '' },
        canEdit: !!state.can_edit,
        ...(session.fromPortal ? { fromPortal: true } : {})
      }));
      const seen = new Set();
      const list = [];
      (state.locations || []).forEach(name => {
        const code = locationCode(name);
        if (!code || seen.has(code)) return;
        seen.add(code);
        list.push({ code, name: String(name).trim() });
      });
      const dirty = !!localStorage.getItem('mata_malam_settings_dirty');
      if (list.length) {
        const before = JSON.stringify(getActiveLocations());
        recordMissedTasks();
        localStorage.setItem('mata_malam_locations', JSON.stringify({ list, syncedAt: Date.now() }));
        if (JSON.stringify(getActiveLocations()) !== before) localStorage.setItem('mata_malam_tracking_start', String(Date.now()));
      }
      if (state.settings_at) {
        if (!dirty && state.settings_at !== localStorage.getItem('mata_malam_settings_at')) applyRemoteSettings(state.settings, state.settings_at);
      } else if (state.can_edit) {
        // Nobody has saved the company's settings yet: this phone's become them
        localStorage.setItem('mata_malam_settings_dirty', '1');
        syncSoon();
      }
      mergeRemoteLogs(state.logs);
      localStorage.setItem('mata_malam_last_sync', String(Date.now()));
    }
    syncState = '';
    locationSyncState = 'ok';
  } catch (err) {
    if (err.refused && err.code === '28000') signedOut = true;
    syncState = reached || err.refused ? '' : 'offline';
    locationSyncState = 'failed';
  } finally {
    syncing = false;
  }

  if (signedOut) {
    localStorage.removeItem('mata_malam_session');
    showSignIn(currentLang === 'BM' ? 'Sesi anda telah tamat. Sila log masuk semula.' : 'Your session has ended. Please sign in again.');
    return;
  }
  renderUser();
  renderTasks();
  renderLocationSettings();
  renderScheduleLocations();
  populateReportLocations();
  applySettingsAccess();
  renderSyncStatus();
  if (manual && document.getElementById('report-module-page').style.display === 'block') generateReport();
}

function renderSyncStatus() {
  const button = document.getElementById('hero-btn');
  const status = document.getElementById('sync-status');
  if (!button || !status) return;
  const bm = currentLang === 'BM';
  const waiting = pendingLogs().length;
  const stuck = pendingLogs().filter(l => l.syncError).length;
  const last = Number(localStorage.getItem('mata_malam_last_sync'));
  button.disabled = syncState === 'working';
  button.textContent = syncState === 'working' ? (bm ? 'Menyelaras…' : 'Synchronizing…') : (bm ? 'Selaraskan Data' : 'Synchronize Data');
  const parts = [];
  if (syncState === 'offline') parts.push(bm ? 'Tiada isyarat — disimpan pada telefon ini' : 'No signal — saved on this phone');
  if (waiting) parts.push(bm ? `${waiting} belum dihantar` : `${waiting} waiting to send`);
  if (stuck) parts.push(bm ? `${stuck} ditolak` : `${stuck} refused`);
  if (!waiting && syncState !== 'offline' && last) parts.push(bm ? 'Semua dihantar' : 'All sent');
  if (last) parts.push(`${bm ? 'Selaras terakhir' : 'Last synced'} ${formatClock(last)}`);
  status.textContent = parts.join(' • ');
  status.classList.toggle('sync-status-warn', syncState === 'offline' || waiting > 0);
}

window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
setInterval(() => syncNow(), 3 * 60 * 1000);

// Update check: phones often keep an old copy of the page open (or cached), so the app asks the
// server which version is live and reloads itself when a newer one has been published.
let pendingUpdateVersion = null;

async function checkForUpdate() {
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const { version } = await response.json();
    if (!version || version === APP_VERSION) return;
    // Already reloaded for this version once: don't loop if the files are out of step
    if (new URL(location.href).searchParams.get('v') === version) return;
    pendingUpdateVersion = version;
    // Don't interrupt a task in progress or a road track being recorded
    const busy = activeRoute || !document.getElementById('submit-sheet').hidden;
    if (busy) {
      document.getElementById('update-banner').hidden = false;
    } else {
      applyUpdate();
    }
  } catch (err) {}
}

function applyUpdate() {
  if (!pendingUpdateVersion) return;
  if (activeRoute && !confirm(currentLang === 'BM'
    ? 'Jejak laluan sedang direkod. Ia akan disambung semula selepas kemas kini. Teruskan?'
    : 'A road track is recording. It will resume after the update. Continue?')) return;
  // A new URL makes the browser fetch the latest page instead of its cached copy
  const url = new URL(location.href);
  url.searchParams.set('v', pendingUpdateVersion);
  location.replace(url.toString());
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForUpdate();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) checkForUpdate();
});
setInterval(checkForUpdate, 5 * 60 * 1000);

// Initialize state on load
window.onload = function() {
  document.getElementById('app-version').textContent = APP_VERSION;
  checkForUpdate();
  startSession();
};

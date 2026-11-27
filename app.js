// App version: keep in step with version.json and the ?v= tags in index.html when publishing
const APP_VERSION = '2026-11-27e';

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
  document.getElementById('nav-home').hidden = true;
  renderTasks();
  window.scrollTo(0, 0);
}

function showDonePage() {
  if (!can('history')) { showHomePage(); return; }
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('done-module-page').style.display = 'block';
  document.getElementById('nav-home').hidden = false;
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
  document.getElementById('nav-home').hidden = false;
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
  if (!can('report')) { showHomePage(); return; }
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('report-module-page').style.display = 'block';
  document.getElementById('nav-home').hidden = false;
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { crossOrigin: true,
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
// A location can have several pins (a gate, a pump house, a store), placed by the office on
// System Setting > Mata Malam. The distance shown is to the NEAREST of that location's pins, by name.
function getLocationPins(location) {
  let list = [];
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_pins'));
    if (Array.isArray(saved)) list = saved;
  } catch (err) {}
  const mine = list.filter(p => p && p.location === location && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (mine.length) return mine;
  // A pin placed on this phone before the office kept them
  const old = getCheckpoints()[location];
  return Array.isArray(old) ? [{ name: `${location} pin`, location, lat: old[0], lng: old[1] }] : [];
}

// ONE TASK A CHECK-IN TIME, AND ITS PINS ARE INSIDE IT. The office pins as many places as a
// location has (System Setting > Mata Malam > Map pins). The To-Do List shows ONE task for the
// location at each time; opening it shows a map with the boundary and every pin, and the guard
// goes to each pin and takes one photo there. A check-in record still belongs to one pin (its
// "point" is the pin's name), so the office sees which pins were visited. A location nobody has
// pinned has one check-in a time, with no point, exactly as before.
function getTaskPoints(location) {
  const names = [];
  getLocationPins(location).forEach(pin => {
    const name = String(pin.name || '').trim();
    if (name && !names.includes(name)) names.push(name);
  });
  return names.length ? names : [''];
}
// A record with no point is from before the pins were tasks (or a location with no pin): it stands
// for the whole location at that time, so it answers every point and nothing is marked missed twice
function logCoversPoint(log, point) {
  return !log.point || !point || log.point === point;
}
function escapeText(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function pointSuffix(point) {
  return point ? ` <span class="task-point">${escapeText(point)}</span>` : '';
}

function describeCheckpointDistance(location, coordText, point = '') {
  const here = parseCoordinates(coordText);
  let pins = getLocationPins(location);
  // A task is for one pin, so the distance is to THAT pin and not to whichever is nearest
  if (point && pins.some(pin => pin.name === point)) pins = pins.filter(pin => pin.name === point);
  if (!pins.length || !here) return '';
  let nearest = null;
  pins.forEach(pin => {
    const meters = distanceMeters(here, [pin.lat, pin.lng]);
    if (!nearest || meters < nearest.meters) nearest = { meters, name: pin.name || location };
  });
  return currentLang === 'BM'
    ? `${formatDistance(nearest.meters)} dari ${nearest.name}`
    : `${formatDistance(nearest.meters)} from ${nearest.name}`;
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

// The locations this worker is filed under on the Worker Namelist (mata_malam_my_locations).
// No answer, an Others worker, or one filed under no location: every location.
function myLocationScope() {
  const s = getSession();
  return s && Array.isArray(s.myLocations) ? s.myLocations.map(locationCode) : null;
}
function isMyLocation(code) {
  const scope = myLocationScope();
  return !scope || scope.includes(locationCode(code));
}

// Codes of the locations that get check-in tasks, in display order: only this worker own
function getActiveLocations() {
  return getLocations().map(l => l.code).filter(isLocationActive).filter(isMyLocation);
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
  const schedule = getActiveLocations().map(location => ({ location, times: getTaskTimes(location), points: getTaskPoints(location) }));
  const logs = getLogs();
  let changed = false;

  for (let i = 31; i >= 0; i--) {
    const date = getShiftDate(new Date(now - i * DAY_MS));
    schedule.forEach(({ location, times, points }) => {
      times.forEach(time => {
        const { closesAt } = getTaskWindow(date, time, settings);
        if (closesAt > now || closesAt <= trackingStart) return;
        points.forEach(point => {
          if (logs.some(l => l.date === date && l.time === time && l.location === location && logCoversPoint(l, point))) return;
          logs.push({ location, ...(point ? { point } : {}), date, time, coordinates: '-', status: 'missed', recordedAt: new Date(closesAt).toISOString() });
          changed = true;
        });
      });
    });
  }

  if (changed) localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  return changed;
}

// History: a check-in photo, full screen. A tap anywhere, the cross or Esc closes it.
function openPhotoViewer(src, alt) {
  let box = document.getElementById('photo-viewer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'photo-viewer';
    box.className = 'photo-viewer';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<button type="button" class="photo-viewer-close" aria-label="Close">✕</button><img alt="">';
    box.onclick = closePhotoViewer;
    document.body.appendChild(box);
  }
  const img = box.querySelector('img');
  img.src = src;
  img.alt = alt || '';
  box.hidden = false;
  box.querySelector('.photo-viewer-close').focus();
}

function closePhotoViewer() {
  const box = document.getElementById('photo-viewer');
  if (box) box.hidden = true;
}

// A check-in made while Capture photo was off has no picture: a tick, never a broken image
function noPhotoThumb(img) {
  const mark = document.createElement('span');
  mark.className = 'task-thumb task-thumb-none';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '✓';
  img.replaceWith(mark);
}

function getShiftTasks(date) {
  const logs = getLogs().filter(log => log.date === date);
  const settings = getTaskSettings();
  const tasks = [];
  getActiveLocations().forEach(location => {
    const points = getTaskPoints(location);
    getTaskTimes(location).forEach(time => {
      points.forEach((point, order) => {
        const log = logs.find(l => l.location === location && l.time === time && logCoversPoint(l, point));
        tasks.push({ location, point, order, time, date, log, ...getTaskWindow(date, time, settings) });
      });
    });
  });
  // Each location has its own times, so put the whole shift in clock order, a location's pins together
  return tasks.sort((a, b) => a.scheduledAt - b.scheduledAt || locationOrder(a.location) - locationOrder(b.location) || a.order - b.order);
}

function renderTasks() {
  recordMissedTasks();
  closeStalePatrols();
  renderTodo();
  renderHistory();
}

// A small picture beside every task time, so the list is not a column of bare numbers:
// sunrise 05:00-06:59, sun 07:00-17:59, sunset 18:00-19:59, moon and stars for the night
const TIME_ICONS = {
  sunrise: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 17a7 7 0 0 1 14 0z" fill="#ffb347"/><g stroke="#ffb347" stroke-width="2" stroke-linecap="round"><path d="M12 4v3M4.6 8.6l2 2M19.4 8.6l-2 2"/></g><path d="M2 20h20" stroke="#ff8a5c" stroke-width="2" stroke-linecap="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>',
  sunset: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 16a7 7 0 0 1 14 0z" fill="#ff8a5c"/><path d="M2 16h20" stroke="#ff8a5c" stroke-width="2" stroke-linecap="round"/><path d="M6 20h12" stroke="#ffb38a" stroke-width="2" stroke-linecap="round"/><g stroke="#ff8a5c" stroke-width="2" stroke-linecap="round"><path d="M12 3.5v3M5 7.5l2 2M19 7.5l-2 2"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19 14.5A8 8 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="#ffd866"/><path d="M17 3l.7 1.8L19.5 5.5l-1.8.7L17 8l-.7-1.8-1.8-.7 1.8-.7z" fill="#c9b8ff"/><circle cx="21" cy="10" r="1" fill="#c9b8ff"/></svg>'
};

function timePeriod(label) {
  const offset = parseSlotLabel(label);
  if (Number.isNaN(offset)) return 'moon';
  const hour = Math.floor(offset / 60) % 24;
  if (hour >= 5 && hour < 7) return 'sunrise';
  if (hour >= 7 && hour < 18) return 'sun';
  if (hour >= 18 && hour < 20) return 'sunset';
  return 'moon';
}

// The picture and the time together, for inside a .task-time
function timeBadge(label) {
  const period = timePeriod(label);
  return `<span class="time-chip time-${period}">${TIME_ICONS[period]}</span>${formatSlotTime(label)}`;
}

function renderTodo(now = Date.now()) {
  const date = getShiftDate(new Date(now));
  const tasks = getShiftTasks(date);
  // Include the previous shift too, in case an early-morning window runs past the noon changeover
  const candidates = getShiftTasks(getShiftDate(new Date(now - DAY_MS))).concat(tasks);
  const due = candidates.filter(task => !task.log && task.opensAt <= now && now < task.closesAt);
  const next = candidates.find(task => !task.log && now < task.opensAt);
  // Counted by task as the guard sees it: a location's pins at one time are ONE task, done when all are
  const shiftRounds = groupRounds(tasks);
  const completed = shiftRounds.filter(r => r.tasks.every(task => task.log && task.log.status !== 'missed')).length;
  const inProgress = getInProgressLogs();

  document.getElementById('todo-meta').textContent = `${date} • ${completed} / ${shiftRounds.length} ${currentLang === 'BM' ? 'selesai' : 'done'}`;

  todoPhotoUrls.forEach(url => URL.revokeObjectURL(url));
  todoPhotoUrls = [];
  const todoList = document.getElementById('todo-list');
  if (liveRouteMapEl.closest('#todo-list')) liveRouteMapEl.remove();
  todoList.innerHTML = '';
  if (!can('home')) {
    // Switched off in the office for this person's column: said in words, never an empty list
    const closed = !moduleOpen()
      ? (currentLang === 'BM' ? 'Mata Malam tidak dibuka untuk akaun anda. Sila hubungi pejabat.' : 'Mata Malam is not open for your account. Please ask the office.')
      : (currentLang === 'BM' ? 'Tugasan daftar masuk tidak dibuka untuk akaun anda.' : 'Check-in tasks are not open for your account.');
    document.getElementById('todo-meta').textContent = '';
    todoList.insertAdjacentHTML('beforeend', `<li class="task-empty" id="todo-closed">${closed}</li>`);
    return;
  }
  inProgress.forEach(log => todoList.appendChild(buildInProgressTask(log)));

  // A pinned location's task stays while its road track is still recording, so Stop is always reachable
  const dueRounds = groupRounds(due.filter(task => task.point));
  if (activeRoute && activeRoute.round && !dueRounds.some(r => roundKey(r) === roundKey(activeRoute.round))) {
    const r = activeRoute.round;
    dueRounds.unshift({ location: r.location, date: r.date, time: r.time, tasks: [] });
  }
  const dueSingles = due.filter(task => !task.point);

  if (dueRounds.length + dueSingles.length === 0) {
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

  dueRounds.forEach((round, index) => {
    const all = roundTasks(round);
    const done = all.filter(task => task.log && task.log.status !== 'missed').length;
    const closesAt = all.length ? all[0].closesAt : now;
    const minutesLeft = Math.max(1, Math.ceil((closesAt - now) / 60000));
    const recording = roundRecording(round);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === 0 ? 'task-item task-next task-round' : 'task-item task-round';
    btn.dataset.round = roundKey(round);
    btn.onclick = () => openRoundSheet(round);
    // The same in both languages: a pin mark and the count, on one line, so the badge is one shape
    const pinsLine = `📍 ${done}/${all.length}`;
    // Few words: the whole card is the button, so it says only how long is left
    const deadline = now < closesAt
      ? (currentLang === 'BM' ? `${minutesLeft} min lagi` : `${minutesLeft} min left`)
      : (currentLang === 'BM' ? 'Jejak laluan masih merekod' : 'Road track still recording');
    // The whole card is the button. One line: the place, its pins, and how long is left beside them
    btn.innerHTML = `
      <span class="task-time">${timeBadge(round.time)}</span>
      <span class="task-location task-stack"><span class="task-line">${round.location} <span class="task-point">${pinsLine}</span></span><span class="task-left">${deadline}</span></span>
      ${recording ? `<span class="task-action"><span class="route-recording">● ${currentLang === 'BM' ? 'Merekod' : 'Recording'}</span></span>` : ''}
    `;
    li.appendChild(btn);
    todoList.appendChild(li);
  });

  dueSingles.forEach((task, index) => {
    const minutesLeft = Math.max(1, Math.ceil((task.closesAt - now) / 60000));
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === 0 && !dueRounds.length ? 'task-item task-next' : 'task-item';
    btn.onclick = () => startTask(task);
    btn.innerHTML = `
      <span class="task-time">${timeBadge(task.time)}</span>
      <span class="task-location task-stack"><span class="task-line">${task.location}</span>
        <span class="task-left">${currentLang === 'BM' ? `${minutesLeft} min lagi` : `${minutesLeft} min left`}</span>
      </span>
    `;
    li.appendChild(btn);
    todoList.appendChild(li);
  });
}

function renderHistory(now = Date.now()) {
  const dates = [];
  for (let i = 0; i < HISTORY_SHIFTS; i++) dates.push(getShiftDate(new Date(now - i * DAY_MS)));
  const all = getLogs()
    .filter(log => dates.includes(log.date) && isMyLocation(log.location) && !log.patrolOpen && !Number.isNaN(parseSlotLabel(log.time)))
    .map(log => ({ log, ...getTaskWindow(log.date, log.time) }))
    .sort((a, b) => b.scheduledAt - a.scheduledAt || locationOrder(a.log.location) - locationOrder(b.log.location));

  // Date, time and location filters. Each list is what the history holds, and a choice that has gone
  // (an old day dropping off the end) falls back to All rather than to an empty list.
  const bm = currentLang === 'BM';
  const fill = (id, allLabel, values, label = v => v) => {
    const select = document.getElementById(id);
    const chosen = select.value;
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = allLabel;
    select.appendChild(first);
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label(v);
      select.appendChild(opt);
    });
    select.value = values.includes(chosen) ? chosen : '';
    return select.value;
  };
  const uniq = list => [...new Set(list)];
  const wantDate = fill('history-date', bm ? 'Tarikh' : 'Date', uniq(all.map(e => e.log.date)), d => {
    // Short, so it fits a third of a phone: 12 Nov
    const [y, m, day] = d.split('-').map(Number);
    return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
  });
  const times = uniq(all.map(e => e.log.time)).sort((a, b) => parseSlotLabel(a) - parseSlotLabel(b));
  const wantTime = fill('history-time', bm ? 'Masa' : 'Time', times, formatSlotTime);
  const places = uniq(all.map(e => e.log.location)).sort((a, b) => locationOrder(a) - locationOrder(b));
  const wantPlace = fill('history-location', bm ? 'Lokasi' : 'Location', places);
  const entries = all.filter(({ log }) => (!wantDate || log.date === wantDate)
    && (!wantTime || log.time === wantTime) && (!wantPlace || log.location === wantPlace));

  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = [];
  historyRouteMaps.forEach(layers => layers.map.remove());
  historyRouteMaps = [];

  // ONE CARD PER TIME AT A LOCATION. The pins are inside it, the same way the task was walked:
  // one road track, several check-ins. A card is complete when every pin is, not done when none is.
  const groups = [];
  entries.forEach(entry => {
    const { log } = entry;
    const key = `${log.date}|${log.location}|${log.time}`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, date: log.date, location: log.location, time: log.time, logs: [] }; groups.push(g); }
    g.logs.push(log);
  });
  groups.forEach(g => {
    g.logs.sort((x, y) => String(x.point || '').localeCompare(String(y.point || ''), undefined, { numeric: true }));
    g.done = g.logs.filter(l => l.status !== 'missed');
    g.state = g.done.length === g.logs.length ? 'ok' : (g.done.length ? 'part' : 'no');
  });

  const okCount = groups.filter(g => g.state === 'ok').length;
  const notCount = groups.length - okCount;
  document.getElementById('done-meta').textContent = currentLang === 'BM'
    ? `${okCount} selesai • ${notCount} tidak selesai`
    : `${okCount} completed • ${notCount} not completed`;

  const doneList = document.getElementById('done-list');
  doneList.innerHTML = '';
  if (groups.length === 0) {
    doneList.innerHTML = `<li class="task-empty">${all.length
      ? (currentLang === 'BM' ? 'Tiada rekod untuk pilihan ini.' : 'Nothing matches these filters.')
      : (currentLang === 'BM' ? 'Tiada sejarah tugasan lagi.' : 'No task history yet.')}</li>`;
    return;
  }

  // A photo from this phone, or from the AI System when it was taken on another one
  const showPhoto = (img, log) => {
    // A photo opens big on a tap; a check-in with no photo never gets this far (noPhotoThumb replaces it)
    img.classList.add('photo-open');
    img.setAttribute('role', 'button');
    img.tabIndex = 0;
    img.onclick = (event) => { event.stopPropagation(); if (img.src) openPhotoViewer(img.src, img.alt); };
    img.onkeydown = (event) => { if ((event.key === 'Enter' || event.key === ' ') && img.src) { event.preventDefault(); openPhotoViewer(img.src, img.alt); } };
    img.alt = `${log.location} ${formatSlotTime(log.time)}${log.point ? ' ' + log.point : ''}`;
    loadPhoto(log.id).then(blob => {
      if (!blob) {
        if (log.photoUrl) img.src = log.photoUrl;
        else noPhotoThumb(img);
        return;
      }
      const url = URL.createObjectURL(blob);
      photoUrls.push(url);
      img.src = url;
    }).catch(() => { if (log.photoUrl) img.src = log.photoUrl; else noPhotoThumb(img); });
  };

  let currentDate = null;
  groups.forEach(g => {
    if (g.date !== currentDate) {
      currentDate = g.date;
      const heading = document.createElement('li');
      heading.className = 'task-date-heading';
      heading.textContent = g.date;
      doneList.appendChild(heading);
    }
    const pinned = g.logs.some(l => l.point);
    const first = g.done[0];
    const last = g.done.map(l => l.submittedAt).filter(Boolean).sort().pop();
    const li = document.createElement('li');
    li.className = 'task-item task-done' + (g.state === 'no' ? ' task-missed' : '') + (g.state === 'part' ? ' task-part' : '');
    const remark = g.state === 'no'
      ? `<span class="task-remark-missed">${currentLang === 'BM' ? 'Kerja Tidak Disiapkan' : 'Work Not Completed'}</span>`
      : (g.state === 'part'
        ? `<span class="task-remark-part">${currentLang === 'BM' ? 'Tidak Lengkap' : 'Not Completed'}</span>`
        : `<span class="task-submitted"><span class="task-check">✓</span> ${last ? formatClock(last) : ''}</span>`);
    li.innerHTML = `
      ${pinned ? '' : (first ? '<img class="task-thumb" alt="">' : '<span class="task-thumb task-thumb-missed" aria-hidden="true">✕</span>')}
      <span class="task-time">${formatSlotTime(g.time)}</span>
      <span class="task-location">${g.location}${pinned ? ` <span class="task-point">📍 ${g.done.length}/${g.logs.length}</span>` : ''}<span class="task-deadline task-by"></span></span>
      <span class="task-action">${remark}</span>
    `;
    li.querySelector('.task-by').textContent = [...new Set(g.done.map(l => l.workerName).filter(Boolean))].join(', ');
    // A pinned card shows each pin's own photo below, so the head carries none
    if (first && !pinned) showPhoto(li.querySelector('img'), first);

    // The task's one road track
    const routed = g.done.find(l => l.routeId || l.hasRoute);
    if (routed) {
      li.classList.add('task-has-route');
      li.insertAdjacentHTML('beforeend', `
        <div class="history-route">
          <span class="icon-text">${ICONS.route} ${formatDistance(routed.routeDistance || 0)} • ${formatElapsed(routed.routeDuration || 0)}</span>
          <button type="button" class="btn btn-secondary history-route-btn">${currentLang === 'BM' ? 'Peta' : 'Map'}</button>
        </div>
        <div class="history-route-map" hidden>
          <div class="route-map"></div>
        </div>
      `);
      li.querySelector('.history-route-btn').onclick = (event) => toggleHistoryRoute(event.currentTarget, routed);
    }

    // Each pin of it: its photo, who, when, or that it was not done
    if (pinned) {
      li.classList.add('task-has-pins');
      const list = document.createElement('ul');
      list.className = 'history-pins';
      g.logs.forEach(log => {
        const missed = log.status === 'missed';
        const row = document.createElement('li');
        row.className = 'history-pin' + (missed ? ' missed' : '');
        row.innerHTML = `${missed ? '<span class="history-pin-thumb missed" aria-hidden="true">✕</span>' : '<img class="history-pin-thumb" alt="">'}
          <span class="history-pin-name"><strong></strong><small></small></span>
          <span class="history-pin-when">${missed
            ? `<span class="task-remark-missed">${currentLang === 'BM' ? 'Tidak dibuat' : 'Not done'}</span>`
            : `<span class="task-check">✓</span> ${log.submittedAt ? formatClock(log.submittedAt) : ''}`}</span>`;
        row.querySelector('strong').textContent = log.point || log.location;
        row.querySelector('small').textContent = missed ? '' : (log.workerName || '');
        const img = row.querySelector('img');
        if (img) showPhoto(img, log);
        list.appendChild(row);
      });
      li.appendChild(list);
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
  if (!can('home')) return;
  if (Date.now() >= task.closesAt) {
    refreshTaskSchedule();
    return;
  }
  const { location, time, date, closesAt } = task;
  const point = task.point || '';
  // The log id is chosen now so a road track recorded in the sheet can be linked to this task
  const logId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingTask = { location, point, time, date, closesAt, logId, route: null };
  pendingPhoto = null;
  // A pin was only opened because the guard is near it, so the position the task screen already has is
  // where the check-in was made: no second GPS wait on the photo screen. Anything else asks the GPS.
  pendingCoordinates = point && roundHere && Date.now() - roundHereAt < 2 * 60 * 1000
    ? Promise.resolve(`${roundHere[0].toFixed(6)}, ${roundHere[1].toFixed(6)}`)
    : fetchCoordinates();

  document.getElementById('sheet-task-label').textContent = `${formatSlotTime(time)} • ${location}${point ? ` • ${point}` : ''}`;
  const coordEl = document.getElementById('sheet-coord');
  const locationState = document.getElementById('sheet-location-state');
  coordEl.textContent = currentLang === 'BM' ? 'Mengesan Lokasi...' : 'Detecting Location...';
  locationState.textContent = '';
  const current = pendingTask;
  pendingCoordinates.then(coord => {
    if (pendingTask !== current) return;
    coordEl.textContent = coord;
    const distance = describeCheckpointDistance(location, coord, point);
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
  // Capture photo and GPS track record are each a switch in the office. A step that is off is not
  // shown, and Submit does not wait for a photo nobody is asked to take.
  const wantPhoto = can('photo');
  document.getElementById('sheet-step-photo').hidden = !wantPhoto;
  // Where the check-in was made is still recorded with it, but it is not a step the guard has to look at.
  // Only where the office has switched the photo off is it shown, or the screen would hold nothing but Submit.
  document.getElementById('sheet-step-location').hidden = wantPhoto;
  // A pin's road track is the round's, started and stopped on the task's own screen
  document.getElementById('sheet-step-route').hidden = !can('gps') || !!point;
  // A pin check-in has no Cancel: the row only opens within range of the pin, and the screen is Capture,
  // then Retake and Submit once a photo has really been taken
  document.getElementById('sheet-cancel').hidden = !!point;
  renderSheetRoute();
  if (wantPhoto) openTaskCamera();
  else {
    stopActiveCamera();
    document.getElementById('sheet-submit').hidden = false;
    document.getElementById('sheet-submit').disabled = false;
  }
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
  // Submit is not on screen until a photo has been captured: first Capture, then Retake and Submit
  document.getElementById('sheet-submit').hidden = capturing;
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
        // Else the position the task screen had when the pin was opened (if under 2 minutes old)
        if (roundHere && Date.now() - roundHereAt < 2 * 60 * 1000) {
          resolve(`${roundHere[0].toFixed(6)}, ${roundHere[1].toFixed(6)}`);
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
  if (!pendingTask || (!pendingPhoto && can('photo'))) return;
  if (Date.now() >= pendingTask.closesAt) {
    refreshTaskSchedule();
    return;
  }
  // A road track recording for this task that has not moved: walk first, or cancel the track
  if (activeRoute && activeRoute.logId === pendingTask.logId && routeNotWalked()) { sayRouteNotWalked(); return; }
  const submitBtn = document.getElementById('sheet-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = currentLang === 'BM' ? 'Menghantar...' : 'Submitting...';

  const coordinates = await pendingCoordinates;
  const id = pendingTask.logId;

  try {
    if (pendingPhoto) await savePhoto(id, pendingPhoto);
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
    ...(pendingTask.point ? { point: pendingTask.point } : {}),
    date: pendingTask.date,
    time: pendingTask.time,
    coordinates,
    status: 'completed',
    submittedAt: new Date().toISOString(),
    rev: 1,
    ...(getSession() ? { workerId: getSession().worker.id, workerName: getSession().worker.name } : {}),
    // A task whose road track is not finished stays in the To-Do List until it is
    // A pin's check-in never waits for a road track of its own: the task's one track covers its pins
    patrolOpen: !pendingTask.route && can('gps') && !pendingTask.point,
    ...(pendingTask.point ? takeRoundRoute(pendingTask) : {}),
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
  // Back to the task's pins and map, which is where a pin's check-in was opened from
  if (openRound) showRoundSheet();
}

document.addEventListener('keydown', (event) => {
  const viewer = document.getElementById('photo-viewer');
  if (event.key === 'Escape' && viewer && !viewer.hidden) {
    closePhotoViewer();
    return;
  }
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
// Every place walked is kept, wrong turns included: a new point is taken as soon as the guard is
// 3 m from the last one. Only when GPS is unsure (a wide accuracy circle) is a bigger step needed,
// so a phone standing still does not draw a scribble: half the accuracy, never more than 8 m.
const ROUTE_MIN_STEP_M = 3;
const ROUTE_MAX_STEP_M = 8;
function routeMinStep(accuracy) {
  return Math.min(ROUTE_MAX_STEP_M, Math.max(ROUTE_MIN_STEP_M, (accuracy || 0) / 2));
}
const ROUTE_MAX_ACCURACY_M = 50;    // ignore fixes less accurate than this
// The shortest road track that may be stopped and saved, set by the office (timing.minTrackMeters in
// System Setting > Mata Malam). Not set, or 0: no minimum, a track can be stopped at any time.
function getMinTrackMeters() {
  const value = Number(getTaskSettings().minTrackMeters);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
function routeNotWalked() {
  const min = getMinTrackMeters();
  return !!activeRoute && min > 0 && (activeRoute.distance || 0) < min;
}
// Cancel Road Track: throws the recording away without saving it. The task itself is untouched
// (a submitted one stays in the To-Do List with Start Road Track and Finish), and a new track can be started.
async function cancelRoadTrack() {
  if (!activeRoute) return;
  if (!confirm(currentLang === 'BM'
    ? 'Batal jejak laluan ini? Laluan yang direkod akan dibuang dan tidak disimpan.'
    : 'Cancel this road track? The recorded route will be thrown away and not saved.')) return;
  await stopRouteTracking({ discard: true });
  renderTasks();
  renderRoundRoute();
  renderSheetRoute();
}
function cancelRoadTrackLabel() {
  return currentLang === 'BM' ? 'Batal Jejak Laluan' : 'Cancel Road Track';
}
function sayRouteNotWalked() {
  alert(currentLang === 'BM'
    ? `Jejak laluan belum bergerak (kurang daripada ${getMinTrackMeters()} m). Sila buat rondaan dahulu, kemudian hantar. Jika tidak mahu merekod laluan, tekan Batal Jejak Laluan.`
    : `The road track has not moved yet (under ${getMinTrackMeters()} m). Please walk the patrol first, then submit. If you do not want to record a route, press Cancel Road Track.`);
}

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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { crossOrigin: true,
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
      <span class="task-time">${timeBadge(log.time)}</span>
      <span class="task-location">${log.location}${pointSuffix(log.point)}</span>
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
      ${tracking ? `<button type="button" class="btn btn-secondary task-route-cancel">${cancelRoadTrackLabel()}</button>` : `<button type="button" class="btn btn-secondary task-finish">${currentLang === 'BM' ? 'Selesai' : 'Finish'}</button>`}
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
  li.querySelector('.task-route-toggle').onclick = () => {
    if (!tracking) { startRouteTracking(log.id); return; }
    if (routeNotWalked()) { sayRouteNotWalked(); return; }
    stopRouteTracking();
  };
  const finish = li.querySelector('.task-finish');
  if (finish) finish.onclick = () => finishTask(log.id);
  const cancelTrack = li.querySelector('.task-route-cancel');
  if (cancelTrack) cancelTrack.onclick = () => cancelRoadTrack();
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

async function startRouteTracking(logId, round = null) {
  if (activeRoute) return;
  if (!navigator.geolocation) {
    alert(currentLang === 'BM' ? 'Geolokasi tidak disokong pada peranti ini.' : 'Location is not supported on this device.');
    return;
  }
  const route = { id: `route-${Date.now().toString(36)}`, logId, startedAt: Date.now(), endedAt: null, points: [], distance: 0,
    ...(round ? { round: { location: round.location, date: round.date, time: round.time } } : {}) };
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
  renderRoundRoute();
}

// Road Track step inside the task sheet
// ── A PINNED TASK: one screen with the boundary, every pin, the road track and the pin list ──
// A "round" is one location at one check-in time on one shift date.
let openRound = null;
let roundMap = null;
let roundLayers = null;
let roundWatchId = null;
let roundHere = null;
let roundHereAt = 0;
let roundHereAccuracy = Infinity;
let roundGpsError = null;
// Start Road Track needs the phone's GPS: a fix from the last two minutes, good enough for the road
// track to use (the track ignores fixes worse than ROUTE_MAX_ACCURACY_M)
function roundGpsReady() {
  return !!roundHere && Date.now() - roundHereAt <= 2 * 60 * 1000 && roundHereAccuracy <= ROUTE_MAX_ACCURACY_M;
}
// A pin opens only for somebody standing within this distance of it. The office sets it (System
// Setting > Mata Malam > Capture photo within, timing.pinRangeMeters); not set is 3 m, what it was
// before it could be set. Far away, or with no GPS fix yet, the row is shown and cannot be pressed.
// Asked again when the row is pressed.
const PIN_RANGE_DEFAULT_M = 3;
function getPinRangeMeters() {
  const value = Number(getTaskSettings().pinRangeMeters);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : PIN_RANGE_DEFAULT_M;
}
function pinInRange(location, point) {
  const pin = getLocationPins(location).find(p => p.name === point);
  if (!pin) return true;                 // a pin the map cannot place is not held back by the map
  // A position more than two minutes old says nothing about where the guard is now
  if (!roundHere || Date.now() - roundHereAt > 2 * 60 * 1000) return false;
  return Math.round(distanceMeters(roundHere, [pin.lat, pin.lng])) <= getPinRangeMeters();
}

function roundKey(r) { return `round:${r.location}|${r.date}|${r.time}`; }
function groupRounds(tasks) {
  const rounds = [];
  tasks.forEach(task => {
    let round = rounds.find(r => r.location === task.location && r.date === task.date && r.time === task.time);
    if (!round) rounds.push(round = { location: task.location, date: task.date, time: task.time, tasks: [] });
    round.tasks.push(task);
  });
  return rounds;
}
function roundTasks(r) {
  return getShiftTasks(r.date).filter(task => task.location === r.location && task.time === r.time);
}
function roundRecording(r) {
  return !!(activeRoute && activeRoute.round && roundKey(activeRoute.round) === roundKey(r));
}
function roundLogs(r) {
  return getLogs().filter(l => l.id && l.status !== 'missed' && l.location === r.location && l.date === r.date && l.time === r.time)
    .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));
}
// A track stopped before any pin was checked in waits here for the task's first check-in
function getRoundRoutes() {
  try { return JSON.parse(localStorage.getItem('mata_malam_round_routes')) || {}; } catch (err) { return {}; }
}
function roundRouteOf(r) {
  const log = roundLogs(r).find(l => l.routeId || l.hasRoute);
  if (log) return { routeDistance: log.routeDistance || 0, routeDuration: log.routeDuration || 0, routeId: log.routeId || null, log };
  return getRoundRoutes()[roundKey(r)] || null;
}

// A track that has been STOPPED stays on the task's map, so the guard can see where they walked.
// From this phone when it was recorded here, else from the AI System (a track somebody else walked).
let roundTrackShown = null;
async function showRoundTrack(r, finished) {
  const key = roundKey(r) + '|' + (finished.routeId || (finished.log && finished.log.id) || '');
  if (roundTrackShown === key) return;
  roundTrackShown = key;
  let route = null;
  try {
    if (finished.routeId) route = await loadRoute(finished.routeId).catch(() => null);
    if (!route && finished.log) route = await loadLogRoute(finished.log);
  } catch (err) { route = null; }
  if (roundTrackShown !== key || !roundLayers || !openRound || roundKey(openRound) !== roundKey(r)) return;
  const points = ((route && route.points) || []).map(p => [p[0], p[1]]);
  if (!points.length) { roundTrackShown = null; return; }
  roundLayers.line.setLatLngs(points);
  // Frame the walk together with the boundary and the pins, so all of it is on screen
  const frame = roundLayers.line.getBounds();
  if (roundLayers.bounds) frame.extend(roundLayers.bounds);
  if (roundMap && Date.now() - roundUserMovedAt > 60000) roundMapMove(() => roundMap.fitBounds(frame, { padding: [28, 28], maxZoom: 18 }));
}
// The track is stored on the task's first check-in made on THIS phone (somebody else's record cannot be changed)
function attachRoundRoute(r, done) {
  const mine = roundLogs(r).find(l => !l.remote);
  if (mine) { updateLog(mine.id, { patrolOpen: false, ...done }); return; }
  const waiting = getRoundRoutes();
  waiting[roundKey(r)] = done;
  localStorage.setItem('mata_malam_round_routes', JSON.stringify(waiting));
}
function takeRoundRoute(task) {
  const waiting = getRoundRoutes();
  const done = waiting[roundKey(task)];
  if (!done) return {};
  delete waiting[roundKey(task)];
  localStorage.setItem('mata_malam_round_routes', JSON.stringify(waiting));
  return done;
}

function openRoundSheet(round) {
  if (!can('home')) return;
  openRound = { location: round.location, date: round.date, time: round.time };
  roundTarget = null;
  roundUserMovedAt = 0;
  roundFollowKey = null;
  showRoundSheet();
}
function showRoundSheet() {
  if (!openRound) return;
  document.getElementById('round-sheet').hidden = false;
  document.querySelector('#round-sheet .sheet').scrollTop = 0;
  drawRoundMap();
  renderRoundSheet();
  if (navigator.geolocation && roundWatchId === null) {
    roundWatchId = navigator.geolocation.watchPosition(position => {
      roundHere = [position.coords.latitude, position.coords.longitude];
      roundHereAt = Date.now();
      roundHereAccuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : Infinity;
      roundGpsError = null;
      if (roundLayers) {
        if (!roundLayers.me) roundLayers.me = L.circleMarker(roundHere, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(roundMap);
        else roundLayers.me.setLatLng(roundHere);
        roundLayers.me.bringToFront();   // the guard's dot stays on top of the walked line
      }
      renderRoundPins();
      renderRoundRoute();
    }, error => {
      roundGpsError = error && error.code === error.PERMISSION_DENIED ? 'denied' : 'searching';
      renderRoundRoute();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
}
function hideRoundSheet() {
  document.getElementById('round-sheet').hidden = true;
  if (roundWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(roundWatchId);
  roundWatchId = null;
  if (roundMap) roundMap.remove();
  roundMap = null;
  roundLayers = null;
}
// Back: leaves the screen and changes nothing, a road track that is recording carries on
function backRoundSheet() {
  hideRoundSheet();
  openRound = null;
  renderTasks();
}
function drawRoundMap() {
  const el = document.getElementById('round-map');
  if (roundMap) roundMap.remove();
  roundMap = null;
  roundLayers = null;
  roundTrackShown = null;
  el.innerHTML = '';
  if (typeof L === 'undefined') {
    el.innerHTML = `<span class="route-map-offline">${currentLang === 'BM' ? 'Peta tidak dapat dimuatkan (tiada internet).' : 'Map could not be loaded (no internet).'}</span>`;
    return;
  }
  const r = openRound;
  // A view first: Leaflet cannot draw a shape on a map that has not been given one yet
  roundMap = L.map(el, { maxZoom: 21 }).setView([3.139, 101.6869], 12);
  // Moved or zoomed by hand (drag, pinch, + / −): the app stops moving the map for a while.
  // Its own moves are marked (roundAutoMove) so they are not taken for the guard's.
  roundMap.on('dragstart zoomstart', () => { if (!roundAutoMove) roundUserMovedAt = Date.now(); });
  // + / − sit at the bottom right: the top of the map is where the arrow to the next pin shows
  roundMap.zoomControl.setPosition('bottomright');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { crossOrigin: true, maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(roundMap);
  let bounds = null;
  const grow = b => { if (b && b.isValid()) bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast()); };
  // The boundary of this location, drawn strongly; the others faintly, so the guard knows where the edge is
  const saved = getSiteOutlines();
  ((saved && saved.list) || []).forEach(row => {
    if (!row || !row.geojson) return;
    const mine = locationCode(row.nursery) === r.location;
    try {
      const layer = L.geoJSON(row.geojson, { interactive: false,
        style: { color: mine ? '#2e7d32' : '#8a8a8a', weight: mine ? 3 : 1, opacity: mine ? 1 : 0.6, fillColor: mine ? '#2e7d32' : '#8a8a8a', fillOpacity: mine ? 0.12 : 0.03 } }).addTo(roundMap);
      if (mine) grow(layer.getBounds());
    } catch (err) {}
  });
  const pins = L.layerGroup().addTo(roundMap);
  const line = L.polyline(roundRecording(r) ? activeRoute.points.map(p => [p[0], p[1]]) : [], { color: '#58a6ff', weight: 5 }).addTo(roundMap);
  roundLayers = { pins, line, me: null };
  getLocationPins(r.location).forEach(pin => grow(L.latLngBounds([pin.lat, pin.lng], [pin.lat, pin.lng])));
  if (roundHere) roundLayers.me = L.circleMarker(roundHere, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(roundMap);
  roundLayers.bounds = bounds;
  if (bounds) roundMapMove(() => roundMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 }));
  setTimeout(() => {
    if (!roundMap || !roundLayers) return;
    roundMap.invalidateSize();
    const frame = roundLayers.line.getLatLngs().length ? roundLayers.line.getBounds() : null;
    if (frame && bounds) frame.extend(bounds);
    if (frame || bounds) roundMapMove(() => roundMap.fitBounds(frame || bounds, { padding: [28, 28], maxZoom: 18 }));
  }, 60);
}

function renderRoundSheet() {
  if (!openRound || document.getElementById('round-sheet').hidden) return;
  const r = openRound;
  const tasks = roundTasks(r);
  const done = tasks.filter(task => task.log && task.log.status !== 'missed').length;
  const title = document.getElementById('round-title');
  title.innerHTML = `<span class="task-time">${timeBadge(r.time)}</span>`;
  title.appendChild(document.createTextNode(` • ${r.location}`));
  document.getElementById('round-progress').innerHTML = `${ICONS.pin}<span>${done}/${tasks.length}</span>`;
  setIconLabel('round-back', currentLang === 'BM' ? 'Kembali' : 'Back');
  renderRoundRoute();
  renderRoundPins();
}

function renderRoundRoute() {
  if (!openRound || document.getElementById('round-sheet').hidden) return;
  const r = openRound;
  const step = document.getElementById('round-step-route');
  step.hidden = !can('gps');
  if (step.hidden) return;
  const toggle = document.getElementById('round-route-toggle');
  const state = document.getElementById('round-route-state');
  const status = document.getElementById('round-route-status');
  const recording = roundRecording(r);
  // Asked AFTER recording is known: read before it, the whole render threw and the pin list was never drawn
  const cancelBtn = document.getElementById('round-route-cancel');
  if (cancelBtn) { cancelBtn.hidden = !recording; cancelBtn.textContent = cancelRoadTrackLabel(); }
  const other = activeRoute && !recording;
  const finished = !recording && roundRouteOf(r);
  toggle.hidden = !!finished;
  // No GPS, no start: the button waits, and says so, until the phone has found where it is
  const noGps = !recording && !other && !finished && !roundGpsReady();
  toggle.disabled = !!other || noGps;
  toggle.classList.toggle('btn-stop', recording);
  toggle.classList.remove('btn-locked');
  // Start is the one thing to press on this box, so it is the blue button; Stop is red while recording
  toggle.classList.remove('btn-secondary');
  toggle.textContent = recording
    ? (currentLang === 'BM' ? 'Henti Jejak Laluan' : 'Stop Road Track')
    : (currentLang === 'BM' ? 'Mula Jejak Laluan' : 'Start Road Track');
  status.classList.toggle('route-status-warning', !!(recording && routeWarning));
  if (recording) {
    state.innerHTML = `<span class="route-recording">● ${currentLang === 'BM' ? 'Merekod' : 'Recording'}</span> ${formatDistance(activeRoute.distance)} • ${formatElapsed(Date.now() - activeRoute.startedAt)}`;
    // Every pin checked in: the one thing left is to stop the track, and the task is done
    const allIn = roundTasks(r).every(task => task.log && task.log.status !== 'missed');
    const left = roundPinsLeft(r);
    status.textContent = routeWarning || (allIn || !left
      ? (currentLang === 'BM' ? 'Semua pin sudah didaftar masuk. Tekan Henti Jejak Laluan untuk selesai.' : 'All pins checked in. Press Stop Road Track to finish.')
      : (currentLang === 'BM' ? `${left} pin lagi. Henti Jejak Laluan dibuka selepas semua pin diambil gambar.` : `${left} pin${left > 1 ? 's' : ''} to go. Stop Road Track opens once every pin is captured.`));
    toggle.classList.toggle('btn-locked', left > 0);
  } else if (finished) {
    state.textContent = `✓ ${formatDistance(finished.routeDistance || 0)} • ${formatElapsed(finished.routeDuration || 0)}`;
    status.textContent = currentLang === 'BM'
      ? 'Jejak laluan sudah dihentikan dan disimpan. Garisan biru di peta ialah laluan yang anda jalani.'
      : 'Road track stopped and saved. The blue line on the map is the way you walked.';
    showRoundTrack(r, finished);
  } else {
    state.textContent = '';
    const bm = currentLang === 'BM';
    if (noGps) toggle.textContent = bm ? 'Menunggu GPS…' : 'Waiting for GPS…';
    status.classList.toggle('route-status-warning', noGps);
    status.textContent = other
      ? (bm ? 'Jejak laluan lain masih merekod. Hentikannya dahulu.' : 'Another road track is still recording. Stop it first.')
      : !noGps ? ''
      : !navigator.geolocation ? (bm ? 'Telefon ini tidak mempunyai GPS.' : 'This phone has no GPS.')
      : roundGpsError === 'denied'
        ? (bm ? 'Lokasi ditutup. Hidupkan Lokasi (GPS) dan benarkan untuk pelayar ini, kemudian buka semula tugasan.' : 'Location is off. Turn on Location (GPS) and allow it for this browser, then open the task again.')
        : (roundHere && Date.now() - roundHereAt <= 2 * 60 * 1000
          ? (bm ? `Isyarat GPS lemah (±${Math.round(roundHereAccuracy)} m). Pergi ke kawasan terbuka.` : `GPS signal is weak (±${Math.round(roundHereAccuracy)} m). Move to an open area.`)
          : (bm ? 'Mencari GPS… Mula Jejak Laluan dibuka sebaik sahaja GPS dikesan.' : 'Finding GPS… Start Road Track opens as soon as GPS is found.'));
  }
}

// The pin the arrow points to: the first pin still to visit, or the one the guard pressed on the map
let roundTarget = null;
// When the guard last moved the map by hand: the map stops following them for a while after that
let roundUserMovedAt = 0;
let roundAutoMove = false;
let roundFollowKey = null;
// The app moving the map itself (framing the guard and the pin)
function roundMapMove(move) {
  roundAutoMove = true;
  try { move(); } finally { setTimeout(() => { roundAutoMove = false; }, 400); }
}
const PIN_SHAPE_SVG = '<svg class="round-pin-shape" viewBox="0 0 36 48" aria-hidden="true"><path d="M18 46C18 46 3 29.5 3 18a15 15 0 0 1 30 0c0 11.5-15 28-15 28z"/></svg>';
const PIN_SVG_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
// A pin is named by its number on a small badge, not its long name
function pinBadge(index) {
  return `<span class="pin-badge">${PIN_SVG_SMALL}${index + 1}</span>`;
}
const GUIDE_ARROW_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l7 19-7-4-7 4z" fill="#ffffff"/></svg>';

function roundFix() {
  return roundHere && Date.now() - roundHereAt <= 2 * 60 * 1000 ? roundHere : null;
}

// Compass direction from one point to another, 0 = north (the map is drawn north up)
function bearingDegrees([lat1, lng1], [lat2, lng2]) {
  const rad = deg => deg * Math.PI / 180;
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// A patrol goes pin 1, pin 2, … to the last pin, in order, with the road track recording:
// only the NEXT pin can be captured, and only once Start Road Track is pressed (when the road track
// is switched on for this person). Stop is allowed once every pin is captured, or once the time is up.
function roundNextTask(r) {
  const now = Date.now();
  return roundTasks(r).find(task => !task.log && task.opensAt <= now && now < task.closesAt) || null;
}
function roundCanCapture(r) {
  return roundRecording(r) || !can('gps');
}
function roundPinsLeft(r) {
  const now = Date.now();
  return roundTasks(r).filter(task => !task.log && task.opensAt <= now && now < task.closesAt).length;
}
let roundNotice = '';
let roundNoticeAt = 0;
function sayRoundNotice(text) {
  roundNotice = text;
  roundNoticeAt = Date.now();
  renderRoundPins();
  setTimeout(() => { if (Date.now() - roundNoticeAt >= 3900) renderRoundPins(); }, 4000);
}

// ── Alerts while walking, so the guard need not watch the screen ──
// Getting close to the next pin: one short buzz at 25 m, two at 10 m. Reached it (Capture opens):
// a long buzz pattern and a bell, ding ding ding. The colours on the map stay.
// (Vibration works on Android phones; iPhones do not let a web page vibrate, so they get the bell.)
let alertAudio = null;
let roundAlert = { point: null, level: 0 };
// Sound may only start from a press: the Start Road Track press opens it for the rest of the patrol
function unlockAlertAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!alertAudio) alertAudio = new Ctx();
    if (alertAudio.state === 'suspended') alertAudio.resume();
  } catch (err) {}
}
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (err) {}
}
// A bell: "ding ding ding". Each ding is a struck-bell tone (a main note with the bright,
// slightly out-of-tune overtones of a real bell) that rings out and fades.
function chime() {
  if (!alertAudio) return;
  try {
    if (alertAudio.state === 'suspended') alertAudio.resume();
    const start = alertAudio.currentTime + 0.02;
    for (let ding = 0; ding < 3; ding++) {
      const t = start + ding * 0.45;
      [[1, 0.5, 1.4], [2.76, 0.18, 0.7], [5.4, 0.08, 0.35]].forEach(([ratio, level, ring]) => {
        const osc = alertAudio.createOscillator();
        const gain = alertAudio.createGain();
        osc.type = 'sine';
        osc.frequency.value = 1320 * ratio;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + ring);
        osc.connect(gain).connect(alertAudio.destination);
        osc.start(t);
        osc.stop(t + ring + 0.05);
      });
    }
  } catch (err) {}
}
// Called on every GPS fix with the next pin: alerts only when the guard crosses into a closer band
function roundProximityAlert(r, row, ready) {
  if (!row || !row.pin || !roundRecording(r) || row.away === null) { roundAlert = { point: null, level: 0 }; return; }
  const level = ready ? 3 : Math.round(row.away) <= 10 ? 2 : Math.round(row.away) <= 25 ? 1 : 0;
  if (roundAlert.point !== row.task.point) roundAlert = { point: row.task.point, level: 0, readyAt: 0 };
  if (level <= roundAlert.level) {
    // Walked away again: the next approach alerts again
    if (level < roundAlert.level - 1 || (roundAlert.level === 3 && level < 3)) roundAlert.level = level;
    return;
  }
  roundAlert.level = level;
  const no = row.index + 1;
  if (level === 1) buzz(200);
  else if (level === 2) buzz([200, 120, 200]);
  else {
    // GPS hovering around 3 m: the arrival alert once, not again within 20 s
    if (Date.now() - (roundAlert.readyAt || 0) < 20000) return;
    roundAlert.readyAt = Date.now();
    buzz([500, 150, 500, 150, 500]);
    chime();
  }
}

// The pins live on the map only: red with a number to visit, blue for the one the arrow points to,
// green with a camera once the guard is within 3 m (pressing it opens the camera), green ✓ when done
function renderRoundPins() {
  if (!openRound || document.getElementById('round-sheet').hidden) return;
  const r = openRound;
  const now = Date.now();
  const bm = currentLang === 'BM';
  const pins = getLocationPins(r.location);
  const here = roundFix();
  const rows = roundTasks(r).map((task, index) => {
    const pin = pins.find(p => p.name === task.point);
    const visited = !!(task.log && task.log.status !== 'missed');
    const open = !task.log && task.opensAt <= now && now < task.closesAt;
    const near = open && pinInRange(r.location, task.point);
    const away = pin && here ? distanceMeters(here, [pin.lat, pin.lng]) : null;
    return { task, index, pin, visited, open, near, away };
  });
  // In order: the next pin is the first one not yet captured; it is the only one that can be captured
  const next = roundNextTask(r);
  const nextRow = next ? rows.find(x => x.task.point === next.point) : null;
  const target = nextRow && nextRow.pin ? nextRow : null;
  const canCapture = roundCanCapture(r);
  const ready = nextRow && nextRow.near && canCapture ? nextRow : null;
  roundProximityAlert(r, nextRow, ready);

  if (roundLayers) {
    const markers = roundLayers.markers || (roundLayers.markers = {});
    rows.forEach(x => {
      if (!x.pin) return;
      const state = x.visited ? 'done' : (x === ready ? 'ready' : x.open ? 'open' : 'closed');
      let marker = markers[x.task.point];
      if (!marker) {
        const point = x.task.point;
        marker = markers[point] = L.marker([x.pin.lat, x.pin.lng], { keyboard: false, title: point }).addTo(roundLayers.pins);
        marker.on('click', () => tapRoundPin(point));
      }
      // The icon is swapped only when the pin's state changes, so a press is never lost to a redraw
      if (marker.pinState !== state) {
        marker.pinState = state;
        const label = state === 'done' ? '✓' : state === 'ready' ? ICONS.camera : String(x.index + 1);
        // A map pin: the point sits exactly on the spot, the number (or ✓ / camera) in the round head
        marker.setIcon(L.divIcon({ className: `round-pin2 ${state}`, html: `${PIN_SHAPE_SVG}<span>${label}</span>`, iconSize: [36, 48], iconAnchor: [18, 46] }));
        marker.setZIndexOffset(state === 'ready' ? 1000 : 0);
      }
    });
  }

  // Within 3 m of a pin: one big Capture button on the map
  const capture = document.getElementById('round-capture');
  if (ready) {
    capture.hidden = false;
    capture.innerHTML = `${ICONS.camera}<span>${bm ? 'Ambil Gambar' : 'Capture'}</span>${pinBadge(ready.index)}`;
    capture.setAttribute('aria-label', `${bm ? 'Ambil Gambar' : 'Capture'}: ${ready.task.point}`);
    capture.onclick = () => checkInPin(ready.task.point);
  } else {
    capture.hidden = true;
  }

  // The arrow always points to the next pin; before Start it says to press Start first
  const guiding = !!target;
  const guide = document.getElementById('round-guide');
  if (roundLayers && roundMap) {
    if (!roundLayers.guide) roundLayers.guide = L.polyline([], { color: '#ffd866', weight: 3, dashArray: '6 8', interactive: false }).addTo(roundMap);
    roundLayers.guide.setLatLngs(guiding && here && target && !ready ? [here, [target.pin.lat, target.pin.lng]] : []);
  }
  const notice = roundNotice && Date.now() - roundNoticeAt < 4000 ? roundNotice : '';
  if (!guiding || ready) {
    guide.hidden = true;
  } else {
    guide.hidden = false;
    if (!here) {
      guide.innerHTML = `<span class="guide-text"><strong>${bm ? 'Menunggu GPS…' : 'Waiting for GPS…'}</strong></span>`;
    } else {
      const deg = bearingDegrees(here, [target.pin.lat, target.pin.lng]);
      guide.innerHTML = `<span class="guide-arrow" style="transform: rotate(${deg.toFixed(0)}deg)">${GUIDE_ARROW_SVG}</span><span class="guide-text"><strong>${pinBadge(target.index)}<span class="guide-away">${formatDistance(target.away)}</span></strong><small></small></span>`;
      guide.querySelector('small').textContent = notice || (!canCapture
        ? (bm ? 'Tekan Mula Jejak Laluan dahulu, kemudian mula dari pin ini.' : 'Press Start Road Track first, then begin at this pin.')
        : (bm ? `Pada ${getPinRangeMeters()} m, Ambil Gambar dibuka.` : `At ${getPinRangeMeters()} m, Capture opens.`));
    }
  }

  // While the road track records, the map keeps the guard on screen. When the arrow moves to a new pin
  // it frames the guard and that pin once; after that it only slides along at the zoom the guard chose.
  // A drag, pinch or + / − by hand: hands off for a minute.
  const following = roundRecording(r) && here && roundMap && now - roundUserMovedAt > 60000;
  const followKey = target ? target.task.point : '';
  if (following && followKey !== roundFollowKey && target) {
    roundFollowKey = followKey;
    roundMapMove(() => roundMap.fitBounds(L.latLngBounds([here, [target.pin.lat, target.pin.lng]]), { padding: [70, 70], maxZoom: 19 }));
  } else if (following && !roundMap.getBounds().pad(-0.15).contains(here)) {
    roundMapMove(() => roundMap.panTo(here));
  }
}

// A pin pressed on the map: within 3 m it opens the camera; further away the arrow points to it
function tapRoundPin(point) {
  if (!openRound) return;
  const task = roundTasks(openRound).find(t => t.point === point);
  if (!task || task.log) return;
  const now = Date.now();
  if (!(task.opensAt <= now && now < task.closesAt)) return;
  const bm = currentLang === 'BM';
  const next = roundNextTask(openRound);
  const nextNo = next ? roundTasks(openRound).findIndex(t => t.point === next.point) + 1 : 0;
  if (next && next.point !== point) {
    sayRoundNotice(bm ? `Ikut turutan: pergi ke pin ${nextNo} dahulu.` : `In order: go to pin ${nextNo} first.`);
    return;
  }
  if (!roundCanCapture(openRound)) {
    sayRoundNotice(bm ? 'Tekan Mula Jejak Laluan dahulu.' : 'Press Start Road Track first.');
    return;
  }
  if (pinInRange(openRound.location, point)) { checkInPin(point); return; }
  sayRoundNotice(bm ? `Dekati pin ini sehingga ${getPinRangeMeters()} m untuk Ambil Gambar.` : `Come within ${getPinRangeMeters()} m of this pin to Capture.`);
}

// One pin: the photo sheet for that pin. The task's screen comes back when it is submitted or cancelled.
function checkInPin(point) {
  if (!openRound) return;
  const task = roundTasks(openRound).find(t => t.point === point);
  if (!task || task.log) { renderRoundPins(); return; }
  // Only the next pin, in order, and only with the road track recording
  const next = roundNextTask(openRound);
  if (!next || next.point !== task.point || !roundCanCapture(openRound)) { renderRoundPins(); return; }
  if (!pinInRange(openRound.location, point)) { renderRoundPins(); return; }
  hideRoundSheet();
  startTask(task);
  // startTask does nothing for a window that has just closed: come straight back
  if (!pendingTask) showRoundSheet();
}

function toggleRoundRoute() {
  if (!openRound || !can('gps')) return;
  if (roundRecording(openRound)) {
    // Every pin captured first (once the time is up there is nothing left to capture, and Stop is allowed)
    const left = roundPinsLeft(openRound);
    if (left > 0) {
      alert(currentLang === 'BM'
        ? `Masih ada ${left} pin belum diambil gambar. Ambil gambar di setiap pin dahulu, kemudian tekan Henti Jejak Laluan. Jika mahu membatalkan rondaan, tekan Batal Jejak Laluan.`
        : `${left} pin${left > 1 ? 's' : ''} still to capture. Capture every pin first, then press Stop Road Track. To give up this patrol, press Cancel Road Track.`);
      return;
    }
    if (routeNotWalked()) { sayRouteNotWalked(); return; }
    // Every pin captured (not just the time running out): fireworks once the track is saved
    const finished = { ...openRound };
    const allCaptured = roundTasks(finished).every(task => task.log && task.log.status !== 'missed');
    Promise.resolve(stopRouteTracking()).then(() => {
      if (!allCaptured) return;
      // Done: back to the To-Do List by itself (no Back to press), with the fireworks over it
      if (openRound && roundKey(openRound) === roundKey(finished)) backRoundSheet();
      celebrateTask(finished);
    });
    return;
  }
  if (activeRoute) return;
  if (!roundGpsReady()) { renderRoundRoute(); return; }
  unlockAlertAudio();
  roundAlert = { point: null, level: 0 };
  startRouteTracking(roundKey(openRound), openRound).then(() => { renderRoundRoute(); renderRoundPins(); renderTodo(); });
}

// Fireworks over the screen and a "Task complete" card, for a patrol with every pin captured.
// Tap anywhere to close; it closes by itself after a few seconds. Calm (no fireworks) for a phone
// set to reduce motion.
function celebrateTask(r) {
  const old = document.getElementById('celebrate');
  if (old) old.remove();
  const bm = currentLang === 'BM';
  const pins = roundTasks(r).length;
  const box = document.createElement('div');
  box.id = 'celebrate';
  box.className = 'celebrate';
  box.setAttribute('role', 'alert');
  box.innerHTML = `<canvas class="celebrate-sky" aria-hidden="true"></canvas>
    <div class="celebrate-card">
      <div class="celebrate-emoji" aria-hidden="true">🎉</div>
      <h3></h3>
      <p></p>
    </div>`;
  box.querySelector('h3').textContent = bm ? 'Tugasan Selesai!' : 'Task Complete!';
  box.querySelector('p').textContent = bm
    ? `${formatSlotTime(r.time)} • ${r.location} — ${pins} pin diambil gambar dan jejak laluan disimpan.`
    : `${formatSlotTime(r.time)} • ${r.location} — ${pins} pin${pins > 1 ? 's' : ''} captured and road track saved.`;
  document.body.appendChild(box);

  let running = true;
  const close = () => {
    if (!running) return;
    running = false;
    box.classList.add('celebrate-out');
    setTimeout(() => box.remove(), 400);
  };
  box.onclick = close;
  setTimeout(close, 4500);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = box.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const scale = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = innerWidth * scale;
    canvas.height = innerHeight * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  };
  resize();
  const colors = ['#ffd866', '#ff6b6b', '#58a6ff', '#3fb950', '#c9b8ff', '#ff9f43', '#ffffff'];
  const rockets = [];
  const sparks = [];
  let launched = 0;
  const launch = () => {
    rockets.push({
      x: innerWidth * (0.15 + Math.random() * 0.7),
      y: innerHeight,
      vy: -(innerHeight / 55) * (0.85 + Math.random() * 0.3),
      top: innerHeight * (0.15 + Math.random() * 0.3),
      color: colors[Math.floor(Math.random() * colors.length)]
    });
    launched++;
  };
  const burst = (x, y, color) => {
    const count = 60 + Math.floor(Math.random() * 30);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 4.5;
      sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color: Math.random() < 0.25 ? '#ffffff' : color });
    }
  };
  let last = 0;
  const frame = time => {
    if (!running || !box.isConnected) return;
    if (time - last > 260 && launched < 9) { launch(); last = time; }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const rk = rockets[i];
      rk.y += rk.vy;
      rk.vy *= 0.985;
      ctx.fillStyle = rk.color;
      ctx.beginPath();
      ctx.arc(rk.x, rk.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (rk.y <= rk.top || rk.vy > -1.5) { burst(rk.x, rk.y, rk.color); rockets.splice(i, 1); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vx *= 0.97;
      sp.vy = sp.vy * 0.97 + 0.06;
      sp.life -= 0.012;
      if (sp.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = sp.life;
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderSheetRoute() {
  if (!pendingTask) return;
  const recording = activeRoute && activeRoute.logId === pendingTask.logId;
  const otherRecording = activeRoute && !recording;
  const toggle = document.getElementById('sheet-route-toggle');
  const cancelBtn = document.getElementById('sheet-route-cancel');
  if (cancelBtn) { cancelBtn.hidden = !recording; cancelBtn.textContent = cancelRoadTrackLabel(); }
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
    const otherOf = otherLog || (otherRecording && activeRoute.round) || null;
    const otherLabel = otherOf ? `${formatSlotTime(otherOf.time)} • ${otherOf.location}` : '';
    status.textContent = otherRecording
      ? (currentLang === 'BM'
        ? `Jejak laluan ${otherLabel} sedang direkod. Hentikannya dahulu dalam Senarai Tugasan.`
        : `The road track for ${otherLabel} is still recording. Stop it first in the To-Do List.`)
      : (currentLang === 'BM' ? 'Rekod laluan rondaan anda (pilihan sebelum hantar).' : 'Record your patrol route (optional before submitting).');
  }
}

function toggleSheetRoute() {
  if (!pendingTask || !can('gps') || pendingTask.point) return;
  if (activeRoute && activeRoute.logId === pendingTask.logId) {
    if (routeNotWalked()) { sayRouteNotWalked(); return; }
    stopRouteTracking();
  } else startRouteTracking(pendingTask.logId);
}

function onRoutePosition(position) {
  if (!activeRoute) return;
  const { latitude, longitude, accuracy } = position.coords;
  if (accuracy > ROUTE_MAX_ACCURACY_M) return;
  const point = [latitude, longitude, Date.now()];
  const last = activeRoute.points[activeRoute.points.length - 1];
  if (last) {
    const step = distanceMeters(last, point);
    if (step < routeMinStep(accuracy)) return;
    activeRoute.distance += step;
  }
  activeRoute.points.push(point);
  saveRoute(activeRoute).catch(() => {});
  if (roundLayers && openRound && roundRecording(openRound)) roundLayers.line.addLatLng([latitude, longitude]);

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
  renderRoundRoute();
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
  // A pinned task's track belongs to the task, not to one pin's check-in
  if (route.round) {
    attachRoundRoute(route.round, { routeId: route.id, routeDistance: Math.round(route.distance), routeDuration: route.endedAt - route.startedAt });
    renderTasks();
    renderRoundSheet();
    return;
  }
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

let routeHiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (activeRoute) routeHiddenAt = Date.now(); return; }
  if (!activeRoute) return;
  requestRouteWakeLock();
  // The browser stops GPS while the screen is off or another app is in front: that stretch is missing
  if (routeHiddenAt && Date.now() - routeHiddenAt > 20000) {
    const minutes = Math.max(1, Math.round((Date.now() - routeHiddenAt) / 60000));
    alert(currentLang === 'BM'
      ? `Skrin ditutup atau aplikasi lain dibuka selama kira-kira ${minutes} min. Telefon tidak merekod laluan dalam masa itu. Biarkan Mata Malam terbuka di skrin semasa berjalan.`
      : `The screen was off or another app was open for about ${minutes} min. The phone does not record the route during that time. Keep Mata Malam open on the screen while walking.`);
  }
  routeHiddenAt = 0;
});

// Resumes a route that was still recording when the app was closed or reloaded
async function resumeActiveRoute() {
  const id = localStorage.getItem('mata_malam_active_route');
  if (!id || !navigator.geolocation) return;
  try {
    const route = await loadRoute(id);
    const log = route && findLog(route.logId);
    if (!route || route.endedAt || (!log && !route.round)) {
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
      const done = { routeId: route.id, routeDistance: Math.round(route.distance), routeDuration: route.endedAt - route.startedAt };
      if (route.round) attachRoundRoute(route.round, done);
      else updateLog(route.logId, { patrolOpen: false, ...done });
      renderTasks();
      return;
    }
    // Keep the task in the To-Do List so its Stop Road Track button is always reachable
    if (log && !route.round && !log.patrolOpen) updateLog(log.id, { patrolOpen: true });
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

// History: shows a task's recorded route on a map (the line is on it, so no link out)
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
  }).catch(() => {});
}

// ───────────────────────── Daily Work Report ─────────────────────────
// ONE ROW PER DAY PER LOCATION. A location's day is complete when EVERY check-in time set for it on
// System Setting was done, and a time is done when EVERY pin of it was checked in (the To-Do List's
// own rule). Four times of five is not a day's work. The day is the shift day (it runs past midnight).
// The times asked of a past day are the ones set NOW: a time added today is asked of last week too.
let reportDefaulted = false;
const reportFetched = new Set();

function populateReportYearDropdown() {
  const yearSelect = document.getElementById('report-year-select');
  const monthSelect = document.getElementById('report-month-select');
  const chosen = yearSelect.value;
  const today = getShiftDate();
  const years = new Set(getLogs().map(log => String(log.date || '').split('-')[0]).filter(Boolean));
  years.add(today.slice(0, 4));
  yearSelect.innerHTML = `<option value="" id="opt-all-years">${currentLang === 'BM' ? 'Semua Tahun' : 'All Years'}</option>`;
  // Newest year first, so the latest is what the list opens on
  [...years].sort().reverse().forEach(year => {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    yearSelect.appendChild(opt);
  });
  // Opens on this month: a daily report of every day ever is a list nobody reads
  if (!reportDefaulted) {
    reportDefaulted = true;
    yearSelect.value = today.slice(0, 4);
    monthSelect.value = today.slice(5, 7);
  } else {
    yearSelect.value = chosen;
  }
}

// The report's location filter: the current locations, plus any older one that still has logs
function populateReportLocations() {
  const select = document.getElementById('report-module-select');
  if (!select) return;
  const selected = select.value || 'ALL';
  const names = new Map(getLocations().filter(l => isMyLocation(l.code)).map(l => [l.code, l.name]));
  getLogs().forEach(log => { if (log.location && isMyLocation(log.location) && !names.has(log.location)) names.set(log.location, log.location); });
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

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// One location on one day: each time, whether it is done, and the day's answer
function dailyWork(date, location, now = Date.now()) {
  const tasks = getShiftTasks(date).filter(task => task.location === location);
  const times = [];
  tasks.forEach(task => {
    let t = times.find(x => x.time === task.time);
    if (!t) { t = { time: task.time, tasks: [], closesAt: 0 }; times.push(t); }
    t.tasks.push(task);
    t.closesAt = Math.max(t.closesAt, task.closesAt);
  });
  const guards = new Set();
  times.forEach(t => {
    t.done = t.tasks.every(task => task.log && task.log.status !== 'missed');
    t.state = t.done ? 'ok' : (now < t.closesAt ? 'wait' : 'no');
    t.tasks.forEach(task => { if (task.log && task.log.status !== 'missed' && task.log.workerName) guards.add(task.log.workerName); });
  });
  const done = times.filter(t => t.done).length;
  const state = !times.length ? null : (done === times.length ? 'ok' : (times.some(t => t.state === 'wait') ? 'wait' : 'no'));
  return { date, location, times, done, state, guards: [...guards] };
}

// A month older than the phone's own window is asked of the AI System once, so an old month is not
// read as a month of missed work only because this phone never held its check-ins.
async function fetchReportMonth(year, month) {
  const session = getSession();
  if (!session || !year || !month) return;
  const key = `${year}-${month}`;
  if (reportFetched.has(key)) return;
  reportFetched.add(key);
  try {
    const state = await rpc('mata_malam_state', { p_token: session.token, p_from: `${key}-01` });
    if (state && mergeRemoteLogs(state.logs) && document.getElementById('report-module-page').style.display === 'block') generateReport();
  } catch (err) {
    reportFetched.delete(key);
  }
}

function generateReport() {
  const logs = getLogs();
  const selectedMonth = document.getElementById('report-month-select').value;
  const selectedYear = document.getElementById('report-year-select').value;
  const selectedModule = document.getElementById('report-module-select').value;
  const BM = currentLang === 'BM';
  const tbody = document.getElementById('report-table-body');
  const summary = document.getElementById('report-summary');
  tbody.innerHTML = '';
  summary.innerHTML = '';
  if (selectedMonth && selectedYear) fetchReportMonth(selectedYear, selectedMonth);

  // From the first day anything was recorded to today: a day before the app was in use is not a missed day
  const today = getShiftDate();
  const dates = logs.map(l => l.date).filter(Boolean).sort();
  let first = dates[0] || today;
  if (selectedYear && selectedMonth) first = first > `${selectedYear}-${selectedMonth}-01` ? first : `${selectedYear}-${selectedMonth}-01`;
  const locations = selectedModule === 'ALL' ? getActiveLocations() : [selectedModule];
  const rows = [];
  // Newest day first: the report opens on what happened last
  for (let date = today; date >= first; date = addDays(date, -1)) {
    const [year, month] = date.split('-');
    if (selectedYear && year !== selectedYear) continue;
    if (selectedMonth && month !== selectedMonth) continue;
    locations.forEach(location => {
      const day = dailyWork(date, location);
      if (day.state) rows.push(day);
    });
  }

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align: center; color: var(--text-muted);">${BM ? 'Tiada hari untuk dilaporkan.' : 'No days to report.'}</td>`;
    tbody.appendChild(tr);
    return;
  }

  // Per location: complete days out of the days that are over (today, still running, is not counted)
  locations.forEach(location => {
    const mine = rows.filter(r => r.location === location && r.state !== 'wait');
    if (!rows.some(r => r.location === location)) return;
    const card = document.createElement('div');
    card.className = 'report-sum-card';
    const ok = mine.filter(r => r.state === 'ok').length;
    card.innerHTML = `<strong></strong>${ok} / ${mine.length} ${BM ? 'hari lengkap' : 'days complete'}`;
    card.querySelector('strong').textContent = location;
    summary.appendChild(card);
  });

  const label = { ok: BM ? 'Lengkap' : 'Completed', no: BM ? 'Tidak Lengkap' : 'Not Completed', wait: BM ? 'Sedang Berjalan' : 'In Progress' };
  rows.forEach(day => {
    const tr = document.createElement('tr');
    tr.className = `report-row-${day.state}`;
    const head = id => document.getElementById(id).textContent;
    tr.innerHTML = `
      <td class="rc-date" style="white-space: nowrap;">${day.date}</td>
      <td class="rc-loc"><strong></strong></td>
      <td class="rc-times" data-label="${head('th-timeslot')}"><span class="report-times">${day.times.map(t => `<span class="report-time ${t.state}">${t.state === 'ok' ? '✓' : (t.state === 'no' ? '✕' : '…')} ${formatSlotTime(t.time)}</span>`).join('')}</span></td>
      <td class="report-done rc-done" data-label="${head('th-coordinates')}">${day.done} / ${day.times.length}</td>
      <td class="rc-day"><span class="report-day ${day.state}">${label[day.state]}</span></td>
      <td class="report-guard rc-guard" data-label="${head('th-guard')}"></td>
    `;
    tr.querySelector('strong').textContent = day.location;
    tr.querySelector('.report-guard').textContent = day.guards.length ? day.guards.join(', ') : '-';
    tbody.appendChild(tr);
  });
}

function printReport() {
  window.print();
}

function handleClick() {
  syncNow({ manual: true });
}

// The header buttons are icons: their name is what a screen reader says and what a long press shows
function setIconLabel(id, label) {
  const el = document.getElementById(id);
  el.setAttribute('aria-label', label);
  el.title = label;
}

// Language Toggle logic
let currentLang = 'EN';
function toggleLanguage() {
  currentLang = currentLang === 'EN' ? 'BM' : 'EN';
  // The pill names the language a tap switches TO, like the FC Portal
  const langBtn = document.getElementById('nav-lang');
  document.getElementById('nav-lang-code').textContent = currentLang === 'EN' ? 'BM' : 'EN';
  setIconLabel('nav-lang', currentLang === 'EN' ? 'Tukar ke Bahasa Melayu' : 'Switch to English');
  setIconLabel('nav-portal', currentLang === 'BM' ? 'Kembali ke Worker Portal' : 'Back to Worker Portal');
  setIconLabel('nav-home', currentLang === 'BM' ? 'Laman Utama' : 'Home');

  if (currentLang === 'BM') {
    document.getElementById('signin-hint').textContent = 'Buka Mata Malam dari 555 Worker Portal.';
    document.getElementById('signin-btn').textContent = 'Pergi ke Worker Portal';
    document.getElementById('signin-lang').textContent = 'English';
    document.getElementById('th-guard').textContent = 'Pengawal';
    document.getElementById('todo-title').textContent = 'Senarai Tugasan';
    document.getElementById('done-title').textContent = 'Sejarah';
    setIconLabel('nav-done', 'Sejarah');
    document.getElementById('sheet-cancel').textContent = 'Batal';
    document.getElementById('sheet-retake').textContent = 'Ambil Semula';
    document.getElementById('sheet-capture').textContent = 'Ambil Gambar';
    document.getElementById('sheet-lbl-photo').textContent = 'Ambil Gambar';
    document.getElementById('sheet-lbl-location').textContent = 'Lokasi';
    document.getElementById('sheet-lbl-route').textContent = 'Jejak Laluan';
    document.getElementById('sheet-submit').textContent = 'Hantar';
    setIconLabel('nav-about', 'Laporan');
    setIconLabel('nav-settings', 'Tetapan');
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
    showOfflineReady();
    document.getElementById('update-banner-text').textContent = 'Versi baharu tersedia.';
    document.getElementById('update-banner-btn').textContent = 'Kemas Kini';
    
    // Report text translation
    document.getElementById('report-title').textContent = 'Laporan';
    document.getElementById('btn-print').textContent = 'Cetak Laporan';
    document.getElementById('label-report-month').textContent = 'Pilih Bulan';
    document.getElementById('label-report-year').textContent = 'Pilih Tahun';
    document.getElementById('label-report-module').textContent = 'Pilih Lokasi';
    document.getElementById('opt-all-months').textContent = 'Semua Bulan';
    document.getElementById('opt-all-years').textContent = 'Semua Tahun';
    document.getElementById('opt-all').textContent = 'Semua Lokasi';
    document.getElementById('th-location').textContent = 'Lokasi';
    document.getElementById('th-date').textContent = 'Tarikh';
    document.getElementById('th-timeslot').textContent = 'Masa Daftar Masuk';
    document.getElementById('th-coordinates').textContent = 'Selesai';
    document.getElementById('th-status').textContent = 'Kerja Harian';
  } else {
    document.getElementById('signin-hint').textContent = 'Open Mata Malam from the 555 Worker Portal.';
    document.getElementById('signin-btn').textContent = 'Go to Worker Portal';
    document.getElementById('signin-lang').textContent = 'Bahasa Melayu';
    document.getElementById('th-guard').textContent = 'Guards';
    document.getElementById('todo-title').textContent = 'To-Do List';
    document.getElementById('done-title').textContent = 'History';
    setIconLabel('nav-done', 'History');
    document.getElementById('sheet-cancel').textContent = 'Cancel';
    document.getElementById('sheet-retake').textContent = 'Retake';
    document.getElementById('sheet-capture').textContent = 'Capture';
    document.getElementById('sheet-lbl-photo').textContent = 'Take Photo';
    document.getElementById('sheet-lbl-location').textContent = 'Location';
    document.getElementById('sheet-lbl-route').textContent = 'Road Track';
    document.getElementById('sheet-submit').textContent = 'Submit';
    setIconLabel('nav-about', 'Report');
    setIconLabel('nav-settings', 'Settings');
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
    showOfflineReady();
    document.getElementById('update-banner-text').textContent = 'A new version is available.';
    document.getElementById('update-banner-btn').textContent = 'Update';

    // Report text translation
    document.getElementById('report-title').textContent = 'Report';
    document.getElementById('btn-print').textContent = 'Print Report';
    document.getElementById('label-report-month').textContent = 'Select Month';
    document.getElementById('label-report-year').textContent = 'Select Year';
    document.getElementById('label-report-module').textContent = 'Select Location';
    document.getElementById('opt-all-months').textContent = 'All Months';
    document.getElementById('opt-all-years').textContent = 'All Years';
    document.getElementById('opt-all').textContent = 'All Locations';
    document.getElementById('th-location').textContent = 'Location';
    document.getElementById('th-date').textContent = 'Date';
    document.getElementById('th-timeslot').textContent = 'Check-in Times';
    document.getElementById('th-coordinates').textContent = 'Done';
    document.getElementById('th-status').textContent = 'Daily Work';
  }
  renderTasks();
  updateSettingsPreview();
  renderLocationSettings();
  applySettingsAccess();
  renderSyncStatus();
  renderCheckpointPicker();
  drawSiteOutlines();
  if (document.getElementById('report-module-page').style.display === 'block') { populateReportYearDropdown(); populateReportLocations(); generateReport(); }
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

// What this person may use, switched on System Setting > Portal View & Function > Mata Malam in the
// office. There are two columns there: FC Portal (Field Conductor, Assistant Field Conductor, Admin,
// Estate Manager) and Worker Portal (everybody else), and the database says which one this person
// reads. Nothing known yet (no signal, or a database from before the switches) means everything is
// on: a switch nobody could read must not take the app away from a guard on shift.
const ACCESS_FUNCTIONS = ['home', 'photo', 'gps', 'history', 'report'];
function getAccess() {
  const session = getSession();
  const access = session && session.access;
  return access && typeof access === 'object' ? access : null;
}
function moduleOpen() {
  const access = getAccess();
  return !access || access.on !== false;
}
function can(fn) {
  if (!moduleOpen()) return false;
  const access = getAccess();
  return !(access && access.fn && access.fn[fn] === false);
}

function applyAccess() {
  const hide = (id, hidden) => {
    const el = document.getElementById(id);
    if (el) (el.closest('li') || el).hidden = hidden;
  };
  hide('nav-done', !can('history'));
  hide('nav-about', !can('report'));
  const shown = (id) => document.getElementById(id).style.display === 'block';
  if ((!can('history') && shown('done-module-page')) || (!can('report') && shown('report-module-page'))) showHomePage();
}

// The settings are the office's: System Setting > Mata Malam on the MJM AI System is the one place
// they are changed, and this app only follows them. So nobody changes them here, whoever they are,
// and the Settings link and page are not offered (see renderUser and showSettingsPage).
function canEditSettings() {
  return false;
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
      // Short wait: with no or weak signal the guard carries on as who was signed in on this phone
      const who = await rpc('worker_whoami', { p_token: handed }, 6000);
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
  // Mata Malam is entered from the Worker Portal only. A session from the days a PIN was typed here is let go
  // (its check-ins stay on the phone and are sent once somebody comes in from the portal).
  const kept = getSession();
  if (kept && !kept.fromPortal) localStorage.removeItem('mata_malam_session');
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
  // A guard who came in from the Worker Portal has a way back to it (same tab: the portal keeps its own sign in)
  document.getElementById('nav-portal').hidden = !session;
  // Settings is only for the people who may change it; everybody else has nothing to do there
  const settingsLink = document.getElementById('nav-settings');
  (settingsLink.closest('li') || settingsLink).hidden = !canEditSettings();
  if (!canEditSettings() && document.getElementById('settings-module-page').style.display === 'block') showHomePage();
  applyAccess();
}

function enterApp() {
  const session = getSession();
  // The boundaries are drawn on a pinned task's map; they change rarely, so once a day is enough
  loadSiteOutlines();
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
  const pointsNow = () => JSON.stringify(getLocations().map(({ code }) => [code, getTaskPoints(code)]));
  const before = JSON.stringify(buildSettingsPayload()) + pointsNow();
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
  if (timingOk) {
    // The shortest road track is optional: kept only when the office has set a number (0 = no minimum)
    const min = Number(timing.minTrackMeters);
    // How close a guard must stand to a pin to capture it: kept only when the office has set one
    const range = Number(timing.pinRangeMeters);
    localStorage.setItem('mata_malam_task_settings', JSON.stringify({
      opensBeforeMinutes: timing.opensBeforeMinutes,
      windowMinutes: timing.windowMinutes,
      ...(Number.isFinite(min) && min >= 0 ? { minTrackMeters: Math.round(min) } : {}),
      ...(Number.isFinite(range) && range > 0 ? { pinRangeMeters: Math.round(range) } : {})
    }));
  }
  // Where each location's pins are, set on the office map: a list, any number per location.
  // The one-pin-per-location shape it had for a day ({ BNN: [lat, lng] }) is still read.
  if (settings.pins && typeof settings.pins === 'object') {
    const pins = [];
    if (Array.isArray(settings.pins)) {
      settings.pins.forEach(p => {
        if (p && p.location && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          pins.push({ name: String(p.name || p.location), location: String(p.location), lat: p.lat, lng: p.lng });
        }
      });
    } else {
      Object.entries(settings.pins).forEach(([code, pin]) => {
        if (Array.isArray(pin) && pin.length === 2 && pin.every(Number.isFinite)) pins.push({ name: `${code} pin`, location: code, lat: pin[0], lng: pin[1] });
      });
    }
    localStorage.setItem('mata_malam_pins', JSON.stringify(pins));
  }
  localStorage.setItem('mata_malam_settings_at', stamp || '');
  if (JSON.stringify(buildSettingsPayload()) + pointsNow() !== before) {
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
      id: log.id, location: log.location, point: log.point || '', date: log.date, time: log.time,
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
      if (l.status === 'missed' && l.location === remote.location && l.date === remote.date && l.time === remote.time
        && (!remote.point || !l.point || l.point === remote.point)) logs.splice(i, 1);
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
    // 1. Nothing about the settings goes UP from a phone any more: the office page is the one writer.
    //    A change left waiting from the days this app had its own Settings is dropped, or it would
    //    stop the office's settings ever being taken below.
    localStorage.removeItem('mata_malam_settings_dirty');

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
        // The location the Worker Namelist files this worker under; null is every location
        myLocations: Array.isArray(state.my_locations) ? state.my_locations : null,
        ...(state.access && typeof state.access === 'object' ? { access: state.access } : (session.access ? { access: session.access } : {})),
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
      if (list.length) {
        const before = JSON.stringify(getActiveLocations());
        recordMissedTasks();
        localStorage.setItem('mata_malam_locations', JSON.stringify({ list, syncedAt: Date.now() }));
        if (JSON.stringify(getActiveLocations()) !== before) localStorage.setItem('mata_malam_tracking_start', String(Date.now()));
      }
      // Until the office has saved once there is nothing to follow, and the phone keeps the times it has
      if (state.settings_at && state.settings_at !== localStorage.getItem('mata_malam_settings_at')) {
        applyRemoteSettings(state.settings, state.settings_at);
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
    showSignIn(currentLang === 'BM' ? 'Sesi anda telah tamat. Buka semula dari Worker Portal.' : 'Your session has ended. Open it again from the Worker Portal.');
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
  // The button is an icon in the header: it spins while synchronizing and carries a dot while something waits
  button.classList.toggle('syncing', syncState === 'working');
  setIconLabel('hero-btn', syncState === 'working' ? (bm ? 'Menyelaras…' : 'Synchronizing…') : (bm ? 'Selaraskan Data' : 'Synchronize Data'));
  document.getElementById('sync-dot').hidden = !(syncState === 'offline' || waiting > 0);
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
// Offline: sw.js keeps the app (and the map pictures already seen) on the phone, so Mata Malam
// opens and works with no signal; check-ins wait on the phone and are sent when signal returns.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(showOfflineReady).catch(() => showOfflineReady());
  });
}
// The footer says whether THIS phone can open Mata Malam with no signal: the app is kept on it
// (the service worker is running and has the page). Shown so it can be checked before going offline.
async function showOfflineReady() {
  const el = document.getElementById('offline-ready');
  if (!el) return;
  let ready = false;
  try {
    if ('serviceWorker' in navigator && 'caches' in window) {
      await navigator.serviceWorker.ready;
      ready = !!(await caches.match(new URL('index.html', location.href).toString()));
    }
  } catch (err) {}
  el.dataset.ready = ready ? '1' : '';
  el.textContent = ready
    ? (currentLang === 'BM' ? '• Sedia luar talian ✓' : '• Offline ready ✓')
    : (currentLang === 'BM' ? '• Belum sedia luar talian' : '• Not offline ready yet');
  el.className = ready ? 'offline-ok' : 'offline-no';
}

window.onload = function() {
  document.getElementById('app-version').textContent = APP_VERSION;
  checkForUpdate();
  startSession();
};

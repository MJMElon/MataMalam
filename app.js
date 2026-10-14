// ---------------------------------------------------------------- constants ----

// All selectable locations, in display order.
const MODULES = ['bnn', 'unn1', 'unn2'];

// A shift runs 6pm -> 6am, so the last three slots fall on the next calendar
// day. dayOffset records that, which is what lets one night's five photos stay
// grouped together as a single shift.
const SLOTS = [
  { key: '6pm',  hour: 18, dayOffset: 0 },
  { key: '9pm',  hour: 21, dayOffset: 0 },
  { key: '12am', hour: 0,  dayOffset: 1 },
  { key: '3am',  hour: 3,  dayOffset: 1 },
  { key: '6am',  hour: 6,  dayOffset: 1 }
];

// Query-string keys the FC Portal uses to hand over the current user.
const PORTAL_PARAMS = { user: 'user', name: 'name', locations: 'locations', role: 'role' };

// Longest edge and JPEG quality for stored photos. Browser storage is only a
// few megabytes, so the original camera file is never kept.
const PHOTO_MAX_EDGE = 800;
const PHOTO_QUALITY = 0.6;

const STRINGS = {
  EN: {
    todoTitle: 'To-Do List',
    doneTitle: 'Done This Shift',
    historyLink: 'View Full History',
    progress: (done, total) => `${done} of ${total} done`,
    shiftLabel: date => `Shift ${date} (6pm - 6am)`,
    allDone: 'All tasks done for this shift. Nothing left to do.',
    noTasks: 'No tasks for this shift.',
    nothingDone: 'No tasks submitted yet for this shift.',
    statusDue: 'Due now',
    statusUpcoming: 'Upcoming',
    statusOverdue: 'Overdue',
    takePhoto: 'Take photo',
    submitted: at => `Submitted ${at}`,
    noPhotoStored: 'No photo stored',
    flashSaved: (loc, slot) => `${loc} ${slot} submitted. Moved to Done.`,
    captureDesc: 'Take the photo for this time slot, then submit. The task moves to Done once submitted.',
    cameraOffline: 'Camera Offline',
    openCamera: 'Open Camera',
    retakePhoto: 'Retake Photo',
    submitTask: 'Submit Task',
    photoRequired: 'Please take a photo before submitting.',
    photoFailed: 'That photo could not be read. Please try again.',
    alreadyDone: 'That task has already been submitted.',
    saveFailed: 'Could not save the task. Browser storage is full.',
    savedNoPhoto: 'Browser storage is full, so the task was saved without its photo. An HQ Admin can free space from Settings.',
    storageUsage: mb => `About ${mb} MB used by stored photos`,
    confirmClearPhotos: 'Delete every stored photo? Log entries are kept, but their photos are removed permanently.',
    photosCleared: 'Stored photos deleted.'
  },
  BM: {
    todoTitle: 'Senarai Tugasan',
    doneTitle: 'Selesai Syif Ini',
    historyLink: 'Lihat Sejarah Penuh',
    progress: (done, total) => `${done} daripada ${total} selesai`,
    shiftLabel: date => `Syif ${date} (6pm - 6am)`,
    allDone: 'Semua tugasan syif ini telah selesai.',
    noTasks: 'Tiada tugasan untuk syif ini.',
    nothingDone: 'Belum ada tugasan dihantar untuk syif ini.',
    statusDue: 'Perlu sekarang',
    statusUpcoming: 'Akan datang',
    statusOverdue: 'Lewat',
    takePhoto: 'Ambil gambar',
    submitted: at => `Dihantar ${at}`,
    noPhotoStored: 'Tiada gambar disimpan',
    flashSaved: (loc, slot) => `${loc} ${slot} telah dihantar. Dipindah ke Selesai.`,
    captureDesc: 'Ambil gambar untuk slot masa ini, kemudian hantar. Tugasan akan berpindah ke Selesai.',
    cameraOffline: 'Kamera Tidak Aktif',
    openCamera: 'Buka Kamera',
    retakePhoto: 'Ambil Semula',
    submitTask: 'Hantar Tugasan',
    photoRequired: 'Sila ambil gambar sebelum menghantar.',
    photoFailed: 'Gambar itu tidak dapat dibaca. Sila cuba lagi.',
    alreadyDone: 'Tugasan itu telah dihantar.',
    saveFailed: 'Tugasan tidak dapat disimpan. Storan pelayar penuh.',
    savedNoPhoto: 'Storan pelayar penuh, jadi tugasan disimpan tanpa gambar. HQ Admin boleh kosongkan ruang di Tetapan.',
    storageUsage: mb => `Kira-kira ${mb} MB digunakan oleh gambar tersimpan`,
    confirmClearPhotos: 'Hapus semua gambar tersimpan? Rekod log dikekalkan, tetapi gambarnya dibuang selama-lamanya.',
    photosCleared: 'Gambar tersimpan telah dihapus.'
  }
};

let currentLang = 'EN';
let activeStream = null;

// The task being captured: { location, slot, shiftDate }.
let currentTask = null;
// Compressed data URL for the photo just taken, before submit.
let currentPhoto = null;
// Coordinate string for the current capture, or null when unavailable.
let currentCoords = null;

function t(key) {
  return STRINGS[currentLang][key];
}

// ------------------------------------------------------------- date helpers ----

// Local calendar date as YYYY-MM-DD. Date#toISOString would convert to UTC
// first, which shifts the date for anyone east or west of Greenwich - a real
// problem for an app whose work happens either side of midnight.
function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The shift a moment belongs to, identified by the date its 6pm slot falls on.
// Midnight to noon still belongs to the night before; noon onwards opens the
// coming night, so the list is never empty.
function getShiftDate(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return localDateString(d);
}

// When a slot of a given shift starts.
function slotStart(shiftDate, slot) {
  const [y, m, d] = shiftDate.split('-').map(Number);
  return new Date(y, m - 1, d + slot.dayOffset, slot.hour, 0, 0, 0);
}

function slotStatus(shiftDate, slotIndex, now = new Date()) {
  const start = slotStart(shiftDate, SLOTS[slotIndex]);
  if (now < start) return 'upcoming';
  const next = SLOTS[slotIndex + 1];
  const end = next ? slotStart(shiftDate, next) : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return now < end ? 'due' : 'overdue';
}

function formatTimeOfDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --------------------------------------------------------- portal context ----

// Who is using the app, as told to us by the FC Portal. Null means the app was
// opened without portal context and nothing should be shown.
//
// The portal links to the app like:
//   index.html?user=0123456789&name=Ali&locations=unn1,unn2
//   index.html?user=0123456789&locations=bnn,unn1,unn2&role=admin
//
// `locations` is a comma-separated subset of MODULES and decides what the user
// sees. `role=admin` additionally reveals the Settings screen. Unknown location
// names are ignored.
let portal = null;

function readPortalContext(search = window.location.search) {
  const params = new URLSearchParams(search);
  const user = (params.get(PORTAL_PARAMS.user) || '').trim();
  if (!user) return null;

  const locations = (params.get(PORTAL_PARAMS.locations) || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => MODULES.includes(value));

  const role = (params.get(PORTAL_PARAMS.role) || '').trim().toLowerCase();

  return {
    user,
    name: (params.get(PORTAL_PARAMS.name) || '').trim() || user,
    locations: MODULES.filter(mod => locations.includes(mod)),
    isAdmin: role === 'admin' || role === 'hq admin'
  };
}

function isAdmin() {
  return !!portal && portal.isAdmin;
}

// Locations the current user may see, in display order.
function getAllowedModules() {
  return portal ? portal.locations.slice() : [];
}

function canAccessModule(moduleName) {
  return getAllowedModules().includes(String(moduleName).toLowerCase());
}

function permissionDeniedMessage() {
  return currentLang === 'BM'
    ? 'Anda tidak mempunyai kebenaran untuk lokasi ini.'
    : 'You do not have permission to access this location.';
}

// ------------------------------------------------------------------ logs ----

function getAllLogs() {
  return JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
}

// Browser storage is small and photos are big, so a write can genuinely fail.
function saveLogs(logs) {
  try {
    localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
    return true;
  } catch (err) {
    return false;
  }
}

// Which shift a log belongs to. Entries written before shifts existed have no
// shift field, so derive it: the after-midnight slots belong to the previous
// calendar day's shift.
function logShiftDate(log) {
  if (log.shift) return log.shift;
  const slot = SLOTS.find(s => s.key === log.time);
  if (!slot || slot.dayOffset === 0) return log.date;
  const [y, m, d] = log.date.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d - 1));
}

// Log entries belonging to the signed-in user's own locations.
function getVisibleLogs() {
  const allowed = getAllowedModules().map(mod => mod.toUpperCase());
  return getAllLogs().filter(log => allowed.includes(log.location));
}

// --------------------------------------------------------------- task model ----

// Every slot of the shift for every location the user may see, in the order
// they should be worked: earliest slot first, locations grouped within a slot.
function buildTasks(shiftDate) {
  const locations = getAllowedModules().map(mod => mod.toUpperCase());
  const shiftLogs = getVisibleLogs().filter(log => logShiftDate(log) === shiftDate);
  const tasks = [];

  SLOTS.forEach((slot, slotIndex) => {
    locations.forEach(location => {
      const log = shiftLogs.find(l => l.location === location && l.time === slot.key);
      tasks.push({
        location,
        slot: slot.key,
        slotIndex,
        shiftDate,
        done: !!log,
        log: log || null
      });
    });
  });

  return tasks;
}

function isTaskDone(location, slotKey, shiftDate) {
  return getVisibleLogs().some(log =>
    log.location === location && log.time === slotKey && logShiftDate(log) === shiftDate);
}

// ------------------------------------------------------- To-Do / Done views ----

function renderTaskScreens() {
  const shiftDate = getShiftDate();
  const tasks = buildTasks(shiftDate);
  const pending = tasks.filter(task => !task.done);
  const done = tasks.filter(task => task.done);

  const progress = document.getElementById('todo-progress');
  if (progress) {
    progress.textContent = tasks.length ? t('progress')(done.length, tasks.length) + ' →' : '';
  }

  const shiftText = tasks.length ? t('shiftLabel')(shiftDate) : '';
  const shiftLabel = document.getElementById('todo-shift-label');
  if (shiftLabel) shiftLabel.textContent = shiftText;
  const doneShiftLabel = document.getElementById('done-shift-label');
  if (doneShiftLabel) doneShiftLabel.textContent = shiftText;

  renderTodoList(pending, tasks.length);
  renderDoneList(done);
}

function renderTodoList(pending, totalTasks) {
  const list = document.getElementById('todo-list');
  if (!list) return;

  if (!totalTasks) {
    list.innerHTML = `<p class="list-empty">${t('noTasks')}</p>`;
    return;
  }

  if (!pending.length) {
    list.innerHTML = `<p class="list-empty list-empty-done">${t('allDone')}</p>`;
    return;
  }

  const now = new Date();

  // What to do right now goes to the top, then what is coming, and finally
  // slots whose moment has passed. Within each group, chronological order.
  const RANK = { due: 0, upcoming: 1, overdue: 2 };
  const ordered = pending
    .map(task => ({ task, status: slotStatus(task.shiftDate, task.slotIndex, now) }))
    .sort((a, b) => (RANK[a.status] - RANK[b.status]) || (a.task.slotIndex - b.task.slotIndex));

  list.innerHTML = ordered.map(({ task, status }, index) => {
    const statusLabel = status === 'due' ? t('statusDue')
      : status === 'overdue' ? t('statusOverdue')
      : t('statusUpcoming');
    return `
      <div class="task-row task-${status}${index === 0 ? ' task-next' : ''}"
           role="button" tabindex="0"
           onclick="startTask('${task.location}', '${task.slot}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();startTask('${task.location}', '${task.slot}');}">
        <div class="task-main">
          <span class="slot-badge">${task.slot}</span>
          <span class="task-location">${task.location}</span>
        </div>
        <div class="task-side">
          <span class="task-status">${statusLabel}</span>
          <span class="task-action">${t('takePhoto')} &rarr;</span>
        </div>
      </div>`;
  }).join('');
}

function renderDoneList(done) {
  const list = document.getElementById('done-list');
  if (!list) return;

  if (!done.length) {
    list.innerHTML = `<p class="list-empty">${t('nothingDone')}</p>`;
    return;
  }

  // Most recently submitted first.
  const ordered = done.slice().sort((a, b) => b.slotIndex - a.slotIndex);

  list.innerHTML = ordered.map(task => {
    const log = task.log || {};
    const thumb = log.photo
      ? `<img class="task-thumb" src="${log.photo}" alt="${task.location} ${task.slot}">`
      : `<span class="task-thumb task-thumb-empty">${t('noPhotoStored')}</span>`;
    const at = formatTimeOfDay(log.submittedAt);
    const details = [at ? t('submitted')(at) : '', log.coordinates || ''].filter(Boolean);
    return `
      <div class="task-row task-done">
        ${thumb}
        <div class="task-main task-main-done">
          <div>
            <span class="slot-badge">${task.slot}</span>
            <span class="task-location">${task.location}</span>
          </div>
          <span class="task-sub">${details.join(' &middot; ')}</span>
        </div>
        <span class="task-check" aria-hidden="true">&#10003;</span>
      </div>`;
  }).join('');
}

function flash(message) {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// --------------------------------------------------------- photo capture ----

// Shrink to PHOTO_MAX_EDGE and re-encode as JPEG. createImageBitmap honours
// EXIF orientation, so phone photos that report themselves as rotated are
// stored upright; the HTMLImageElement path is the fallback.
async function compressPhoto(file) {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

function decodeImage(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => decodeImageViaElement(file));
  }
  return decodeImageViaElement(file);
}

function decodeImageViaElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo file'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode the photo'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function openTaskCamera() {
  const input = document.getElementById('capture-file-input');
  if (input) input.click();
}

async function handleTaskPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById('capture-preview');
  try {
    currentPhoto = await compressPhoto(file);
    if (preview) preview.innerHTML = `<img src="${currentPhoto}" alt="Captured Photo">`;
    setCaptureReady(true);
  } catch (err) {
    currentPhoto = null;
    setCaptureReady(false);
    if (preview) {
      preview.innerHTML = `<span style="color: var(--error-color); font-size: 0.85rem;">${t('photoFailed')}</span>`;
    }
  }

  // Allow re-picking the same file, which otherwise fires no change event.
  event.target.value = '';
}

function setCaptureReady(ready) {
  const submit = document.getElementById('capture-submit');
  if (submit) submit.disabled = !ready;
  const cameraBtn = document.getElementById('capture-camera-btn');
  if (cameraBtn) cameraBtn.textContent = ready ? t('retakePhoto') : t('openCamera');
}

// ------------------------------------------------------------ task capture ----

function startTask(location, slotKey) {
  if (!canAccessModule(location)) {
    alert(permissionDeniedMessage());
    showHomePage();
    return;
  }

  const shiftDate = getShiftDate();
  if (isTaskDone(location, slotKey, shiftDate)) {
    alert(t('alreadyDone'));
    renderTaskScreens();
    showHomePage();
    return;
  }

  currentTask = { location, slot: slotKey, shiftDate };
  currentPhoto = null;
  currentCoords = null;

  showPage('capture-page');

  document.getElementById('capture-location').textContent = location;
  document.getElementById('capture-slot').textContent = slotKey;
  document.getElementById('capture-shift-date').textContent = shiftDate;

  const preview = document.getElementById('capture-preview');
  preview.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;" id="capture-placeholder">${t('cameraOffline')}</span>`;
  setCaptureReady(false);
  requestCoordinates();

  // Still inside the tap that opened this task, so the camera may be opened
  // straight away - "tap the task, take the photo". If the browser refuses,
  // the Open Camera button is right there.
  openTaskCamera();
}

function requestCoordinates() {
  const coordEl = document.getElementById('capture-coord');
  if (!coordEl) return;

  currentCoords = null;
  coordEl.textContent = currentLang === 'BM' ? 'Mendapatkan Lokasi...' : 'Fetching Location...';

  if (!navigator.geolocation) {
    coordEl.textContent = currentLang === 'BM' ? 'Geolokasi tidak disokong' : 'Geolocation not supported';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      currentCoords = `${lat}, ${lng}`;
      coordEl.textContent = currentCoords;
    },
    () => {
      coordEl.textContent = currentLang === 'BM'
        ? 'Gagal mendapatkan koordinat (GPS Ditutup)'
        : 'Failed to retrieve coordinates (GPS Disabled)';
    },
    { timeout: 10000 }
  );
}

function submitCapture(event) {
  event.preventDefault();
  if (!currentTask) return;

  const { location, slot, shiftDate } = currentTask;

  if (!canAccessModule(location)) {
    alert(permissionDeniedMessage());
    showHomePage();
    return;
  }

  if (!currentPhoto) {
    alert(t('photoRequired'));
    return;
  }

  if (isTaskDone(location, slot, shiftDate)) {
    alert(t('alreadyDone'));
    renderTaskScreens();
    showHomePage();
    return;
  }

  const now = new Date();
  const entry = {
    location,
    user: portal ? portal.user : '',
    date: localDateString(now),
    time: slot,
    coordinates: currentCoords || '',
    shift: shiftDate,
    photo: currentPhoto,
    submittedAt: now.toISOString()
  };

  const logs = getAllLogs();
  logs.push(entry);

  let message = t('flashSaved')(location, slot);
  if (!saveLogs(logs)) {
    // Storage is full. Keep the task itself rather than losing the work.
    entry.photo = null;
    if (!saveLogs(logs)) {
      alert(t('saveFailed'));
      return;
    }
    message = t('savedNoPhoto');
  }

  currentTask = null;
  currentPhoto = null;
  currentCoords = null;
  renderTaskScreens();
  showHomePage();
  flash(message);
}

// --------------------------------------------------- navigation / page views ----

function showPage(pageId) {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById(pageId).style.display = 'block';
  window.scrollTo(0, 0);
}

function showHomePage() {
  currentTask = null;
  currentPhoto = null;
  currentCoords = null;
  showPage('home-page');
  if (portal) renderTaskScreens();
}

function showDonePage() {
  if (!getAllowedModules().length) {
    showHomePage();
    return;
  }
  renderTaskScreens();
  showPage('done-page');
}

function showReportPage() {
  if (!portal) {
    showHomePage();
    return;
  }
  showPage('report-module-page');
  populateReportLocationDropdown();
  populateReportYearDropdown();
  generateReport();
}

function showSettingsPage() {
  if (!isAdmin()) {
    alert(currentLang === 'BM'
      ? 'Hanya HQ Admin boleh membuka Tetapan.'
      : 'Only an HQ Admin can open Settings.');
    showHomePage();
    return;
  }

  showPage('settings-module-page');

  const settingsDisplay = document.getElementById('settings-user-display');
  if (settingsDisplay) settingsDisplay.textContent = portal.name;

  updateStorageUsage();
}

function stopActiveCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }
}

function handleClick() {
  alert(currentLang === 'BM'
    ? 'Data berjaya diselaraskan dengan pelayan!'
    : 'Data synchronized successfully with server!');
}

// --------------------------------------------------- portal handover / UI ----

// Decide what the app shows for the user the portal handed over. Without
// context nothing but the "open from the FC Portal" notice is rendered.
function applyPortalContext() {
  const noContext = document.getElementById('no-context-section');
  const appContent = document.getElementById('app-content');
  const navDone = document.getElementById('nav-done');
  const navReport = document.getElementById('nav-about');
  const navSettings = document.getElementById('nav-settings');

  if (!portal) {
    if (noContext) noContext.style.display = 'block';
    if (appContent) appContent.style.display = 'none';
    if (navDone) navDone.style.display = 'none';
    if (navReport) navReport.style.display = 'none';
    if (navSettings) navSettings.style.display = 'none';
    return;
  }

  if (noContext) noContext.style.display = 'none';
  if (appContent) appContent.style.display = 'block';
  if (navReport) navReport.style.display = 'inline';
  if (navSettings) navSettings.style.display = isAdmin() ? 'inline' : 'none';

  const settingsDisplay = document.getElementById('settings-user-display');
  if (settingsDisplay) settingsDisplay.textContent = portal.name;

  applyAccessControl();
  renderTaskScreens();
}

function applyAccessControl() {
  const hasAccess = getAllowedModules().length > 0;

  const todo = document.getElementById('todo-section');
  const syncRow = document.querySelector('.sync-row');
  const notice = document.getElementById('no-access-notice');
  const navDone = document.getElementById('nav-done');
  if (todo) todo.style.display = hasAccess ? 'block' : 'none';
  if (syncRow) syncRow.style.display = hasAccess ? 'block' : 'none';
  if (notice) notice.style.display = hasAccess ? 'none' : 'block';
  if (navDone) navDone.style.display = hasAccess ? 'inline' : 'none';

  const adminSection = document.getElementById('settings-admin-section');
  if (adminSection) adminSection.style.display = isAdmin() ? 'block' : 'none';
}

// ------------------------------------------------------------ photo storage ----

function updateStorageUsage() {
  const el = document.getElementById('settings-storage-usage');
  if (!el) return;
  const bytes = getAllLogs().reduce((sum, log) => sum + (log.photo ? log.photo.length : 0), 0);
  el.textContent = t('storageUsage')((bytes / (1024 * 1024)).toFixed(2));
}

function clearStoredPhotos() {
  if (!isAdmin()) return;
  if (!confirm(t('confirmClearPhotos'))) return;

  const logs = getAllLogs().map(log => {
    const copy = Object.assign({}, log);
    delete copy.photo;
    return copy;
  });

  if (!saveLogs(logs)) return;

  updateStorageUsage();
  renderTaskScreens();
  alert(t('photosCleared'));
}

// ---------------------------------------------------------------- reporting ----

// The Location dropdown only offers locations the signed-in user may see.
// "All Locations" only appears when there is more than one to choose between.
function populateReportLocationDropdown() {
  const select = document.getElementById('report-module-select');
  if (!select) return;

  const allowed = getAllowedModules();
  const allLabel = currentLang === 'BM' ? 'Semua Lokasi' : 'All Locations';

  let html = allowed.length > 1 ? `<option value="ALL" id="opt-all">${allLabel}</option>` : '';
  allowed.forEach(mod => {
    const label = mod.toUpperCase();
    html += `<option value="${label}">${label}</option>`;
  });

  select.innerHTML = html;
}

function populateReportYearDropdown() {
  const logs = getVisibleLogs();
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

function generateReport() {
  const logs = getVisibleLogs();
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
    tr.innerHTML = `<td colspan="5" style="text-align: center; color: var(--text-muted);">${currentLang === 'BM' ? 'Tiada rekod log ditemui.' : 'No log records found.'}</td>`;
    tbody.appendChild(tr);
    return;
  }

  // Newest first, so the most recent shift is at the top.
  const ordered = filteredLogs.slice().sort((a, b) => {
    const shiftDiff = logShiftDate(b).localeCompare(logShiftDate(a));
    if (shiftDiff !== 0) return shiftDiff;
    return SLOTS.findIndex(s => s.key === b.time) - SLOTS.findIndex(s => s.key === a.time);
  });

  ordered.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${log.location}</strong></td>
      <td>${log.date}</td>
      <td>${log.time}</td>
      <td style="font-family: monospace;">${log.coordinates || '&mdash;'}</td>
      <td class="no-print">${log.photo ? `<img class="report-thumb" src="${log.photo}" alt="${log.location} ${log.time}">` : '&mdash;'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function printReport() {
  window.print();
}

// ------------------------------------------------------------- translations ----

// Writes text only when the element exists. Several nodes are built or hidden
// conditionally, so they may be absent when the language is toggled.
function setTextIfPresent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toggleLanguage() {
  currentLang = currentLang === 'EN' ? 'BM' : 'EN';
  setTextIfPresent('nav-lang', `Language (${currentLang})`);

  const bm = currentLang === 'BM';

  // Portal handover screen
  setTextIfPresent('no-context-title', bm ? 'Buka dari FC Portal' : 'Open from the FC Portal');
  setTextIfPresent('no-context-desc', bm
    ? 'Mata Malam adalah sebahagian daripada sistem MJM A1. Sila buka melalui FC Portal supaya aplikasi tahu siapa anda dan lokasi yang anda liputi.'
    : 'Mata Malam is part of the MJM A1 system. Open it from the FC Portal so it knows who you are and which locations you cover.');
  setTextIfPresent('no-context-hint', bm
    ? 'Pautan ini tidak mengandungi maklumat portal.'
    : 'This link is missing its portal details.');
  setTextIfPresent('hero-btn', bm ? 'Selaraskan Data' : 'Synchronize Data');
  setTextIfPresent('nav-done', bm ? 'Selesai' : 'Done');
  setTextIfPresent('nav-about', bm ? 'Laporan' : 'Report');
  setTextIfPresent('nav-settings', bm ? 'Tetapan' : 'Settings');
  setTextIfPresent('footer-rights', bm ? 'Hak cipta terpelihara.' : 'All rights reserved.');

  // Task lists
  setTextIfPresent('todo-title', t('todoTitle'));
  setTextIfPresent('done-title', t('doneTitle'));
  setTextIfPresent('done-history-link', t('historyLink'));
  setTextIfPresent('no-access-title', bm ? 'Tiada Lokasi Diberikan' : 'No Locations Assigned');
  setTextIfPresent('no-access-desc', bm
    ? 'Pautan FC Portal anda tidak memberikan sebarang lokasi. Sila hubungi pentadbir MJM A1 anda.'
    : 'Your FC Portal link did not grant any locations. Please contact your MJM A1 administrator.');

  // Capture screen
  setTextIfPresent('back-home-capture', bm ? '← Kembali ke Senarai Tugasan' : '← Back to To-Do List');
  setTextIfPresent('back-home-done', bm ? '← Kembali ke Senarai Tugasan' : '← Back to To-Do List');
  setTextIfPresent('capture-desc', t('captureDesc'));
  setTextIfPresent('capture-label-shift', bm ? 'Tarikh Syif (Automatik)' : 'Shift Date (Automatic)');
  setTextIfPresent('capture-label-photo', bm ? 'Gambar (Wajib)' : 'Photo (Required)');
  setTextIfPresent('capture-label-coord', bm ? 'Koordinat (Automatik)' : 'Coordinate (Automatic)');
  setTextIfPresent('capture-submit', t('submitTask'));
  setTextIfPresent('capture-placeholder', t('cameraOffline'));
  setCaptureReady(!!currentPhoto);

  // Report
  setTextIfPresent('report-title', bm ? 'Laporan Log' : 'Log Reports');
  setTextIfPresent('report-desc', bm
    ? 'Tapis entri log yang dihantar mengikut bulan, tahun, dan pilihan lokasi.'
    : 'Filter submitted log entries by month, year, and location selection.');
  setTextIfPresent('btn-print', bm ? 'Cetak Laporan' : 'Print Report');
  setTextIfPresent('label-report-month', bm ? 'Pilih Bulan' : 'Select Month');
  setTextIfPresent('label-report-year', bm ? 'Pilih Tahun' : 'Select Year');
  setTextIfPresent('label-report-module', bm ? 'Pilih Lokasi' : 'Select Location');
  setTextIfPresent('opt-all-months', bm ? 'Semua Bulan' : 'All Months');
  setTextIfPresent('opt-all-years', bm ? 'Semua Tahun' : 'All Years');
  setTextIfPresent('opt-all', bm ? 'Semua Lokasi' : 'All Locations');
  setTextIfPresent('th-location', bm ? 'Lokasi' : 'Location');
  setTextIfPresent('th-date', bm ? 'Tarikh' : 'Date');
  setTextIfPresent('th-timeslot', bm ? 'Slot Masa' : 'Time Slot');
  setTextIfPresent('th-coordinates', bm ? 'Koordinat' : 'Coordinates');
  setTextIfPresent('th-photo', bm ? 'Gambar' : 'Photo');
  setTextIfPresent('back-home-report', bm ? '← Kembali ke Utama' : '← Back to Home');

  // Settings
  setTextIfPresent('settings-title', bm ? 'Tetapan' : 'Settings');
  setTextIfPresent('settings-desc', bm
    ? 'Butiran sesi daripada FC Portal, dan storan yang digunakan oleh gambar pada peranti ini.'
    : 'Session details supplied by the FC Portal, and storage used by photos on this device.');
  setTextIfPresent('settings-current-user-label', bm ? 'Sesi Semasa' : 'Current Session');
  setTextIfPresent('settings-storage-label', bm ? 'Storan Gambar' : 'Photo Storage');
  setTextIfPresent('btn-clear-photos', bm ? 'Hapus Gambar Tersimpan' : 'Delete Stored Photos');
  setTextIfPresent('back-home-settings', bm ? '← Kembali ke Utama' : '← Back to Home');

  populateReportLocationDropdown();
  updateStorageUsage();
  if (portal) renderTaskScreens();
}

// --------------------------------------------------------------------- init ----

window.onload = function() {
  document.getElementById('year').textContent = new Date().getFullYear();
  portal = readPortalContext();
  applyPortalContext();
};

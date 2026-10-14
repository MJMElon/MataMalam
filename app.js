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

// Account used to bootstrap the very first install, when no users exist yet.
const STARTER_ADMIN = { phone: '0000', pin: '0000' };

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
let bootstrapState = 'ok';

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

// ------------------------------------------------------------ user accounts ----

function getRegisteredUsers() {
  return JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];
}

function saveRegisteredUsers(users) {
  localStorage.setItem('mata_malam_registered_users', JSON.stringify(users));
}

function getCurrentUser() {
  const phone = localStorage.getItem('mata_malam_user');
  if (!phone) return null;
  return getRegisteredUsers().find(u => u.phone === phone) || null;
}

function isAdmin() {
  const user = getCurrentUser();
  return !!user && user.role === 'HQ Admin';
}

// Locations the signed-in user may see. HQ Admin sees everything; for everyone
// else a location counts as allowed unless its permission is explicitly false,
// so accounts created before permissions were enforced keep working until an
// admin unticks them.
function getAllowedModules() {
  const user = getCurrentUser();
  if (!user) return [];
  if (user.role === 'HQ Admin') return MODULES.slice();
  const perms = user.permissions || {};
  return MODULES.filter(mod => perms[mod] !== false);
}

function canAccessModule(moduleName) {
  return getAllowedModules().includes(String(moduleName).toLowerCase());
}

// An HQ Admin must always exist, otherwise nobody can reach the admin-only
// User Management screen. Returns 'seeded' when a starter admin had to be
// created, so the caller can surface its credentials.
function ensureAdminExists() {
  const users = getRegisteredUsers();

  if (users.length === 0) {
    users.push({
      phone: STARTER_ADMIN.phone,
      pin: STARTER_ADMIN.pin,
      role: 'HQ Admin',
      permissions: { bnn: true, unn1: true, unn2: true }
    });
    saveRegisteredUsers(users);
    return 'seeded';
  }

  if (!users.some(u => u.role === 'HQ Admin')) {
    users[0].role = 'HQ Admin';
    saveRegisteredUsers(users);
    return 'promoted';
  }

  return 'ok';
}

function showBootstrapNotice(state) {
  const notice = document.getElementById('bootstrap-notice');
  if (!notice) return;

  if (state !== 'seeded') {
    notice.style.display = 'none';
    return;
  }

  notice.style.display = 'block';
  notice.innerHTML = currentLang === 'BM'
    ? `Tiada pengguna berdaftar, jadi akaun HQ Admin permulaan telah dibuat &mdash; PIN: <strong>${STARTER_ADMIN.pin}</strong>. Log masuk, tambah pengguna sebenar, kemudian tukar peranan akaun ini.`
    : `No users were registered, so a starter HQ Admin account was created &mdash; PIN: <strong>${STARTER_ADMIN.pin}</strong>. Sign in, add your real users, then change this account's role.`;
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
  if (localStorage.getItem('mata_malam_user')) renderTaskScreens();
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

  const loggedUser = localStorage.getItem('mata_malam_user');
  const settingsDisplay = document.getElementById('settings-user-display');
  if (settingsDisplay && loggedUser) settingsDisplay.textContent = loggedUser;

  updateStorageUsage();
  switchSettingsTab('register');
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

// Settings tab switching logic
function switchSettingsTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  if (tabName === 'register') {
    document.getElementById('tab-btn-register').classList.add('active');
    document.getElementById('tab-content-register').classList.add('active');
  } else {
    document.getElementById('tab-btn-registered').classList.add('active');
    document.getElementById('tab-content-registered').classList.add('active');
    renderRegisteredUsersList();
  }
}

// ------------------------------------------------------------ sign in / out ----

// The PIN is both the credential and the thing that identifies the account,
// which is why registerable PINs have to be unique.
function handleSignIn(event) {
  event.preventDefault();
  const pin = document.getElementById('signin-pin').value.trim();
  const errorDiv = document.getElementById('signin-error');

  if (!pin) {
    errorDiv.textContent = currentLang === 'BM' ? 'Sila masukkan PIN anda.' : 'Please enter your PIN.';
    return;
  }

  const matchedUser = getRegisteredUsers().find(u => u.pin === pin);

  if (!matchedUser) {
    errorDiv.textContent = currentLang === 'BM'
      ? 'PIN tidak sah atau belum berdaftar.'
      : 'That PIN is not recognised.';
    document.getElementById('signin-pin').value = '';
    return;
  }

  errorDiv.textContent = '';
  localStorage.setItem('mata_malam_user', matchedUser.phone);
  updateAuthState();
}

function handleSignOut() {
  localStorage.removeItem('mata_malam_user');
  document.getElementById('signin-pin').value = '';
  updateAuthState();
  showHomePage();
}

function updateAuthState() {
  const loggedUser = localStorage.getItem('mata_malam_user');
  const signinSection = document.getElementById('signin-section');
  const heroSection = document.getElementById('hero-section');
  const welcomeBox = document.getElementById('user-welcome-box');
  const protectedContent = document.getElementById('protected-content');
  const loggedPhoneSpan = document.getElementById('logged-phone');
  const syncBtn = document.getElementById('hero-btn');
  const navDone = document.getElementById('nav-done');
  const navAbout = document.getElementById('nav-about');
  const navSettings = document.getElementById('nav-settings');
  const navSignout = document.getElementById('nav-signout');

  if (loggedUser) {
    // The To-Do List is the landing view, so the whole hero steps aside.
    signinSection.style.display = 'none';
    if (heroSection) heroSection.style.display = 'none';
    welcomeBox.style.display = 'none';
    protectedContent.style.display = 'block';
    if (syncBtn) syncBtn.style.display = 'inline-block';
    if (navDone) navDone.style.display = 'inline';
    if (navAbout) navAbout.style.display = 'inline';
    if (navSettings) navSettings.style.display = isAdmin() ? 'inline' : 'none'; // Settings is HQ Admin only
    if (navSignout) navSignout.style.display = 'inline-block';
    if (loggedPhoneSpan) loggedPhoneSpan.textContent = loggedUser;
    const settingsDisplay = document.getElementById('settings-user-display');
    if (settingsDisplay) settingsDisplay.textContent = loggedUser;
    applyAccessControl();
    renderTaskScreens();
  } else {
    signinSection.style.display = 'block';
    if (heroSection) heroSection.style.display = 'block';
    welcomeBox.style.display = 'none';
    protectedContent.style.display = 'none';
    if (syncBtn) syncBtn.style.display = 'none';
    if (navDone) navDone.style.display = 'none';
    if (navAbout) navAbout.style.display = 'none';
    if (navSettings) navSettings.style.display = 'none';
    if (navSignout) navSignout.style.display = 'none';
  }
}

// Show the task lists only when the user actually has locations assigned.
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

// -------------------------------------------------------- user management ----

function handleRegister(event) {
  event.preventDefault();

  if (!isAdmin()) return;

  const phone = document.getElementById('reg-phone').value.trim();
  const pin = document.getElementById('reg-pin').value.trim();
  const msgDiv = document.getElementById('reg-message');

  if (!phone || !pin) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM' ? 'Sila masukkan nombor telefon dan PIN.' : 'Please enter phone number and PIN.';
    return;
  }

  let registeredUsers = getRegisteredUsers();

  if (registeredUsers.find(u => u.phone === phone)) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM' ? 'Nombor telefon sudah didaftarkan.' : 'Phone number is already registered.';
    return;
  }

  // Sign-in is by PIN alone, so a shared PIN would be ambiguous.
  if (registeredUsers.find(u => u.pin === pin)) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM'
      ? 'PIN itu sudah digunakan. Sila pilih PIN yang lain.'
      : 'That PIN is already in use. Please choose a different one.';
    return;
  }

  // Access is opt-in: an admin grants locations under User Management.
  registeredUsers.push({ phone, pin, role: 'Worker', permissions: { bnn: false, unn1: false, unn2: false } });
  saveRegisteredUsers(registeredUsers);

  msgDiv.style.color = 'var(--success-color)';
  msgDiv.textContent = currentLang === 'BM' ? 'Pengguna berjaya didaftarkan!' : 'User registered successfully!';

  document.getElementById('reg-phone').value = '';
  document.getElementById('reg-pin').value = '';
  renderRegisteredUsersList();
}

function updateRole(phone, newRole) {
  if (!isAdmin()) return;

  const registeredUsers = getRegisteredUsers();
  const user = registeredUsers.find(u => u.phone === phone);
  if (user) {
    user.role = newRole;
    saveRegisteredUsers(registeredUsers);
    reflectUserChange(phone);
  }
}

function updatePermission(phone, moduleKey, isChecked) {
  if (!isAdmin()) return;

  const registeredUsers = getRegisteredUsers();
  const user = registeredUsers.find(u => u.phone === phone);
  if (user) {
    if (!user.permissions) user.permissions = { bnn: true, unn1: true, unn2: true };
    user.permissions[moduleKey] = isChecked;
    saveRegisteredUsers(registeredUsers);
    reflectUserChange(phone);
  }
}

// When an admin edits their own account, re-apply the UI immediately, and leave
// the admin screen if they just dropped their own HQ Admin role.
function reflectUserChange(phone) {
  if (phone !== localStorage.getItem('mata_malam_user')) return;
  const stillAdmin = isAdmin();
  updateAuthState();
  if (!stillAdmin) showHomePage();
}

function renderRegisteredUsersList() {
  const container = document.getElementById('registered-users-list');
  if (!container) return;

  // Never render the user list for a non-admin, even into hidden markup.
  if (!isAdmin()) {
    container.innerHTML = '';
    return;
  }

  const registeredUsers = getRegisteredUsers();

  if (registeredUsers.length === 0) {
    container.textContent = currentLang === 'BM' ? 'Tiada nombor telefon berdaftar.' : 'No registered phone numbers.';
    return;
  }

  // Data saved before PIN-only sign-in may contain duplicates, which would
  // make a PIN ambiguous. Flag them so an admin can correct them.
  const pinCounts = registeredUsers.reduce((counts, u) => {
    counts[u.pin] = (counts[u.pin] || 0) + 1;
    return counts;
  }, {});

  container.innerHTML = registeredUsers.map(u => {
    const role = u.role || 'Worker';
    const perms = u.permissions || { bnn: true, unn1: true, unn2: true };
    const duplicatePin = pinCounts[u.pin] > 1
      ? `<div style="color: var(--error-color); font-size: 0.8rem; margin-bottom: 0.4rem;">${currentLang === 'BM'
          ? 'PIN ini dikongsi dengan akaun lain. Sign-in akan memilih akaun pertama &mdash; sila tukar salah satu PIN.'
          : 'This PIN is shared with another account. Sign-in will pick the first one &mdash; change one of them.'}</div>`
      : '';
    return `${duplicatePin}
      <div style="margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.5rem;">
          <span><strong>Phone:</strong> ${u.phone}</span>
          <div>
            <label style="font-size: 0.8rem; margin-right: 0.2rem;">Role:</label>
            <select class="select-input" style="padding: 0.2rem 0.4rem; font-size: 0.8rem; width: auto; display: inline-block;" onchange="updateRole('${u.phone}', this.value)">
              <option value="Worker" ${role === 'Worker' ? 'selected' : ''}>Worker</option>
              <option value="FC" ${role === 'FC' ? 'selected' : ''}>FC</option>
              <option value="HQ Admin" ${role === 'HQ Admin' ? 'selected' : ''}>HQ Admin</option>
            </select>
          </div>
        </div>
        <div style="display: flex; gap: 1rem; font-size: 0.85rem; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
          <span>Permissions:</span>
          <label><input type="checkbox" ${perms.bnn !== false ? 'checked' : ''} onchange="updatePermission('${u.phone}', 'bnn', this.checked)"> BNN</label>
          <label><input type="checkbox" ${perms.unn1 !== false ? 'checked' : ''} onchange="updatePermission('${u.phone}', 'unn1', this.checked)"> UNN1</label>
          <label><input type="checkbox" ${perms.unn2 !== false ? 'checked' : ''} onchange="updatePermission('${u.phone}', 'unn2', this.checked)"> UNN2</label>
        </div>
      </div>
    `;
  }).join('');
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

  // Home / sign-in
  setTextIfPresent('hero-title', bm ? 'Selamat Datang ke Mata Malam' : 'Welcome to Mata Malam');
  setTextIfPresent('hero-desc', bm ? 'Ambil Gambar • Rekod Masa • Pantau Kerja' : 'Take Pictures • Record Time • Monitor Work');
  setTextIfPresent('hero-btn', bm ? 'Selaraskan Data' : 'Synchronize Data');
  setTextIfPresent('signin-title', bm ? 'Log Masuk' : 'Sign In');
  setTextIfPresent('label-pin', 'PIN');
  setTextIfPresent('signin-btn', bm ? 'Log Masuk' : 'Sign In');
  setTextIfPresent('welcome-text', bm ? 'Berjaya log masuk' : 'Signed in successfully');
  setTextIfPresent('nav-done', bm ? 'Selesai' : 'Done');
  setTextIfPresent('nav-about', bm ? 'Laporan' : 'Report');
  setTextIfPresent('nav-settings', bm ? 'Tetapan' : 'Settings');
  setTextIfPresent('nav-signout', bm ? 'Log Keluar' : 'Sign Out');
  setTextIfPresent('footer-rights', bm ? 'Hak cipta terpelihara.' : 'All rights reserved.');

  // Task lists
  setTextIfPresent('todo-title', t('todoTitle'));
  setTextIfPresent('done-title', t('doneTitle'));
  setTextIfPresent('done-history-link', t('historyLink'));
  setTextIfPresent('no-access-title', bm ? 'Tiada Lokasi Diberikan' : 'No Locations Assigned');
  setTextIfPresent('no-access-desc', bm
    ? 'Akaun anda belum diberikan sebarang lokasi. Sila hubungi pentadbir anda.'
    : 'Your account has no locations assigned yet. Please contact your administrator.');

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
    ? 'Urus keutamaan akaun anda dan lihat konfigurasi sesi aktif.'
    : 'Manage your account preferences and view active session configuration.');
  setTextIfPresent('settings-current-user-label', bm ? 'Sesi Semasa' : 'Current Session');
  setTextIfPresent('settings-storage-label', bm ? 'Storan Gambar' : 'Photo Storage');
  setTextIfPresent('btn-clear-photos', bm ? 'Hapus Gambar Tersimpan' : 'Delete Stored Photos');
  setTextIfPresent('tab-btn-register', bm ? 'Tambah Pengguna Baharu' : 'Add New User');
  setTextIfPresent('tab-btn-registered', bm ? 'Pengurusan Pengguna' : 'User Management');
  setTextIfPresent('label-reg-phone', bm ? 'Nombor Telefon' : 'Phone Number');
  setTextIfPresent('label-reg-pin', 'PIN');
  setTextIfPresent('reg-btn', bm ? 'Tambah Pengguna Baharu' : 'Add New User');
  setTextIfPresent('label-registered-list', bm
    ? 'Nombor Telefon Berdaftar & Kebenaran:'
    : 'Registered Phone Numbers & Permissions:');
  setTextIfPresent('back-home-settings', bm ? '← Kembali ke Utama' : '← Back to Home');

  renderRegisteredUsersList();
  populateReportLocationDropdown();
  updateStorageUsage();
  showBootstrapNotice(bootstrapState);
  if (localStorage.getItem('mata_malam_user')) renderTaskScreens();
}

// --------------------------------------------------------------------- init ----

window.onload = function() {
  document.getElementById('year').textContent = new Date().getFullYear();
  bootstrapState = ensureAdminExists();
  showBootstrapNotice(bootstrapState);
  updateAuthState();
};

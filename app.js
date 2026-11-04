let activeStream = null;

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
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('settings-module-page').style.display = 'block';
  loadTaskSettingsForm();
  loadTaskSlotsForm();
  switchSettingsTab('task-timing');
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
}

function showReportPage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('report-module-page').style.display = 'block';
  populateReportYearDropdown();
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
const TASK_LOCATIONS = ['BNN', 'UNN1', 'UNN2'];
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

function getTaskSlots() {
  try {
    const saved = JSON.parse(localStorage.getItem('mata_malam_task_slots'));
    if (Array.isArray(saved) && saved.length > 0 && saved.every(s => /^\d{2}:\d{2}$/.test(s))) return sortSlots(saved);
  } catch (err) {}
  return [...DEFAULT_TASK_SLOTS];
}

// Slot labels in shift order, e.g. ['6pm', '9pm', '12am', '3am', '6am']
function getTaskTimes() {
  return getTaskSlots().map(formatSlotLabel);
}

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
  const exampleTime = getTaskTimes()[0];
  const { opensAt, closesAt } = getTaskWindow(getShiftDate(), exampleTime, settings);
  // Bubble above each slider thumb shows the duration; the header shows the resulting time for the first task of the shift
  setSliderBubble('setting-opens-before', 'bubble-opens-before', formatDuration(settings.opensBeforeMinutes));
  setSliderBubble('setting-window', 'bubble-window', formatDuration(settings.windowMinutes));
  document.getElementById('value-opens-before').textContent = `${exampleTime} → ${formatClock(opensAt)}`;
  document.getElementById('preview-scheduled').textContent = exampleTime;
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
  localStorage.setItem('mata_malam_task_settings', JSON.stringify(settings));
  message.style.color = '#3fb950';
  message.textContent = currentLang === 'BM' ? 'Tetapan disimpan.' : 'Settings saved.';
  renderTasks();
}

function resetTaskSettings() {
  loadTaskSettingsForm(DEFAULT_TASK_SETTINGS);
}

// Schedule tab: the admin-editable list of photo times
function loadTaskSlotsForm(slots = getTaskSlots()) {
  const list = document.getElementById('slot-list');
  list.innerHTML = '';
  slots.forEach(slot => addSlotRow(slot));
  document.getElementById('schedule-message').textContent = '';
}

function addSlotRow(value) {
  const list = document.getElementById('slot-list');
  if (list.children.length >= MAX_TASK_SLOTS) return;
  if (value === undefined) {
    // Suggest one hour after the last time in the list
    const inputs = list.querySelectorAll('input');
    const last = inputs.length ? inputs[inputs.length - 1].value : '17:00';
    const [hours, minutes] = (last || '17:00').split(':').map(Number);
    value = `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const li = document.createElement('li');
  li.className = 'slot-row';
  li.innerHTML = `
    <input type="time" class="select-input slot-input" value="${value}" required aria-label="${currentLang === 'BM' ? 'Masa gambar' : 'Photo time'}">
    <button type="button" class="slot-remove" aria-label="${currentLang === 'BM' ? 'Buang' : 'Remove'}">✕</button>
  `;
  li.querySelector('input').oninput = () => { document.getElementById('schedule-message').textContent = ''; };
  li.querySelector('button').onclick = () => {
    if (list.children.length > 1) li.remove();
    updateSlotButtons();
  };
  list.appendChild(li);
  updateSlotButtons();
}

function updateSlotButtons() {
  const count = document.getElementById('slot-list').children.length;
  document.getElementById('slot-add').disabled = count >= MAX_TASK_SLOTS;
  document.querySelectorAll('#slot-list .slot-remove').forEach(btn => { btn.disabled = count <= 1; });
}

function saveTaskSlots(event) {
  event.preventDefault();
  const message = document.getElementById('schedule-message');
  const slots = [...document.querySelectorAll('#slot-list input')].map(input => input.value);

  let error = null;
  if (slots.some(slot => !/^\d{2}:\d{2}$/.test(slot))) {
    error = currentLang === 'BM' ? 'Sila isi semua masa.' : 'Please fill in every time.';
  } else if (new Set(slots).size !== slots.length) {
    error = currentLang === 'BM' ? 'Masa yang sama dimasukkan lebih daripada sekali.' : 'The same time is listed more than once.';
  }
  if (error) {
    message.style.color = 'var(--error-color)';
    message.textContent = error;
    return;
  }

  // Record any tasks already missed under the old schedule, then only count misses from now on,
  // so a newly added time whose window has already passed is not marked "Work Not Completed"
  recordMissedTasks();
  localStorage.setItem('mata_malam_task_slots', JSON.stringify(sortSlots(slots)));
  localStorage.setItem('mata_malam_tracking_start', String(Date.now()));

  loadTaskSlotsForm();
  message.style.color = '#3fb950';
  message.textContent = currentLang === 'BM' ? 'Jadual disimpan.' : 'Schedule saved.';
  renderTasks();
  updateSettingsPreview();
}

function resetTaskSlots() {
  loadTaskSlotsForm(DEFAULT_TASK_SLOTS);
}

function getLogs() {
  return JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
}

function formatClock(time) {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const times = getTaskTimes();
  const logs = getLogs();
  let changed = false;

  for (let i = 31; i >= 0; i--) {
    const date = getShiftDate(new Date(now - i * DAY_MS));
    times.forEach(time => {
      const { closesAt } = getTaskWindow(date, time, settings);
      if (closesAt > now || closesAt <= trackingStart) return;
      TASK_LOCATIONS.forEach(location => {
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
  getTaskTimes().forEach(time => {
    TASK_LOCATIONS.forEach(location => {
      const log = logs.find(l => l.location === location && l.time === time);
      tasks.push({ location, time, date, log, ...getTaskWindow(date, time, settings) });
    });
  });
  return tasks;
}

function renderTasks() {
  recordMissedTasks();
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

  document.getElementById('todo-meta').textContent = `${date} • ${completed} / ${tasks.length} ${currentLang === 'BM' ? 'selesai' : 'done'}`;

  const todoList = document.getElementById('todo-list');
  todoList.innerHTML = '';
  if (due.length === 0) {
    let message;
    if (next) {
      message = currentLang === 'BM'
        ? `Tiada tugasan buat masa ini. Tugasan seterusnya (${next.time}) akan dipaparkan pada ${formatClock(next.opensAt)}.`
        : `No tasks due right now. The next task (${next.time}) appears at ${formatClock(next.opensAt)}.`;
    } else {
      message = currentLang === 'BM' ? 'Tiada lagi tugasan untuk syif ini.' : 'No more tasks for this shift.';
    }
    todoList.innerHTML = `<li class="task-empty">${message}</li>`;
  }

  due.forEach((task, index) => {
    const minutesLeft = Math.max(1, Math.ceil((task.closesAt - now) / 60000));
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === 0 ? 'task-item task-next' : 'task-item';
    btn.onclick = () => startTask(task);
    btn.innerHTML = `
      <span class="task-time">${task.time}</span>
      <span class="task-location">${task.location}
        <span class="task-deadline">${currentLang === 'BM' ? `Hantar sebelum ${formatClock(task.closesAt)} • ${minutesLeft} min lagi` : `Submit by ${formatClock(task.closesAt)} • ${minutesLeft} min left`}</span>
      </span>
      <span class="task-action">${index === 0 ? (currentLang === 'BM' ? 'Ambil Gambar' : 'Take Photo') : '📷'}</span>
    `;
    li.appendChild(btn);
    todoList.appendChild(li);
  });
}

function renderHistory(now = Date.now()) {
  const dates = [];
  for (let i = 0; i < HISTORY_SHIFTS; i++) dates.push(getShiftDate(new Date(now - i * DAY_MS)));
  const entries = getLogs()
    .filter(log => dates.includes(log.date) && !Number.isNaN(parseSlotLabel(log.time)))
    .map(log => ({ log, ...getTaskWindow(log.date, log.time) }))
    .sort((a, b) => b.scheduledAt - a.scheduledAt || TASK_LOCATIONS.indexOf(a.log.location) - TASK_LOCATIONS.indexOf(b.log.location));

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
      <span class="task-time">${log.time}</span>
      <span class="task-location">${log.location}</span>
      <span class="task-action">${remark}</span>
    `;
    if (!missed && log.routeId) {
      li.classList.add('task-has-route');
      li.insertAdjacentHTML('beforeend', `
        <div class="history-route">
          <span>🛣 ${formatDistance(log.routeDistance || 0)} • ${formatElapsed(log.routeDuration || 0)}</span>
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
      loadPhoto(log.id).then(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        photoUrls.push(url);
        img.src = url;
        img.alt = `${log.location} ${log.time}`;
      }).catch(() => {});
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
  const changed = recordMissedTasks(now);
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
  pendingTask = { location, time, date, closesAt };
  pendingPhoto = null;
  pendingCoordinates = fetchCoordinates();

  document.getElementById('sheet-task-label').textContent = `${time} • ${location}`;
  const coordEl = document.getElementById('sheet-coord');
  coordEl.textContent = currentLang === 'BM' ? 'Mengesan Lokasi...' : 'Detecting Location...';
  const current = pendingTask;
  pendingCoordinates.then(coord => {
    if (pendingTask === current) coordEl.textContent = coord;
  });

  document.getElementById('submit-sheet').hidden = false;
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
    submitBtn.disabled = false;
    submitBtn.textContent = currentLang === 'BM' ? 'Hantar' : 'Submit';
    setSheetMode('review');
    submitBtn.focus();
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
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
    submittedAt: new Date().toISOString()
  });
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));

  // Offer Road Tracking for the patrol that follows this photo
  localStorage.setItem('mata_malam_patrol_offer', id);
  savedRouteNotice = null;

  closeSubmitSheet();
  renderTasks();
  renderPatrolCard();
}

function closeSubmitSheet() {
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
    closeSubmitSheet();
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

// Road Tracking: after a task photo is submitted, the watchman can record the patrol route for
// that task. Routes are stored in IndexedDB and linked to the task's log entry.
const ROUTE_MIN_STEP_M = 10;        // ignore GPS jitter smaller than this
const ROUTE_MAX_ACCURACY_M = 50;    // ignore fixes less accurate than this

let activeRoute = null;
let routeWatchId = null;
let routeWakeLock = null;
let routeTimer = null;
let liveRouteMap = null;
let savedRouteNotice = null;
let historyRouteMaps = [];

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

function patrolTaskLabel(log) {
  return `${log.time} • ${log.location}`;
}

// The Road Tracking card on the To-Do page: offered after a photo is submitted, live while recording
function renderPatrolCard() {
  const section = document.getElementById('patrol-section');
  const offerId = localStorage.getItem('mata_malam_patrol_offer');
  const log = activeRoute ? findLog(activeRoute.logId) : savedRouteNotice ? findLog(savedRouteNotice.logId) : offerId ? findLog(offerId) : null;
  if (!log) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const tracking = !!activeRoute;
  const taskEl = document.getElementById('patrol-task');
  taskEl.innerHTML = `<strong>${patrolTaskLabel(log)}</strong> <span class="task-check">✓</span> ${currentLang === 'BM' ? 'Gambar dihantar' : 'Photo submitted'}`;
  document.getElementById('route-meta').textContent = tracking ? (currentLang === 'BM' ? '● Merekod' : '● Recording') : '';
  document.getElementById('route-stats').hidden = !tracking;
  document.getElementById('route-live-map').hidden = !tracking;

  const toggle = document.getElementById('route-toggle');
  const skip = document.getElementById('route-skip');
  toggle.hidden = !!savedRouteNotice && !tracking;
  toggle.textContent = tracking
    ? (currentLang === 'BM' ? 'Henti Jejak' : 'Stop Tracking')
    : (currentLang === 'BM' ? 'Mula Jejak Laluan' : 'Start Road Tracking');
  toggle.classList.toggle('btn-stop', tracking);
  skip.hidden = tracking;
  skip.textContent = savedRouteNotice ? (currentLang === 'BM' ? 'Tutup' : 'Close') : (currentLang === 'BM' ? 'Langkau' : 'Skip');

  if (tracking) {
    document.getElementById('route-distance').textContent = formatDistance(activeRoute.distance);
    document.getElementById('route-duration').textContent = formatElapsed(Date.now() - activeRoute.startedAt);
  }
  const status = document.getElementById('route-status');
  status.classList.remove('route-status-warning');
  if (savedRouteNotice) {
    status.textContent = currentLang === 'BM'
      ? `Laluan disimpan: ${formatDistance(savedRouteNotice.distance)} dalam ${formatElapsed(savedRouteNotice.duration)}. Lihat di Sejarah.`
      : `Route saved: ${formatDistance(savedRouteNotice.distance)} in ${formatElapsed(savedRouteNotice.duration)}. See History.`;
  } else if (tracking) {
    if (!status.dataset.warning) {
      status.textContent = currentLang === 'BM' ? 'Merekod laluan rondaan... Pastikan aplikasi kekal dibuka.' : 'Recording patrol route... Keep the app open.';
    }
  } else {
    status.textContent = currentLang === 'BM' ? 'Rekod laluan rondaan anda untuk tugasan ini?' : 'Record your patrol route for this task?';
  }
}

function setRouteWarning(text) {
  const status = document.getElementById('route-status');
  status.dataset.warning = text ? '1' : '';
  if (text) {
    status.textContent = text;
    status.classList.add('route-status-warning');
  }
}

function skipPatrol() {
  localStorage.removeItem('mata_malam_patrol_offer');
  savedRouteNotice = null;
  renderPatrolCard();
}

async function toggleRouteTracking() {
  if (activeRoute) {
    await stopRouteTracking();
  } else {
    await startRouteTracking();
  }
}

async function startRouteTracking() {
  const logId = localStorage.getItem('mata_malam_patrol_offer');
  if (!logId || !findLog(logId)) return;
  if (!navigator.geolocation) {
    setRouteWarning(currentLang === 'BM' ? 'Geolokasi tidak disokong pada peranti ini.' : 'Location is not supported on this device.');
    return;
  }
  activeRoute = { id: `route-${Date.now().toString(36)}`, logId, startedAt: Date.now(), endedAt: null, points: [], distance: 0 };
  try {
    await saveRoute(activeRoute);
  } catch (err) {
    activeRoute = null;
    setRouteWarning(currentLang === 'BM' ? 'Laluan tidak dapat disimpan pada peranti ini.' : 'The route could not be saved on this device.');
    return;
  }
  localStorage.removeItem('mata_malam_patrol_offer');
  localStorage.setItem('mata_malam_active_route', activeRoute.id);
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
  clearInterval(routeTimer);
  routeTimer = setInterval(renderPatrolCard, 15000);
  setRouteWarning('');
  renderPatrolCard();

  const mapEl = document.getElementById('route-live-map');
  if (!liveRouteMap) liveRouteMap = drawRouteMap(mapEl, activeRoute.points);
  if (liveRouteMap) liveRouteMap.map.invalidateSize();
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
  setRouteWarning('');
  renderPatrolCard();
}

function onRoutePositionError(error) {
  setRouteWarning(error.code === error.PERMISSION_DENIED
    ? (currentLang === 'BM' ? 'Akses lokasi ditolak. Sila benarkan lokasi untuk merekod laluan.' : 'Location access denied. Please allow location to record the route.')
    : (currentLang === 'BM' ? 'Mencari isyarat GPS...' : 'Searching for GPS signal...'));
}

async function stopRouteTracking() {
  if (routeWatchId !== null) navigator.geolocation.clearWatch(routeWatchId);
  routeWatchId = null;
  clearInterval(routeTimer);
  releaseRouteWakeLock();

  const route = activeRoute;
  activeRoute = null;
  localStorage.removeItem('mata_malam_active_route');
  if (liveRouteMap) liveRouteMap.map.remove();
  liveRouteMap = null;
  document.getElementById('route-live-map').innerHTML = '';
  if (!route) return;

  route.endedAt = Date.now();
  await saveRoute(route).catch(() => {});
  // Link the route to its task so History can show it
  const logs = getLogs();
  const log = logs.find(l => l.id === route.logId);
  if (log) {
    log.routeId = route.id;
    log.routeDistance = Math.round(route.distance);
    log.routeDuration = route.endedAt - route.startedAt;
    localStorage.setItem('mata_malam_logs', JSON.stringify(logs));
  }
  savedRouteNotice = { logId: route.logId, distance: route.distance, duration: route.endedAt - route.startedAt };
  setRouteWarning('');
  renderPatrolCard();
  renderHistory();
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
    if (!route || route.endedAt) {
      localStorage.removeItem('mata_malam_active_route');
      return;
    }
    activeRoute = route;
    beginRouteWatch();
  } catch (err) {}
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
  loadRoute(log.routeId).then(route => {
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
    tr.innerHTML = `<td colspan="5" style="text-align: center; color: var(--text-muted);">${currentLang === 'BM' ? 'Tiada rekod log ditemui.' : 'No log records found.'}</td>`;
    tbody.appendChild(tr);
    return;
  }

  filteredLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${log.location}</strong></td>
      <td>${log.date}</td>
      <td>${log.time}</td>
      <td style="font-family: monospace;">${log.coordinates}</td>
      <td>${log.status === 'missed'
        ? `<span class="task-remark-missed">${currentLang === 'BM' ? 'Kerja Tidak Disiapkan' : 'Work Not Completed'}</span>`
        : (currentLang === 'BM' ? 'Selesai' : 'Completed')}</td>
    `;
    tbody.appendChild(tr);
  });
}

function printReport() {
  window.print();
}

function handleClick() {
  alert(currentLang === 'BM' ? 'Data berjaya diselaraskan dengan pelayan!' : 'Data synchronized successfully with server!');
}

// Language Toggle logic
let currentLang = 'EN';
function toggleLanguage() {
  currentLang = currentLang === 'EN' ? 'BM' : 'EN';
  const langBtn = document.getElementById('nav-lang');
  langBtn.textContent = `Language (${currentLang})`;

  if (currentLang === 'BM') {
    document.getElementById('hero-btn').textContent = 'Selaraskan Data';
    document.getElementById('todo-title').textContent = 'Senarai Tugasan';
    document.getElementById('done-title').textContent = 'Sejarah';
    document.getElementById('route-title').textContent = 'Penjejakan Laluan';
    document.getElementById('lbl-route-distance').textContent = 'Jarak';
    document.getElementById('lbl-route-duration').textContent = 'Masa';
    document.getElementById('nav-done').textContent = 'Sejarah';
    document.getElementById('back-home-done').textContent = '← Kembali ke Senarai Tugasan';
    document.getElementById('sheet-cancel').textContent = 'Batal';
    document.getElementById('sheet-retake').textContent = 'Ambil Semula';
    document.getElementById('sheet-capture').textContent = 'Ambil Gambar';
    document.getElementById('sheet-submit').textContent = 'Hantar';
    document.getElementById('nav-about').textContent = 'Laporan';
    document.getElementById('nav-settings').textContent = 'Tetapan';
    document.getElementById('back-home-settings').textContent = '← Kembali ke Senarai Tugasan';
    document.getElementById('settings-title').textContent = 'Tetapan';
    document.getElementById('tab-btn-task-timing').textContent = 'Masa Tugasan';
    document.getElementById('tab-btn-schedule').textContent = 'Jadual';
    document.getElementById('slot-add').textContent = '+ Tambah Masa';
    document.getElementById('schedule-reset').textContent = 'Set Semula';
    document.getElementById('schedule-save').textContent = 'Simpan';
    document.getElementById('label-opens-before').textContent = 'Dipaparkan awal';
    document.getElementById('label-window').textContent = 'Had masa';
    document.getElementById('settings-reset').textContent = 'Set Semula';
    document.getElementById('settings-save').textContent = 'Simpan';
    document.getElementById('footer-rights').textContent = 'Hak cipta terpelihara.';
    
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
    document.getElementById('hero-btn').textContent = 'Synchronize Data';
    document.getElementById('todo-title').textContent = 'To-Do List';
    document.getElementById('done-title').textContent = 'History';
    document.getElementById('route-title').textContent = 'Road Tracking';
    document.getElementById('lbl-route-distance').textContent = 'Distance';
    document.getElementById('lbl-route-duration').textContent = 'Time';
    document.getElementById('nav-done').textContent = 'History';
    document.getElementById('back-home-done').textContent = '← Back to To-Do List';
    document.getElementById('sheet-cancel').textContent = 'Cancel';
    document.getElementById('sheet-retake').textContent = 'Retake';
    document.getElementById('sheet-capture').textContent = 'Capture';
    document.getElementById('sheet-submit').textContent = 'Submit';
    document.getElementById('nav-about').textContent = 'Report';
    document.getElementById('nav-settings').textContent = 'Settings';
    document.getElementById('back-home-settings').textContent = '← Back to To-Do List';
    document.getElementById('settings-title').textContent = 'Settings';
    document.getElementById('tab-btn-task-timing').textContent = 'Task Timing';
    document.getElementById('tab-btn-schedule').textContent = 'Schedule';
    document.getElementById('slot-add').textContent = '+ Add Time';
    document.getElementById('schedule-reset').textContent = 'Reset';
    document.getElementById('schedule-save').textContent = 'Save';
    document.getElementById('label-opens-before').textContent = 'Appears early';
    document.getElementById('label-window').textContent = 'Time limit';
    document.getElementById('settings-reset').textContent = 'Reset';
    document.getElementById('settings-save').textContent = 'Save';
    document.getElementById('footer-rights').textContent = 'All rights reserved.';

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
  renderPatrolCard();
}

// Initialize state on load
window.onload = function() {
  renderTasks();
  renderPatrolCard();
  resumeActiveRoute();
};

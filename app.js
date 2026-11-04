// App version: keep in step with version.json and the ?v= tags in index.html when publishing
const APP_VERSION = '2026-11-04h';

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
  updateTimeFormatToggle();
  document.getElementById('schedule-message').textContent = '';
}

function updateTimeFormatToggle() {
  const format = getTimeFormat();
  document.querySelectorAll('.segmented button').forEach(btn => {
    const active = btn.dataset.format === format;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Switches every time shown in the app between 12-hour and 24-hour format
function setTimeFormat(format) {
  const rows = [...document.querySelectorAll('#slot-list .slot-row')].map(getSlotRowValue);
  localStorage.setItem('mata_malam_time_format', format === '24' ? '24' : '12');
  const list = document.getElementById('slot-list');
  list.innerHTML = '';
  rows.forEach(value => addSlotRow(value, { focus: false }));
  updateTimeFormatToggle();
  renderTasks();
  updateSettingsPreview();
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
    };
  });
  li.querySelector('.slot-remove').onclick = () => {
    if (list.children.length > 1) li.remove();
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

// Times use one fixed format everywhere (e.g. "6:45 PM"), whatever the device's 12/24-hour setting
function getTimeFormat() {
  return localStorage.getItem('mata_malam_time_format') === '24' ? '24' : '12';
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
      <span class="task-time">${formatSlotTime(log.time)}</span>
      <span class="task-location">${log.location}</span>
      <span class="task-action">${remark}</span>
    `;
    if (!missed && log.routeId) {
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
      loadPhoto(log.id).then(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        photoUrls.push(url);
        img.src = url;
        img.alt = `${log.location} ${formatSlotTime(log.time)}`;
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
      <td>${formatSlotTime(log.time)}</td>
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
    document.getElementById('tab-btn-schedule').textContent = 'Jadual';
    document.getElementById('slot-add-label').textContent = 'Tambah Masa';
    document.getElementById('schedule-reset').textContent = 'Set Semula';
    document.getElementById('schedule-save').textContent = 'Simpan Perubahan';
    document.getElementById('lbl-time-format').textContent = 'Format Masa';
    document.getElementById('fmt-12').textContent = '12 jam';
    document.getElementById('fmt-24').textContent = '24 jam';
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
    document.getElementById('hero-btn').textContent = 'Synchronize Data';
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
    document.getElementById('tab-btn-schedule').textContent = 'Schedule';
    document.getElementById('slot-add-label').textContent = 'Add Time';
    document.getElementById('schedule-reset').textContent = 'Reset';
    document.getElementById('schedule-save').textContent = 'Save Changes';
    document.getElementById('lbl-time-format').textContent = 'Time Format';
    document.getElementById('fmt-12').textContent = '12-hour';
    document.getElementById('fmt-24').textContent = '24-hour';
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
}

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
  renderTasks();
  resumeActiveRoute();
};

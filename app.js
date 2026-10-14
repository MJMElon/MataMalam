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
const TASK_TIME_SLOTS = ['6pm', '9pm', '12am', '3am', '6am'];

let pendingTask = null;
let pendingPhoto = null;
let pendingCoordinates = null;
let photoUrls = [];

// The night shift runs 6pm–6am, so anything before noon belongs to the previous day's shift
function getShiftDate(now = new Date()) {
  const d = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getShiftTasks() {
  const date = getShiftDate();
  const logs = (JSON.parse(localStorage.getItem('mata_malam_logs')) || []).filter(log => log.date === date);
  const tasks = [];
  TASK_TIME_SLOTS.forEach(time => {
    TASK_LOCATIONS.forEach(location => {
      const log = logs.find(l => l.location === location && l.time === time);
      tasks.push({ location, time, log });
    });
  });
  return tasks;
}

function renderTasks() {
  const tasks = getShiftTasks();
  const pending = tasks.filter(task => !task.log);
  const done = tasks.filter(task => task.log)
    .sort((a, b) => (b.log.submittedAt || '').localeCompare(a.log.submittedAt || ''));

  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = [];

  document.getElementById('todo-meta').textContent = `${getShiftDate()} • ${done.length} / ${tasks.length} ${currentLang === 'BM' ? 'selesai' : 'done'}`;
  document.getElementById('done-meta').textContent = `${done.length} ${currentLang === 'BM' ? 'tugasan' : done.length === 1 ? 'task' : 'tasks'}`;

  const todoList = document.getElementById('todo-list');
  todoList.innerHTML = '';
  if (pending.length === 0) {
    todoList.innerHTML = `<li class="task-empty">${currentLang === 'BM' ? 'Semua tugasan syif ini telah selesai.' : 'All tasks for this shift are done.'}</li>`;
  }
  pending.forEach((task, index) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === 0 ? 'task-item task-next' : 'task-item';
    btn.onclick = () => startTask(task.location, task.time);
    btn.innerHTML = `
      <span class="task-time">${task.time}</span>
      <span class="task-location">${task.location}</span>
      <span class="task-action">${index === 0 ? (currentLang === 'BM' ? 'Ambil Gambar' : 'Take Photo') : '📷'}</span>
    `;
    li.appendChild(btn);
    todoList.appendChild(li);
  });

  const doneList = document.getElementById('done-list');
  doneList.innerHTML = '';
  if (done.length === 0) {
    doneList.innerHTML = `<li class="task-empty">${currentLang === 'BM' ? 'Belum ada tugasan yang dihantar.' : 'No tasks submitted yet.'}</li>`;
  }
  done.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item task-done';
    const submitted = task.log.submittedAt
      ? new Date(task.log.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    li.innerHTML = `
      <img class="task-thumb" alt="">
      <span class="task-time">${task.time}</span>
      <span class="task-location">${task.location}</span>
      <span class="task-action"><span class="task-check">✓</span> ${submitted}</span>
    `;
    const img = li.querySelector('img');
    if (task.log.id) {
      loadPhoto(task.log.id).then(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        photoUrls.push(url);
        img.src = url;
        img.alt = `${task.location} ${task.time}`;
      }).catch(() => {});
    }
    doneList.appendChild(li);
  });
}

function startTask(location, time) {
  pendingTask = { location, time, date: getShiftDate() };
  pendingPhoto = null;
  pendingCoordinates = fetchCoordinates();

  document.getElementById('sheet-task-label').textContent = `${time} • ${location}`;
  const coordEl = document.getElementById('sheet-coord');
  coordEl.textContent = currentLang === 'BM' ? 'Mengesan Lokasi...' : 'Detecting Location...';
  const task = pendingTask;
  pendingCoordinates.then(coord => {
    if (pendingTask === task) coordEl.textContent = coord;
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
      () => resolve(currentLang === 'BM' ? 'Gagal mendapatkan koordinat (GPS Ditutup)' : 'Failed to retrieve coordinates (GPS Disabled)'),
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

  let logs = JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
  logs.push({
    id,
    location: pendingTask.location,
    date: pendingTask.date,
    time: pendingTask.time,
    coordinates,
    submittedAt: new Date().toISOString()
  });
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));

  closeSubmitSheet();
  renderTasks();
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
      const request = indexedDB.open('mata_malam', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos');
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
    tr.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-muted);">${currentLang === 'BM' ? 'Tiada rekod log ditemui.' : 'No log records found.'}</td>`;
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
    document.getElementById('done-title').textContent = 'Sejarah / Selesai';
    document.getElementById('nav-done').textContent = 'Selesai';
    document.getElementById('back-home-done').textContent = '← Kembali ke Senarai Tugasan';
    document.getElementById('sheet-cancel').textContent = 'Batal';
    document.getElementById('sheet-retake').textContent = 'Ambil Semula';
    document.getElementById('sheet-capture').textContent = 'Ambil Gambar';
    document.getElementById('sheet-submit').textContent = 'Hantar';
    document.getElementById('nav-about').textContent = 'Laporan';
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
  } else {
    document.getElementById('hero-btn').textContent = 'Synchronize Data';
    document.getElementById('todo-title').textContent = 'To-Do List';
    document.getElementById('done-title').textContent = 'History / Done';
    document.getElementById('nav-done').textContent = 'Done';
    document.getElementById('back-home-done').textContent = '← Back to To-Do List';
    document.getElementById('sheet-cancel').textContent = 'Cancel';
    document.getElementById('sheet-retake').textContent = 'Retake';
    document.getElementById('sheet-capture').textContent = 'Capture';
    document.getElementById('sheet-submit').textContent = 'Submit';
    document.getElementById('nav-about').textContent = 'Report';
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
  }
  renderTasks();
}

// Initialize state on load
window.onload = function() {
  renderTasks();
};

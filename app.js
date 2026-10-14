let activeStream = null;

document.getElementById('year').textContent = new Date().getFullYear();

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

function showSettingsPage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('settings-module-page').style.display = 'block';
  switchSettingsTab('register'); 
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
  openTaskCamera();
}

function openTaskCamera() {
  const input = document.getElementById('task-photo-input');
  input.value = '';
  input.click();
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
      { timeout: 10000 }
    );
  });
}

async function handleTaskPhoto(event) {
  const file = event.target.files[0];
  if (!file || !pendingTask) return;

  try {
    pendingPhoto = await compressPhoto(file);
  } catch (err) {
    alert(currentLang === 'BM' ? 'Gambar tidak dapat dibaca. Sila cuba lagi.' : 'Could not read the photo. Please try again.');
    return;
  }

  const preview = document.getElementById('sheet-photo');
  const previewUrl = URL.createObjectURL(pendingPhoto);
  preview.innerHTML = '';
  const img = document.createElement('img');
  img.alt = currentLang === 'BM' ? 'Gambar yang diambil' : 'Captured Photo';
  img.onload = () => URL.revokeObjectURL(previewUrl);
  img.src = previewUrl;
  preview.appendChild(img);

  document.getElementById('sheet-task-label').textContent = `${pendingTask.time} • ${pendingTask.location}`;
  const coordEl = document.getElementById('sheet-coord');
  coordEl.textContent = currentLang === 'BM' ? 'Mendapatkan Lokasi...' : 'Fetching Location...';
  const task = pendingTask;
  pendingCoordinates.then(coord => {
    if (pendingTask === task) coordEl.textContent = coord;
  });

  const submitBtn = document.getElementById('sheet-submit');
  submitBtn.disabled = false;
  submitBtn.textContent = currentLang === 'BM' ? 'Hantar' : 'Submit';
  document.getElementById('submit-sheet').hidden = false;
  submitBtn.focus();
}

// Resize to keep stored photos small enough for on-device storage
function compressPhoto(file, maxSize = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid image'));
    };
    img.src = url;
  });
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
  updateDashboardProgress();
}

function closeSubmitSheet() {
  document.getElementById('submit-sheet').hidden = true;
  document.getElementById('sheet-photo').innerHTML = '';
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

function handleRegister(event) {
  event.preventDefault();
  const phone = document.getElementById('reg-phone').value.trim();
  const pin = document.getElementById('reg-pin').value.trim();
  const msgDiv = document.getElementById('reg-message');

  if (!phone || !pin) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM' ? 'Sila masukkan nombor telefon dan PIN.' : 'Please enter phone number and PIN.';
    return;
  }

  let registeredUsers = JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];
  const existing = registeredUsers.find(u => u.phone === phone);
  
  if (existing) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM' ? 'Nombor telefon sudah didaftarkan.' : 'Phone number is already registered.';
    return;
  }

  // PIN is the only sign-in credential, so it must be unique per user
  if (registeredUsers.some(u => u.pin === pin)) {
    msgDiv.style.color = 'var(--error-color)';
    msgDiv.textContent = currentLang === 'BM' ? 'PIN sudah digunakan. Sila pilih PIN lain.' : 'PIN is already in use. Please choose a different PIN.';
    return;
  }

  registeredUsers.push({ phone, pin, role: 'Worker', permissions: { bnn: true, unn1: true, unn2: true } });
  localStorage.setItem('mata_malam_registered_users', JSON.stringify(registeredUsers));

  msgDiv.style.color = 'var(--success-color)';
  msgDiv.textContent = currentLang === 'BM' ? 'Pengguna berjaya didaftarkan!' : 'User registered successfully!';
  
  document.getElementById('reg-phone').value = '';
  document.getElementById('reg-pin').value = '';
  renderRegisteredUsersList();
}

function updateRole(phone, newRole) {
  let registeredUsers = JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];
  const user = registeredUsers.find(u => u.phone === phone);
  if (user) {
    user.role = newRole;
    localStorage.setItem('mata_malam_registered_users', JSON.stringify(registeredUsers));
  }
}

function updatePermission(phone, moduleKey, isChecked) {
  let registeredUsers = JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];
  const user = registeredUsers.find(u => u.phone === phone);
  if (user) {
    if (!user.permissions) user.permissions = { bnn: true, unn1: true, unn2: true };
    user.permissions[moduleKey] = isChecked;
    localStorage.setItem('mata_malam_registered_users', JSON.stringify(registeredUsers));
  }
}

function renderRegisteredUsersList() {
  const container = document.getElementById('registered-users-list');
  const registeredUsers = JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];

  if (registeredUsers.length === 0) {
    container.textContent = currentLang === 'BM' ? 'Tiada nombor telefon berdaftar.' : 'No registered phone numbers.';
    return;
  }

  container.innerHTML = registeredUsers.map(u => {
    const role = u.role || 'Worker';
    const perms = u.permissions || { bnn: true, unn1: true, unn2: true };
    return `
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

function updateDashboardProgress() {
  const logs = JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
  const today = getShiftDate();
  
  const modules = ['bnn', 'unn1', 'unn2'];
  modules.forEach(mod => {
    const count = logs.filter(log => log.location === mod.toUpperCase() && log.date === today).length;
    const target = 5;
    const percentage = Math.min(Math.round((count / target) * 100), 100);

    document.getElementById(`dash-count-${mod}`).textContent = `${count} / ${target} Photos`;
    document.getElementById(`dash-pct-${mod}`).textContent = `${percentage}%`;
    
    const fillBar = document.getElementById(`dash-fill-${mod}`);
    fillBar.style.width = `${percentage}%`;
    
    if (percentage >= 100) {
      fillBar.classList.add('complete');
    } else {
      fillBar.classList.remove('complete');
    }
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
    document.getElementById('sheet-cancel').textContent = 'Batal';
    document.getElementById('sheet-retake').textContent = 'Ambil Semula';
    document.getElementById('sheet-submit').textContent = 'Hantar';
    document.getElementById('nav-about').textContent = 'Laporan';
    document.getElementById('nav-settings').textContent = 'Tetapan';
    document.getElementById('dash-title').textContent = 'Papan Pemuka Penyelesaian Langsung Hari Ini';
    document.getElementById('dash-target-text').textContent = 'Sasaran: 5 Gambar / Hari = 100%';
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

    // Settings text translation
    document.getElementById('settings-title').textContent = 'Tetapan';
    document.getElementById('settings-desc').textContent = 'Urus keutamaan akaun anda dan lihat konfigurasi sesi aktif.';
    document.getElementById('tab-btn-register').textContent = 'Tambah Pengguna Baharu';
    document.getElementById('tab-btn-registered').textContent = 'Pengurusan Pengguna';
    document.getElementById('label-reg-phone').textContent = 'Nombor Telefon';
    document.getElementById('label-reg-pin').textContent = 'PIN';
    document.getElementById('reg-btn').textContent = 'Tambah Pengguna Baharu';
    document.getElementById('label-registered-list').textContent = 'Nombor Telefon Berdaftar & Kebenaran:';
  } else {
    document.getElementById('hero-btn').textContent = 'Synchronize Data';
    document.getElementById('todo-title').textContent = 'To-Do List';
    document.getElementById('done-title').textContent = 'History / Done';
    document.getElementById('sheet-cancel').textContent = 'Cancel';
    document.getElementById('sheet-retake').textContent = 'Retake';
    document.getElementById('sheet-submit').textContent = 'Submit';
    document.getElementById('nav-about').textContent = 'Report';
    document.getElementById('nav-settings').textContent = 'Settings';
    document.getElementById('dash-title').textContent = "Today's Live Completion Dashboard";
    document.getElementById('dash-target-text').textContent = 'Target: 5 Photos / Day = 100%';
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

    // Settings text translation
    document.getElementById('settings-title').textContent = 'Settings';
    document.getElementById('settings-desc').textContent = 'Manage your account preferences and view active session configuration.';
    document.getElementById('tab-btn-register').textContent = 'Add New User';
    document.getElementById('tab-btn-registered').textContent = 'User Management';
    document.getElementById('label-reg-phone').textContent = 'Phone Number';
    document.getElementById('label-reg-pin').textContent = 'PIN';
    document.getElementById('reg-btn').textContent = 'Add New User';
    document.getElementById('label-registered-list').textContent = 'Registered Phone Numbers & Permissions:';
  }
  renderRegisteredUsersList();
  renderTasks();
}

// Initialize state on load
window.onload = function() {
  renderTasks();
  updateDashboardProgress();
};

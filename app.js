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

// Sign-in management logic
function handleSignIn(event) {
  event.preventDefault();
  const phone = document.getElementById('signin-phone').value.trim();
  const pin = document.getElementById('signin-pin').value.trim();
  const errorDiv = document.getElementById('signin-error');

  if (!phone || !pin) {
    errorDiv.textContent = currentLang === 'BM' ? 'Sila masukkan nombor telefon dan PIN.' : 'Please enter phone number and PIN.';
    return;
  }

  // Check if user is registered in registered_users
  const registeredUsers = JSON.parse(localStorage.getItem('mata_malam_registered_users')) || [];
  const matchedUser = registeredUsers.find(u => u.phone === phone && u.pin === pin);

  if (!matchedUser) {
    errorDiv.textContent = currentLang === 'BM' ? 'Nombor telefon atau PIN tidak sah / belum berdaftar.' : 'Invalid credentials or phone number not registered under User Management.';
    return;
  }

  errorDiv.textContent = '';
  localStorage.setItem('mata_malam_user', phone);
  updateAuthState();
}

function handleSignOut() {
  localStorage.removeItem('mata_malam_user');
  document.getElementById('signin-phone').value = '';
  document.getElementById('signin-pin').value = '';
  updateAuthState();
  showHomePage();
}

function updateAuthState() {
  const loggedUser = localStorage.getItem('mata_malam_user');
  const signinSection = document.getElementById('signin-section');
  const welcomeBox = document.getElementById('user-welcome-box');
  const protectedContent = document.getElementById('protected-content');
  const loggedPhoneSpan = document.getElementById('logged-phone');
  const syncBtn = document.getElementById('hero-btn');
  const navAbout = document.getElementById('nav-about');
  const navSettings = document.getElementById('nav-settings');
  const navSignout = document.getElementById('nav-signout');

  if (loggedUser) {
    signinSection.style.display = 'none';
    welcomeBox.style.display = 'none'; 
    protectedContent.style.display = 'block';
    if (syncBtn) syncBtn.style.display = 'inline-block'; 
    if (navAbout) navAbout.style.display = 'inline'; 
    if (navSettings) navSettings.style.display = 'inline'; 
    if (navSignout) navSignout.style.display = 'inline-block'; // Show Sign Out in header
    if (loggedPhoneSpan) loggedPhoneSpan.textContent = loggedUser;
    const settingsDisplay = document.getElementById('settings-user-display');
    if (settingsDisplay) settingsDisplay.textContent = loggedUser;
  } else {
    signinSection.style.display = 'block';
    welcomeBox.style.display = 'none';
    protectedContent.style.display = 'none';
    if (syncBtn) syncBtn.style.display = 'none'; 
    if (navAbout) navAbout.style.display = 'none'; 
    if (navSettings) navSettings.style.display = 'none'; 
    if (navSignout) navSignout.style.display = 'none'; // Hide Sign Out in header
  }
}

// Navigation and page view handling
function showHomePage() {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById('home-page').style.display = 'block';
  window.scrollTo(0, 0);
}

function enterModule(moduleName) {
  stopActiveCamera();
  document.querySelectorAll('.page-view').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById(`${moduleName}-module-page`).style.display = 'block';
  initializeModuleInputs(moduleName);
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
  const loggedUser = localStorage.getItem('mata_malam_user');
  const settingsDisplay = document.getElementById('settings-user-display');
  if (settingsDisplay && loggedUser) {
    settingsDisplay.textContent = loggedUser;
  }
  switchSettingsTab('register'); 
  window.scrollTo(0, 0);
}

function stopActiveCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }
}

function initializeModuleInputs(moduleName) {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById(`date-val-${moduleName}`).textContent = today;

  const coordEl = document.getElementById(`coord-val-${moduleName}`);
  coordEl.textContent = currentLang === 'BM' ? 'Mendapatkan Lokasi...' : 'Fetching Location...';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        coordEl.textContent = `${lat}, ${lng}`;
      },
      (error) => {
        coordEl.textContent = currentLang === 'BM' ? 'Gagal mendapatkan koordinat (GPS Ditutup)' : 'Failed to retrieve coordinates (GPS Disabled)';
      },
      { timeout: 10000 }
    );
  } else {
    coordEl.textContent = currentLang === 'BM' ? 'Geolokasi tidak disokong' : 'Geolocation not supported';
  }
}

function openCamera(moduleName) {
  const fileInput = document.getElementById(`file-input-${moduleName}`);
  fileInput.click();
}

function handleFile(event, moduleName) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const container = document.getElementById(`camera-container-${moduleName}`);
    container.innerHTML = `<img src="${e.target.result}" alt="Captured Photo">`;
  };
  reader.readAsDataURL(file);
}

function submitData(event, moduleName) {
  event.preventDefault();

  const date = document.getElementById(`date-val-${moduleName}`).textContent;
  const coord = document.getElementById(`coord-val-${moduleName}`).textContent;
  const timeRadios = document.getElementsByName(`${moduleName}-time`);
  
  let selectedTime = '';
  for (const radio of timeRadios) {
    if (radio.checked) {
      selectedTime = radio.value;
      break;
    }
  }

  if (!selectedTime) {
    alert(currentLang === 'BM' ? 'Sila pilih slot masa.' : 'Please select a time slot.');
    return;
  }

  let logs = JSON.parse(localStorage.getItem('mata_malam_logs')) || [];
  logs.push({
    location: moduleName.toUpperCase(),
    date: date,
    time: selectedTime,
    coordinates: coord
  });
  localStorage.setItem('mata_malam_logs', JSON.stringify(logs));

  alert(currentLang === 'BM' ? 'Log berjaya disimpan!' : 'Log entry saved successfully!');
  updateDashboardProgress();
  showHomePage();
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
  const today = new Date().toISOString().split('T')[0];
  
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
    document.getElementById('hero-title').textContent = 'Selamat Datang ke Mata Malam';
    document.getElementById('hero-desc').textContent = 'Ambil Gambar • Rekod Masa • Pantau Kerja';
    document.getElementById('hero-btn').textContent = 'Selaraskan Data';
    document.getElementById('signin-title').textContent = 'Log Masuk';
    document.getElementById('label-phone').textContent = 'Nombor Telefon';
    document.getElementById('label-pin').textContent = 'PIN';
    document.getElementById('signin-btn').textContent = 'Log Masuk';
    document.getElementById('welcome-text').textContent = 'Berjaya log masuk';
    document.getElementById('nav-about').textContent = 'Laporan';
    document.getElementById('nav-settings').textContent = 'Tetapan';
    document.getElementById('nav-signout').textContent = 'Log Keluar';
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
    document.getElementById('settings-current-user-label').textContent = 'Sesi Semasa';
    document.getElementById('tab-btn-register').textContent = 'Tambah Pengguna Baharu';
    document.getElementById('tab-btn-registered').textContent = 'Pengurusan Pengguna';
    document.getElementById('label-reg-phone').textContent = 'Nombor Telefon';
    document.getElementById('label-reg-pin').textContent = 'PIN';
    document.getElementById('reg-btn').textContent = 'Tambah Pengguna Baharu';
    document.getElementById('label-registered-list').textContent = 'Nombor Telefon Berdaftar & Kebenaran:';
  } else {
    document.getElementById('hero-title').textContent = 'Welcome to Mata Malam';
    document.getElementById('hero-desc').textContent = 'Take Pictures • Record Time • Monitor Work';
    document.getElementById('hero-btn').textContent = 'Synchronize Data';
    document.getElementById('signin-title').textContent = 'Sign In';
    document.getElementById('label-phone').textContent = 'Phone Number';
    document.getElementById('label-pin').textContent = 'PIN';
    document.getElementById('signin-btn').textContent = 'Sign In';
    document.getElementById('welcome-text').textContent = 'Signed in successfully';
    document.getElementById('nav-about').textContent = 'Report';
    document.getElementById('nav-settings').textContent = 'Settings';
    document.getElementById('nav-signout').textContent = 'Sign Out';
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
    document.getElementById('settings-current-user-label').textContent = 'Current Session';
    document.getElementById('tab-btn-register').textContent = 'Add New User';
    document.getElementById('tab-btn-registered').textContent = 'User Management';
    document.getElementById('label-reg-phone').textContent = 'Phone Number';
    document.getElementById('label-reg-pin').textContent = 'PIN';
    document.getElementById('reg-btn').textContent = 'Add New User';
    document.getElementById('label-registered-list').textContent = 'Registered Phone Numbers & Permissions:';
  }
  renderRegisteredUsersList();
}

// Initialize state on load
window.onload = function() {
  updateAuthState();
  updateDashboardProgress();
};

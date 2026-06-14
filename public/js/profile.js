function requireAuth(req, res, next) {

  if (!req.session.user) {
    return res.redirect("/login");
  }

  next();
}

const STORAGE_KEYS = {
  USER : 'operator_user',
  TOKEN: 'operator_token'
};

const ROUTES = {
  LOGIN: '/'
};


function safeJSONParse(value, fallback = null) {
  try   { return JSON.parse(value); }
  catch { return fallback; }
}

function redirect(url) {
  window.location.href = url;
}

function getCurrentUser() {
  const stored = localStorage.getItem(STORAGE_KEYS.USER);
  if (!stored) return null;
  const user = safeJSONParse(stored);
  if (!user || typeof user !== 'object') {
    localStorage.removeItem(STORAGE_KEYS.USER);
    return null;
  }
  return user;
}

async function requireAuth() {
  const res  = await fetch("/api/auth/status");
  const data = await res.json();
  if (!data.loggedIn) {
    redirect(ROUTES.LOGIN);
    return null;
  }
  return data; // berisi { loggedIn: true, email: "..." }
}


let toastTimer = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = 'toast';
  if (type) toast.classList.add(type);
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}


function openModal(id)  { document.getElementById(id)?.classList.add('show');    }
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.addEventListener('click', function(e) {
    if (e.target === this) closeModal(this.id);
  });
});


function setText(id, value = '—') {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderUserProfile(user) {
  setText('display-email',     user.email     || '—');
  setText('display-lastlogin', user.lastLogin  || '—');

  const toggle = document.getElementById('toggle-notif');
  if (toggle) toggle.classList.toggle('active', !!user.notif);
}


async function logoutUser() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (e) {
    console.error("Logout error:", e);
  }
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  sessionStorage.clear();
  showToast('Logout berhasil', 'suc');
  setTimeout(() => redirect(ROUTES.LOGIN), 1200);
}

async function deleteAccount(email) {
  if (!email) {
    showToast('Email tidak ditemukan', 'err');
    return;
  }

  try {
    const res = await fetch(`/api/operator/${encodeURIComponent(email)}`, {
      method : 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || 'Gagal menghapus akun');
    }

    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    sessionStorage.clear();

    showToast('Akun berhasil dihapus', 'suc');
    setTimeout(() => redirect(ROUTES.LOGIN), 1500);

  } catch (err) {
    console.error(err);
    showToast(err.message || 'Gagal menghapus akun', 'err');
  }
}

function setupDeleteAccount(user) {
  document.getElementById('btn-delete')
    ?.addEventListener('click', () => openModal('modal-delete'));

  document.getElementById('delete-cancel')
    ?.addEventListener('click', () => closeModal('modal-delete'));

  document.getElementById('delete-confirm')
    ?.addEventListener('click', async () => {
      closeModal('modal-delete');
      await deleteAccount(user.email);
    });
}


function setupNotificationToggle() {
  const toggle = document.getElementById('toggle-notif');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    const isActive = toggle.classList.contains('active');

    const user = getCurrentUser();
    if (!user) return;

    user.notif = isActive;
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));

    showToast(
      isActive ? 'Notifikasi diaktifkan' : 'Notifikasi dimatikan',
      'info'
    );
  });
}


function setupPreferences() {
  document.getElementById('pref-faq')
    ?.addEventListener('click', () => showToast('Mengalihkan', 'info'));

  document.getElementById('pref-language')
    ?.addEventListener('click', () => showToast('Fitur bahasa segera hadir', 'info'));
}


function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page) redirect(page);
    });
  });
}

document.addEventListener('DOMContentLoaded', async() => {
  const user = await requireAuth();
  if (!user) return;

  const res     = await fetch('/api/operator/me');
  const profile = await res.json();

  renderUserProfile({
    email    : profile.email,
    lastLogin: profile.lastLogin
    ? new Date(profile.lastLogin).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta', 
      day     : '2-digit',
      month   : 'long',
      year    : 'numeric',
      hour    : '2-digit',
      minute  : '2-digit',
      hour12  : false           
    }).replace(/\./g, ':')      
  : '—'
  });

  setupDeleteAccount({ email: profile.email });
  setupNotificationToggle();
  setupNavigation();
  setupPreferences();

    document.getElementById('profile-btn-logout')
    ?.addEventListener('click', () => openModal('modal-logout'));

    document.getElementById('logout-cancel')
    ?.addEventListener('click', () => closeModal('modal-logout'));

document.getElementById('logout-confirm')
  ?.addEventListener('click', async () => {
    const btn = document.getElementById('logout-confirm');
    btn.textContent = 'Memproses...';
    btn.disabled = true;
    await logoutUser();
  });
});
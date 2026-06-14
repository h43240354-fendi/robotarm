let toastTimer = null;

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

const toggleBtn = document.getElementById('toggle-pw');
const pwInput   = document.getElementById('password');
const eyeIcon   = document.getElementById('eye-icon');

if (toggleBtn && pwInput) {
  toggleBtn.addEventListener('click', () => {
    const isText = pwInput.type === 'text';
    pwInput.type = isText ? 'password' : 'text';
    eyeIcon.innerHTML = isText
      ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  });
}

const form    = document.querySelector('form');
const btnText = document.getElementById('btn-text');
const spinner = document.getElementById('spinner');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showToast('Email dan password wajib diisi', 'error');
      return;
    }

    if (btnText) btnText.textContent = 'Memproses...';
    if (spinner) spinner.style.display = 'block';

    try {
      const res = await fetch('/api/login', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Login gagal');
      }

      const userData = {
        email    : email,
        lastLogin: new Intl.DateTimeFormat('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        }).format(new Date()),
        notif: true
      };

      localStorage.setItem('operator_user',  JSON.stringify(userData));
      localStorage.setItem('operator_token', 'LOGIN_SESSION_' + Date.now());

      showToast('Login berhasil', 'suc');

      setTimeout(() => {
        window.location.href = '/home';
      }, 1200);

    } catch (err) {
      showToast(err.message || 'Login gagal', 'error');
      if (btnText) btnText.textContent = 'Login';
      if (spinner) spinner.style.display = 'none';
    }
  });
}
function initNav() {
  const currentPath = window.location.pathname;

  document.querySelectorAll('[data-page]').forEach(item => {
    const page = item.dataset.page;
    if (page && currentPath.startsWith(page)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('[data-page]').forEach(item => {
    if (item.tagName === 'A') return;

    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (!page) return;

      if (typeof confirmLeave === 'function') {
        confirmLeave(page);
      } else {
        window.location.href = page;
      }
    });
  });
}

function initLogout() {
  const modalLogout = document.getElementById('sidebar-modal-logout');
  const btnLogout   = document.getElementById('btn-logout');
  const btnCancel   = document.getElementById('sidebar-logout-cancel');
  const btnConfirm  = document.getElementById('sidebar-logout-confirm');

  btnLogout?.addEventListener('click', () => modalLogout?.classList.add('show'));
  btnCancel?.addEventListener('click', () => modalLogout?.classList.remove('show'));

  btnConfirm?.addEventListener('click', async () => {
    btnConfirm.textContent = 'Memproses...';
    btnConfirm.disabled = true;
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('operator_user');
    localStorage.removeItem('operator_token');
    showToast('Logout berhasil', 'suc'); 
    setTimeout(() => { window.location.href = '/'; }, 1200); 
  });
}

function syncConnectionStatus(state) {
  const dot   = document.getElementById('sidebar-dot');
  const label = document.getElementById('sidebar-status-label');
  if (!dot || !label) return;

  const map = {
    online:     { cls: 'online',     text: 'TERHUBUNG' },
    connecting: { cls: 'connecting', text: 'MENGHUBUNGKAN' },
    offline:    { cls: 'offline',    text: 'TERPUTUS' }
  };

  const current = map[state] || map.offline;
  dot.className = `sidebar-status-dot ${current.cls}`;
  label.textContent = current.text;
}
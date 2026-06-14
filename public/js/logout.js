
async function doLogout() {
  try {
    await fetch('/api/logout', { method: 'POST', cache: 'no-store' });
  } catch { /* tetap lanjut logout meski fetch gagal */ }

  // Ganti semua history entry dengan halaman login
  // sehingga back button tidak bisa kembali ke dashboard
//   history.pushState(null, '', '/');
//   history.pushState(null, '', '/');
  history.go(-1);

  // Paksa navigasi ke login tanpa bisa di-back
  window.location.replace('/');
}

// Blokir back button selama di halaman protected
// Jika user tekan back → cek session dulu
window.addEventListener('popstate', async () => {
  try {
    const res  = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await res.json();
    if (!data.loggedIn) {
    //   history.replaceState(null, '', '/');
      window.location.replace('/');
    } else {
      // Masih login → push state lagi agar back tetap terblokir
    //   history.pushState(null, '', window.location.pathname);
    }
  } catch {
    window.location.replace('/');
  }
});

// Inisialisasi: push state dummy agar popstate bisa dideteksi
// history.pushState(null, '', window.location.pathname);
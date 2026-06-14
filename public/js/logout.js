
async function doLogout() {
  try {
    await fetch('/api/logout', { method: 'POST', cache: 'no-store' });
  } catch {}

  history.go(-1);
  window.location.replace('/');
}

window.addEventListener('popstate', async () => {
  try {
    const res  = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await res.json();
    if (!data.loggedIn) {
      window.location.replace('/');
    } else {
    }
  } catch {
    window.location.replace('/');
  }
});
(async function () {
  try {
    const res  = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await res.json();
    if (!data.loggedIn) {
      history.replaceState(null, '', '/');
      window.location.replace('/');
    }
  } catch {
    window.location.replace('/');
  }
})();
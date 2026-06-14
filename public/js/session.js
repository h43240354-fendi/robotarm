/**
 * session-manager.js
 * Include di SEMUA halaman terproteksi (home, kalibrasi, profile, dll)
 * <script src="/js/session-manager.js"></script>
 *
 * Fitur:
 *  1. Heartbeat ke server tiap 1 menit → mencatat aktivitas
 *  2. Deteksi gerakan mouse/keyboard → update lastActivity lokal
 *  3. Countdown 15 menit idle → warning di menit ke-13 → auto-logout menit ke-15
 *  4. Sinkronisasi status dari server setiap 2 menit
 */

(function () {
  "use strict";

  const IDLE_TIMEOUT_MS   = 15 * 60 * 1000; // 15 menit
  const WARNING_AT_MS     = 13 * 60 * 1000; // warning di menit ke-13
  const HEARTBEAT_MS      = 60 * 1000;       // kirim heartbeat tiap 1 menit
  const SERVER_CHECK_MS   = 2 * 60 * 1000;   // sinkron server tiap 2 menit

  let lastActivity    = Date.now();
  let warningShown    = false;
  let warningEl       = null;
  let countdownTimer  = null;

  // ── Perbarui lastActivity setiap ada interaksi ──────────────────
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
    document.addEventListener(evt, () => {
      lastActivity = Date.now();
      if (warningShown) dismissWarning();
    }, { passive: true });
  });

  // ── Kirim heartbeat ke server ────────────────────────────────────
  async function sendHeartbeat() {
    try {
      const res  = await fetch("/api/heartbeat", { method: "POST" });
      const data = await res.json();

      if (!data.loggedIn) {
        // Server sudah invalidasi session (idle sweeper / logout dari tab lain)
        forceLogout("Sesi berakhir. Silakan login kembali.");
      }
    } catch (_) {
      // Network error, coba lagi nanti
    }
  }

  // ── Cek status dari server ───────────────────────────────────────
  async function checkServerStatus() {
    try {
      const res  = await fetch("/api/auth/status");
      const data = await res.json();
      if (!data.loggedIn) {
        forceLogout("Sesi tidak valid. Silakan login kembali.");
      }
    } catch (_) {}
  }

  // ── Paksa logout & redirect ──────────────────────────────────────
  async function forceLogout(pesan) {
    clearAllTimers();
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (_) {}
    alert(pesan || "Sesi berakhir.");
    window.location.href = "/";
  }

  // ── Tampilkan banner warning ─────────────────────────────────────
  function showWarning(sisaDetik) {
    if (warningShown && warningEl) {
      updateCountdownText(sisaDetik);
      return;
    }
    warningShown = true;

    warningEl = document.createElement("div");
    warningEl.id = "idle-warning-banner";
    warningEl.innerHTML = `
      <div style="
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #f97316; color: #fff;
        padding: 12px 20px;
        display: flex; align-items: center; justify-content: space-between;
        font-family: Inter, sans-serif; font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      ">
        <span>
          ⚠️ Tidak ada aktivitas. Kamu akan otomatis logout dalam
          <strong id="idle-countdown">${sisaDetik}</strong> detik.
        </span>
        <button onclick="window.__sessionManager.tetapAktif()" style="
          background: #fff; color: #f97316;
          border: none; border-radius: 6px;
          padding: 6px 16px; cursor: pointer; font-weight: 600;
        ">Saya Masih Di Sini</button>
      </div>
    `;
    document.body.prepend(warningEl);

    // Mulai countdown visual
    let sisa = sisaDetik;
    countdownTimer = setInterval(() => {
      sisa--;
      updateCountdownText(sisa);
      if (sisa <= 0) {
        clearInterval(countdownTimer);
        forceLogout("Kamu tidak aktif selama 15 menit. Sesi berakhir.");
      }
    }, 1000);
  }

  function updateCountdownText(detik) {
    const el = document.getElementById("idle-countdown");
    if (el) el.textContent = detik;
  }

  function dismissWarning() {
    warningShown = false;
    if (countdownTimer) clearInterval(countdownTimer);
    if (warningEl) {
      warningEl.remove();
      warningEl = null;
    }
  }

  // ── Loop utama: cek idle setiap detik ───────────────────────────
  function startIdleWatcher() {
    setInterval(() => {
      const idleMs  = Date.now() - lastActivity;
      const sisaMs  = IDLE_TIMEOUT_MS - idleMs;

      if (idleMs >= IDLE_TIMEOUT_MS) {
        // Sudah melewati batas → logout
        if (!warningShown) {
          forceLogout("Kamu tidak aktif selama 15 menit. Sesi berakhir.");
        }
        return;
      }

      if (idleMs >= WARNING_AT_MS) {
        // Di zona warning (menit 13–15)
        const sisaDetik = Math.ceil(sisaMs / 1000);
        showWarning(sisaDetik);
      } else {
        // Masih aktif → pastikan warning hilang
        if (warningShown) dismissWarning();
      }
    }, 1000);
  }

  function clearAllTimers() {
    if (countdownTimer) clearInterval(countdownTimer);
  }

  // ── Ekspor fungsi ke global untuk tombol "Saya Masih Di Sini" ───
  window.__sessionManager = {
    tetapAktif: () => {
      lastActivity = Date.now();
      dismissWarning();
      sendHeartbeat(); // Langsung update server
    }
  };

  // ── Mulai semua timer ────────────────────────────────────────────
  startIdleWatcher();
  setInterval(sendHeartbeat,    HEARTBEAT_MS);
  setInterval(checkServerStatus, SERVER_CHECK_MS);

  // Heartbeat awal saat halaman dibuka
  sendHeartbeat();

  console.log("[SessionManager] Aktif — idle timeout 15 menit");
})();
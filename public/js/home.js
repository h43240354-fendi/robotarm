function requireAuth(req, res, next) {

  if (!req.session.user) {
    return res.redirect("/login");
  }

  next();
}

let ws             = null;
let wsConnected    = false;
let lastSystemStatus = null;
let pingTimer      = null;
let pingStart      = 0;
let connectionMode = 'wifi';
let serialPort     = null;
let serialReader   = null;
let serialWriter   = null;
let uptimeSecs     = 0;
let uptimeTimer    = null;
let statMerah      = 0;
let statBiru      = 0;
let prevMerah      = 0;
let prevBiru      = 0;
let chartMode      = 'menit';
let lastColor      = null;
let waitingPong    = false;
let manualDisconnect = false;
let allowPageLeave = false;

window.addEventListener('beforeunload', (e) => {
  if (wsConnected && !allowPageLeave) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function confirmLeave(url) {
  if (!wsConnected) {
    window.location.href = url;
    return;
  }
  const ok = confirm(
    'KONEKSI MASIH TERHUBUNG!!!\n' +
    'Jika Anda meninggalkan halaman ini atau me-refresh browser, semua data sesi saat ini akan hilang.\n\n' +
    'Lanjutkan?'
  );
  if (ok) {
    allowPageLeave = true;
    window.location.href = url;
  }
}

function resetDashboard() {
  statMerah = 0; statBiru = 0; prevMerah = 0; prevBiru = 0;
  document.getElementById('stat-merah').textContent = '0';
  document.getElementById('stat-biru').textContent = '0';
  minuteData.forEach(d => { d.b = 0; d.y = 0; });
  hourData.forEach(d => { d.b = 0; d.y = 0; });
  dayData.forEach(d => { d.b = 0; d.y = 0; });
  renderChart(chartMode);
  uptimeSecs = 0;
  document.getElementById('uptime').textContent  = '00:00:00';
  document.getElementById('latency').textContent = '0 ms';
}

async function loadSerialPorts() {
  if (!('serial' in navigator)) { showToast('Browser tidak mendukung Web Serial', 'err'); return; }
  const select = document.getElementById('serial-port');
  try {
    await navigator.serial.requestPort();
    const ports = await navigator.serial.getPorts();
    select.innerHTML = '';
    ports.forEach((port, index) => {
      const opt  = document.createElement('option');
      opt.value  = index;
      const info = port.getInfo();
      opt.textContent = info.usbVendorId === 6790 ? 'Port CH340' : 'Port Terpilih';
      select.appendChild(opt);
    });
    showToast('Port berhasil dipilih', 'suc');
  } catch (err) {
    showToast('Pemilihan port dibatalkan', 'err');
  }
}

async function setConnectionMode(mode) {
  connectionMode = mode;
  document.getElementById('mode-wifi').classList.toggle('active', mode === 'wifi');
  document.getElementById('mode-usb').classList.toggle('active',  mode === 'usb');
  document.getElementById('ws-input-wrap').style.display = mode === 'wifi' ? 'flex' : 'none';
  document.getElementById('serial-port').style.display   = mode === 'usb'  ? 'block' : 'none';
  if (mode === 'usb') await loadSerialPorts();
  showToast('Mode ' + (mode === 'wifi' ? 'WiFi' : 'USB'));
}

async function connectESP32() {
  if (wsConnected) {
    showToast('Memutus koneksi');
    await disconnectAll();
    return;
  }
  manualDisconnect = false;
  if (connectionMode === 'wifi') connectWS();
  else connectUSB();
}

function connectWS() {
  const ip = document.getElementById('ws-url').value.trim();
  const url = 'ws://' + ip + ':81';
  setConnectingUI();
  try { ws = new WebSocket(url); }
  catch (err) { setDisconnectedUI(); return; }

  ws.onopen = () => {
    if (manualDisconnect) { ws.close(); return; }
    wsConnected = true;
    resetDashboard();
    setConnectedUI();
    appendStatusLog('NET', 'net', 'WebSocket terhubung ke ' + url);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
      if (waitingPong) {
      if (typeof recordLatencyFail === 'function') recordLatencyFail();
    }
    
    waitingPong = true;
    pingStart   = Date.now();
    ws.send('{"cmd":"ping"}');
  }
}, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.cmd === 'pong' && waitingPong) {
        waitingPong = false;
        const lat   = Date.now() - pingStart;
        pingStart   = 0;
        document.getElementById('latency').textContent = lat + ' ms';
        if (typeof recordLatency === 'function') recordLatency(lat);
        return;
      }
      handleData(data);
    } catch (err) { console.error('WS JSON ERROR:', err); }
  };

  ws.onerror = () => {};

  ws.onclose = () => {
    clearInterval(pingTimer);
    pingTimer = null; waitingPong = false; pingStart = 0;
    wsConnected = false; ws = null;
    if (!manualDisconnect) {
      resetDashboard();
      setDisconnectedUI();
      showToast('Koneksi terputus', 'err');
      appendStatusLog('WARN', 'warn', 'Koneksi WebSocket terputus.');
    }
    manualDisconnect = false;
  };
}

async function connectUSB() {
  if (!('serial' in navigator)) { showToast('Browser tidak mendukung Web Serial', 'err'); return; }
  if (serialPort) await disconnectUSB();
  try {
    setConnectingUI();
    const ports    = await navigator.serial.getPorts();
    const selected = document.getElementById('serial-port').value;
    serialPort     = ports[selected];
    if (!serialPort) { showToast('Pilih port terlebih dahulu', 'err'); setDisconnectedUI(); return; }
    await serialPort.open({ baudRate: 115200 });
    serialWriter = serialPort.writable.getWriter();
    serialReader = serialPort.readable.getReader();
    wsConnected  = true;
    resetDashboard();
    setConnectedUI();
    showToast('USB Connected', 'suc');
    appendStatusLog('NET', 'net', 'USB Serial terhubung.');
    readSerialLoop();
    pingTimer = setInterval(async () => {
      if (!serialWriter) return;
      pingStart = Date.now();
      await serialWriter.write(new TextEncoder().encode('ping\n'));
    }, 3000);
  } catch (err) {
    console.error(err);
    setDisconnectedUI();
    showToast('USB gagal terhubung', 'err');
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    try {
      const { value, done } = await serialReader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line.trim());
          if (data.cmd === 'pong') {
            const lat = Date.now() - pingStart;
            document.getElementById('latency').textContent = lat + ' ms';
            if (typeof recordLatency === 'function') recordLatency(lat);
            continue;
          }
          handleData(data);
        } catch (e) {}
      }
    } catch (err) { disconnectUSB(); break; }
  }
}

async function disconnectUSB() {
  try {
    if (serialReader) { await serialReader.cancel(); serialReader.releaseLock(); }
    if (serialWriter) { serialWriter.releaseLock(); }
    if (serialPort)   { await serialPort.close(); }
  } catch (e) { console.error(e); }
  finally {
    serialPort = serialReader = serialWriter = null;
    clearInterval(pingTimer); pingTimer = null;
    wsConnected = false;
    setDisconnectedUI();
  }
}

async function disconnectAll() {
  allowPageLeave = true;
  manualDisconnect = true;
  clearInterval(pingTimer);
  pingTimer = null;

  waitingPong = false;
  pingStart = 0;
  wsConnected = false;

  resetDashboard();
  setDisconnectedUI();
  stopUptime();

  if (connectionMode === 'wifi' && ws)
    ws.close(1000, 'manual');
  else if (connectionMode === 'usb')
    await disconnectUSB();
}

async function sendCmd(cmd) {
  if (!wsConnected) { showToast('Tidak terhubung ke Mikrokontroler', 'err'); return; }
  if (connectionMode === 'wifi') {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(cmd);
  } else {
    if (serialWriter) await serialWriter.write(new TextEncoder().encode(cmd + '\n'));
  }
}

function selectFilter(el) {
  document.querySelectorAll('.filter-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  const lbl = el.querySelector('.filter-lbl').textContent;
  if (lbl.includes('Semua'))      sendCmd('msg_semua');
  else if (lbl.includes('Merah')) sendCmd('msg_merah');
  else if (lbl.includes('Biru'))  sendCmd('msg_biru');
}

const minuteData = Array.from({ length: 60 }, () => ({ b: 0, y: 0 }));
const minuteXLabels = (() => {
  const labels = [], now = new Date();
  for (let i = 0; i < 60; i += 10) {
    const t = new Date(now.getTime() - (59 - i) * 60000);
    labels.push(t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0'));
  }
  return labels;
})();

const hourData     = Array.from({ length: 24 }, () => ({ b: 0, y: 0 }));
const hourXLabels  = ['00:00','04:00','08:00','12:00','16:00','20:00','23:00'];
const dayData      = Array.from({ length: 7  }, () => ({ b: 0, y: 0 }));
const dayXLabels   = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];

function norm(val, maxVal) { return Math.max(4, Math.round((val / maxVal) * 88)); }

function renderChart(mode) {
  const chart  = document.getElementById('bar-chart');
  const labels = document.getElementById('chart-labels');
  if (!chart || !labels) return;
  chart.classList.add('fading');
  setTimeout(() => {
    chart.innerHTML = ''; labels.innerHTML = '';
    const data    = mode === 'menit' ? minuteData : mode === 'jam' ? hourData : dayData;
    const xLabels = mode === 'menit' ? minuteXLabels : mode === 'jam' ? hourXLabels : dayXLabels;
    const maxVal  = Math.max(...data.map(d => Math.max(d.b, d.y)), 1);
    data.forEach(d => {
      const g = document.createElement('div');
      g.className = 'bar-group';
      g.innerHTML = `<div class="bar-b" style="height:${norm(d.b,maxVal)}px"></div>
                     <div class="bar-y" style="height:${norm(d.y,maxVal)}px"></div>`;
      chart.appendChild(g);
    });
    xLabels.forEach(l => {
      const s = document.createElement('span');
      s.className = 'chart-x-lbl'; s.textContent = l;
      labels.appendChild(s);
    });
    chart.classList.remove('fading');
  }, 180);
}

function switchChart(mode) {
  chartMode = mode;
  document.getElementById('tab-menit').classList.toggle('active', mode === 'menit');
  document.getElementById('tab-jam').classList.toggle('active',   mode === 'jam');
  document.getElementById('tab-hari').classList.toggle('active',  mode === 'hari');
  renderChart(mode);
}

function padZ(n) { return String(n).padStart(2, '0'); }

function startUptime() {
  clearInterval(uptimeTimer);
  uptimeTimer = setInterval(() => {
    uptimeSecs++;
    const h = Math.floor(uptimeSecs / 3600);
    const m = Math.floor((uptimeSecs % 3600) / 60);
    const s = uptimeSecs % 60;
    document.getElementById('uptime').textContent = padZ(h)+':'+padZ(m)+':'+padZ(s);
  }, 1000);
}

function stopUptime() {
  clearInterval(uptimeTimer); uptimeTimer = null; uptimeSecs = 0;
  document.getElementById('uptime').textContent  = '00:00:00';
  document.getElementById('latency').textContent = '0 ms';
}

const COLORS = {
  'Blue'  : { label:'Biru',   hex:'#1a56db' },
  'Red'   : { label:'Merah',  hex:'#d32f2f' },
  'Yellow': { label:'Kuning', hex:'#f9a825' },
  'Green' : { label:'Hijau',  hex:'#2d7d32' },
  'White' : { label:'Putih',  hex:'#bdbdbd' },
  'Black' : { label:'Hitam',  hex:'#424242' },
  'Orange': { label:'Oranye', hex:'#e65100' },
  'Purple': { label:'Ungu',   hex:'#6a1b9a' },
};

function updateSensorColor(colorName, rIn, gIn, bIn) {
  const info = COLORS[colorName] || { label: colorName, hex: '#8a9bb5' };
  const r = rIn || 0, g = gIn || 0, b = bIn || 0;

  if (colorName !== lastColor) {
    const wrap = document.getElementById('sensor-wrap');
    const ripple = document.getElementById('sensor-ripple');
    if (wrap && ripple) {
      wrap.classList.remove('detecting');
      ripple.style.background = info.hex;
      void wrap.offsetWidth;
      wrap.classList.add('detecting');
      setTimeout(() => wrap.classList.remove('detecting'), 800);
    }
    lastColor = colorName;
  }

  const icon = document.getElementById('sensor-icon');
  if (icon) icon.style.background = info.hex;
  const badge = document.getElementById('sensor-badge');
  if (badge) { badge.textContent = info.label.toUpperCase() + ' TERDETEKSI'; badge.style.background = info.hex; }
  const nameEl = document.getElementById('sensor-color-name');
  if (nameEl) { nameEl.textContent = colorName; nameEl.style.color = info.hex; }
  const swatch = document.getElementById('sensor-swatch');
  if (swatch) swatch.style.background = `rgb(${r},${g},${b})`;
  const rgb = document.getElementById('sensor-rgb');
  if (rgb) rgb.textContent = `R:${r}   G:${g}   B:${b}`;
}

function handleData(d) {
  if (d.status === 'emergency') {
    document.getElementById('btn-start').style.opacity = '0.5';
    document.getElementById('btn-stop').style.opacity  = '0.5';
    
    if (typeof appendStatusLog === 'function') {
      appendStatusLog('EMRGCY', 'warn', 'ROBOT BERHENTI PAKSA!!!');
    }
    
    const badge = document.getElementById('sensor-badge');
    if (badge) { badge.textContent = 'EMERGENCY STOP'; badge.style.background = '#d32f2f'; }
    const nameEl = document.getElementById('sensor-color-name');
    if (nameEl) { nameEl.textContent = 'BERHENTI PAKSA'; nameEl.style.color = '#d32f2f'; }
    
    showToast('EMERGENCY AKTIF', 'err');
    lastSystemStatus = d.status;
    return;
  }

  if (d.status === 'stopping') {
    document.getElementById('btn-start').style.opacity = '0.5';
    document.getElementById('btn-stop').style.opacity  = '0.5';
    
    if (lastSystemStatus !== 'stopping' && typeof appendStatusLog === 'function') {
      appendStatusLog('STOPPING', 'warn', 'Robot menyelesaikan langkah terakhir...');
    }
    
    const badge = document.getElementById('sensor-badge');
    if (badge) { badge.textContent = 'PREPARING TO STOP'; badge.style.background = '#f9a825'; }
  }

  if (d.status === 'stopped') {
    document.getElementById('btn-start').style.opacity = '0.5';
    document.getElementById('btn-stop').style.opacity  = '1';
  
    if (lastSystemStatus !== 'stopped' && typeof appendStatusLog === 'function') {
      appendStatusLog('STOP', 'stop', 'Robot berhenti');
    }
    
    const badge = document.getElementById('sensor-badge');
    if (badge) { badge.textContent = 'STANDBY / IDLE'; badge.style.background = '#8a9bb5'; }
    const nameEl = document.getElementById('sensor-color-name');
    if (nameEl) { nameEl.textContent = 'None'; nameEl.style.color = '#8a9bb5'; }
  }

  if (d.status === 'running') {
    document.getElementById('btn-start').style.opacity = '1';
    document.getElementById('btn-stop').style.opacity  = '0.5';
  
    if (lastSystemStatus !== 'running' && typeof appendStatusLog === 'function') {
      appendStatusLog('START', 'start', 'Robot mulai berjalan.');
    }
  }

  if (d.color !== undefined && d.color !== 'NONE' && d.color !== 'Unknown') {
    updateSensorColor(d.color, d.r, d.g, d.b);
    if (typeof appendActivityLog === 'function') appendActivityLog(d.color, d.r||0, d.g||0, d.b||0);
  }

  if (d.merah !== undefined) {
    prevMerah = statMerah; statMerah = d.merah;
    document.getElementById('stat-merah').textContent = statMerah.toLocaleString('id-ID');
    const h = new Date().getHours(), m = new Date().getMinutes();
    hourData[h].b   = Math.min(hourData[h].b + 1, 999);
    minuteData[m].b = Math.min(minuteData[m].b + 1, 999);
    renderChart(chartMode);
  }

  if (d.biru !== undefined) {
    prevBiru = statBiru; statBiru = d.biru;
    document.getElementById('stat-biru').textContent = statBiru.toLocaleString('id-ID');
    const h = new Date().getHours(), m = new Date().getMinutes();
    hourData[h].y   = Math.min(hourData[h].y + 1, 999);
    minuteData[m].y = Math.min(minuteData[m].y + 1, 999);
    renderChart(chartMode);
  }
  lastSystemStatus = d.status;
}


function setConnectedUI() {
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge online'; badge.textContent = 'TERHUBUNG';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('online');
   }
  

  const btn = document.getElementById('btn-connect');
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>Putuskan`;
    btn.style.background = '#d32f2f'; btn.disabled = false;
  }
  const urlEl = document.getElementById('ws-url');
    if (urlEl) { urlEl.disabled = true; }
  const wrapEl = document.getElementById('ws-input-wrap');
    if (wrapEl) wrapEl.style.opacity = '0.55';
  const wifiBtn = document.getElementById('mode-wifi');
  const usbBtn  = document.getElementById('mode-usb');
  if (wifiBtn && usbBtn) {
    wifiBtn.disabled = connectionMode !== 'wifi';
    usbBtn.disabled  = connectionMode !== 'usb';
  }
  setControlEnabled(true);
  startUptime();
  showToast('TERHUBUNG', 'suc');
}

function setDisconnectedUI() {
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge offline'; badge.textContent = 'TERPUTUS';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('offline');

   }
  const btn = document.getElementById('btn-connect');
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>Hubungkan`;
    btn.style.background = '#1a56db'; btn.disabled = false;
  }
  const urlEl = document.getElementById('ws-url');
    if (urlEl) { urlEl.disabled = false; }
  const wrapEl = document.getElementById('ws-input-wrap');
    if (wrapEl) wrapEl.style.opacity = '1';
  const wifiBtn = document.getElementById('mode-wifi');
  const usbBtn  = document.getElementById('mode-usb');
  if (wifiBtn) wifiBtn.disabled = false;
  if (usbBtn)  usbBtn.disabled  = false;
  setControlEnabled(false);
  stopUptime();
}

function setConnectingUI() {
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge connecting'; badge.textContent = 'MENGHUBUNGKAN';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('connecting');
   }
  const btn = document.getElementById('btn-connect');
  if (btn) { btn.innerHTML = `<span class="spinner"></span> Menghubungkan`; btn.style.background = '#f9a825'; btn.disabled = true; }
}

function setControlEnabled(on) {
  ['btn-start','btn-stop','btn-emergency'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
}

function exportData() {
  const rows = [['Jam','Merah','Biru'], ...hourData.map((d,i) => [i+':00', d.b, d.y])];
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'arm_robot_laporan.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('Laporan diunduh', 'suc');
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

window.addEventListener('DOMContentLoaded', () => {
  setControlEnabled(false);
  renderChart('menit');

  document.getElementById('btn-connect').addEventListener('click', connectESP32);
  document.getElementById('btn-start').addEventListener('click',   () => sendCmd('msg_start'));
  document.getElementById('btn-stop').addEventListener('click',    () => sendCmd('msg_stop'));
  document.getElementById('btn-emergency').addEventListener('click', () => sendCmd('msg_emergency'));
});

function switchPageTab(tabName) {

  document.querySelectorAll('.page-tab').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById('ptab-' + tabName)
    ?.classList.add('active');

  document.querySelectorAll('.page-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  document.getElementById('panel-' + tabName)
    ?.classList.add('active');
}
function requireAuth(req, res, next) {

  if (!req.session.user) {
    return res.redirect("/login");
  }

  next();
}

let ws = null;
let wsConnected = false;
let connectionMode = 'wifi';

let serialPort   = null;
let serialReader = null;
let serialWriter = null;

const _serialQueue  = [];
let   _serialBusy   = false;

async function _drainSerial() {
  if (_serialBusy || !_serialQueue.length) return;
  _serialBusy = true;
  while (_serialQueue.length > 0) {
    const bytes = _serialQueue.shift();
    try {
      if (serialWriter) await serialWriter.write(bytes);
    } catch (_) { }
  }
  _serialBusy = false;
}

function _serialSend(cmd) {
  if (!serialWriter) return;
  _serialQueue.push(new TextEncoder().encode(cmd + '\n'));
  _drainSerial();
}

let pingTimer     = null;
let pingStart     = 0;
let waitingPong   = false;
let manualDisconnect = false;

const N       = 6;
let PINS = JSON.parse(localStorage.getItem('servo_pins') || 'null') || [15, 2, 4, 13, 12, 14];
const PRESETS = [0, 45, 90, 135, 180];
const angles  = new Array(N).fill(90);
const offsets = JSON.parse(localStorage.getItem('servo_offsets') || 'null') || new Array(N).fill(0);
const sequence    = [];
const stepNames = Array.from({ length: 100 }, (_, i) => `Step ${i + 1}`);

let nameIdx    = 0;
let uptimeSecs = 0;
let uptimeTimer = null;
let moveSpeed  = 6;

const servoQueue     = new Array(N).fill(null);
let   frameScheduled = false;

window.addEventListener('DOMContentLoaded', () => {
  buildServoCards();
  buildCalibGrid();
  buildPinConfig();
  setDisconnectedUI();
  renderSeq();

  document.getElementById('btn-connect')
    ?.addEventListener('click', connectESP32);
  document.getElementById('mode-wifi')
    ?.addEventListener('click', () => setConnectionMode('wifi'));
  document.getElementById('mode-usb')
    ?.addEventListener('click', () => setConnectionMode('usb'));
});

async function setConnectionMode(mode) {
  connectionMode = mode;
  document.getElementById('mode-wifi')?.classList.toggle('active', mode === 'wifi');
  document.getElementById('mode-usb')?.classList.toggle('active', mode === 'usb');
  const wsInput   = document.getElementById('ws-url');
  const serialSel = document.getElementById('serial-port');
  const wsWrap    = document.getElementById('ws-input-wrap');
  const serialSel = document.getElementById('serial-port');
  if (wsWrap)    wsWrap.style.display    = mode === 'wifi' ? 'flex' : 'none';
  if (serialSel) serialSel.style.display = mode === 'usb'  ? 'block' : 'none';
  if (mode === 'usb') await loadSerialPorts();
  showToast('Mode ' + mode.toUpperCase());
}

async function loadSerialPorts() {
  if (!('serial' in navigator)) { showToast('Browser tidak mendukung Web Serial', 'err'); return; }
  const sel = document.getElementById('serial-port');
  if (!sel) return;
  try {
    await navigator.serial.requestPort();
    const ports = await navigator.serial.getPorts();
    sel.innerHTML = '';
    ports.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = i;
      try {
        const info = p.getInfo();
        o.textContent = info.usbVendorId === 6790
          ? `Port CH340 (Port ${i + 1})`
          : `Port ${i + 1}`;
      } catch { o.textContent = `Port Terpilih ${i + 1}`; }
      sel.appendChild(o);
    });
    showToast('Port berhasil dipilih', 'suc');
  } catch { showToast('Pemilihan port dibatalkan', 'err'); }
}

async function connectESP32() {
  if (wsConnected) { showToast('Memutus koneksi...'); await disconnectAll(); return; }
  manualDisconnect = false;
  connectionMode === 'wifi' ? connectWS() : connectUSB();
}

async function disconnectAll() {
  manualDisconnect = true;
  clearInterval(pingTimer); pingTimer = null;
  waitingPong = false; pingStart = 0;
  wsConnected = false;
  setDisconnectedUI();
  stopUptime();
  if (connectionMode === 'wifi' && ws) ws.close(1000, 'manual');
  else if (connectionMode === 'usb') await disconnectUSB();
}

function connectWS() {
  const ip = document.getElementById('ws-url')?.value.trim() || '192.168.4.1';
  const url = 'ws://' + ip + ':81';
  setConnectingUI();
  try { ws = new WebSocket(url); } catch { setDisconnectedUI(); return; }

  ws.onopen = () => {
    if (manualDisconnect) { ws.close(); return; }
    wsConnected = true;
    setConnectedUI();
    startUptime();
    const appSub = document.getElementById('appSub');
    if (appSub) appSub.textContent = url;
    appendLog('info', '[WS] Terhubung ke ' + url);

    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && !waitingPong) {
        waitingPong = true;
        pingStart   = Date.now();
        ws.send('{"cmd":"ping"}');
      }
    }, 3000);
  };

  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.cmd === 'pong' && waitingPong) {
        waitingPong = false;
        const el = document.getElementById('latency');
        if (el) el.textContent = (Date.now() - pingStart) + ' ms';
        pingStart = 0; return;
      }
    } catch {}
    appendLog('rx', '[ESP32] ' + e.data.trim());
  };

  ws.onerror = () => {};
  ws.onclose = () => {
    clearInterval(pingTimer); pingTimer = null;
    waitingPong = false; pingStart = 0;
    wsConnected = false; ws = null;
    if (!manualDisconnect) {
      setDisconnectedUI();
      showToast('Koneksi terputus', 'err');
      appendLog('warn', '[WS] Terputus');
    }
    manualDisconnect = false;
  };
}

async function connectUSB() {
  if (!('serial' in navigator)) { showToast('Browser tidak mendukung Web Serial', 'err'); return; }
  if (serialPort) await disconnectUSB();
  try {
    setConnectingUI();
    const ports  = await navigator.serial.getPorts();
    const selEl  = document.getElementById('serial-port');
    const sel    = selEl ? +selEl.value : 0;
    serialPort   = ports[sel];
    if (!serialPort) { showToast('Pilih port terlebih dahulu', 'err'); setDisconnectedUI(); return; }

    await serialPort.open({ baudRate: 115200 });
    serialWriter = serialPort.writable.getWriter();
    serialReader = serialPort.readable.getReader();
    wsConnected  = true;
    setConnectedUI();
    startUptime();
    const appSub = document.getElementById('appSub');
    if (appSub) appSub.textContent = 'USB Serial · 115200';
    appendLog('info', '[USB] Port terbuka · 115200');
    showToast('USB Connected', 'suc');
    readSerialLoop();

    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      pingStart = Date.now();
      _serialSend('{"cmd":"ping"}');
    }, 3000);
  } catch {
    setDisconnectedUI();
    showToast('USB gagal terhubung', 'err');
  }
}

async function readSerialLoop() {
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    try {
      const { value, done } = await serialReader.read();
      if (done) break;
      buf += dec.decode(value);
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line.trim());
          if (d.cmd === 'pong') {
            const el = document.getElementById('latency');
            if (el) el.textContent = (Date.now() - pingStart) + ' ms';
            continue;
          }
        } catch {}
        appendLog('rx', '[ESP32] ' + line.trim());
      }
    } catch { await disconnectUSB(); break; }
  }
}

async function disconnectUSB() {
  try {
    if (serialReader) { await serialReader.cancel(); serialReader.releaseLock(); }
    if (serialWriter) { serialWriter.releaseLock(); }
    if (serialPort)   { await serialPort.close(); }
  } catch {} finally {
    serialPort   = null;
    serialReader = null;
    serialWriter = null;
    _serialQueue.length = 0;
    _serialBusy = false;
    clearInterval(pingTimer); pingTimer = null;
    wsConnected = false;
    setDisconnectedUI();
  }
}

function sendCmd(cmd) {
  if (!wsConnected) return;

  if (connectionMode === 'wifi') {
    if (ws?.readyState === WebSocket.OPEN) ws.send(cmd);
  } else {
    _serialSend(cmd);
  }

  if (!cmd.endsWith(':0')) appendLog('tx', '[TX] → ' + cmd);
}

function onSlider(id, a) {
  a = Math.max(0, Math.min(180, a));
  angles[id] = a;
  refreshCard(id, a);
  servoQueue[id] = `S${id}:${a + offsets[id]}:0`;
  flushServoQueue();
}

function onSliderEnd(id, a) {
  a = Math.max(0, Math.min(180, a));
  angles[id] = a;
  refreshCard(id, a);
  servoQueue[id] = null;
  sendCmd(`S${id}:${a + offsets[id]}`);
}

function flushServoQueue() {
  if (frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(() => {
    frameScheduled = false;
    for (let i = 0; i < N; i++) {
      const cmd = servoQueue[i];
      if (!cmd) continue;
      servoQueue[i] = null;
      sendCmd(cmd);
    }
  });
}

function setAngle(id, a) {
  a = Math.max(0, Math.min(180, a));
  angles[id] = a;
  refreshCard(id, a);
  servoQueue[id] = null;
  sendCmd(`S${id}:${a + offsets[id]}:0`); 
}

function refreshCard(id, a) {
  const sv   = document.getElementById('sv'   + id);
  const ssl  = document.getElementById('ssl'  + id);
  const sarc = document.getElementById('sarc' + id);
  if (sv)   sv.textContent  = a;
  if (ssl)  ssl.value       = a;
  if (sarc) sarc.innerHTML  = arcSVG(a);
}

function resetAll() { for (let i = 0; i < N; i++) setAngle(i, 90); }

function sendAll() {
  for (let i = 0; i < N; i++) sendCmd(`S${i}:${angles[i] + offsets[i]}`);
}

function stopAll() { sendCmd('STOP:ALL'); }

function onSpeed(v) {
  moveSpeed = v;
  const svEl = document.getElementById('speedVal');
  if (svEl) svEl.textContent = v + ' ms/deg';
  sendCmd('SPEED:' + v);
}

function startUptime() {
  clearInterval(uptimeTimer);
  uptimeSecs = 0;
  uptimeTimer = setInterval(() => {
    uptimeSecs++;
    const h  = Math.floor(uptimeSecs / 3600);
    const m  = Math.floor((uptimeSecs % 3600) / 60);
    const s  = uptimeSecs % 60;
    const el = document.getElementById('uptime');
    if (el) el.textContent = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }, 1000);
}

function stopUptime() {
  clearInterval(uptimeTimer); uptimeTimer = null; uptimeSecs = 0;
  const upEl  = document.getElementById('uptime');
  const latEl = document.getElementById('latency');
  if (upEl)  upEl.textContent  = '00:00:00';
  if (latEl) latEl.textContent = '0 ms';
}

function showPage(p) {
  ['ctrl', 'move', 'calib'].forEach(n => {
    document.getElementById('page-' + n)?.classList.toggle('active', n === p);
    document.getElementById('bnav-' + n)?.classList.toggle('active', n === p);
  });
}

function setConnectedUI() {
  const urlEl  = document.getElementById('ws-url');
  const wrapEl = document.getElementById('ws-input-wrap');
  if (urlEl)  urlEl.disabled = true;
  if (wrapEl) wrapEl.style.opacity = '0.55';
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge online'; badge.textContent = 'TERHUBUNG';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('online');

   }
  const btn = document.getElementById('btn-connect');
  if (btn)  { btn.innerHTML = 'Putuskan'; btn.disabled = false; }
  showToast('Terhubung', 'suc');
}

function setDisconnectedUI() {
  const urlEl  = document.getElementById('ws-url');
  const wrapEl = document.getElementById('ws-input-wrap');
  if (urlEl)  urlEl.disabled = false;
  if (wrapEl) wrapEl.style.opacity = '1';
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge offline'; badge.textContent = 'TERPUTUS';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('offline');

   }
  const btn = document.getElementById('btn-connect');
  if (btn)  { btn.innerHTML = 'Hubungkan'; btn.disabled = false; }
}

function setConnectingUI() {
  const badge = document.getElementById('status-badge');
  if (badge) { badge.className = 'status-badge connecting'; badge.textContent = 'MENGHUBUNGKAN';
    if (typeof syncConnectionStatus === 'function') syncConnectionStatus('connecting');
   }
  const btn = document.getElementById('btn-connect');
  if (btn)   btn.disabled = true;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = 'toast ' + type + ' show';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function togglePinCard() {
  const body = document.getElementById('pinConfigBody');
  const btn  = document.getElementById('pinToggleBtn');
  body.classList.toggle('pin-hidden');
  btn.innerHTML = body.classList.contains('pin-hidden') ? '▼' : '▲';
}

function appendLog(cls, msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const d = document.createElement('div');
  d.className   = 'log-' + cls;
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = 99999;
  while (el.children.length > 80) el.removeChild(el.firstChild);
}

function clearLog() {
  const el = document.getElementById('log');
  if (el) el.innerHTML = '';
}

function buildServoCards() {
  const target = document.getElementById('servoCards');
  if (!target) return;
  target.innerHTML = Array.from({ length: N }, (_, i) => `
  <div class="servo-card" id="sc${i}">
    <div class="sc-top">
      <div class="sc-left">
        <div class="sc-num">${i+1}</div>
        <div>
          <div class="sc-name">Servo ${i+1}</div>
          <div class="sc-pin">GPIO ${PINS[i]}</div>
        </div>
      </div>
      <span><span class="sc-angle" id="sv${i}">90</span><span class="sc-deg">°</span></span>
    </div>
    <div class="arc-wrap">
      <svg id="sarc${i}" width="80" height="58" viewBox="0 0 80 58">${arcSVG(90)}</svg>
    </div>
    <input type="range" class="servo-sl" id="ssl${i}"
           min="0" max="180" step="1" value="90"
           oninput="onSlider(${i}, +this.value)"
           onchange="onSliderEnd(${i}, +this.value)">
    <div class="sl-labels"><span>0°</span><span>90°</span><span>180°</span></div>
    <div class="presets">
      ${PRESETS.map(a => `<button class="pb" onclick="setAngle(${i},${a})">${a}°</button>`).join('')}
    </div>
  </div>`).join('');
}

function arcSVG(angle) {
  const R = 32, cx = 40, cy = 42, start = 180, range = 180;
  const rad = d => d * Math.PI / 180;
  const end  = start - (angle / 180) * range;
  const x1   = cx + R * Math.cos(rad(start)),      y1  = cy - R * Math.sin(rad(start));
  const x2   = cx + R * Math.cos(rad(end)),         y2  = cy - R * Math.sin(rad(end));
  const nx   = cx + (R - 5) * Math.cos(rad(end)),  ny  = cy - (R - 5) * Math.sin(rad(end));
  const tx2  = cx + R * Math.cos(rad(start - range)), ty2 = cy - R * Math.sin(rad(start - range));
  return [
    `<path d="M${x1},${y1} A${R},${R} 0 0 1 ${tx2},${ty2}" fill="none" stroke="#DBEAFE" stroke-width="4.5" stroke-linecap="round"/>`,
    `<path d="M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2}"  fill="none" stroke="#2563EB" stroke-width="4.5" stroke-linecap="round"/>`,
    `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="4" fill="#fff" stroke="#2563EB" stroke-width="2"/>`,
    `<circle cx="${x2}" cy="${y2}" r="3.5" fill="#2563EB"/>`
  ].join('');
}

function saveStep() {
  const snap = [...angles];
  const name = stepNames[nameIdx % stepNames.length];
  nameIdx++;
  sequence.push({ name, angles: snap });
  renderSeq();

  const b = document.getElementById('saveBtn');
  if (b) {
    b.classList.add('saved');
    b.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> POSISI TERSIMPAN!';
    setTimeout(() => {
      b.classList.remove('saved');
      b.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> SIMPAN POSISI SEKARANG';
    }, 1400);
  }
  showToast('Posisi tersimpan: ' + name, 'suc');
}

function renderSeq() {
  const scEl = document.getElementById('stepCount');
  if (scEl) scEl.textContent = sequence.length;
  const el = document.getElementById('seqList');
  if (!el) return;
  if (!sequence.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">Belum ada posisi tersimpan</div>
      <div class="empty-sub">Atur posisi servo di tab Control,<br>lalu tekan Simpan Posisi Sekarang</div>
    </div>`;
    return;
  }
  el.innerHTML = sequence.map((s, i) => `
  <div class="seq-item" id="si${i}">
    <div class="seq-num" id="sn${i}">${i + 1}</div>
    <div class="seq-info">
      <div class="seq-lbl">${s.name}</div>
      <div class="seq-angles">${s.angles.map((a, j) => 'S' + j + ':' + a + '°').join(' ')}</div>
    </div>
    <div class="seq-del" onclick="deleteStep(${i})">✕</div>
  </div>`).join('');
}

function deleteStep(i) { 
  sequence.splice(i, 1); 
  renderSeq(); 
  showToast('Langkah dihapus'); 
}

function clearSequence() { 
  if (!sequence.length) return; 
  sequence.length = 0; 
  nameIdx = 0; 
  renderSeq(); 
}

function buildCalibGrid() {
  const cg = document.getElementById('calibGrid');
  if (cg) {
    cg.innerHTML = Array.from({ length: N }, (_, i) => `
    <div class="calib-servo">
      <div class="cal-name">S${i} · GPIO ${PINS[i]}</div>
      <div class="cal-val" id="cv${i}">${angles[i] + offsets[i]}°</div>
      <input type="range" class="cal-sl" min="-30" max="30"
             value="${offsets[i]}"
             id="co${i}" oninput="onCalib(${i},+this.value)">
      <div class="cal-offset" id="cd${i}">offset: ${offsets[i] >= 0 ? '+' : ''}${offsets[i]}°</div>
    </div>`).join('');
  }
 
  const cta = document.getElementById('calibTestArea');
  if (cta) {
    cta.innerHTML = Array.from({ length: N }, (_, i) => `
    <div class="range-test-row">
      <span class="rt-name">Servo ${i}</span>
      <div class="rt-btns">
        ${[0, 45, 90, 135, 180].map(a => `<button class="rt-btn" onclick="sendCmd('S${i}:${a}')">${a}°</button>`).join('')}
      </div>
    </div>`).join('');
  }
}
 
function onCalib(id, val) {
  offsets[id] = val;
  const cd = document.getElementById('cd' + id);
  const cv = document.getElementById('cv' + id);
  if (cd) cd.textContent = 'offset: ' + (val >= 0 ? '+' : '') + val + '°';
  if (cv) cv.textContent = (angles[id] + val) + '°';
 
  sendCmd(`S${id}:${angles[id] + val}:0`);
}
 
function resetCalib() {
  for (let i = 0; i < N; i++) {
    offsets[i] = 0;
    const co = document.getElementById('co' + i);
    if (co) co.value = 0;
    const cd = document.getElementById('cd' + i);
    const cv = document.getElementById('cv' + i);
    if (cd) cd.textContent = 'offset: 0°';
    if (cv) cv.textContent = angles[i] + '°';
    sendCmd(`S${i}:${angles[i]}:0`);
  }
  localStorage.removeItem('servo_offsets');
  showToast('Offset direset');
}
 
function applyCalib() {
  for (let i = 0; i < N; i++) {
    sendCmd(`S${i}:${angles[i] + offsets[i]}`);
  }
  localStorage.setItem('servo_offsets', JSON.stringify(offsets));
  showToast('Offset diterapkan & disimpan', 'suc');
}
 
function buildPinConfig() {
  const target = document.getElementById('pinConfigGrid');
  if (!target) return;
  target.innerHTML = Array.from({ length: N }, (_, i) => `
    <div class="pin-row">
      <span class="pin-label">Servo ${i + 1}</span>
      <div class="pin-input-wrap">
        <span class="pin-prefix">GPIO</span>
        <input type="number" class="pin-input" id="pin${i}"
               min="0" max="39" value="${PINS[i]}"
               onchange="onPinChange(${i}, +this.value)">
      </div>
    </div>
  `).join('');
}
 
function onPinChange(id, val) {
  if (val < 0 || val > 39) { showToast('GPIO harus 0–39', 'err'); return; }
  PINS[id] = val;
}
 
function savePins() {
  localStorage.setItem('servo_pins', JSON.stringify(PINS));
  buildServoCards();
  showToast('Pin tersimpan', 'suc');
}
 
function applyPins() {
  savePins();
  for (let i = 0; i < N; i++) sendCmd(`PIN:${i}:${PINS[i]}`);
  showToast('Pin diterapkan', 'suc');
}
 
function resetPins() {
  const defaults = [15, 2, 4, 13, 12, 14];
  PINS = [...defaults];
  localStorage.setItem('servo_pins', JSON.stringify(PINS));
  for (let i = 0; i < N; i++) {
    const inp = document.getElementById('pin' + i);
    if (inp) inp.value = defaults[i];
  }
  buildServoCards();
  showToast('Pin direset ke default');
}
 
function switchTab(tabName) {

  document.querySelectorAll('.page-tab').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById('ptab-' + tabName)
    ?.classList.add('active');

  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  document.getElementById('page-' + tabName)
    ?.classList.add('active');
}
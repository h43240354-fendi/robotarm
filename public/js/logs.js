function makeLogEntry(time, badge, badgeCls, msg) {
  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="badge ${badgeCls}">${badge}</span>
    <span class="log-msg">${msg}</span>`;
  return row;
}

function appendActivityLog(colorName, r, g, b) {
  const scroll = document.getElementById('activity-scroll');
  if (!scroll) return;
  const row = makeLogEntry(nowTag(), 'SORT', 'sort',
    `${colorName} terdeteksi — R:${r} G:${g} B:${b}`);
  scroll.insertBefore(row, scroll.firstChild);
}

function appendStatusLog(badge, cls, msg) {
  const scroll = document.getElementById('activity-scroll');
  if (!scroll) return;
  const row = makeLogEntry(nowTag(), badge, cls, msg);
  scroll.insertBefore(row, scroll.firstChild);
}

const MAX_SAMPLES   = 60;
const latencyBuffer = [];
let   totalPings    = 0;
let   failedPings   = 0;

function recordLatency(ms) {
  totalPings++;
  latencyBuffer.push({ ms, ok: true });
  if (latencyBuffer.length > MAX_SAMPLES) latencyBuffer.shift();
  updateLatencyStats();
  drawSparkline();
  appendLatencyLog(nowTag(), 'NET', ms < 30 ? 'ok' : ms < 100 ? 'net' : 'warn',
    `Round-trip ${ms} ms. ${ms < 30 ? 'Excellent' : ms < 100 ? 'Good' : 'High latency'}.`);
}

function recordLatencyFail() {
  totalPings++;
  failedPings++;
  latencyBuffer.push({ ms: null, ok: false });
  if (latencyBuffer.length > MAX_SAMPLES) latencyBuffer.shift();
  updateLatencyStats();
  drawSparkline();
  appendLatencyLog(nowTag(), 'WARN', 'warn', `Ping timeout. (attempt #${totalPings})`);
}

function updateLatencyStats() {
  const valid = latencyBuffer.filter(s => s.ok && s.ms !== null).map(s => s.ms);
  const last  = valid[valid.length - 1];

  const elCur  = document.getElementById('stat-cur');
  const elAvg  = document.getElementById('stat-avg');
  const elLoss = document.getElementById('stat-loss');

  if (elCur) {
    elCur.textContent = last !== undefined ? last + ' ms' : 'N/A';
    elCur.className   = 'stat-value' + (last >= 300 ? ' bad' : last >= 100 ? ' warn' : '');
  }
  if (elAvg && valid.length > 0) {
    const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    elAvg.textContent = avg + ' ms';
    elAvg.className   = 'stat-value' + (avg >= 300 ? ' bad' : avg >= 100 ? ' warn' : '');
  }
  if (elLoss && totalPings > 0) {
    const loss = ((failedPings / totalPings) * 100).toFixed(1);
    elLoss.textContent = loss + ' %';
    elLoss.className   = 'stat-value' + (parseFloat(loss) >= 20 ? ' bad' : parseFloat(loss) >= 5 ? ' warn' : '');
  }
}

function drawSparkline() {
  const canvas = document.getElementById('spark');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight || 48;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const valid = latencyBuffer.filter(s => s.ok && s.ms !== null).map(s => s.ms);
  if (valid.length < 2) return;

  const maxMs = Math.max(...valid, 50);
  const step  = W / (MAX_SAMPLES - 1);

  ctx.strokeStyle = '#e2e6ea';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => {
    const y = H - f * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  ctx.beginPath();
  latencyBuffer.forEach((s, i) => {
    const x = i * step;
    const y = s.ok ? H - (s.ms / maxMs) * (H - 4) - 2 : H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo((latencyBuffer.length - 1) * step, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(37,99,235,0.25)');
  grad.addColorStop(1, 'rgba(37,99,235,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.8;
  ctx.lineJoin  = 'round';
  latencyBuffer.forEach((s, i) => {
    const x = i * step;
    const y = s.ok ? H - (s.ms / maxMs) * (H - 4) - 2 : H - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = latencyBuffer[latencyBuffer.length - 1];
  if (last && last.ok) {
    const x = (latencyBuffer.length - 1) * step;
    const y = H - (last.ms / maxMs) * (H - 4) - 2;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
  }
}

function appendLatencyLog(time, badge, badgeCls, msg) {
  const scroll = document.getElementById('latency-scroll');
  if (!scroll) return;
  const row = makeLogEntry(time, badge, badgeCls, msg);
  scroll.insertBefore(row, scroll.firstChild);
}

function switchLogTab(tab, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  btn.classList.add('active');
}

function nowTag() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
}

window.addEventListener('resize', () => {
  if (latencyBuffer.length > 0) drawSparkline();
});

window.addEventListener('DOMContentLoaded', () => {
  const scroll = document.getElementById('activity-scroll');

  if (scroll) {
    scroll.innerHTML = '';
  }
});
const $ = id => document.getElementById(id);

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function setError(fieldId, errId, show) {
  const field = $('field-' + fieldId);
  if (!field) return;
  const inp = field.querySelector('input');
  const err = $(errId);
  if (show) { inp && inp.classList.add('error-input'); err && err.classList.add('visible'); }
  else { inp && inp.classList.remove('error-input'); err && err.classList.remove('visible'); }
}

const colors = ['#e53935','#e87c2a','#f0c030','#2d7d32'];
const labels = ['Weak','Fair','Good','Strong'];

function calcStrength(pw) {
  let score = 0;
  if (pw.length >= 8)           score++;
  if (/[A-Z]/.test(pw))         score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw))  score++;
  return score;
}

$('password').addEventListener('input', () => {
  const pw    = $('password').value;
  const score = pw ? calcStrength(pw) : 0;
  ['s1','s2','s3','s4'].forEach((id, i) => {
    $(id).style.background = (pw && i < score) ? colors[score - 1] : '#dde3ed';
  });
  $('strengthLabel').textContent = pw ? labels[score - 1] || '' : '';
  $('strengthLabel').style.color  = pw ? colors[score - 1] : '#8a9bb5';
});

function makeToggle(btnId, inputId, iconId) {
  $(btnId).addEventListener('click', () => {
    const inp     = $(inputId);
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    $(iconId).innerHTML = showing
      ? '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
        '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
        '<line x1="1" y1="1" x2="23" y2="23"/>';
  });
}
makeToggle('togglePw',      'password',        'eyeIcon');
makeToggle('toggleConfirm', 'confirmPassword', 'eyeIcon2');

$('password').addEventListener('blur', () => {
  setError('password', 'err-password', $('password').value.length < 8);
});
$('confirmPassword').addEventListener('blur', () => {
  setError('confirm', 'err-confirm', $('confirmPassword').value !== $('password').value);
});
$('otp').addEventListener('blur', () => {
  setError('otp', 'err-otp', $('otp').value.trim().length !== 6);
});

let countdownTimer = null;

function startCountdown(seconds) {
  const wrap = $('countdownWrap');
  const val  = $('countdownVal');
  const btn  = $('btnSendOtp');
  const txt  = $('btnSendOtpText');

  wrap.style.display = 'flex';
  btn.disabled       = true;
  txt.textContent    = 'Sent';

  let remaining = seconds;
  val.textContent = remaining + 's';

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    remaining--;
    val.textContent = remaining + 's';
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      wrap.style.display = 'none';
      btn.disabled       = false;
      txt.textContent    = 'Resend OTP';
    }
  }, 1000);
}

$('btnSendOtp').addEventListener('click', async () => {
  const email   = $('email').value.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!emailOk) { setError('email', 'err-email', true); return; }
  setError('email', 'err-email', false);

  const btn = $('btnSendOtp');
  btn.disabled = true;
  $('btnSendOtpText').textContent = '...';
  $('otpSpinner').style.display   = 'inline-block';

  try {
  const res = await fetch('/api/send-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  });

  if (!res.ok) throw new Error(await res.text());

  $('otpSpinner').style.display = 'none';
  $('otp').focus();

  showToast('OTP berhasil dikirim ke email', 'suc');
  startCountdown(60);

} catch (err) {
  showToast(err.message, 'err');
  btn.disabled = false;
  $('btnSendOtpText').textContent = 'Send OTP';
  $('otpSpinner').style.display = 'none';
}
});

$('btnRegister').addEventListener('click', async () => {
  const email   = $('email').value.trim();
  const otp     = $('otp').value.trim();
  const pw      = $('password').value;
  const confirm = $('confirmPassword').value;

  let valid = true;

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk)        { setError('email',    'err-email',    true); valid = false; }
  else                   setError('email',    'err-email',    false);

  if (otp.length !== 6){ setError('otp',      'err-otp',      true); valid = false; }
  else                   setError('otp',      'err-otp',      false);

  if (pw.length < 8)   { setError('password', 'err-password', true); valid = false; }
  else                   setError('password', 'err-password', false);

  if (pw !== confirm)  { setError('confirm',  'err-confirm',  true); valid = false; }
  else                   setError('confirm',  'err-confirm',  false);

  if (!valid) { showToast('Please fix the errors above.', 'err'); return; }

  const btn = $('btnRegister');
  btn.classList.add('loading');
  $('btnText').textContent      = 'Registering...';
  $('btnSpinner').style.display = 'inline-block';

    try {
    const res = await fetch('/api/register', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
      email,
      password: pw,
      otp
  })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'Registration failed.');

    clearInterval(countdownTimer);
    showToast('Akun berhasil dibuat', 'suc');
    setTimeout(() => { window.location.href = '/'; }, 1600);

  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    btn.classList.remove('loading');
    $('btnText').textContent      = 'Register';
    $('btnSpinner').style.display = 'none';
  }
});
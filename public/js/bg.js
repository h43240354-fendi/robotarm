(function () {
  const canvas = document.getElementById('iot-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', () => {
    resize();
    initAll();
  });

  const W = () => canvas.width;
  const H = () => canvas.height;

  const COLORS = [
    '#1a56db', '#378add', '#185fa5',
    '#85b7eb', '#b5d4f4', '#2671c8', '#4a9de0'
  ];

  class Particle {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x = Math.random() * W();
      this.y = init ? Math.random() * H() : H() + 10;
      this.r = Math.random() * 3 + 1;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = -(Math.random() * 0.4 + 0.15);
      this.alpha = Math.random() * 0.5 + 0.15;
      this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.pulse = Math.random() * Math.PI * 2;
      this.pulseSpeed = Math.random() * 0.02 + 0.005;
      this.type = Math.random() < 0.15 ? 'ring' : 'dot';
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.pulse += this.pulseSpeed;
      if (this.y < -20) this.reset();
    }

    draw() {
      const a = this.alpha * (0.7 + 0.3 * Math.sin(this.pulse));
      ctx.globalAlpha = a;
      ctx.fillStyle = this.color;
      ctx.strokeStyle = this.color;

      if (this.type === 'ring') {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r + 2, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawConnections(particles) {
    const MAX_DIST = 120;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > MAX_DIST) continue;
        ctx.globalAlpha = (1 - dist / MAX_DIST) * 0.12;
        ctx.strokeStyle = '#1a56db';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  class Wave {
    constructor(yFraction, amp, period, speed, color, alpha) {
      this.yFrac = yFraction;
      this.amp = amp;
      this.period = period;
      this.speed = speed;
      this.color = color;
      this.alpha = alpha;
      this.offset = Math.random() * Math.PI * 2;
    }

    draw(t) {
      ctx.globalAlpha = this.alpha;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const baseY = this.yFrac * H();
      for (let x = 0; x <= W(); x += 2) {
        const y = baseY + Math.sin((x / this.period) + t * this.speed + this.offset) * this.amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  class Ripple {
    constructor() { this.reset(); }

    reset() {
      this.x = Math.random() * W();
      this.y = Math.random() * H();
      this.radius = 0;
      this.maxR = Math.random() * 60 + 30;
      this.speed = Math.random() * 0.5 + 0.3;
      this.alpha = Math.random() * 0.12 + 0.05;
      this.color = COLORS[Math.floor(Math.random() * 3)];
      this.delay = Math.random() * 200;
    }

    update() {
      if (this.delay > 0) { this.delay--; return; }
      this.radius += this.speed;
      if (this.radius > this.maxR) this.reset();
    }

    draw() {
      if (this.delay > 0) return;
      const a = this.alpha * (1 - this.radius / this.maxR);
      ctx.globalAlpha = a;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  class DataPulse {
    constructor() { this.reset(); }

    reset() {
      const side = Math.floor(Math.random() * 4);
      if (side === 0)      { this.x = 0;    this.y = Math.random() * H(); this.vx =  (Math.random() * 1 + 0.5); this.vy = (Math.random() - 0.5) * 0.5; }
      else if (side === 1) { this.x = W();  this.y = Math.random() * H(); this.vx = -(Math.random() * 1 + 0.5); this.vy = (Math.random() - 0.5) * 0.5; }
      else if (side === 2) { this.x = Math.random() * W(); this.y = 0;    this.vx = (Math.random() - 0.5) * 0.5; this.vy =  (Math.random() * 1 + 0.5); }
      else                 { this.x = Math.random() * W(); this.y = H();  this.vx = (Math.random() - 0.5) * 0.5; this.vy = -(Math.random() * 1 + 0.5); }

      this.trail = [];
      this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.size = Math.random() * 2 + 1;
      this.alpha = 0.6;
    }

    update() {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 18) this.trail.shift();
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < -20 || this.x > W() + 20 || this.y < -20 || this.y > H() + 20) {
        this.reset();
      }
    }

    draw() {
      for (let i = 0; i < this.trail.length; i++) {
        ctx.globalAlpha = (i / this.trail.length) * this.alpha * 0.4;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.trail[i].x, this.trail[i].y, this.size * (i / this.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  let particles, waves, ripples, pulses;

  function initAll() {
    particles = Array.from({ length: 150 }, () => new Particle());
    waves = [
      new Wave(0.25, 18, 180, 0.40, '#378add', 0.18),
      new Wave(0.45, 14, 220, 0.30, '#1a56db', 0.12),
      new Wave(0.65, 20, 160, 0.50, '#185fa5', 0.10),
      new Wave(0.82, 12, 250, 0.35, '#85b7eb', 0.15),
    ];
    ripples = Array.from({ length: 15 }, () => new Ripple());
    pulses  = Array.from({ length: 30 }, () => new DataPulse());
  }

  initAll();

  let t = 0;
  let animId;

  function frame() {
    ctx.clearRect(0, 0, W(), H());

    waves.forEach(w => w.draw(t));
    drawConnections(particles);
    ripples.forEach(r => { r.update(); r.draw(); });
    pulses.forEach(p => { p.update(); p.draw(); });
    particles.forEach(p => { p.update(); p.draw(); });

    t += 0.016;
    animId = requestAnimationFrame(frame);
  }

  frame();

  window.iotBgStop = () => cancelAnimationFrame(animId);
})();
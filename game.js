'use strict';

// ---------------------------------------------------------------------------
// Константы мира (логические координаты, масштабируются под экран)
// ---------------------------------------------------------------------------
const W = 1600;
const H = 900;
const GROUND = 800;
const NET_X = W / 2;
const NET_W = 18;
const NET_TOP = GROUND - 250;

const P_R = 80;           // радиус борца (круг столкновения)
const P_GRAVITY = 2600;
const P_JUMP = 1150;
const P_SPEED = 620;

const B_R = 34;           // радиус мяча
const B_GRAVITY = 1300;
const B_MAX_SPEED = 1500;
const B_MIN_BOUNCE = 850; // минимальная скорость отскока от борца

const WIN_SCORE = 11;
const MAX_TOUCHES = 3;
const STEP = 1 / 120;     // фиксированный шаг физики
const TAU = Math.PI * 2;

const COLORS = [
  { belt: '#c9352f', dark: '#8e211c', score: '#ffd9d6', name: 'Красный' },
  { belt: '#2f63c9', dark: '#1f438c', score: '#d9e5ff', name: 'Синий' },
];
const SKIN = '#f2c29b';
const SKIN_DARK = '#b77a55';

// ---------------------------------------------------------------------------
// Холст и масштабирование
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = window.innerWidth;
  ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  scale = Math.min(cw / W, ch / H);
  ox = (cw - W * scale) / 2;
  oy = (ch - H * scale) / 2;
}
window.addEventListener('resize', resize);
resize();

const isPortraitTouch = () =>
  window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches;

// ---------------------------------------------------------------------------
// Звук (WebAudio, без файлов)
// ---------------------------------------------------------------------------
let actx = null;

function ensureAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      actx = null;
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const sfx = {
  hit(speed) {
    tone(160 + speed * 0.12, 0.12, 'triangle', 0.3, -60);
    if (navigator.vibrate) navigator.vibrate(12);
  },
  jump() { tone(260, 0.14, 'sine', 0.07, 260); },
  wall() { tone(120, 0.06, 'square', 0.04); },
  point() {
    tone(880, 0.12, 'square', 0.07);
    tone(660, 0.2, 'square', 0.07, 0, 0.13);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.15, 0, i * 0.14));
  },
};

// ---------------------------------------------------------------------------
// Состояние игры
// ---------------------------------------------------------------------------
function makePlayer(side) {
  return {
    side,
    x: 0, y: 0, vx: 0, vy: 0,
    onGround: true,
    squash: 0,
    lastHit: -10,
    move: 0,
    jump: false,
  };
}

const players = [makePlayer(0), makePlayer(1)];
const ball = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, frozen: false };

const game = {
  screen: 'menu',   // menu | play | over
  vsBot: true,
  paused: false,
  phase: 'serve',   // serve | rally | point
  phaseT: 0,
  score: [0, 0],
  server: 0,
  touchSide: -1,
  touchCount: 0,
  msg: '',
  msgT: 0,
  hintT: 0,
  time: 0,
};

const bot = { err: 0, reactT: 0 };

function playerBounds(side) {
  return side === 0
    ? [P_R, NET_X - NET_W / 2 - P_R]
    : [NET_X + NET_W / 2 + P_R, W - P_R];
}

function resetPlayers() {
  players.forEach((p) => {
    p.x = p.side === 0 ? W * 0.25 : W * 0.75;
    p.y = GROUND - P_R;
    p.vx = p.vy = 0;
    p.onGround = true;
    p.squash = 0;
    p.lastHit = -10;
  });
}

function startServe() {
  resetPlayers();
  ball.x = game.server === 0 ? W * 0.25 : W * 0.75;
  ball.y = GROUND - 2 * P_R - 230;
  ball.vx = ball.vy = 0;
  ball.frozen = true;
  game.phase = 'serve';
  game.phaseT = 0.7;
  game.touchSide = -1;
  game.touchCount = 0;
  bot.err = (Math.random() - 0.5) * 40;
}

function startMatch(vsBot) {
  game.vsBot = vsBot;
  game.score = [0, 0];
  game.server = Math.random() < 0.5 ? 0 : 1;
  game.screen = 'play';
  game.paused = false;
  game.msg = '';
  game.hintT = 5;
  pointers.clear();
  startServe();
  showOverlay(null);
}

function sideName(side) {
  if (game.vsBot) return side === 0 ? 'Вы' : 'Бот';
  return COLORS[side].name;
}

function awardPoint(side, reason) {
  if (game.phase !== 'rally' && game.phase !== 'serve') return;
  game.score[side]++;
  game.server = side;
  game.phase = 'point';
  game.phaseT = 1.4;
  game.msg = reason ? `${reason} +1 ${sideName(side)}` : `+1 ${sideName(side)}`;
  game.msgT = 1.4;
  sfx.point();
}

function checkWinner() {
  const [a, b] = game.score;
  if (Math.max(a, b) >= WIN_SCORE && Math.abs(a - b) >= 2) return a > b ? 0 : 1;
  return -1;
}

// ---------------------------------------------------------------------------
// Управление: касания (виртуальный джойстик на своей половине) и клавиатура
// ---------------------------------------------------------------------------
const pointers = new Map(); // pointerId -> { side, sx, sy, x, y, t, moved }
const tapJump = [0, 0];     // время «импульса» прыжка от тапа
const JOY_DEAD = 8;
const JOY_FULL = 45;
const JOY_UP = 40;

function pointerSide(clientX) {
  if (game.vsBot) return 0;
  return clientX < cw / 2 ? 0 : 1;
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.screen !== 'play' || game.paused) return;
  ensureAudio();
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  const side = pointerSide(e.clientX);
  pointers.set(e.pointerId, {
    side, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
    t: performance.now(), moved: 0,
  });
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
  p.x = e.clientX;
  p.y = e.clientY;
  // джойстик «тянется» за пальцем, чтобы смена направления была быстрой
  const dx = p.x - p.sx;
  if (Math.abs(dx) > JOY_FULL) p.sx = p.x - Math.sign(dx) * JOY_FULL;
  const dy = p.y - p.sy;
  if (dy > JOY_UP) p.sy = p.y - JOY_UP;
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (performance.now() - p.t < 250 && p.moved < 15) tapJump[p.side] = 0.15;
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function readInput(side) {
  let move = 0;
  let jump = false;

  const left = side === 0 ? ['KeyA'] : ['ArrowLeft'];
  const right = side === 0 ? ['KeyD'] : ['ArrowRight'];
  const up = side === 0 ? ['KeyW'] : ['ArrowUp'];
  if (side === 0 && game.vsBot) {
    left.push('ArrowLeft');
    right.push('ArrowRight');
    up.push('ArrowUp', 'Space');
  }
  if (left.some((k) => keys.has(k))) move -= 1;
  if (right.some((k) => keys.has(k))) move += 1;
  if (up.some((k) => keys.has(k))) jump = true;

  // последний активный палец этой стороны
  let ptr = null;
  for (const p of pointers.values()) if (p.side === side) ptr = p;
  if (ptr) {
    const dx = ptr.x - ptr.sx;
    if (Math.abs(dx) > JOY_DEAD) {
      move = Math.max(-1, Math.min(1, (dx - Math.sign(dx) * JOY_DEAD) / (JOY_FULL - JOY_DEAD)));
    }
    if (ptr.sy - ptr.y > JOY_UP) jump = true;
  }
  if (tapJump[side] > 0) jump = true;

  return { move, jump };
}

// ---------------------------------------------------------------------------
// Бот
// ---------------------------------------------------------------------------
function predictBallX(targetY) {
  let { x, y, vx, vy } = ball;
  const dt = 1 / 60;
  for (let i = 0; i < 240; i++) {
    if (vy > 0 && y >= targetY) return x;
    vy += B_GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < B_R) { x = B_R; vx = -vx * 0.9; }
    if (x > W - B_R) { x = W - B_R; vx = -vx * 0.9; }
    if (y > NET_TOP - B_R && Math.abs(x - NET_X) < NET_W / 2 + B_R) {
      vx = -vx * 0.8;
      x = x < NET_X ? NET_X - NET_W / 2 - B_R : NET_X + NET_W / 2 + B_R;
    }
  }
  return x;
}

function botInput(p, dt) {
  bot.reactT -= dt;
  let target = W * 0.75;
  let jump = false;

  if (game.phase !== 'point') {
    const land = predictBallX(GROUND - P_R * 1.6);
    // встаём чуть дальше от сетки, чем мяч, чтобы отбить его вперёд
    if (land > NET_X) target = land + 28 + bot.err;

    const onMySide = ball.x > NET_X - B_R;
    const dx = Math.abs(ball.x - p.x);
    if (onMySide && dx < 110 && ball.y < p.y - P_R && ball.y > GROUND - 520 && ball.vy > -200) {
      jump = true;
    }
  }

  const diff = target - p.x;
  const move = Math.abs(diff) < 6 ? 0 : Math.max(-1, Math.min(1, diff / 30)) * 0.9;
  return { move, jump };
}

// ---------------------------------------------------------------------------
// Физика
// ---------------------------------------------------------------------------
function updatePlayer(p, dt) {
  p.vx = p.move * P_SPEED;
  if (p.jump && p.onGround) {
    p.vy = -P_JUMP;
    p.onGround = false;
    sfx.jump();
  }
  p.vy += P_GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.y >= GROUND - P_R) {
    if (!p.onGround && p.vy > 300) p.squash = 1;
    p.y = GROUND - P_R;
    p.vy = 0;
    p.onGround = true;
  }
  const [minX, maxX] = playerBounds(p.side);
  if (p.x < minX) p.x = minX;
  if (p.x > maxX) p.x = maxX;
  p.squash = Math.max(0, p.squash - dt * 5);
}

function registerTouch(p) {
  if (game.time - p.lastHit < 0.25) return;
  p.lastHit = game.time;
  if (game.phase === 'point') return;
  if (game.phase === 'serve') {
    game.phase = 'rally';
    ball.frozen = false;
  }
  if (game.touchSide !== p.side) {
    game.touchSide = p.side;
    game.touchCount = 1;
  } else {
    game.touchCount++;
  }
  if (p.side === 1) bot.err = (Math.random() - 0.5) * 50;
  if (game.touchCount > MAX_TOUCHES) awardPoint(1 - p.side, 'Больше 3 касаний!');
}

function collideBallPlayer(p) {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;
  const d = Math.hypot(dx, dy);
  const min = P_R + B_R;
  if (d >= min || d === 0) return;

  const nx = dx / d;
  const ny = dy / d;
  ball.x = p.x + nx * min;
  ball.y = p.y + ny * min;

  const rvx = ball.vx - p.vx;
  const rvy = ball.vy - p.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0 && !ball.frozen) return;

  ball.frozen = false;
  let vx = rvx - 1.9 * vn * nx + p.vx;
  let vy = rvy - 1.9 * vn * ny + Math.min(p.vy, 0);
  const out = vx * nx + vy * ny;
  if (out < B_MIN_BOUNCE) {
    vx += (B_MIN_BOUNCE - out) * nx;
    vy += (B_MIN_BOUNCE - out) * ny;
  }
  const sp = Math.hypot(vx, vy);
  if (sp > B_MAX_SPEED) {
    vx *= B_MAX_SPEED / sp;
    vy *= B_MAX_SPEED / sp;
  }
  ball.vx = vx;
  ball.vy = vy;
  sfx.hit(Math.min(sp, B_MAX_SPEED));
  registerTouch(p);
}

function collideBallNet() {
  const half = NET_W / 2;
  if (ball.y > NET_TOP) {
    if (Math.abs(ball.x - NET_X) < half + B_R) {
      if (ball.x < NET_X) {
        ball.x = NET_X - half - B_R;
        if (ball.vx > 0) ball.vx = -ball.vx * 0.8;
      } else {
        ball.x = NET_X + half + B_R;
        if (ball.vx < 0) ball.vx = -ball.vx * 0.8;
      }
      sfx.wall();
    }
    return;
  }
  const dx = ball.x - NET_X;
  const dy = ball.y - NET_TOP;
  const d = Math.hypot(dx, dy);
  const min = half + B_R;
  if (d < min && d > 0) {
    const nx = dx / d;
    const ny = dy / d;
    ball.x = NET_X + nx * min;
    ball.y = NET_TOP + ny * min;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= 1.8 * vn * nx;
      ball.vy -= 1.8 * vn * ny;
      sfx.wall();
    }
  }
}

function updateBall(dt) {
  if (!ball.frozen) {
    ball.vy += B_GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }
  ball.rot += (ball.vx * dt) / B_R;

  if (ball.x < B_R) {
    ball.x = B_R;
    ball.vx = Math.abs(ball.vx) * 0.9;
    sfx.wall();
  } else if (ball.x > W - B_R) {
    ball.x = W - B_R;
    ball.vx = -Math.abs(ball.vx) * 0.9;
    sfx.wall();
  }

  collideBallNet();
  players.forEach(collideBallPlayer);

  if (ball.y + B_R >= GROUND) {
    ball.y = GROUND - B_R;
    if (game.phase === 'rally') {
      awardPoint(ball.x < NET_X ? 1 : 0, '');
    }
    ball.vy = -Math.abs(ball.vy) * 0.45;
    ball.vx *= 0.7;
    if (Math.abs(ball.vy) < 60) ball.vy = 0;
  }
}

function step(dt) {
  game.time += dt;
  for (let s = 0; s < 2; s++) tapJump[s] = Math.max(0, tapJump[s] - dt);

  players.forEach((p) => {
    const inp = p.side === 1 && game.vsBot ? botInput(p, dt) : readInput(p.side);
    p.move = inp.move;
    p.jump = inp.jump;
    updatePlayer(p, dt);
  });

  if (game.phase === 'serve') {
    game.phaseT -= dt;
    if (game.phaseT <= 0 && ball.frozen) {
      ball.frozen = false;
      game.phase = 'rally';
    }
  }

  updateBall(dt);

  if (game.phase === 'point') {
    game.phaseT -= dt;
    if (game.phaseT <= 0) {
      const w = checkWinner();
      if (w >= 0) endMatch(w);
      else startServe();
    }
  }

  game.msgT = Math.max(0, game.msgT - dt);
  game.hintT = Math.max(0, game.hintT - dt);
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------
function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, -200, 0, GROUND);
  sky.addColorStop(0, '#6b4fa3');
  sky.addColorStop(0.55, '#f08a6b');
  sky.addColorStop(1, '#ffd29a');
  ctx.fillStyle = sky;
  ctx.fillRect(-3000, -3000, W + 6000, GROUND + 3000);

  // солнце
  ctx.fillStyle = 'rgba(255, 236, 190, 0.9)';
  circle(W * 0.5, GROUND - 330, 120);
  ctx.fill();

  // горы
  ctx.fillStyle = '#9a5f86';
  ctx.beginPath();
  ctx.moveTo(-3000, GROUND);
  ctx.lineTo(-200, GROUND - 140);
  ctx.lineTo(250, GROUND - 330);
  ctx.lineTo(520, GROUND - 170);
  ctx.lineTo(800, GROUND - 230);
  ctx.lineTo(1150, GROUND - 390);
  ctx.lineTo(1500, GROUND - 180);
  ctx.lineTo(W + 3000, GROUND - 100);
  ctx.lineTo(W + 3000, GROUND);
  ctx.fill();
  // снежная шапка
  ctx.fillStyle = '#f4e6ee';
  ctx.beginPath();
  ctx.moveTo(1150, GROUND - 390);
  ctx.lineTo(1085, GROUND - 330);
  ctx.lineTo(1120, GROUND - 340);
  ctx.lineTo(1150, GROUND - 320);
  ctx.lineTo(1185, GROUND - 342);
  ctx.lineTo(1215, GROUND - 330);
  ctx.fill();

  // песок
  const sand = ctx.createLinearGradient(0, GROUND, 0, GROUND + 200);
  sand.addColorStop(0, '#e9c98f');
  sand.addColorStop(1, '#c9a064');
  ctx.fillStyle = sand;
  ctx.fillRect(-3000, GROUND, W + 6000, 3000);
  ctx.fillStyle = '#d8b577';
  ctx.fillRect(-3000, GROUND, W + 6000, 6);

  // соломенные валики дохё у краёв площадки
  ctx.fillStyle = '#b8935a';
  ctx.fillRect(-26, GROUND - 22, 26, 22);
  ctx.fillRect(W, GROUND - 22, 26, 22);
}

function drawNet() {
  const half = NET_W / 2;
  // сетка
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = NET_TOP + 20; y < GROUND; y += 22) {
    ctx.moveTo(NET_X - 34, y);
    ctx.lineTo(NET_X + 34, y);
  }
  for (let x = NET_X - 33; x <= NET_X + 33; x += 22) {
    ctx.moveTo(x, NET_TOP + 20);
    ctx.lineTo(x, GROUND - 60);
  }
  ctx.stroke();
  // столб
  ctx.fillStyle = '#6d3f21';
  ctx.fillRect(NET_X - half, NET_TOP, NET_W, GROUND - NET_TOP);
  ctx.fillStyle = '#f5f1e6';
  ctx.fillRect(NET_X - 36, NET_TOP + 8, 72, 12);
  circle(NET_X, NET_TOP, half);
  ctx.fillStyle = '#c9352f';
  ctx.fill();
}

function drawShadow(x, height, w) {
  const k = Math.max(0.3, 1 - height / 600);
  ctx.fillStyle = `rgba(80, 40, 10, ${0.28 * k})`;
  ctx.beginPath();
  ctx.ellipse(x, GROUND + 4, w * k, 12 * k, 0, 0, TAU);
  ctx.fill();
}

function drawSumo(p) {
  const dir = p.side === 0 ? 1 : -1;
  const c = COLORS[p.side];
  const s = p.squash;
  const air = !p.onGround;

  drawShadow(p.x, GROUND - P_R - p.y, P_R * 0.95);

  ctx.save();
  ctx.translate(p.x, p.y + P_R);
  ctx.scale(1 + s * 0.16, 1 - s * 0.16);
  ctx.translate(0, -P_R);
  ctx.lineWidth = 4;
  ctx.strokeStyle = SKIN_DARK;

  // ступни
  ctx.fillStyle = SKIN;
  for (const fx of [-38, 38]) {
    ctx.beginPath();
    ctx.ellipse(fx + dir * 6, P_R - 10 + (air ? -6 : 0), 26, 14, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // тело
  const body = ctx.createRadialGradient(dir * 18, -6, 10, 0, 12, P_R);
  body.addColorStop(0, '#fbdcbf');
  body.addColorStop(1, SKIN);
  ctx.fillStyle = body;
  circle(0, 12, P_R - 8);
  ctx.fill();
  ctx.stroke();

  // маваси (пояс)
  ctx.save();
  circle(0, 12, P_R - 10);
  ctx.clip();
  ctx.fillStyle = c.belt;
  ctx.fillRect(-P_R, 34, P_R * 2, 26);
  ctx.fillStyle = c.dark;
  ctx.fillRect(-P_R, 56, P_R * 2, 4);
  ctx.restore();
  ctx.fillStyle = c.belt;
  ctx.fillRect(dir * 10 - 11, 56, 22, 22);
  ctx.fillStyle = c.dark;
  for (let i = -1; i <= 1; i++) ctx.fillRect(dir * 10 + i * 7 - 1.5, 60, 3, 22);

  // пупок
  ctx.fillStyle = SKIN_DARK;
  circle(dir * 10, 22, 3);
  ctx.fill();

  // руки
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * (P_R - 14), 4);
    ctx.rotate(side * (air ? -0.9 : 0.25));
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.ellipse(0, 18, 18, 32, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // голова
  const hx = dir * 6;
  const hy = -P_R + 36;
  ctx.fillStyle = SKIN;
  circle(hx, hy, 30);
  ctx.fill();
  ctx.stroke();
  // волосы и пучок (тёммагэ)
  ctx.fillStyle = '#1d1a1a';
  ctx.beginPath();
  ctx.arc(hx, hy, 31, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx - dir * 4, hy - 34, 15, 8, dir * -0.3, 0, TAU);
  ctx.fill();
  // лицо
  ctx.fillStyle = '#1d1a1a';
  circle(hx + dir * 17, hy + 2, 3.5);
  ctx.fill();
  circle(hx + dir * 3, hy + 2, 3.5);
  ctx.fill();
  ctx.strokeStyle = '#1d1a1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx + dir * 11, hy - 10);
  ctx.lineTo(hx + dir * 23, hy - 5);
  ctx.moveTo(hx + dir * 9, hy - 10);
  ctx.lineTo(hx - dir * 3, hy - 5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230, 110, 110, 0.45)';
  circle(hx + dir * 22, hy + 12, 6);
  ctx.fill();
  ctx.strokeStyle = '#7a3d2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(hx + dir * 10, hy + 12, 6, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

function drawBall() {
  drawShadow(ball.x, GROUND - B_R - ball.y, B_R * 0.9);

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.rot);
  ctx.fillStyle = '#fffdf6';
  circle(0, 0, B_R);
  ctx.fill();
  ctx.save();
  circle(0, 0, B_R);
  ctx.clip();
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#f4c430';
  ctx.beginPath();
  ctx.arc(-B_R * 1.1, 0, B_R * 1.2, -0.7, 0.7);
  ctx.stroke();
  ctx.strokeStyle = '#2f63c9';
  ctx.beginPath();
  ctx.arc(B_R * 1.1, 0, B_R * 1.2, Math.PI - 0.7, Math.PI + 0.7);
  ctx.stroke();
  ctx.strokeStyle = '#f4c430';
  ctx.beginPath();
  ctx.arc(0, -B_R * 1.3, B_R * 1.1, 0.35 * Math.PI, 0.65 * Math.PI);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#6b6457';
  circle(0, 0, B_R);
  ctx.stroke();
  ctx.restore();

  // указатель, если мяч улетел выше экрана
  const topWorld = -oy / scale;
  if (ball.y + B_R < topWorld) {
    const y = topWorld + 18;
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath();
    ctx.moveTo(ball.x, y);
    ctx.lineTo(ball.x - 16, y + 22);
    ctx.lineTo(ball.x + 16, y + 22);
    ctx.fill();
  }
}

function drawText(text, x, y, size, color, align = 'center') {
  ctx.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = 'rgba(40, 20, 30, 0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHud() {
  for (let s = 0; s < 2; s++) {
    const x = s === 0 ? NET_X - 130 : NET_X + 130;
    drawText(String(game.score[s]), x, 80, 88, COLORS[s].score);
    drawText(sideName(s), x, 142, 28, '#fff');
    // касания
    if (game.touchSide === s && game.phase !== 'point') {
      for (let i = 0; i < MAX_TOUCHES; i++) {
        ctx.fillStyle = i < game.touchCount ? '#fff' : 'rgba(255,255,255,0.25)';
        circle(x - 24 + i * 24, 176, 7);
        ctx.fill();
      }
    }
    if (game.phase === 'serve' && game.server === s) {
      drawText('подача', x, 176, 22, '#ffe7a8');
    }
  }

  if (game.msgT > 0 && game.msg) {
    ctx.globalAlpha = Math.min(1, game.msgT * 2);
    drawText(game.msg, NET_X, 300, 60, '#fff');
    ctx.globalAlpha = 1;
  }

  if (game.hintT > 0) {
    ctx.globalAlpha = Math.min(1, game.hintT);
    const sides = game.vsBot ? [W * 0.25] : [W * 0.25, W * 0.75];
    for (const x of sides) {
      drawText('← → ведите пальцем', x, 420, 30, '#fff');
      drawText('↑ свайп / тап — прыжок', x, 462, 30, '#fff');
    }
    ctx.globalAlpha = 1;
  }
}

function drawJoysticks() {
  for (const p of pointers.values()) {
    const c = COLORS[p.side].belt;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    circle(p.sx, p.sy, JOY_FULL + 12);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c;
    const dx = Math.max(-JOY_FULL, Math.min(JOY_FULL, p.x - p.sx));
    const dy = Math.max(-JOY_UP - 10, Math.min(JOY_UP, p.y - p.sy));
    circle(p.sx + dx, p.sy + dy, 22);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2b1d3a';
  ctx.fillRect(0, 0, cw, ch);

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  drawBackground();
  drawNet();
  players.forEach(drawSumo);
  drawBall();
  if (game.screen !== 'menu') drawHud();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawJoysticks();
}

// ---------------------------------------------------------------------------
// Экраны и кнопки
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const overlays = { menu: $('menu'), pause: $('pause'), over: $('over') };
const pauseBtn = $('pauseBtn');

function showOverlay(name) {
  for (const [k, el] of Object.entries(overlays)) el.classList.toggle('hidden', k !== name);
  pauseBtn.classList.toggle('hidden', !(game.screen === 'play' && !game.paused));
}

function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    Promise.resolve(req.call(el))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}

function togglePause(force) {
  if (game.screen !== 'play') return;
  game.paused = force !== undefined ? force : !game.paused;
  pointers.clear();
  showOverlay(game.paused ? 'pause' : null);
}

function endMatch(winner) {
  game.screen = 'over';
  pointers.clear();
  const title = game.vsBot
    ? (winner === 0 ? 'Победа! 🏆' : 'Бот победил')
    : `${COLORS[winner].name} победил! 🏆`;
  $('overTitle').textContent = title;
  $('overScore').textContent = `${game.score[0]} : ${game.score[1]}`;
  showOverlay('over');
  sfx.win();
}

document.querySelectorAll('#menu button[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ensureAudio();
    goFullscreen();
    startMatch(btn.dataset.mode === '1');
  });
});
pauseBtn.addEventListener('click', () => togglePause(true));
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('againBtn').addEventListener('click', () => startMatch(game.vsBot));
const toMenu = () => {
  game.screen = 'menu';
  game.paused = false;
  resetDemo();
  showOverlay('menu');
};
$('pauseMenuBtn').addEventListener('click', toMenu);
$('overMenuBtn').addEventListener('click', toMenu);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) togglePause(true);
});

// демо-сцена за меню
function resetDemo() {
  resetPlayers();
  ball.x = W * 0.25;
  ball.y = GROUND - 2 * P_R - 200;
  ball.vx = ball.vy = 0;
  ball.frozen = true;
}
resetDemo();

// ---------------------------------------------------------------------------
// Главный цикл
// ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const running = game.screen === 'play' && !game.paused && !isPortraitTouch();
  if (running) {
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
      if (game.screen !== 'play') break;
    }
  } else {
    acc = 0;
  }

  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

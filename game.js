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
  screen: 'menu',   // menu | wait | play | over
  mode: 'bot',      // bot | local | host | guest
  mySide: 0,        // сторона этого устройства (-1 — зритель или оба игрока)
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
  hits: 0,
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

function startMatch(mode) {
  game.mode = mode;
  game.mySide = mode === 'local' ? -1 : 0;
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
  if (game.mode === 'bot') return side === 0 ? 'Вы' : 'Бот';
  if (game.mySide >= 0 && game.mode !== 'local') return side === game.mySide ? 'Вы' : 'Соперник';
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
// Управление: зоны касания и клавиатура.
// Нижняя часть экрана — движение (левая половина зоны ←, правая →),
// верхняя — прыжок. В игре вдвоём на одном телефоне у каждого своя половина.
// ---------------------------------------------------------------------------
const pointers = new Map(); // pointerId -> { side, x, y }
const tapJump = [0, 0];     // время «импульса» прыжка от тапа
const JUMP_ZONE = 0.4;      // верхние 40% экрана — прыжок

function zoneOf(side) {
  if (game.mode === 'local') return side === 0 ? [0, cw / 2] : [cw / 2, cw];
  return [0, cw];
}

function touchAction(p) {
  if (p.y < ch * JUMP_ZONE) return 'jump';
  const [x0, x1] = zoneOf(p.side);
  return p.x < (x0 + x1) / 2 ? 'left' : 'right';
}

function pointerSide(clientX) {
  if (game.mode === 'local') return clientX < cw / 2 ? 0 : 1;
  return game.mySide;
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.screen !== 'play' || game.paused) return;
  ensureAudio();
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  const side = pointerSide(e.clientX);
  if (side < 0) return;
  const p = { side, x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, p);
  // короткий тап по зоне прыжка не должен теряться
  if (touchAction(p) === 'jump') {
    if (game.mode === 'guest') net.tapSeq++;
    else tapJump[side] = 0.15;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  p.x = e.clientX;
  p.y = e.clientY;
});

function endPointer(e) {
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  // короткое нажатие прыжка у гостя может не успеть уйти по сети — шлём как тап
  if (game.mode === 'guest' && !e.repeat && ['ArrowUp', 'KeyW', 'Space'].includes(e.code)) net.tapSeq++;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function readInput(side) {
  let move = 0;
  let jump = false;

  const left = side === 0 ? ['KeyA'] : ['ArrowLeft'];
  const right = side === 0 ? ['KeyD'] : ['ArrowRight'];
  const up = side === 0 ? ['KeyW'] : ['ArrowUp'];
  if (game.mode !== 'local') {
    left.push('KeyA');
    right.push('KeyD');
    up.push('KeyW');
  }
  if (game.mode !== 'local') {
    left.push('ArrowLeft');
    right.push('ArrowRight');
    up.push('ArrowUp', 'Space');
  }
  if (left.some((k) => keys.has(k))) move -= 1;
  if (right.some((k) => keys.has(k))) move += 1;
  if (up.some((k) => keys.has(k))) jump = true;

  // пальцы этой стороны: можно держать движение и одновременно жать прыжок
  let touchMove = 0;
  for (const p of pointers.values()) {
    if (p.side !== side) continue;
    const a = touchAction(p);
    if (a === 'jump') jump = true;
    else touchMove = a === 'left' ? -1 : 1; // последний палец главнее
  }
  if (touchMove) move = touchMove;
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
  game.hits++;
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
    let inp;
    if (p.side === 1 && game.mode === 'bot') inp = botInput(p, dt);
    else if (p.side === 1 && game.mode === 'host') inp = net.remoteInput();
    else inp = readInput(p.side);
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
    const sides = game.mode === 'local' ? [W * 0.25, W * 0.75]
      : game.mySide >= 0 ? [game.mySide === 0 ? W * 0.25 : W * 0.75] : [];
    if (game.mode === 'guest' && game.mySide < 0) drawText('Вы смотрите игру', NET_X, 420, 34, '#fff');
    for (const x of sides) {
      if (isTouch) continue; // на телефоне подсказки нарисованы прямо на зонах
      const kb = game.mode === 'local' ? (x < NET_X ? 'A / D / W' : '← / → / ↑') : '← / → / ↑  или  A / D / W';
      drawText(kb, x, 420, 30, '#fff');
      drawText('движение и прыжок', x, 462, 30, '#fff');
    }
    ctx.globalAlpha = 1;
  }
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;

function drawTouchZones() {
  if (game.screen !== 'play' || game.paused || game.mySide < 0 && game.mode !== 'local') return;
  if (!isTouch && game.hintT <= 0) return;
  const sides = game.mode === 'local' ? [0, 1] : [game.mySide];
  const jy = ch * JUMP_ZONE;
  const base = game.hintT > 0 ? 0.5 : 0.14;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2;
  for (const side of sides) {
    const [x0, x1] = zoneOf(side);
    const mid = (x0 + x1) / 2;
    const active = new Set();
    for (const p of pointers.values()) if (p.side === side) active.add(touchAction(p));

    // подсветка нажатых зон
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    if (active.has('jump')) ctx.fillRect(x0, 0, x1 - x0, jy);
    if (active.has('left')) ctx.fillRect(x0, jy, mid - x0, ch - jy);
    if (active.has('right')) ctx.fillRect(mid, jy, x1 - mid, ch - jy);

    // границы зон
    ctx.strokeStyle = `rgba(255,255,255,${base})`;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(x0 + 12, jy);
    ctx.lineTo(x1 - 12, jy);
    ctx.moveTo(mid, jy + 12);
    ctx.lineTo(mid, ch - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    // подписи
    const size = Math.max(18, Math.min(34, ch * 0.07));
    ctx.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, base + 0.2)})`;
    const ly = jy + (ch - jy) * 0.72;
    ctx.fillText('◀', (x0 + mid) / 2, ly);
    ctx.fillText('▶', (mid + x1) / 2, ly);
    ctx.fillText('▲ прыжок', mid, jy * 0.62);
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
  drawTouchZones();
}

// ---------------------------------------------------------------------------
// Экраны и кнопки
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const overlays = {
  menu: $('menu'), online: $('online'), wait: $('wait'), pause: $('pause'), over: $('over'), log: $('log'),
};
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

function overTitle(winner) {
  if (game.mode === 'bot') return winner === 0 ? 'Победа! 🏆' : 'Бот победил';
  if (game.mode !== 'local' && game.mySide >= 0) {
    return winner === game.mySide ? 'Победа! 🏆' : 'Соперник победил';
  }
  return `${COLORS[winner].name} победил! 🏆`;
}

function showOver(winner) {
  $('overTitle').textContent = overTitle(winner);
  $('overScore').textContent = `${game.score[0]} : ${game.score[1]}`;
  // в онлайне новую партию начинает создатель игры
  $('againBtn').classList.toggle('hidden', game.mode === 'guest');
  $('overNote').classList.toggle('hidden', game.mode !== 'guest');
  showOverlay('over');
}

function endMatch(winner) {
  game.screen = 'over';
  pointers.clear();
  showOver(winner);
  sfx.win();
}

function toMenu() {
  net.leave();
  game.screen = 'menu';
  game.mode = 'bot';
  game.mySide = 0;
  game.paused = false;
  resetDemo();
  showOverlay('menu');
}

document.querySelectorAll('#menu button[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ensureAudio();
    goFullscreen();
    startMatch(btn.dataset.mode === '1' ? 'bot' : 'local');
  });
});
pauseBtn.addEventListener('click', () => togglePause(true));
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('againBtn').addEventListener('click', () => startMatch(game.mode));
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
// Онлайн (claude.ai, capability `room`)
//
// Создатель игры (host, красный) считает физику и публикует состояние в своём
// presence. Гость (синий) публикует только своё управление и рисует
// полученное состояние. Остальные вошедшие в ту же игру смотрят.
// ---------------------------------------------------------------------------
const CODE_ABC = 'abcdefghjkmnpqrstuvwxyz23456789';

const ERRORS = {
  'NET-404': { text: 'Игра {code} не найдена: проверьте код или попросите друга создать игру заново.' },
  'NET-409': { text: 'Не получилось занять код игры. Попробуйте создать игру ещё раз.' },
  'NET-SRV': { text: 'Нет связи с сервером подключения (0.peerjs.com). Проверьте интернет; возможно, сеть или VPN его блокирует.' },
  'NET-SRV-TIMEOUT': { text: 'Сервер подключения (0.peerjs.com) не ответил за 20 секунд. Попробуйте ещё раз или другую сеть.' },
  'NET-P2P': { text: 'Игра найдена, но телефоны не смогли соединиться напрямую. Частая причина — мобильный интернет: подключите оба телефона к Wi-Fi.' },
  'NET-RTC': { text: 'Ошибка WebRTC в браузере. Откройте ссылку в Safari или Chrome, а не во встроенном браузере мессенджера.' },
  'NET-BROWSER': { text: 'Этот браузер не поддерживает прямое соединение. Откройте ссылку в Safari или Chrome.' },
  'NET-LOST': { text: 'Связь с создателем игры потеряна.' },
  'NET-UNKNOWN': { text: 'Не удалось подключиться.' },
};
const PEERJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
const PEER_PREFIX = 'sumovolley-v1-';
const PEER_OPTS = {
  ...(window.SUMO_PEER_SERVER || {}), // для тестов с локальным сервером PeerJS
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = reject;
    document.head.append(el);
  });
}

// Журнал подключения: показывается игроку и копируется для отладки.
const netLog = {
  lines: [],
  add(msg) {
    const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
    this.lines.push(line);
    if (this.lines.length > 400) this.lines.shift();
    if (window.console) console.log('[net]', msg);
  },
  env() {
    const c = navigator.connection || {};
    this.add(`env: ${navigator.userAgent}`);
    this.add(`env: online=${navigator.onLine} net=${c.effectiveType || '?'}/${c.type || '?'} ` +
      `webrtc=${typeof RTCPeerConnection !== 'undefined'} url=${location.origin}${location.pathname}`);
  },
  text() {
    return this.lines.join('\n');
  },
};

const errType = (err) => (err && (err.type || err.name)) || 'unknown';
const errMsg = (err) => (err && err.message ? String(err.message).slice(0, 200) : '');

// Следим за WebRTC-соединением: какие адреса нашлись (host/srflx/relay)
// и чем закончился ICE — это главное, что нужно для разбора проблем.
function watchIce(conn, label, onFailed) {
  let tries = 0;
  const hook = () => {
    const pc = conn.peerConnection;
    if (!pc) {
      if (tries++ < 50) setTimeout(hook, 100);
      return;
    }
    const kinds = new Set();
    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate && e.candidate.candidate) {
        const m = / typ (\w+)/.exec(e.candidate.candidate);
        const kind = m ? m[1] : '?';
        if (!kinds.has(kind)) {
          kinds.add(kind);
          netLog.add(`${label}: найден свой адрес типа ${kind}`);
        }
      } else if (!e.candidate) {
        netLog.add(`${label}: сбор адресов завершён (${[...kinds].join(',') || 'нет'})`);
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      netLog.add(`${label}: ICE ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' && onFailed) onFailed();
    });
    pc.addEventListener('connectionstatechange', () => netLog.add(`${label}: соединение ${pc.connectionState}`));
  };
  hook();
}

// Комната поверх WebRTC (PeerJS) с тем же интерфейсом, что и у `room`:
// presence / peers / onPeers / leave. Создатель игры — узел с id по коду,
// остальные подключаются к нему напрямую.
function p2pJoin(code, role, onIssue) {
  return new Promise((resolve, reject) => {
    netLog.add(`${role}: старт, код ${code.toUpperCase()}, сервер ${PEER_OPTS.host || '0.peerjs.com'}`);
    let stage = 'server'; // server -> p2p -> ok
    let peer;
    try {
      peer = role === 'host' ? new Peer(PEER_PREFIX + code, PEER_OPTS) : new Peer(PEER_OPTS);
    } catch (e) {
      netLog.add(`${role}: не удалось создать Peer: ${errType(e)} ${errMsg(e)}`);
      reject({ type: 'browser-incompatible', message: errMsg(e) });
      return;
    }
    const conns = new Map(); // peer id -> { conn, presence }
    const listeners = new Set();
    let mine = {};
    let myId = null;
    let snap = [];
    let settled = false;
    let closed = false;
    let sendTimer = 0;

    const rebuild = () => {
      snap = [{ peer: myId, presence: mine, sameTab: true, isMe: true }];
      for (const [id, c] of conns) {
        if (c.presence) snap.push({ peer: id, presence: c.presence, sameTab: false, isMe: false });
      }
      listeners.forEach((f) => f());
    };
    const flush = () => {
      sendTimer = 0;
      for (const c of conns.values()) {
        if (c.conn.open) {
          try {
            c.conn.send({ t: 'p', p: mine });
          } catch (e) { /* соединение закрывается */ }
        }
      }
    };
    const fail = (err) => {
      netLog.add(`${role}: ошибка ${errType(err)} на этапе ${stage} ${errMsg(err)}`);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(beat);
      window.removeEventListener('pagehide', bye);
      closed = true;
      try { peer.destroy(); } catch (e) { /* уже закрыт */ }
      reject({ type: errType(err), message: errMsg(err), stage });
    };
    const timer = setTimeout(() => fail({ type: 'timeout' }), 20000);
    // WebRTC замечает пропажу соседа не сразу: шлём пульс и отключаем молчащих
    const beat = setInterval(() => {
      flush();
      const now = Date.now();
      for (const c of conns.values()) {
        if (now - c.seen > 5000) {
          try { c.conn.close(); } catch (e) { /* уже закрыто */ }
          dropConn(c.conn);
        }
      }
    }, 1000);
    const bye = () => chan.leave();
    window.addEventListener('pagehide', bye);

    const chan = {
      presence(patch) {
        mine = { ...mine };
        for (const k of Object.keys(patch)) {
          if (patch[k] === null) delete mine[k];
          else mine[k] = patch[k];
        }
        rebuild();
        if (!sendTimer) sendTimer = setTimeout(flush, 16);
        return Promise.resolve();
      },
      peers: () => snap,
      onPeers(f) {
        listeners.add(f);
        setTimeout(() => listeners.has(f) && f(), 0);
        return () => listeners.delete(f);
      },
      leave() {
        closed = true;
        clearTimeout(sendTimer);
        clearInterval(beat);
        window.removeEventListener('pagehide', bye);
        listeners.clear();
        try { peer.destroy(); } catch (e) { /* уже закрыт */ }
        return Promise.resolve();
      },
    };

    const dropConn = (conn) => {
      if (conns.get(conn.peer)?.conn === conn) {
        netLog.add(`${role}: соединение с ${conn.peer.slice(-6)} закрыто`);
        conns.delete(conn.peer);
        rebuild();
      }
    };
    const attach = (conn) => {
      conns.set(conn.peer, { conn, presence: null, seen: Date.now() });
      const label = role === 'host' ? `host←${conn.peer.slice(-6)}` : 'guest→host';
      netLog.add(`${label}: устанавливаем прямое соединение`);
      watchIce(conn, label, () => {
        if (role === 'guest') fail({ type: 'ice-failed' });
        else if (onIssue) onIssue('NET-P2P');
      });
      conn.on('open', () => {
        netLog.add(`${label}: канал данных открыт`);
        stage = 'ok';
        conn.send({ t: 'p', p: mine });
        if (role === 'guest' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(chan);
        }
      });
      conn.on('data', (d) => {
        const c = conns.get(conn.peer);
        if (c) c.seen = Date.now();
        if (c && d && d.t === 'p' && d.p && typeof d.p === 'object') {
          c.presence = d.p;
          rebuild();
        }
      });
      conn.on('close', () => dropConn(conn));
      conn.on('error', (e) => {
        netLog.add(`${label}: ошибка канала ${errType(e)} ${errMsg(e)}`);
        dropConn(conn);
      });
    };

    peer.on('open', (id) => {
      myId = id;
      netLog.add(`${role}: сервер подключения ответил, мой id …${id.slice(-6)}`);
      rebuild();
      if (settled) return; // переподключение к серверу
      if (role === 'host') {
        settled = true;
        clearTimeout(timer);
        resolve(chan);
      } else {
        stage = 'p2p';
        attach(peer.connect(PEER_PREFIX + code, { serialization: 'json' }));
      }
    });
    peer.on('connection', (conn) => {
      if (role === 'host') attach(conn);
      else conn.close();
    });
    peer.on('error', (err) => fail(err));
    // сервер нужен только для новых подключений — возвращаемся к нему тихо
    peer.on('disconnected', () => {
      netLog.add(`${role}: связь с сервером подключения потеряна${closed ? '' : ', переподключаемся'}`);
      if (!closed && settled) {
        try { peer.reconnect(); } catch (e) { /* попробуем позже */ }
      }
    });
  });
}

const p2pLobby = {
  p2p: true,
  join: p2pJoin,
  presence: () => Promise.resolve(),
  peers: () => [],
  onPeers: () => () => {},
};
const PHASES = ['serve', 'rally', 'point'];

const net = {
  room: null,       // лобби: все, у кого открыта страница
  chan: null,       // комната конкретной игры
  code: '',
  opp: null,        // host: peer соперника
  hostPeer: null,   // guest: peer создателя
  lastTap: 0,       // host: последний номер тапа гостя
  tapSeq: 0,        // guest: номер своего тапа
  sentIn: '',
  lastSt: null,
  target: null,
  recvT: 0,
  lastHits: 0,
  lastScreen: 0,
  unsubs: [],
  joinTimer: 0,

  async init() {
    // На claude.ai — capability `room`; на обычном сайте — WebRTC через PeerJS.
    if (window.claude && window.claude.use) {
      let room = null;
      try {
        room = await window.claude.use('room');
      } catch (e) {
        room = null;
      }
      if (!room) return;
      this.room = room;
      $('onlineBtn').classList.remove('hidden');
      room.onPeers(() => this.renderLobby(), () => $('onlineBtn').classList.add('hidden'));
      return;
    }
    try {
      await loadScript(PEERJS_URL);
    } catch (e) {
      netLog.add('не удалось загрузить PeerJS с cdnjs — онлайн недоступен');
      return;
    }
    if (!window.Peer) return;
    netLog.env();
    this.room = p2pLobby;
    $('onlineBtn').classList.remove('hidden');
    $('gameList').classList.add('hidden');
    $('joinHint').textContent = 'Или введите код друга:';
    $('onlineHint').textContent = 'Создайте игру и отправьте другу ссылку или код. Лучше играть через Wi-Fi.';

    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (join) {
      history.replaceState(null, '', location.pathname);
      this.joinGame(join);
    }
  },

  joinChan(code, role) {
    if (this.room.p2p) {
      return this.room.join(code, role, (issue) => {
        if (game.mode === 'host' && game.screen === 'wait') {
          $('waitText').textContent = `${ERRORS[issue].text} (${issue})`;
        }
      });
    }
    return this.room.join('sumo-' + code).catch(() => this.room); // без именованных комнат — общее лобби
  },

  onlineError(text) {
    this.leave();
    game.mode = 'bot';
    game.mySide = 0;
    game.screen = 'menu';
    showOverlay('online');
    this.renderLobby();
    $('onlineError').textContent = text;
  },

  // Ошибка PeerJS -> код и понятный текст (коды — в ERRORS и README)
  errorText(err, code) {
    const type = errType(err);
    let key = 'NET-UNKNOWN';
    if (type === 'peer-unavailable') key = 'NET-404';
    else if (type === 'unavailable-id') key = 'NET-409';
    else if (type === 'browser-incompatible') key = 'NET-BROWSER';
    else if (type === 'ice-failed') key = 'NET-P2P';
    else if (type === 'timeout') key = err.stage === 'p2p' ? 'NET-P2P' : 'NET-SRV-TIMEOUT';
    else if (['network', 'socket-error', 'socket-closed', 'server-error', 'ssl-unavailable'].includes(type)) key = 'NET-SRV';
    else if (type === 'webrtc') key = 'NET-RTC';
    const text = ERRORS[key].text
      .replace('{code}', code.toUpperCase())
      .replace('0.peerjs.com', PEER_OPTS.host || '0.peerjs.com');
    netLog.add(`итог: ${key} (${type}${err && err.stage ? ', этап ' + err.stage : ''})`);
    return `${text} Код ошибки: ${key}${key === 'NET-UNKNOWN' ? ' / ' + type : ''}.`;
  },

  inviteUrl() {
    return `${location.origin}${location.pathname}?join=${this.code.toUpperCase()}`;
  },

  async share() {
    const url = this.inviteUrl();
    const text = `Сыграем в Sumo Volley! Код игры: ${this.code.toUpperCase()}`;
    const btn = $('shareBtn');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Sumo Volley', text, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Ссылка скопирована';
    } catch (e) {
      $('waitText').textContent = url;
    }
  },

  gamePeers() {
    return (this.chan ? this.chan.peers() : []).filter((p) => p.presence && p.presence.g === this.code);
  },

  renderLobby() {
    if (overlays.online.classList.contains('hidden') || !this.room || this.room.p2p) return;
    const list = $('gameList');
    const codes = [];
    for (const p of this.room.peers()) {
      const c = p.presence && p.presence.open;
      if (!p.sameTab && typeof c === 'string' && /^[a-z0-9]{4}$/.test(c) && !codes.includes(c)) codes.push(c);
    }
    list.replaceChildren();
    if (!codes.length) {
      const empty = document.createElement('p');
      empty.className = 'rules';
      empty.textContent = 'Открытых игр пока нет. Создайте свою или введите код.';
      list.append(empty);
    }
    for (const c of codes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Игра ' + c.toUpperCase();
      b.addEventListener('click', () => this.joinGame(c));
      list.append(b);
    }
  },

  showWait(title, code, text) {
    game.screen = 'wait';
    $('waitTitle').textContent = title;
    $('waitCode').textContent = code ? code.toUpperCase() : '';
    $('waitText').textContent = text;
    showOverlay('wait');
  },

  async createGame() {
    ensureAudio();
    goFullscreen();
    game.mode = 'host';
    game.mySide = 0;
    const p2p = this.room.p2p;
    $('shareBtn').classList.toggle('hidden', !p2p);
    $('shareBtn').textContent = navigator.share ? 'Отправить ссылку' : 'Скопировать ссылку';
    const hint = p2p
      ? 'Отправьте другу ссылку или продиктуйте код.'
      : 'Скажите другу этот код или попросите выбрать игру в списке.';
    let code = '';
    for (let attempt = 0; ; attempt++) {
      code = '';
      for (let i = 0; i < 4; i++) code += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
      this.code = code;
      this.showWait('Ждём соперника…', code, p2p ? 'Создаём игру…' : hint);
      try {
        this.chan = await this.joinChan(code, 'host');
        break;
      } catch (e) {
        if (game.mode !== 'host') return;
        if (e && e.type === 'unavailable-id' && attempt < 3) continue; // код занят — берём другой
        this.onlineError(this.errorText(e, code));
        return;
      }
    }
    if (game.mode !== 'host' || this.code !== code) {
      this.chan.leave();
      return;
    }
    $('waitText').textContent = hint;
    this.chan.presence({ g: code, role: 'host', st: null, in: null }).catch(() => {});
    this.room.presence({ open: code }).catch(() => {});
    this.unsubs.push(this.chan.onPeers(() => this.hostPeers()));
  },

  hostPeers() {
    const peers = this.gamePeers();
    if (this.opp && !peers.some((p) => p.peer === this.opp)) {
      this.opp = null;
      this.showWait('Соперник вышел', this.code, 'Ждём нового соперника с этим кодом.');
      this.room.presence({ open: this.code }).catch(() => {});
    }
    if (!this.opp) {
      const g = peers.find((p) => !p.sameTab && p.presence.role === 'guest');
      if (g) {
        this.opp = g.peer;
        const inp = g.presence.in;
        this.lastTap = Array.isArray(inp) ? +inp[2] || 0 : 0;
        this.room.presence({ open: null }).catch(() => {});
        startMatch('host');
      }
    }
  },

  remoteInput() {
    const p = this.gamePeers().find((x) => x.peer === this.opp);
    const inp = p && p.presence.in;
    if (!Array.isArray(inp)) return { move: 0, jump: false };
    const move = Math.max(-1, Math.min(1, +inp[0] || 0));
    let jump = inp[1] === 1;
    const tap = +inp[2] || 0;
    if (tap !== this.lastTap) {
      this.lastTap = tap;
      tapJump[1] = 0.15;
    }
    if (tapJump[1] > 0) jump = true;
    return { move, jump };
  },

  packState() {
    const r = Math.round;
    const pl = (p) => [r(p.x), r(p.y), r(p.vx), r(p.vy), +p.squash.toFixed(2), p.onGround ? 1 : 0];
    return {
      sc: game.screen === 'over' ? 1 : game.paused ? 2 : 0,
      p: [pl(players[0]), pl(players[1])],
      b: [r(ball.x), r(ball.y), r(ball.vx), r(ball.vy), +ball.rot.toFixed(2), ball.frozen ? 1 : 0],
      s: [game.score[0], game.score[1], PHASES.indexOf(game.phase), game.server,
        game.touchSide, game.touchCount, +game.msgT.toFixed(2)],
      m: game.msg.slice(0, 80),
      h: game.hits,
      opp: this.opp,
    };
  },

  hostFrame() {
    if (!this.chan || !this.opp || game.screen === 'wait') return;
    this.chan.presence({ st: this.packState() }).catch(() => {});
  },

  async joinGame(code) {
    code = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
    if (code.length !== 4) {
      $('codeInput').focus();
      return;
    }
    ensureAudio();
    goFullscreen();
    this.code = code;
    game.mode = 'guest';
    game.mySide = 1;
    this.hostPeer = null;
    this.lastSt = null;
    this.target = null;
    $('shareBtn').classList.add('hidden');
    this.showWait('Подключаемся…', code, '');
    let chan;
    try {
      chan = await this.joinChan(code, 'guest');
    } catch (e) {
      if (game.mode === 'guest' && this.code === code) this.onlineError(this.errorText(e, code));
      return;
    }
    if (game.mode !== 'guest' || this.code !== code) {
      chan.leave();
      return;
    }
    this.chan = chan;
    this.sentIn = '';
    this.chan.presence({ g: code, role: 'guest', in: [0, 0, this.tapSeq], st: null }).catch(() => {});
    this.unsubs.push(this.chan.onPeers(() => this.guestPeers()));
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => {
      if (game.mode === 'guest' && !this.hostPeer) {
        netLog.add('guest: создатель не появился за 8 секунд');
        this.onlineError(this.errorText({ type: 'peer-unavailable' }, code));
      }
    }, 8000);
  },

  guestPeers() {
    const host = this.gamePeers().find((p) => p.presence.role === 'host');
    if (host) {
      this.hostPeer = host.peer;
      if (game.screen === 'wait' && !this.lastSt) {
        this.showWait('Ждём начала…', this.code, 'Создатель игры сейчас играет с другим соперником — вы будете смотреть.');
      }
    } else if (this.hostPeer) {
      netLog.add('guest: создатель игры пропал из комнаты');
      toMenu();
      $('menuNote').textContent = `${ERRORS['NET-LOST'].text} Код ошибки: NET-LOST.`;
    }
  },

  guestFrame(dt, now) {
    const host = this.gamePeers().find((p) => p.peer === this.hostPeer);
    const st = host && host.presence.st;
    if (st && typeof st === 'object' && st !== this.lastSt) {
      this.lastSt = st;
      this.recvT = now;
      this.applyState(st);
    }
    if (this.target) this.smooth(dt, now);

    // своё управление -> presence
    if (game.mySide === 1 && game.screen === 'play' && !game.paused) {
      const inp = readInput(1);
      const msg = [Math.round(inp.move * 20) / 20, inp.jump ? 1 : 0, this.tapSeq];
      const key = msg.join(',');
      if (key !== this.sentIn) {
        this.sentIn = key;
        this.chan.presence({ in: msg }).catch(() => {});
      }
    }
  },

  applyState(st) {
    if (!Array.isArray(st.p) || !Array.isArray(st.b) || !Array.isArray(st.s)) return;
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    game.mySide = st.opp === this.myPeer() ? 1 : -1;
    const first = !this.target;
    this.target = { p: st.p.map((a) => a.map(num)), b: st.b.map(num) };
    const s = st.s.map(num);
    const prevSum = game.score[0] + game.score[1];
    game.score = [s[0], s[1]];
    game.phase = PHASES[s[2]] || 'rally';
    game.server = s[3];
    game.touchSide = s[4];
    game.touchCount = s[5];
    game.msgT = s[6];
    game.msg = typeof st.m === 'string' ? st.m.slice(0, 80) : '';
    if (!first && game.score[0] + game.score[1] > prevSum) sfx.point();
    const hits = num(st.h);
    if (!first && hits > this.lastHits) sfx.hit(700);
    this.lastHits = hits;

    const sc = num(st.sc);
    if (sc === 2) {
      game.msg = 'Пауза';
      game.msgT = 1;
    }
    if (sc === 1 && game.screen !== 'over') {
      game.screen = 'over';
      pointers.clear();
      showOver(game.score[0] > game.score[1] ? 0 : 1);
      sfx.win();
    } else if (sc !== 1 && game.screen !== 'play') {
      game.screen = 'play';
      game.paused = false;
      game.hintT = 5;
      pointers.clear();
      showOverlay(null);
      this.snap();
    }
  },

  myPeer() {
    const me = this.chan && this.chan.peers().find((p) => p.sameTab);
    return me ? me.peer : null;
  },

  snap() {
    if (!this.target) return;
    players.forEach((p, i) => {
      [p.x, p.y] = this.target.p[i];
    });
    [ball.x, ball.y] = this.target.b;
  },

  smooth(dt, now) {
    const t = this.target;
    const age = Math.min(0.12, (now - this.recvT) / 1000);
    const k = 1 - Math.exp(-dt * 25);
    players.forEach((p, i) => {
      const [x, y, vx, vy, sq, gr] = t.p[i];
      const tx = x + vx * age;
      const ty = gr ? y : Math.min(GROUND - P_R, y + vy * age + 0.5 * P_GRAVITY * age * age);
      if (Math.hypot(tx - p.x, ty - p.y) > 250) { p.x = tx; p.y = ty; }
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      p.squash = sq;
      p.onGround = gr === 1;
    });
    const [bx, by, bvx, bvy, rot, frozen] = t.b;
    const a = frozen ? 0 : age;
    const tx = bx + bvx * a;
    const ty = Math.min(GROUND - B_R, by + bvy * a + 0.5 * B_GRAVITY * a * a);
    if (Math.hypot(tx - ball.x, ty - ball.y) > 250) { ball.x = tx; ball.y = ty; }
    ball.x += (tx - ball.x) * k;
    ball.y += (ty - ball.y) * k;
    ball.rot = rot;
  },

  leave() {
    clearTimeout(this.joinTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.chan) {
      if (this.chan !== this.room) this.chan.leave().catch(() => {});
      else this.room.presence({ g: null, role: null, st: null, in: null }).catch(() => {});
    }
    if (this.room) this.room.presence({ open: null }).catch(() => {});
    this.chan = null;
    this.code = '';
    this.opp = null;
    this.hostPeer = null;
    this.lastSt = null;
    this.target = null;
  },
};

$('onlineBtn').addEventListener('click', () => {
  $('onlineError').textContent = '';
  $('menuNote').textContent = '';
  showOverlay('online');
  net.renderLobby();
});
$('createBtn').addEventListener('click', () => net.createGame());
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  net.joinGame($('codeInput').value);
});
$('onlineBack').addEventListener('click', () => showOverlay('menu'));
$('waitCancel').addEventListener('click', toMenu);
$('shareBtn').addEventListener('click', () => net.share());

// Журнал подключения
let logReturn = 'online';
function openLog(from) {
  logReturn = from;
  $('logText').textContent = netLog.text() || 'Журнал пуст: подключений ещё не было.';
  $('logCopy').textContent = 'Скопировать';
  showOverlay('log');
}
document.querySelectorAll('[data-open-log]').forEach((b) => {
  b.addEventListener('click', () => openLog(b.dataset.openLog));
});
$('logClose').addEventListener('click', () => showOverlay(logReturn));
$('logCopy').addEventListener('click', () => {
  const text = netLog.text();
  const done = () => { $('logCopy').textContent = 'Скопировано'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => selectLog());
  } else {
    selectLog();
  }
});
function selectLog() {
  const r = document.createRange();
  r.selectNodeContents($('logText'));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

net.init();

// ---------------------------------------------------------------------------
// Главный цикл
// ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (game.mode === 'guest') {
    net.guestFrame(dt, now);
    game.hintT = Math.max(0, game.hintT - dt);
    game.msgT = Math.max(0, game.msgT - dt);
  } else {
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
    if (game.mode === 'host') net.hostFrame();
  }

  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

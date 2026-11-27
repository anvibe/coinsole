// Frisbee Beach game code, exactly as in the Evom template (src/templates/frisbee-beach.json)
// It runs once per frame as gameFrame(ctx, t, p); the page around it plays the part of Evom.
function gameFrame(ctx, t, p) {
// ---------- Frisbee Beach: game rules + pixel-art drawing (this one code layer owns the game) ----------
// Verb: run, jump and throw frisbees. Goal: cross the beach and beat the Giant Crab.
// Threat: crabs rise from the sand, gulls dive, fish leap from the water. The first hit knocks your
// T-shirt off, the second costs one of 3 lives. Running out of time also costs a life.
// Reward: score for every enemy and shell, weapons lying on the sand that change your throw, a time bonus.
// Every 5 shells a scooter appears ahead: ride it for a few seconds, faster and unhurtable, and knock crabs over.
// End: Game over at 0 lives, Beach clear when the crab falls. Space / Enter / tap to play again.
const VW = p.width, VH = p.height, P = 6, LW = Math.round(VW / P), LH = Math.round(VH / P);
const T = 72, TL = T / P, ROWS = 15, COLS = 156, GY = 12, GROUND = GY * T;
const IN = p.inputs || {}, tt = p.t;
// timeline segments (they match the state machine)
const PLAY0 = 2, PLAY1 = 4, WIN0 = 4.2, WINW = 5.0, LOST0 = 6.2, LOSTW = 7.0;
const running = tt >= PLAY0 && tt < PLAY1;
const G = 3600, JUMP_V = -1350, RUN = 380, LEVEL_TIME = 120, CHECK = 66, ARENA = 130;
const PITS = []; // no holes: the beach is one long stretch of sand
const MEL = [0, null, 4, 7, 9, null, 7, 4, 5, null, 9, 12, 11, null, 7, null, 0, null, 4, 7, 9, null, 7, 4, 2, null, 5, 9, 7, null, 0, null]; // 32 steps; null = rest (the scene's listeners give each step its pitch)
const WEAPONS = { disc: { max: 2, cool: 0.18, dmg: 1, name: "FRISBEE" }, ball: { max: 2, cool: 0.3, dmg: 2, name: "BEACH BALL" }, gold: { max: 1, cool: 0.25, dmg: 1, name: "GOLD DISC" } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function buildLevel() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(" ")), props = [];
  for (let x = 0; x < COLS; x++) if (!PITS.some(([a, b]) => x >= a && x <= b)) for (let y = GY; y < ROWS; y++) g[y][x] = "#";
  const castle = (x, n) => props.push({ x, y: GY, n, kind: "castle" }); // decoration on the sand, nothing to climb
  // things you find on a beach that you can stand on: benches, a lifeguard tower, umbrellas, tiki roofs, an ice-cream kiosk
  const pier = (x, y, n, kind) => { for (let i = 0; i < n; i++) g[y][x + i] = "="; props.push({ x, y, n, kind }); };
  castle(15, 2);
  pier(20, 9, 5, "tower");
  castle(36, 2);
  pier(30, 11, 3, "bench"); pier(40, 11, 3, "bench"); pier(44, 8, 4, "umbrella"); pier(50, 9, 4, "tiki"); pier(57, 11, 3, "bench");
  castle(72, 3);
  pier(78, 9, 5, "kiosk"); pier(84, 7, 4, "umbrella2"); pier(89, 11, 3, "bench");
  castle(96, 2);
  pier(101, 9, 3, "tiki"); pier(107, 11, 3, "bench");
  castle(116, 1); castle(122, 2);
  g.props = props;
  return g;
}
const crab = (x, hidden) => ({ type: "crab", alive: true, x, y: GROUND - 42, w: 60, h: 42, vx: 0, vy: 0, hp: 1, mode: hidden ? "hidden" : "rise", t: 0, ground: true });
function reset(round) {
  const old = self.__fb, best = old ? Math.max(old.best, old.score) : 0;
  const S = (self.__fb = {
    round, fresh: true, g: buildLevel(), best, prevBest: best, anim: old ? old.anim : 0, t: p.t,
    x: 4 * T, y: GROUND - 90, w: 42, h: 90, vx: 0, vy: 0, ground: true, coyote: 0, buffer: 0, fbuf: 0, cool: 0, face: 1, crouch: false,
    shells: 0, boost: 0, lives: 3, shirt: true, score: 0, time: LEVEL_TIME, clock: 0, lifeT: 0, invuln: 0, dead: 0, pitDeath: false, over: false, won: false, endAge: 0, bonus: 0,
    check: 4 * T, weapon: "disc", shots: [], bubbles: [], enemies: [], items: [], fx: [], spawn: 3, gullT: 8,
    camX: 0, lock: false, boss: null, walk: 0, throwT: 0, shake: 0, beat: -1, maxX: 4 * T,
    lastJump: IN.jumpCount || 0, lastFire: IN.fireCount || 0,
    gulls: [28, 46, 68, 84, 100, 114].map((c) => ({ c, done: false })),
  });
  for (const c of [11, 26, 41, 48, 63, 76, 82, 99, 112, 119]) S.enemies.push(crab(c * T, true));
  for (const [a, b] of PITS) S.enemies.push({ type: "fish", alive: true, under: true, x: ((a + b + 1) / 2) * T - 27, y: GROUND + 200, w: 54, h: 30, vx: 0, vy: 0, hp: 1, t: 0.8 + Math.random() * 1.5, minX: a * T + 4, maxX: (b + 1) * T - 58, respawn: 0 });
  const box = (c, row, kind) => S.items.push({ type: "weapon", kind, x: c * T + 9, y: row * T - 60, w: 54, h: 54, vy: 0, t: 0, fixed: true });
  box(22, 9, "ball"); box(85, 7, "gold"); box(102, 9, "disc");
  for (const [c, row] of [[16, 12], [21, 9], [24, 9], [45, 8], [47, 8], [51, 9], [73, 12], [79, 9], [87, 7], [97, 12], [123, 12]]) S.items.push({ type: "shell", x: c * T + 15, y: row * T - 52, w: 42, h: 36, vy: 0, t: 0, fixed: true });
}
// A start / restart press bumps "round". It resets the game only before the first run, or after a
// run has ended and its result screen has finished showing, so a stray key never restarts mid-game.
const R = IN.round || 0;
if (!self.__fb || !self.__fb.g.props) reset(R); // (also when an older version of the level is still in memory)
else if (R !== self.__fb.round) {
  const F = self.__fb, ended = F.over || F.won, onResult = (tt >= WIN0 && tt < WINW) || (tt >= LOST0 && tt < LOSTW);
  if (F.fresh || (ended && !onResult && F.endAge > 0.5)) reset(R); else F.round = R;
}
const S = self.__fb;
let dt = p.t - S.t; S.t = p.t; if (!(dt > 0) || dt > 0.05) dt = dt > 0 ? 0.05 : 0;
S.anim += dt;
if (running && S.fresh) { S.fresh = false; p.emit("go"); }

// ---------- rules ----------
const cell = (cx, cy) => (cx < 0 || cx >= COLS ? "#" : cy < 0 || cy >= ROWS ? " " : S.g[cy][cx]);
const solid = (cx, cy) => { const c = cell(cx, cy); return c === "#" || c === "R"; };
function moveX(o) {
  o.x += o.vx * dt;
  const top = Math.floor(o.y / T), bot = Math.floor((o.y + o.h - 1) / T);
  if (o.vx > 0) { const cx = Math.floor((o.x + o.w) / T); for (let cy = top; cy <= bot; cy++) if (solid(cx, cy)) { o.x = cx * T - o.w - 0.01; return true; } }
  else if (o.vx < 0) { const cx = Math.floor(o.x / T); for (let cy = top; cy <= bot; cy++) if (solid(cx, cy)) { o.x = (cx + 1) * T + 0.01; return true; } }
  return false;
}
function moveY(o) {
  const prevB = o.y + o.h;
  o.y += o.vy * dt; o.ground = false;
  const l = Math.floor(o.x / T), r = Math.floor((o.x + o.w - 1) / T);
  if (o.vy > 0) {
    const cy = Math.floor((o.y + o.h) / T);
    for (let cx = l; cx <= r; cx++) { const c = cell(cx, cy); if (c === "#" || c === "R" || (c === "=" && prevB <= cy * T + 2)) { o.y = cy * T - o.h; o.vy = 0; o.ground = true; return; } }
  } else if (o.vy < 0) {
    const cy = Math.floor(o.y / T);
    for (let cx = l; cx <= r; cx++) if (solid(cx, cy)) { o.y = (cy + 1) * T; o.vy = 0; return; }
  }
}
const hit = (a, b, s = 0) => a.x + s < b.x + b.w && a.x + a.w - s > b.x && a.y + s < b.y + b.h && a.y + a.h - s > b.y;
const pop = (x, y, txt, col) => S.fx.push({ k: "txt", x, y, t: 0, txt, col });
function burst(x, y, cols, n = 8, sp = 260) {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, v = sp * (0.6 + Math.random() * 0.7); S.fx.push({ k: "p", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, t: 0, col: cols[i % cols.length] }); }
}
const score = (n, x, y) => { S.score += n; if (x !== undefined) pop(x, y, "+" + n); };
const bossBusy = () => S.boss && S.boss.dying > 0;
function die(pit) {
  if (S.dead > 0) return;
  S.lives--; S.dead = pit ? 1.2 : 1.6; S.pitDeath = !!pit; S.vx = 0; S.vy = pit ? 0 : -900; S.shake = 0.4;
  if (S.crouch) { S.y -= 32; S.h = 90; S.crouch = false; }
  if (pit) p.emit("splash");
  p.emit("lose-life");
}
function hurt() {
  if (S.dead > 0 || S.over || S.won || S.invuln > 0 || bossBusy()) return;
  S.shake = 0.35;
  if (S.shirt) {
    S.shirt = false; S.invuln = 2; S.vy = -700; S.vx = -S.face * 320;
    S.fx.push({ k: "shirt", x: S.x + 6, y: S.y + 30, vx: -S.face * 200, vy: -620, t: 0 });
    p.emit("hurt");
    return;
  }
  die(false);
}
function respawn() {
  Object.assign(S, { boost: 0, x: S.check, y: GROUND - 90, h: 90, vx: 0, vy: 0, crouch: false, dead: 0, pitDeath: false, shirt: true, time: LEVEL_TIME, invuln: 2, lifeT: 0, shots: [], bubbles: [], spawn: 3, lock: false, boss: null });
  S.enemies = S.enemies.filter((e) => e.type === "fish" || e.mode === "hidden" || Math.abs(e.x - S.x) > 14 * T);
  for (const e of S.enemies) if (e.type === "gull") e.alive = false;
  S.camX = clamp(S.x - VW * 0.4, 0, COLS * T - VW);
  p.emit("respawn");
}
function throwShot() {
  const hy = S.crouch ? S.y + 20 : S.y + 30, hx = S.face > 0 ? S.x + S.w - 6 : S.x - 42;
  if (S.weapon === "disc") S.shots.push({ kind: "disc", x: hx, y: hy, w: 48, h: 18, vx: S.face * 1150, vy: 0, t: 0, life: 0.85 });
  else if (S.weapon === "ball") S.shots.push({ kind: "ball", x: hx, y: hy - 8, w: 36, h: 36, vx: S.face * 720 + S.vx * 0.3, vy: -650, t: 0, life: 1.8, bounces: 0 });
  else S.shots.push({ kind: "gold", x: hx, y: hy, w: 48, h: 18, vx: S.face * 1300, vy: 0, t: 0, life: 2.2, dir: S.face, back: false, hits: [] });
}
function drop(x, y) {
  const r = Math.random();
  if (r < 0.55) return;
  const type = r < 0.8 ? "shell" : r < 0.93 || S.shirt ? "weapon" : "shirt";
  const kinds = Object.keys(WEAPONS).filter((k) => k !== S.weapon);
  S.items.push({ type, kind: kinds[Math.floor(Math.random() * kinds.length)], x: x - 24, y: y - 30, w: type === "weapon" ? 54 : 42, h: type === "weapon" ? 54 : 36, vy: -520, vx: 0, t: 0 });
}
const PTS = { crab: 100, gull: 200, fish: 300 };
const COL = { crab: ["#e8483f", "#ff8a6a", "#ffffff"], gull: ["#ffffff", "#9aa7b8", "#ffb02e"], fish: ["#2f8fd8", "#8fd3ff", "#ffffff"] };
function damage(e, n) {
  if (e.type === "boss") {
    e.hp -= n; e.flash = 0.12; p.emit("boss-hit");
    if (e.hp <= 0) { e.alive = false; e.dying = 1.8; S.shake = 0.5; score(5000, e.x + e.w / 2, e.y); p.emit("boss-die"); }
    return;
  }
  e.hp -= n;
  if (e.hp > 0) return;
  e.alive = false;
  if (e.type === "fish") e.respawn = 5;
  score(PTS[e.type], e.x + e.w / 2, e.y);
  burst(e.x + e.w / 2, e.y + e.h / 2, COL[e.type]);
  p.emit(e.type + "-hit");
  drop(e.x + e.w / 2, e.y);
}
function spawnGull() {
  const y = 2.2 * T + Math.random() * T;
  S.enemies.push({ type: "gull", alive: true, x: S.camX + VW + 40, y, baseY: y, w: 66, h: 30, vx: -330, vy: 0, mode: "glide", ph: Math.random() * 6, hp: 1 });
  p.emit("gull");
}

if (dt > 0 && running && !S.over && !S.won) {
  const hx = S.x + S.w / 2, prog = clamp(S.maxX / (ARENA * T), 0, 1);
  if (S.dead > 0) {
    // dying: a hop and a fall (into the water for a pit), the world holds its breath
    S.dead -= dt; S.vy = Math.min(1700, S.vy + G * dt);
    if (S.pitDeath) S.y += S.vy * dt; else moveY(S);
    if (S.dead <= 0) { if (S.lives <= 0) { S.over = true; S.endAge = 0; S.dead = 0.001; p.emit("gameover"); } else respawn(); }
  } else {
    S.clock += dt; S.lifeT += dt; S.invuln = Math.max(0, S.invuln - dt);
    S.boost = Math.max(0, S.boost - dt);
    if (S.boost > 0 && S.ground && Math.abs(S.vx) > 200 && Math.random() < 0.6) S.fx.push({ k: "p", x: S.x + S.w / 2 - S.face * 22, y: S.y + S.h - 8, vx: -S.face * 90, vy: -70, t: 0, life: 0.4, col: "#f8e2b4" });
    if (!bossBusy()) {
      const before = S.time; S.time -= dt;
      if (S.time < 20 && Math.ceil(S.time) !== Math.ceil(before)) p.emit("tick");
      if (S.time <= 0) { S.time = 0; die(false); }
    }
    const left = IN.left > 0.5, right = IN.right > 0.5, down = IN.down > 0.5;
    if ((IN.jumpCount || 0) !== S.lastJump) { S.buffer = 0.14; S.lastJump = IN.jumpCount || 0; }
    if ((IN.fireCount || 0) !== S.lastFire) { S.fbuf = 0.15; S.lastFire = IN.fireCount || 0; }
    const wantCrouch = down && S.ground;
    if (wantCrouch !== S.crouch) { if (wantCrouch) { S.y += 32; S.h = 58; } else { S.y -= 32; S.h = 90; } S.crouch = wantCrouch; }
    if (right && !left) S.face = 1; else if (left && !right) S.face = -1;
    const dir = S.crouch ? 0 : (right ? 1 : 0) - (left ? 1 : 0);
    const top = S.boost > 0 ? RUN * 1.6 : RUN;
    if (dir) S.vx += dir * (S.ground ? 3400 : 1500) * (S.boost > 0 ? 1.5 : 1) * dt;
    else { const f = (S.ground ? (S.boost > 0 ? 1400 : 3600) : 500) * dt; S.vx = Math.abs(S.vx) <= f ? 0 : S.vx - Math.sign(S.vx) * f; }
    S.vx = clamp(S.vx, -top, top);
    S.coyote = S.ground ? 0.1 : S.coyote - dt; S.buffer -= dt; S.fbuf -= dt; S.cool -= dt; S.throwT -= dt;
    if (S.buffer > 0 && S.coyote > 0) {
      if (S.crouch) { S.y -= 32; S.h = 90; S.crouch = false; }
      S.vy = JUMP_V; S.buffer = 0; S.coyote = 0; S.ground = false; p.emit("jump");
    }
    if (!(IN.jumpHeld > 0.5) && S.vy < -560) S.vy = -560; // a short tap is a small hop
    S.vy = Math.min(1700, S.vy + G * dt);
    if (S.fbuf > 0 && S.cool <= 0) {
      const W = WEAPONS[S.weapon];
      if (S.shots.filter((s) => s.kind === S.weapon).length < W.max) { throwShot(); S.fbuf = 0; S.cool = W.cool; S.throwT = 0.16; p.emit("throw"); }
    }
    const wasGround = S.ground, fall = S.vy;
    if (moveX(S)) S.vx = 0;
    if (S.x < S.camX + 6) { S.x = S.camX + 6; S.vx = Math.max(0, S.vx); }
    if (S.x > COLS * T - S.w - 6) { S.x = COLS * T - S.w - 6; S.vx = 0; }
    moveY(S);
    if (S.ground && !wasGround && fall > 300) {
      p.emit("land");
      for (let i = 0; i < 5; i++) S.fx.push({ k: "p", x: S.x + S.w / 2, y: S.y + S.h, vx: (Math.random() - 0.5) * 240, vy: -Math.random() * 160, t: 0, col: "#fbe7c4", life: 0.35 });
    }
    S.walk += Math.abs(S.vx) * dt; S.maxX = Math.max(S.maxX, S.x);
    if (S.y > GROUND + 40 && !S.ground) die(true);
    if (S.check < CHECK * T && S.x > CHECK * T) { S.check = CHECK * T; p.emit("checkpoint"); const heal = S.lives < 3; if (heal) S.lives++; pop(S.x + S.w / 2, S.y - 20, heal ? "CHECKPOINT +1 LIFE" : "CHECKPOINT", "#ffe66d"); }
    if (!S.lock && S.x > ARENA * T) { S.lock = true; p.emit("boss-in"); }

    // spawning: crabs rise out of the sand near you, gulls come in waves (never in the first 5s of a life)
    if (!S.lock && S.lifeT > 5) {
      S.spawn -= dt;
      if (S.spawn <= 0) {
        S.spawn = 5.4 - 2.2 * prog + Math.random();
        const live = S.enemies.filter((e) => e.alive && e.type === "crab" && e.mode !== "hidden").length;
        if (live < 2 + Math.round(prog * 2)) for (let k = 0; k < 6; k++) {
          const side = Math.random() < 0.65 ? 1 : -1, c = Math.floor((hx + side * (5 + Math.random() * 5) * T) / T);
          if (c * T < S.camX + T || c * T > S.camX + VW - 2 * T) continue; // on screen, so you see it rise
          if (cell(c, GY) === "#" && cell(c + 1, GY) === "#" && cell(c, GY - 1) === " " && cell(c + 1, GY - 1) === " ") { const e = crab(c * T + 6, false); e.spawned = true; S.enemies.push(e); p.emit("rise"); break; }
        }
      }
      for (const w of S.gulls) if (!w.done && S.x > w.c * T - VW * 0.25) { w.done = true; spawnGull(); }
      if (prog > 0.45) { S.gullT -= dt; if (S.gullT <= 0) { S.gullT = 7 + Math.random() * 3; spawnGull(); } }
    }
    // enemies
    const edt = dt * (1 + 0.4 * prog + 0.2 * Math.min(1, S.clock / 90));   // faster the further and longer you go
    for (const e of S.enemies) {
      if (e.type === "fish" && !e.alive) { e.respawn -= edt; if (e.respawn <= 0) { e.alive = true; e.under = true; e.hp = 1; e.t = 1; } continue; }
      if (!e.alive) continue;
      if (e.type === "crab") {
        if (e.mode === "hidden") { if (S.lifeT > 4 && Math.abs(e.x - S.x) < 8.5 * T) { e.mode = "rise"; e.t = 0; p.emit("rise"); } continue; }
        if (e.mode === "rise") { e.t += edt; if (e.t > 0.5) { e.mode = "walk"; e.t = 0; e.vx = (hx > e.x + e.w / 2 ? 1 : -1) * (130 + 60 * prog); } continue; }
        e.vy = Math.min(1700, e.vy + G * edt);
        if (moveX(e)) e.vx = -e.vx;
        moveY(e);
        if (e.ground) { const ahead = e.vx > 0 ? Math.floor((e.x + e.w + 2) / T) : Math.floor((e.x - 2) / T); if (cell(ahead, Math.floor((e.y + e.h + 4) / T)) === " ") e.vx = -e.vx; }
        e.t += edt;
        if (e.t > 2.5) { e.t = 0; if (Math.random() < 0.5) e.vx = (hx > e.x + e.w / 2 ? 1 : -1) * Math.abs(e.vx); }
        if (e.y > ROWS * T || (e.spawned && Math.abs(e.x - S.x) > VW * 1.2)) e.alive = false;
      } else if (e.type === "gull") {
        if (e.mode === "glide") {
          e.x += e.vx * edt; e.y = e.baseY + Math.sin(S.clock * 4 + e.ph) * 14;
          if (e.x < hx + 5.5 * T && e.x > hx) {
            // dive at head height: duck (hold down) and it passes over you
            const standTop = S.crouch ? S.y - 32 : S.y, ty = standTop + 12 - e.h / 2;
            e.mode = "dive"; e.vx = -600; e.ty = ty; e.vy = (ty - e.y) / Math.max(0.3, (e.x - hx) / 600);
          }
        } else if (e.mode === "dive") {
          e.x += e.vx * edt; e.y += e.vy * edt;
          if (e.y >= e.ty || e.x < hx - 40) { e.y = Math.min(e.y, e.ty); e.mode = "climb"; e.vx = -520; e.vy = -380; }
        } else { e.x += e.vx * edt; e.y += e.vy * edt; }
        if (e.x < S.camX - 160 || e.y < -120) e.alive = false;
      } else if (e.type === "fish") {
        if (e.under) { e.t -= edt; if (e.t <= 0) { e.under = false; e.y = GROUND + 40; e.vy = -1250; e.vx = (Math.random() < 0.5 ? -1 : 1) * 60; if (e.x > S.camX && e.x < S.camX + VW) p.emit("fish"); } }
        else { e.vy += 2200 * edt; e.y += e.vy * edt; e.x = clamp(e.x + e.vx * edt, e.minX, e.maxX); if (e.vy > 0 && e.y > GROUND + 40) { e.under = true; e.t = 1.6 + Math.random(); } }
      }
      const harmful = e.type === "crab" ? e.mode === "walk" : e.type === "fish" ? !e.under && e.y < GROUND + 10 : true;
      if (harmful && hit(S, e, 10)) { if (S.boost > 0 && e.type !== "boss") damage(e, 99); else hurt(); }
    }
    // boss: the Giant Crab, in an arena where the camera stops
    if (S.lock && !S.boss) S.boss = { type: "boss", alive: true, x: (COLS - 6) * T, y: GROUND - 112, w: 168, h: 112, vx: 0, vy: 0, hp: 14, maxHp: 14, t: 1.6, flash: 0, ground: true, dying: 0 };
    const B = S.boss;
    if (B && B.alive) {
      B.vy = Math.min(1700, B.vy + G * dt); B.flash -= dt;
      // it keeps about 4.5 tiles from you on its side; cornered against a wall, it hops over you
      const bc = B.x + B.w / 2, side = bc > hx ? 1 : -1, bd = -side;
      const lo = S.camX + 30 + B.w / 2, hi = COLS * T - 30 - B.w / 2;
      const want = clamp(hx + side * 4.5 * T, lo, hi), gap = Math.abs(bc - hx);
      if (B.ground) B.vx += (clamp((want - bc) * 2, -160, 160) - B.vx) * Math.min(1, dt * 3);
      B.t -= dt;
      if (B.t <= 0 && B.ground) {
        const hop = (land) => { B.vy = -1250; B.vx = (clamp(land, lo, hi) - bc) / 0.69; p.emit("boss-hop"); };
        const over = hx - side * 3.5 * T;
        if (gap < 3.2 * T) hop(over >= lo && over <= hi ? over : hx + side * 4.5 * T); // too close: jump over you, or back off if there is no room
        else if (Math.random() < 0.4) hop(hx + side * 2.2 * T);
        else { for (const k of [0, 1, 2]) S.bubbles.push({ x: bc - 18, y: B.y + 6, w: 36, h: 36, vx: bd * (220 + k * 170), vy: -760 - k * 80, t: 0 }); p.emit("boss-shoot"); }
        B.t = (B.hp < 7 ? 1.2 : 1.7) + Math.random() * 0.7;
      }
      B.x = clamp(B.x + B.vx * dt, S.camX + 30, COLS * T - B.w - 30);
      moveY(B);
      if (hit(S, B, 22)) hurt();
    } else if (B && B.dying > 0) {
      B.dying -= dt;
      if (Math.random() < dt * 14) burst(B.x + Math.random() * B.w, B.y + Math.random() * B.h, ["#e8483f", "#ffd54f", "#ffffff"], 6, 200);
      if (B.dying <= 0) { S.bonus = Math.ceil(S.time) * 50; S.score += S.bonus; S.won = true; S.endAge = 0; p.emit("win"); }
    }
    // shots
    const targets = B && B.alive ? [...S.enemies, B] : S.enemies;
    const hittable = (e) => e.alive && (e.type === "crab" ? e.mode === "walk" || (e.mode === "rise" && e.t > 0.25) : e.type === "fish" ? !e.under : true);
    for (const s of S.shots) {
      s.t += dt;
      if (s.kind === "disc") { s.x += s.vx * dt; s.y += Math.sin(s.t * 12) * 30 * dt; }
      else if (s.kind === "ball") {
        s.vy += 2200 * dt; s.x += s.vx * dt;
        const prev = s.y + s.h; s.y += s.vy * dt;
        const cx = Math.floor((s.x + s.w / 2) / T), cy = Math.floor((s.y + s.h) / T);
        if (s.vy > 0 && (solid(cx, cy) || (cell(cx, cy) === "=" && prev <= cy * T + 2))) { s.y = cy * T - s.h; s.vy = -Math.max(420, Math.abs(s.vy) * 0.62); if (++s.bounces > 3) s.dead = true; }
        if (solid(Math.floor((s.x + (s.vx > 0 ? s.w : 0)) / T), Math.floor((s.y + s.h / 2) / T))) s.vx = -s.vx * 0.6;
        if (s.y > ROWS * T) s.dead = true;
      } else {
        s.vx = clamp(s.vx - s.dir * 2000 * dt, -1300, 1300);
        if (!s.back && Math.sign(s.vx) !== s.dir) { s.back = true; s.hits = []; }
        s.x += s.vx * dt; s.y += (S.y + 30 - s.y) * Math.min(1, dt * 4);
        if (s.back && hit(s, S, -12)) s.dead = true;
      }
      if (s.kind === "disc" && solid(Math.floor((s.x + s.w / 2) / T), Math.floor((s.y + s.h / 2) / T))) { s.dead = true; burst(s.x + s.w / 2, s.y + s.h / 2, ["#ffffff", "#e8483f"], 5, 150); }
      if (s.t > s.life || s.x < S.camX - 240 || s.x > S.camX + VW + 240) s.dead = true;
      if (s.dead) continue;
      for (const e of targets) {
        if (!hittable(e) || !hit(s, e, -4)) continue;
        if (s.kind === "gold") { if (s.hits.includes(e)) continue; s.hits.push(e); } else s.dead = true;
        damage(e, WEAPONS[s.kind].dmg);
        if (s.dead) break;
      }
      for (const u of S.bubbles) if (!s.dead && !u.dead && hit(s, u, -4)) { u.dead = true; if (s.kind !== "gold") s.dead = true; score(10); burst(u.x + 18, u.y + 18, ["#dff6ff", "#8fd3ff"], 6, 160); p.emit("pop"); }
    }
    S.shots = S.shots.filter((s) => !s.dead);
    for (const u of S.bubbles) {
      u.t += dt; u.vy += 1500 * dt; u.x += u.vx * dt; u.y += u.vy * dt;
      if (u.y + u.h > GROUND) { u.dead = true; burst(u.x + 18, GROUND - 6, ["#dff6ff", "#8fd3ff"], 5, 140); }
      else if (hit(S, u, 10)) { u.dead = true; hurt(); }
    }
    S.bubbles = S.bubbles.filter((u) => !u.dead);
    // pickups
    for (const it of S.items) {
      it.t += dt;
      if (!it.fixed) { it.vy = Math.min(1700, it.vy + G * dt); moveY(it); if (it.t > 9) it.dead = true; }
      if (hit(S, it, -12)) {
        it.dead = true;
        const cx = it.x + it.w / 2;
        if (it.type === "shell") {
          score(100, cx, it.y); p.emit("pickup"); burst(cx, it.y + 18, ["#ffd1dc", "#ffffff"], 6, 160);
          // every 5 shells a scooter turns up a little way ahead
          if (++S.shells % 5 === 0 && S.x < (ARENA - 8) * T) { S.items.push({ type: "scooter", x: S.x + 10 * T, y: GROUND - 62, w: 66, h: 62, vy: 0, t: 0, fixed: true }); pop(S.x + S.w / 2, S.y - 10, "SCOOTER AHEAD!", "#7bf0e6"); }
        }
        else if (it.type === "scooter") { S.boost = 9; score(300, cx, it.y); pop(cx, it.y - 6, "SCOOTER!", "#7bf0e6"); p.emit("weapon"); burst(cx, it.y + 30, ["#7bf0e6", "#ff7eab", "#ffffff"], 10, 220); }
        else if (it.type === "shirt") { if (S.shirt) score(500, cx, it.y); else { S.shirt = true; pop(cx, it.y, "SHIRT ON!", "#ffe66d"); } p.emit("shirt"); }
        else { S.weapon = it.kind; score(200); pop(cx, it.y, WEAPONS[it.kind].name, "#ffe66d"); p.emit("weapon"); }
      }
    }
    S.items = S.items.filter((it) => !it.dead);
    S.enemies = S.enemies.filter((e) => e.alive || e.type === "fish");
    // music follows game time; it stops while you are knocked out and on the end screens
    const step = Math.floor(S.clock / 0.17);
    if (step !== S.beat) { S.beat = step; const i = step % 32; if (MEL[i] !== null) p.emit("m" + i); if (i % 4 === 0) p.emit("b" + i / 4); }
  }
}
if (S.over || S.won) S.endAge += dt;
for (const f of S.fx) { f.t += dt; if (f.k === "txt") f.y -= 70 * dt; else { f.vy += (f.k === "shirt" ? 1800 : 1400) * dt; f.x += f.vx * dt; f.y += f.vy * dt; } }
S.fx = S.fx.filter((f) => f.t < (f.k === "txt" ? 0.8 : f.k === "shirt" ? 1.2 : f.life || 0.6));
S.shake = Math.max(0, S.shake - dt);
{
  const target = clamp(S.lock ? COLS * T - VW : S.x + S.w / 2 - VW * 0.4, 0, COLS * T - VW);
  S.camX += (target - S.camX) * Math.min(1, dt * 7);
}

// ---------- draw: pixel art in a 320×180 buffer, scaled up 6× with smoothing off ----------
const at = S.anim;
if (!self.__fbpx || self.__fbpx.v !== 5) {
  const mk = (w, h, fn, outline) => {
    const c = new OffscreenCanvas(w, h), x2 = c.getContext("2d"), grid = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid.push(fn(x, y) || null);
    const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : grid[y * w + x]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let col = g(x, y);
      if (!col && outline && (g(x - 1, y) || g(x + 1, y) || g(x, y - 1) || g(x, y + 1))) col = outline;
      if (col) { x2.fillStyle = col; x2.fillRect(x, y, 1, 1); }
    }
    return c;
  };
  const art = (rows, pal, outline) => {
    const m = outline ? 1 : 0, w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    return mk(w + 2 * m, h + 2 * m, (x, y) => pal[(rows[y - m] || "")[x - m]], outline);
  };
  const disc = (cs, x, y) => cs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
  // the hero: white cap with a red bill, sunglasses, white tee, red shorts (from the concept art)
  const HERO = { c: "#ffffff", r: "#e8483f", a: "#7a4422", s: "#f2b483", S: "#d98d5f", g: "#1b1b2f", t: "#f6f7fb", T: "#c9d3e0", h: "#e8483f", H: "#b8322b", w: "#ffffff", l: "#9aa7b8" };
  const head = ["...cccc...", "..cccccc..", "..ccccccrr", "..aasssss.", "..aaggggg.", "..sssssss.", "...ssSss.."];
  const torso = ["..tttttt..", ".sttttttts", ".stttTttts", "..TttttT..", "..hhhhhh..", "..hhHHhh.."];
  const torsoThrow = ["..tttttsss", "..ttttttss", "..tttTtt..", "..TttttT..", "..hhhhhh..", "..hhHHhh.."];
  const legs = { idle: ["..ss..ss..", "..ss..ss..", ".www..www."], a: [".ss....ss.", ".ss....ss.", "www....www"], b: ["...ssss...", "...ssss...", "...wwww..."], air: ["..ss.ss...", ".ss...ss..", "www....ww."] };
  const crouchB = [".sttttttts", "..TttttT..", ".hhhhhhhh.", "www....www"], crouchT = ["..tttttsss", "..TttttTss", ".hhhhhhhh.", "www....www"];
  const bare = (rows) => rows.map((r) => r.replace(/t/g, "s").replace(/T/g, "S"));
  const heroSet = (shirt) => {
    const f = shirt ? (x) => x : bare, o = {};
    for (const [k, l] of Object.entries(legs)) { o[k] = art(f([...head, ...torso, ...l]), HERO, "#1b1b2f"); o["t" + k] = art(f([...head, ...torsoThrow, ...l]), HERO, "#1b1b2f"); }
    o.crouch = art(f([...head, ...crouchB]), HERO, "#1b1b2f"); o.tcrouch = art(f([...head, ...crouchT]), HERO, "#1b1b2f");
    return o;
  };
  const CRAB = { R: "#ff8a6a", r: "#e8483f", w: "#ffffff", k: "#1b1b2f", l: "#b8322b" };
  const crabTop = ["RR........RR", "Rr........rR", ".rr.w..w.rr.", "..rrkrrkrr..", ".rrrrrrrrrr.", "rrRrrrrrrRrr", ".rrrrrrrrrr."];
  const GULL = { w: "#ffffff", k: "#1b1b2f", o: "#ffb02e", g: "#9aa7b8" };
  const FISH = { b: "#2f8fd8", B: "#8fd3ff", k: "#1b1b2f", t: "#1f6fb0" };
  const heart = [".hh.hh.", "hHhhhhh", "hhhhhhh", ".hhhhh.", "..hhh..", "...h..."];
  const boss = (flash) => mk(32, 22, (x, y) => {
    const C = flash ? ["#ffffff", "#ffe3dc", "#ffd0c4"] : ["#e8483f", "#ff8a6a", "#b8322b"];
    const body = ((x + 0.5 - 16) / 11) ** 2 + ((y + 0.5 - 14) / 6.5) ** 2 <= 1;
    const clawL = disc([[4, 7, 3.6]], x, y) && !(x >= 3 && x <= 5 && y <= 5), clawR = disc([[28, 7, 3.6]], x, y) && !(x >= 27 && x <= 29 && y <= 5);
    const arm = (y >= 9 && y <= 10 && (x === 6 || x === 7 || x === 25 || x === 26)) || (y === 11 && (x === 7 || x === 8 || x === 24 || x === 25));
    const stalk = (x === 12 || x === 20) && y >= 5 && y <= 8;
    const eye = disc([[12.5, 4, 2], [20.5, 4, 2]], x, y);
    const legsOn = y >= 19 && y <= 21 && [7, 9, 11, 21, 23, 25].some((lx) => lx + (y - 19) * (lx < 16 ? -1 : 1) === x);
    if (eye) return (x === 12 || x === 20) && y === 4 ? "#1b1b2f" : "#ffffff";
    if (body) return y < 11 && Math.hypot(x - 12, y - 10) < 3 ? C[1] : y >= 17 ? C[2] : C[0];
    if (clawL || clawR) return y < 6 ? C[1] : C[0];
    if (arm || stalk || legsOn) return C[2];
    return null;
  }, "#4a0f0f");
  const ballSpr = (rot) => mk(6, 6, (x, y) => {
    const dx = x + 0.5 - 3, dy = y + 0.5 - 3;
    if (dx * dx + dy * dy > 9) return null;
    const a = (Math.atan2(dy, dx) + rot + Math.PI * 2) % (Math.PI * 2), k = Math.floor(a / (Math.PI / 2));
    return dx * dx + dy * dy < 1.2 ? "#ffffff" : ["#e8483f", "#ffffff", "#2f8fd8", "#ffd54f"][k];
  }, "#1b1b2f");
  const discSpr = (a, b) => [art([".aaaaaa.", "abbaabba", ".aaaaaa."], { a, b }, "#1b1b2f"), art([".aaaaaa.", "aabbaabb", ".aaaaaa."], { a, b }, "#1b1b2f")];
  const buf = new OffscreenCanvas(LW, LH);
  self.__fbpx = {
    v: 5, buf, b: buf.getContext("2d"),
    s: {
      hero: heroSet(true), bare: heroSet(false),
      crab: [art([...crabTop, ".l.l....l.l."], CRAB, "#5a1212"), art([...crabTop, ".l..l..l..l."], CRAB, "#5a1212")],
      gull: [art(["kw..........wk", ".ww........ww.", "..www....www..", "...wwwwwwww...", "ookwwwwwwwwgg.", "....wwwwww...."], GULL, "#4a5568"),
        art(["..............", "...wwwwwwww...", "ookwwwwwwwwgg.", "..www.wwww.www", ".ww.......ww..", "kw.........wk."], GULL, "#4a5568")],
      fish: art(["...bbbb..t", ".bbBBBBbtt", "bkbBBBBbbt", ".bbbbbbbtt", "...bbbb..t"], FISH, "#123a6a"),
      boss: boss(false), bossFlash: boss(true),
      disc: discSpr("#e8483f", "#ffffff"), gold: discSpr("#ffc93c", "#fff4c2"),
      ball: [0, 1, 2, 3].map((i) => ballSpr((i * Math.PI) / 8)),
      shell: art(["..ppp..", ".pPpPp.", "pPpPpPp", "pPpPpPp", ".ppppp.", "..ppp.."], { p: "#ffb3c6", P: "#ffe3ea" }, "#9c4d6a"),
      shirt: art(["ttt..ttt", "tttttttt", ".tttttt.", ".tTtttt.", ".tttttt.", ".tttttt."], { t: "#ffffff", T: "#e8483f" }, "#1b1b2f"),
      heart: art(heart, { h: "#ff4d5e", H: "#ffd0da" }, "#7a1020"), heartOff: art(heart, { h: "rgba(20,35,79,0.25)", H: "rgba(20,35,79,0.25)" }),
      bubble: mk(6, 6, (x, y) => { const d = Math.hypot(x + 0.5 - 3, y + 0.5 - 3); return d > 3 ? null : d > 2.2 ? "#dff6ff" : x === 2 && y === 1 ? "#ffffff" : "rgba(143,211,255,0.55)"; }),
      cloud: mk(30, 12, (x, y) => (y <= 10 && disc([[7, 8, 5], [15, 5.5, 6], [23, 8, 5]], x, y) ? (y >= 9 ? "#e3f4fd" : "#ffffff") : null)),
      palm: mk(32, 46, (x, y) => {
        const tx = Math.round(16 + Math.pow((46 - y) / 30, 2) * -5);
        if (y >= 16 && (x === tx || x === tx + 1 || x === tx + 2)) return y % 4 === 0 ? "#8a5a2b" : x === tx ? "#a96f38" : "#c98b4f";
        for (const [ang, len] of [[-2.7, 15], [-2.2, 13], [-1.2, 11], [-0.5, 14], [0.1, 15], [-3.1, 12]]) {
          for (let k = 2; k < len; k++) {
            const fx = 15 + Math.cos(ang) * k, fy = 15 + Math.sin(ang) * k + (k * k) / 26;
            if (Math.abs(x - fx) < 1.2 && Math.abs(y - fy) < (k < len - 3 ? 1.6 : 0.9)) return y > fy ? "#4aa53a" : "#7bd04f";
          }
        }
        return disc([[16, 15, 2.2]], x, y) ? "#6b4220" : null;
      }, "#24572a"),
      umbrella: mk(28, 30, (x, y) => {
        if (y <= 9 && disc([[14, 11, 13]], x, y)) return Math.floor((Math.atan2(y - 11, x - 14) + Math.PI) / 0.45) % 2 ? "#f6f0e1" : "#ef5a4c";
        if (x === 14 && y > 9) return "#1b1b2f";
        return null;
      }),
      chair: art(["....ww", "...ww.", "..ww..", "wwwwww", "w....w", "w....w"], { w: "#f6f0e1" }, "#7a8aa0"),
      board: mk(9, 28, (x, y) => (((x + 0.5 - 4.5) / 4.2) ** 2 + ((y + 0.5 - 14) / 13.6) ** 2 <= 1 ? (x === 4 || y === 12 || y === 13 ? "#ef5a4c" : "#f6f0e1") : null), "#1b1b2f"),
      boat: mk(14, 14, (x, y) => (y < 10 && x >= 7 && x - 7 <= (y * 6) / 10 ? (x === 7 ? "#c9d3e0" : "#ffffff") : y < 10 && x === 6 ? "#7a8aa0" : y >= 10 && y <= 12 && x >= 1 + (y - 10) && x <= 12 - (y - 10) ? (y === 10 ? "#ef5a4c" : "#b8322b") : null)),
      tower: mk(26, 40, (x, y) => {
        if (y < 4 && x >= 2 + (3 - y) * 2 && x <= 23 - (3 - y) * 2) return "#ef5a4c";
        if (y >= 4 && y < 16 && x >= 4 && x <= 21) return y >= 8 && y <= 12 && x >= 8 && x <= 17 ? "#7fd3f3" : x % 5 === 0 ? "#ef5a4c" : "#ffffff";
        if (y === 16 && x >= 2 && x <= 23) return "#8a5a2b";
        if (y > 16 && (x === 5 || x === 6 || x === 19 || x === 20 || ((x + y) % 9 === 0 && x > 5 && x < 20))) return "#a96f38";
        return null;
      }, "#1b1b2f"),
      flagOn: mk(10, 7, (x, y) => (x < 8 && y < 6 && x <= 7 - Math.abs(y - 2.5) * 0.6 ? (y < 3 ? "#ff6b5e" : "#e8483f") : null)),
      flagOff: mk(10, 7, (x, y) => (x < 8 && y < 6 && x <= 7 - Math.abs(y - 2.5) * 0.6 ? (y < 3 ? "#ffffff" : "#dfe6ef") : null)),
      sand: [0, 1].map((v) => mk(12, 12, (x, y) => ((x * 7 + y * 13 + v * 5) % 23 === 0 ? "#e0ad72" : disc([[3 + v * 4, 4, 2.2], [9 - v * 3, 9, 2]], x, y) ? "#f8dcae" : "#f0c48c"))),
      grass: [0, 1].map((v) => mk(12, 12, (x, y) => {
        const top = 2 + ((x * 5 + v * 3) % 3 === 0 ? -1 : 0) + (x % 4 === v ? 1 : 0);
        if (y < top) return (x + v) % 6 === 0 && y === top - 1 ? "#9be05a" : null;
        if (y <= top) return "#9be05a";
        if (y <= top + 1) return "#6fc23a";
        if (y === top + 2) return x % 3 === v ? "#4f9a2c" : "#6fc23a";
        return (x * 7 + y * 13 + v * 5) % 23 === 0 ? "#e0ad72" : disc([[4 + v * 3, 8, 2]], x, y) ? "#f8dcae" : "#f0c48c";
      })),
      scooter: mk(16, 13, (x, y) => {
        const wheel = (cx) => Math.hypot(x + 0.5 - cx, y + 0.5 - 10.5) <= 2.5;
        if (wheel(3.5) || wheel(12.5)) return Math.hypot(x + 0.5 - (x < 8 ? 3.5 : 12.5), y + 0.5 - 10.5) <= 1 ? "#c9d3e0" : "#1b1b2f";
        if (y >= 8 && y <= 9 && x >= 2 && x <= 13) return y === 8 ? "#ff7eab" : "#2fd0c9";
        if (x === 13 && y >= 1 && y <= 8) return "#c9d3e0";
        if (y === 0 && x >= 11 && x <= 15) return "#1b1b2f";
        return null;
      }),
      plank: mk(12, 5, (x, y) => (y === 0 ? "#e8b070" : y === 4 ? "#8a5a2b" : x === 5 ? "#8a5a2b" : y === 1 ? "#d29a5c" : "#c3854a")),
      tuft: mk(7, 4, (x, y) => ([[1, 2], [1, 3], [2, 1], [2, 3], [3, 0], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3], [5, 1], [5, 3]].some(([a, c]) => a === x && c === y) ? (y < 2 ? "#9be05a" : "#4f9a2c") : null)),
      box: mk(20, 20, (x, y) => (x === 0 || y === 0 || x === 19 || y === 19 ? "#14234f" : x === 1 || y === 1 ? "#ffffff" : x === 18 || y === 18 ? "#c9d3e0" : "#f6f7fb")),
    },
  };
}
const X = self.__fbpx, b = X.b, s = X.s;
b.setTransform(1, 0, 0, 1, 0, 0); b.globalAlpha = 1; b.imageSmoothingEnabled = false;
const put = (img, x, y, flip) => {
  x = Math.round(x); y = Math.round(y);
  if (!flip) return b.drawImage(img, x, y);
  b.save(); b.translate(x + img.width, y); b.scale(-1, 1); b.drawImage(img, 0, 0); b.restore();
};
// tiny pixel font (3×5, a few wide letters), drawn with fillRect so it stays on the pixel grid
const FONT = {
  " ": "00|00|00|00|00", A: "010|101|111|101|101", B: "110|101|110|101|110", C: "011|100|100|100|011", D: "110|101|101|101|110", E: "111|100|110|100|111",
  F: "111|100|110|100|100", G: "011|100|101|101|011", H: "101|101|111|101|101", I: "111|010|010|010|111", J: "001|001|001|101|010", K: "101|101|110|101|101",
  L: "100|100|100|100|111", M: "10001|11011|10101|10001|10001", N: "1001|1101|1011|1001|1001", O: "010|101|101|101|010", P: "110|101|110|100|100",
  Q: "010|101|101|110|011", R: "110|101|110|101|101", S: "011|100|010|001|110", T: "111|010|010|010|010", U: "101|101|101|101|111", V: "101|101|101|101|010",
  W: "10001|10001|10101|11011|10001", X: "101|101|010|101|101", Y: "101|101|010|010|010", Z: "111|001|010|100|111",
  0: "111|101|101|101|111", 1: "010|110|010|010|111", 2: "110|001|010|100|111", 3: "110|001|010|001|110", 4: "101|101|111|001|001",
  5: "111|100|110|001|110", 6: "011|100|111|101|111", 7: "111|001|010|010|010", 8: "111|101|111|101|111", 9: "111|101|111|001|110",
  "/": "001|001|010|100|100", ":": "0|1|0|1|0", "!": "1|1|1|0|1", ".": "0|0|0|0|1", "-": "000|000|111|000|000", "+": "000|010|111|010|000", "'": "1|1|0|0|0",
};
const glyph = (ch) => (FONT[ch] || FONT[" "]).split("|");
const txtW = (str, sc) => [...String(str).toUpperCase()].reduce((a, ch) => a + (glyph(ch)[0].length + 1) * sc, 0) - sc;
function txt(str, x, y, sc, col, align, out, each) {
  str = String(str).toUpperCase();
  const x0 = Math.round(align === "c" ? x - txtW(str, sc) / 2 : align === "r" ? x - txtW(str, sc) : x), y0 = Math.round(y);
  const pass = (ox, oy, c) => {
    b.fillStyle = c; let cx = x0;
    [...str].forEach((ch, i) => {
      const g = glyph(ch), o = each ? each(i) : 0;
      if (o !== null) for (let r = 0; r < g.length; r++) for (let k = 0; k < g[r].length; k++) if (g[r][k] === "1") b.fillRect(cx + k * sc + ox, y0 + r * sc + oy + o, sc, sc);
      cx += (g[0].length + 1) * sc;
    });
  };
  if (out) for (const [ox, oy] of sc >= 3 ? [[-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, 2], [1, 2], [0, 2], [0, 3]] : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, 1], [0, 2]]) pass(ox, oy, out);
  pass(0, 0, col);
}
const panel = (x, y, w, h, fill = "rgba(20,35,79,0.7)", edge = "rgba(255,255,255,0.6)") => {
  b.fillStyle = fill; b.fillRect(x + 1, y + 1, w - 2, h - 2);
  b.fillStyle = edge; b.fillRect(x + 1, y, w - 2, 1); b.fillRect(x + 1, y + h - 1, w - 2, 1); b.fillRect(x, y + 1, 1, h - 2); b.fillRect(x + w - 1, y + 1, 1, h - 2);
};
const shk = S.shake > 0 ? Math.round(Math.sin(at * 90) * S.shake * 5) : 0;
const camL = Math.round(S.camX / P) + shk, GYL = GY * TL;

// sky in flat bands, sun, pixel clouds, an island with a lighthouse, the sea (parallax)
const SKY = ["#7fcff6", "#86d2f7", "#8fd6f8", "#99daf8", "#a4def9", "#b0e3fa"], YB = [0, 30, 52, 70, 86, 100, 112];
for (let i = 0; i < SKY.length; i++) { b.fillStyle = SKY[i]; b.fillRect(0, YB[i], LW, YB[i + 1] - YB[i]); }
{
  const sx = 236 - Math.round(camL * 0.01), sy = 36;
  for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) { const d = dx * dx + dy * dy; if (d <= 225) { b.fillStyle = d > 190 ? "#ffe27a" : "#ffd54f"; b.fillRect(sx + dx, sy + dy, 1, 1); } }
}
for (let i = 0; i < 6; i++) { const span = LW + 90; put(s.cloud, ((((i * 83 + 20 - camL * 0.12 - at * 2) % span) + span) % span) - 45, 14 + (i % 3) * 14 + (i % 2) * 4); }
{
  const ix = 150 - Math.round(camL * 0.05);
  for (let x = 0; x < 170; x++) {
    const u = (x - 85) / 85, far = Math.round(112 - 16 * Math.max(0, 1 - u * u) - Math.sin(x / 9) * 1.5), w = (x - 100) / 45, near = Math.round(112 - 30 * Math.max(0, 1 - w * w));
    b.fillStyle = "#4fa8c4"; b.fillRect(ix + x, far, 1, 112 - far);
    if (near < 112) { b.fillStyle = (x + near) % 7 === 0 ? "#6cbf4a" : "#86cf55"; b.fillRect(ix + x, near, 1, 112 - near); b.fillStyle = "#4f9a2c"; b.fillRect(ix + x, near, 1, 1); }
  }
  const lx = ix + 97, ly = 82;
  b.fillStyle = "#ffffff"; b.fillRect(lx, ly - 14, 6, 14); b.fillStyle = "#c9d3e0"; b.fillRect(lx + 4, ly - 14, 2, 14);
  b.fillStyle = "#14234f"; b.fillRect(lx + 2, ly - 10, 2, 3); b.fillStyle = "#e8483f"; b.fillRect(lx - 1, ly - 16, 8, 2); b.fillRect(lx + 1, ly - 19, 4, 3);
  b.fillStyle = "#1b1b2f"; b.fillRect(lx + 3, ly - 26, 1, 7); b.fillStyle = "#ef5a4c"; b.fillRect(lx + 4, ly - 26, 4, 3);
}
b.fillStyle = "#2a95c8"; b.fillRect(0, 112, LW, 2);
b.fillStyle = "#3ab0dc"; b.fillRect(0, 114, LW, GYL - 114);
b.fillStyle = "#57c2e6"; b.fillRect(0, 124, LW, 2); b.fillRect(0, 134, LW, 1);
b.fillStyle = "#ffffff";
for (let i = 0; i < 40; i++) { const span = LW + 10, sx = ((((i * 53 - camL * 0.35 + Math.floor(at * 6) * (i % 3)) % span) + span) % span) - 5, sy = 116 + ((i * 7) % 26); if ((i + Math.floor(at * 3)) % 4) b.fillRect(sx, sy, (i % 3) + 1, 1); }
put(s.boat, ((((260 - camL * 0.22 + at * 3) % (LW + 40)) + LW + 40) % (LW + 40)) - 20, 112);

// world
b.save(); b.translate(-camL, 0);
const c0 = Math.max(0, Math.floor(camL / TL) - 3), c1 = Math.min(COLS - 1, Math.ceil((camL + LW) / TL) + 3);
const vis = (c) => c >= c0 - 2 && c <= c1 + 2;
for (const c of [2, 18, 47, 69, 93, 118, 127]) if (vis(c)) put(s.palm, c * TL - 10, GYL - 44);
for (const c of [6, 63, 104, 134]) if (vis(c)) { put(s.umbrella, c * TL - 8, GYL - 30); put(s.chair, c * TL - 14, GYL - 8); }
for (const c of [12, 53, 82, 113, 146]) if (vis(c)) put(s.board, c * TL, GYL - 27);
if (vis(151)) put(s.tower, 151 * TL, GYL - 40);
// beach props you can stand on (drawn over the sand, under the player): each sits on a one-way platform row
for (const pr of S.g.props) {
  if (!vis(pr.x) && !vis(pr.x + pr.n)) continue;
  const x = pr.x * TL, y = pr.y * TL, w = pr.n * TL, bot = GYL, h = bot - y;
  const Rc = (rx, ry, rw, rh, col) => { b.fillStyle = col; b.fillRect(rx, ry, rw, rh); };
  if (pr.kind === "castle") {
    const sand = "#ecc88e", lit = "#f8e2b4", shade = "#c99a5e", dark = "#8f6b3e";
    if (pr.n > 1) { Rc(x + 3, bot - 9, w - 6, 9, sand); Rc(x + 3, bot - 2, w - 6, 2, shade); for (let i = 5; i < w - 6; i += 4) Rc(x + i, bot - 11, 2, 2, sand); Rc(x + w / 2 - 2, bot - 5, 4, 5, dark); Rc(x + w / 2 - 1, bot - 6, 2, 1, dark); }
    const tower = (tx, th) => { Rc(tx, bot - th, 6, th, sand); Rc(tx, bot - th, 1, th, lit); Rc(tx + 5, bot - th, 1, th, shade); Rc(tx, bot - th - 2, 2, 2, sand); Rc(tx + 4, bot - th - 2, 2, 2, sand); Rc(tx + 2, bot - th + 4, 2, 3, dark); };
    tower(x, 14); if (pr.n > 1) tower(x + w - 6, 11);
    Rc(x + 2, bot - 22, 1, 6, "#1b1b2f"); Rc(x + 3, bot - 22, 4, 3, "#e8483f");
  } else if (pr.kind === "bench") {
    Rc(x + 2, y - 8, w - 4, 1, "#c3854a"); Rc(x + 2, y - 5, w - 4, 1, "#c3854a"); Rc(x + 2, y - 8, 1, 8, "#8a5a2b"); Rc(x + w - 3, y - 8, 1, 8, "#8a5a2b");
    Rc(x + 2, y + 3, 2, h - 3, "#3a3a4a"); Rc(x + w - 4, y + 3, 2, h - 3, "#3a3a4a");
    Rc(x, y, w, 2, "#e8b070"); Rc(x, y + 2, w, 1, "#8a5a2b");
    for (let sx = x + 6; sx < x + w - 2; sx += 6) Rc(sx, y, 1, 2, "#c3854a");
  } else if (pr.kind === "tower") {
    for (const sx of [x + 3, x + w - 5]) { Rc(sx, y + 2, 2, h - 2, "#8a5a2b"); Rc(sx + 1, y + 2, 1, h - 2, "#6b4220"); }
    for (let i = 0; i < h - 2; i++) { const o = Math.round((i * (w - 10)) / (h - 2)); Rc(x + 4 + o, y + 2 + i, 1, 1, "#6b4220"); Rc(x + w - 5 - o, y + 2 + i, 1, 1, "#6b4220"); }
    Rc(x + w - 26, y - 14, 22, 14, "#ffffff"); Rc(x + w - 26, y - 7, 22, 2, "#e8483f"); Rc(x + w - 22, y - 12, 7, 4, "#14234f"); Rc(x + w - 12, y - 12, 5, 4, "#14234f");
    Rc(x + w - 28, y - 17, 26, 3, "#e8483f"); Rc(x + w - 27, y - 18, 24, 1, "#ff8a6a");
    Rc(x + w - 15, y - 26, 1, 9, "#1b1b2f"); Rc(x + w - 14, y - 26, 5, 3, "#ffd23f");
    Rc(x, y, w, 2, "#e8b070"); Rc(x, y + 2, w, 1, "#8a5a2b");
  } else if (pr.kind === "umbrella" || pr.kind === "umbrella2") {
    const A = pr.kind === "umbrella" ? "#e8483f" : "#2a95c8", Bc = "#ffffff";
    Rc(x + w / 2 - 1, y + 3, 2, h - 3, "#c9d3e0"); Rc(x + w / 2, y + 3, 1, h - 3, "#8f9bb0");
    for (let i = 0; i < w; i++) { const col = Math.floor(i / 6) % 2 ? Bc : A; Rc(x + i, y, 1, 3, col); if (i % 6 < 5) Rc(x + i, y + 3, 1, 1, col); }
    Rc(x + 1, y, w - 2, 1, "rgba(255,255,255,0.55)");
  } else if (pr.kind === "tiki") {
    for (const sx of [x + 3, x + w - 5]) { Rc(sx, y + 4, 2, h - 4, "#c8a45a"); Rc(sx + 1, y + 4, 1, h - 4, "#9a7a38"); for (let ry = y + 8; ry < bot; ry += 6) Rc(sx, ry, 2, 1, "#7a5c24"); }
    Rc(x - 2, y, w + 4, 4, "#d9a441"); Rc(x - 2, y, w + 4, 1, "#f0c864");
    for (let i = -2; i < w + 2; i++) { if ((i + 2) % 3 === 0) Rc(x + i, y + 1, 1, 3, "#b8832a"); Rc(x + i, y + 4, 1, 2 + ((i + 20) % 3 === 0 ? 1 : 0), "#b8832a"); }
    Rc(x + w / 2 - 3, y + 7, 1, 3, "#1b1b2f"); Rc(x + w / 2 - 4, y + 10, 3, 2, "#ff7eab");
  } else if (pr.kind === "kiosk") {
    Rc(x + 2, y + 4, w - 4, h - 4, "#ffd6e6"); Rc(x + 2, y + h - 6, w - 4, 6, "#3fd0c9"); Rc(x + 2, y + 4, 1, h - 4, "#fff3f8");
    Rc(x + 8, y + 9, w - 16, 10, "#14234f"); Rc(x + 6, y + 19, w - 12, 2, "#ffffff"); Rc(x + 6, y + 21, w - 12, 1, "#c9d3e0");
    Rc(x + 12, y + 12, 4, 7, "#ff7eab"); Rc(x + 13, y + 11, 2, 1, "#ff7eab"); Rc(x + 20, y + 12, 5, 7, "#ffd23f");
    for (let i = 0; i < w; i++) { const col = Math.floor(i / 5) % 2 ? "#ffffff" : "#ff7eab"; Rc(x + i, y, 1, 4, col); if (i % 5 < 4) Rc(x + i, y + 4, 1, 1, col); }
  }
}
// checkpoint flag
{ const fx = CHECK * TL + 4; if (vis(CHECK)) { b.fillStyle = "#1b1b2f"; b.fillRect(fx, GYL - 26, 1, 26); put(S.check >= CHECK * T ? s.flagOn : s.flagOff, fx + 1, GYL - 26 + Math.round(Math.sin(at * 5))); } }
// tiles
for (let cy = 0; cy < ROWS; cy++) for (let cx = c0; cx <= c1; cx++) {
  const c = S.g[cy][cx], x = cx * TL, y = cy * TL;
  if (c === "#") put(cy === GY ? s.grass[cx % 2] : s.sand[(cx + cy) % 2], x, y);
}
for (const c of [3, 9, 14, 24, 34, 44, 52, 61, 70, 79, 86, 95, 103, 111, 120, 126, 137, 143, 149]) if (vis(c) && cell(c, GY) === "#" && cell(c, GY - 1) === " ") put(s.tuft, c * TL + 3, GYL - 3);
// water in the gaps
for (const [a, bb] of PITS) {
  if (!vis(a) && !vis(bb)) continue;
  const x0 = a * TL, x1 = (bb + 1) * TL;
  b.fillStyle = "#2f9fd0"; b.fillRect(x0, GYL + 4, x1 - x0, LH - GYL - 4);
  b.fillStyle = "#1f7fb0"; b.fillRect(x0, GYL + 16, x1 - x0, LH - GYL - 16);
  for (let x = x0; x < x1; x++) { const yy = GYL + 3 + Math.round(Math.sin(x * 0.5 + at * 5)); b.fillStyle = "#8fdcf6"; b.fillRect(x, yy, 1, 2); if ((x + Math.floor(at * 8)) % 9 === 0) { b.fillStyle = "#ffffff"; b.fillRect(x, yy - 1, 1, 1); } }
  b.fillStyle = "#c98f55"; b.fillRect(x0, GYL + 2, 1, LH - GYL); b.fillRect(x1 - 1, GYL + 2, 1, LH - GYL);
}
// items
for (const it of S.items) {
  if (!it.fixed && it.t > 7 && Math.floor(it.t * 10) % 2) continue;
  const ix = it.x / P, iy = it.y / P + (it.fixed ? Math.round(Math.sin(at * 4 + it.x) * 1) : 0);
  if (it.type === "shell") put(s.shell, ix, iy);
  else if (it.type === "shirt") put(s.shirt, ix, iy);
  else if (it.type === "scooter") { put(s.scooter, ix - 2, iy - 1 + Math.round(Math.sin(at * 6) * 1)); if (Math.floor(at * 5) % 2) { b.fillStyle = "#ffffff"; b.fillRect(ix + 12, iy - 3, 1, 3); b.fillRect(ix + 11, iy - 2, 3, 1); } }
  else { const ic = it.kind === "ball" ? s.ball[Math.floor(at * 6) % 4] : s[it.kind][Math.floor(at * 6) % 2]; put(ic, ix + 9 - ic.width / 2, iy + 9 - ic.height / 2); if (Math.floor(at * 5 + it.x) % 2) { b.fillStyle = "#ffffff"; b.fillRect(ix + 17, iy + 1, 1, 3); b.fillRect(ix + 16, iy + 2, 3, 1); } }
}
// enemies
for (const e of S.enemies) {
  if (!e.alive) continue;
  const ex = Math.round(e.x / P), ey = Math.round(e.y / P);
  if (e.type === "crab") {
    if (e.mode === "hidden") continue;
    const spr = s.crab[Math.floor(at * 8 + e.x * 0.01) % 2];
    if (e.mode === "rise") {
      const k = Math.min(1, e.t / 0.5), hgt = Math.round(spr.height * k);
      b.drawImage(spr, 0, 0, spr.width, hgt, ex - 1, ey + spr.height - 3 - hgt + 3, spr.width, hgt);
      b.fillStyle = "#f8dcae"; for (let i = 0; i < 4; i++) b.fillRect(ex + i * 3 + Math.round(Math.sin(at * 30 + i) * 1), ey + 6 - Math.round(k * 3), 2, 1);
    } else put(spr, ex - 1, ey - 3);
  } else if (e.type === "gull") put(s.gull[Math.floor(at * 7 + e.ph) % 2], ex - 1, ey - 2, e.vx > 0);
  else if (e.type === "fish" && !e.under) {
    b.save(); b.translate(ex + 6, ey + 3); b.rotate(e.vy < 0 ? -Math.PI / 2.4 : Math.PI / 2.4); b.drawImage(s.fish, -6, -3); b.restore();
    if (Math.abs(e.y - GROUND) < 60) { b.fillStyle = "#ffffff"; for (let i = -2; i <= 2; i++) b.fillRect(ex + 5 + i * 3, GYL + 2 - Math.abs(i), 1, 2); }
  }
}
{
  const B = S.boss;
  if (B && (B.alive || B.dying > 0)) {
    const bx = Math.round(B.x / P) - 2, by = Math.round(B.y / P) - 3, img = B.flash > 0 || (B.dying > 0 && Math.floor(B.dying * 12) % 2) ? s.bossFlash : s.boss;
    if (B.dying > 0) { b.globalAlpha = Math.min(1, B.dying); put(img, bx, by + Math.round((1.8 - B.dying) * 6)); b.globalAlpha = 1; }
    else put(img, bx, by + (B.ground ? Math.round(Math.sin(at * 10)) : 0));
  }
}
for (const u of S.bubbles) put(s.bubble, u.x / P, u.y / P);
// shots
for (const sh of S.shots) {
  if (sh.kind === "ball") put(s.ball[Math.floor(sh.t * 14) % 4], sh.x / P, sh.y / P);
  else { const spr = s[sh.kind][Math.floor(sh.t * 20) % 2]; put(spr, sh.x / P - 1, sh.y / P - 1); b.fillStyle = "rgba(255,255,255,0.7)"; for (let i = 1; i <= 3; i++) b.fillRect(Math.round(sh.x / P + (sh.vx > 0 ? -i * 3 : spr.width + i * 3)), Math.round(sh.y / P + 1 + (i % 2)), 2, 1); }
}
// hero (blinks while invulnerable, lies down when knocked out)
if (!(S.invuln > 0 && Math.floor(S.invuln * 12) % 2) && !(S.over && S.pitDeath)) {
  const set = S.shirt ? s.hero : s.bare, airborne = !S.ground && S.dead <= 0;
  let fr = S.crouch ? "crouch" : airborne ? "air" : Math.abs(S.vx) > 30 ? (Math.floor(S.walk / 54) % 2 ? "a" : "b") : "idle";
  if (S.throwT > 0) fr = "t" + fr;
  const img = set[fr], cx = Math.round((S.x + S.w / 2) / P), by = Math.round((S.y + S.h) / P);
  if (S.dead > 0 || S.over) {
    const k = S.over ? 1 : Math.min(1, (1.6 - S.dead) * 4);
    b.save(); b.translate(cx, by - 6); b.rotate(-S.face * k * Math.PI / 2); if (S.face < 0) b.scale(-1, 1); b.drawImage(img, -6, -img.height + 6); b.restore();
  } else if (S.boost > 0) { put(s.scooter, cx - 8, by - 12, S.face < 0); put(img, cx - 6, by - img.height - 4, S.face < 0); }
  else put(img, cx - 6, by - img.height, S.face < 0);
  if (S.throwT > 0.08 && S.dead <= 0) { const hold = S.weapon === "ball" ? s.ball[0] : s[S.weapon][0]; put(hold, S.face > 0 ? cx + 4 : cx - 4 - hold.width, by - img.height + (S.crouch ? 6 : 8)); }
}
// effects
for (const f of S.fx) {
  if (f.k === "p") { b.globalAlpha = Math.max(0, 1 - f.t / (f.life || 0.6)); b.fillStyle = f.col; b.fillRect(Math.round(f.x / P), Math.round(f.y / P), 2, 2); }
  else if (f.k === "shirt") { b.globalAlpha = Math.max(0, 1 - f.t / 1.2); b.save(); b.translate(Math.round(f.x / P) + 5, Math.round(f.y / P) + 4); b.rotate(f.t * 9); b.drawImage(s.shirt, -5, -4); b.restore(); }
  else { b.globalAlpha = Math.max(0, 1 - Math.max(0, f.t - 0.45) / 0.35); txt(f.txt, f.x / P, f.y / P, 1, f.col || "#ffffff", "c", "#14234f"); }
}
b.globalAlpha = 1;
b.restore();

// ---------- HUD (score, time, hearts, the weapon box: like the concept art) ----------
const inTitle = tt < PLAY0, secs = Math.ceil(S.time), clock = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
if (!inTitle) {
  txt("1P", 8, 5, 2, "#ef4b42", "l", "rgba(255,255,255,0.65)"); txt(String(S.score).padStart(6, "0"), 8, 18, 2, "#14234f", "l", "rgba(255,255,255,0.65)");
  txt("TIME", 112, 5, 2, "#ef4b42", "l", "rgba(255,255,255,0.65)");
  txt(clock, 112, 18, 2, S.time < 20 && Math.floor(at * 4) % 2 ? "#ef4b42" : "#14234f", "l", "rgba(255,255,255,0.65)");
  txt("HI", 182, 5, 1, "#ef4b42", "l", "rgba(255,255,255,0.65)"); txt(String(Math.max(S.best, S.score)).padStart(6, "0"), 182, 12, 1, "#14234f", "l", "rgba(255,255,255,0.65)");
  for (let i = 0; i < 3; i++) put(i < S.lives ? s.heart : s.heartOff, LW - 12 - (2 - i) * 11, 6);
  put(s.shell, 8, 30); txt("X" + S.shells, 20, 32, 1, "#14234f", "l", "rgba(255,255,255,0.65)");
  if (S.boost > 0) { b.fillStyle = "#14234f"; b.fillRect(LW - 45, 19, 34, 5); b.fillStyle = "#2fd0c9"; b.fillRect(LW - 44, 20, Math.round(32 * S.boost / 9), 3); b.fillStyle = "#7bf0e6"; b.fillRect(LW - 44, 20, Math.round(32 * S.boost / 9), 1); }
  const bx = Math.round(LW / 2 - 10), byy = LH - 24;
  b.fillStyle = "rgba(20,35,79,0.25)"; b.fillRect(bx + 3, byy + 19, 14, 2); // the weapon you carry, on the sand: no frame
  const ic = S.weapon === "ball" ? s.ball[Math.floor(at * 3) % 4] : s[S.weapon][0];
  put(ic, bx + 10 - ic.width / 2, byy + 10 - ic.height / 2);
  if (S.boss && (S.boss.alive || S.boss.dying > 0)) {
    txt("GIANT CRAB", LW / 2, 32, 1, "#ffffff", "c", "#14234f");
    b.fillStyle = "#14234f"; b.fillRect(LW / 2 - 41, 39, 82, 6);
    b.fillStyle = "#ef4b42"; b.fillRect(LW / 2 - 40, 40, Math.round(80 * Math.max(0, S.boss.hp) / S.boss.maxHp), 4);
    b.fillStyle = "#ff8a6a"; b.fillRect(LW / 2 - 40, 40, Math.round(80 * Math.max(0, S.boss.hp) / S.boss.maxHp), 1);
  }
}

// ---------- title + end screens (they follow the state machine's timeline) ----------
const dropIn = (lt, l0) => (i) => { const k = (lt - l0 - i * 0.05) / 0.35; return k <= 0 ? null : k >= 1 ? 0 : -Math.round((1 - k) * (1 - k) * 24); };
const btn = (x, y, w, h, label) => {
  b.fillStyle = "#14234f"; b.fillRect(x + 1, y, w - 2, h); b.fillRect(x, y + 1, w, h - 2);
  b.fillStyle = "#b8322b"; b.fillRect(x + 1, y + 1, w - 2, h - 2);
  b.fillStyle = "#ef4b42"; b.fillRect(x + 1, y + 1, w - 2, h - 5);
  b.fillStyle = "#ff8a6a"; b.fillRect(x + 2, y + 1, w - 4, 1);
  txt(label, x + w / 2, y + 4, 1, "#ffffff", "c", "#14234f");
};
if (inTitle) {
  S.titleT = (S.titleT || 0) + dt;
  const lt = S.titleT;
  // the title words are text layers above this one (Title FRISBEE, Title BEACH): edit them in the Inspector
  // the two panels and the lines on them are layers above (Goal panel, Controls panel, Title line: …)
  // the lines on the panels and "Press space or tap to start" are text layers too
}
const endScreen = (t0, dim, title, stats, extra, label) => {
  const lt = tt - t0;
  b.globalAlpha = Math.min(1, lt / 0.3) * 0.6; b.fillStyle = dim; b.fillRect(0, 0, LW, LH); b.globalAlpha = 1;
  txt(title, LW / 2, 50, 3, "#ffffff", "c", "#14234f", dropIn(lt, 0.05));
  if (lt > 0.25) txt(stats, LW / 2, 78, 1, "#dff6ff", "c", "#14234f");
  if (lt > 0.35 && extra) txt(extra, LW / 2, 90, 1, "#ffd54f", "c", "#14234f");
  if (lt > 0.6) { const k = Math.min(1, (lt - 0.6) / 0.25); btn(128, 110 + Math.round((1 - k) * (1 - k) * 12) - (Math.sin(at * 5) > 0.6 ? 1 : 0), 64, 16, label); if (lt > 0.85) txt("OR PRESS SPACE", LW / 2, 132, 1, "#ffffff", "c", "#14234f"); }
};
const best = S.score > S.prevBest && S.score > 0 ? "NEW HIGH SCORE!" : "HIGH SCORE " + String(Math.max(S.best, S.score)).padStart(6, "0");
if (tt >= WIN0 && tt < LOST0) endScreen(WIN0, "#06324a", "BEACH CLEAR!", "SCORE " + String(S.score).padStart(6, "0") + " - TIME BONUS " + S.bonus, best, "PLAY AGAIN");
if (tt >= LOST0) endScreen(LOST0, "#2a0b14", "GAME OVER", "SCORE " + String(S.score).padStart(6, "0") + " - REACHED " + Math.round(clamp(S.maxX / (ARENA * T), 0, 1) * 100) + "%", best, "TRY AGAIN");

// scale the art up 6×, nearest-neighbour
ctx.translate(-VW / 2, -VH / 2);
ctx.imageSmoothingEnabled = false;
ctx.drawImage(X.buf, 0, 0, LW, LH, 0, 0, VW, VH);

}

// Meteor Run: fly your ship along the bottom of the screen and blast the meteors falling from space.
// Big meteors split into smaller ones. Three lives; it gets busier and faster the longer you last.
const GAME_ID = "meteor-run";
// its own space palette (Pixel Serpent is the green one): deep indigo, cyan and orange
const M = { bg: "#07051a", panel: "rgba(7,5,26,0.92)", cyan: "#4fd8ff", blue: "#2a6bff", orange: "#ff8a3d", star1: "#9b8cff", star2: "#3d3478" };
const SIZES = [0, 5, 9, 14];                              // radius by size 1..3
let st = "title", ship, shots, rocks, sparks, score, lives, wave, spawnT, inv, shake, over, level, faster;
const stars = Array.from({ length: 93 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, s: 1 + (i % 3) }));

function newGame() {
  ship = { x: W / 2, y: 210, cool: 0 }; shots = []; rocks = []; sparks = [];
  score = 0; lives = 3; wave = 0; level = 0; faster = 0; spawnT = 1; inv = 2; shake = 0; over = 0; st = "play";
  snd(392, 0.08); snd(587, 0.12, "square", 0.05);
}
function rock(x, y, size, vx, vy) {
  const pts = Array.from({ length: 9 }, (_, i) => 0.75 + Math.random() * 0.35);   // a lumpy outline
  rocks.push({ x, y, size, r: SIZES[size], vx, vy, hp: size, spin: Math.random() * 6, pts });
}
function burst(x, y, n, col) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 20 + Math.random() * 90; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.3 + Math.random() * 0.5, col }); } }
function update(dt) {
  for (const s of stars) { s.y += s.s * 18 * dt; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }
  if (st !== "play") { if (st === "over") over += dt; if (pressed("a") && (st === "title" || over > 1)) newGame(); return; }
  wave += dt; inv = Math.max(0, inv - dt); shake = Math.max(0, shake - dt); faster = Math.max(0, faster - dt);
  const pace = Math.min(1.8, 1 + wave / 120);              // the longer you last, the faster it all moves
  if (Math.floor(wave / 20) > level) { level++; if (level <= 5) { faster = 1.4; snd(660, 0.1); snd(990, 0.18, "square", 0.04, 200); } }
  // ship
  const sp = 190 * Math.min(1.35, 1 + wave / 240);          // your ship gets quicker too, to keep it fair
  if (IN.left) ship.x -= sp * dt; if (IN.right) ship.x += sp * dt;
  ship.x = Math.max(12, Math.min(W - 12, ship.x));
  ship.cool -= dt;
  if (IN.a && ship.cool <= 0) { shots.push({ x: ship.x, y: ship.y - 14 }); ship.cool = 0.18; snd(1200, 0.05, "square", 0.03, -600); }
  shots.forEach((s) => (s.y -= 260 * dt)); shots = shots.filter((s) => s.y > -6);
  // meteors: more and faster over time
  spawnT -= dt;
  if (spawnT <= 0) {
    const big = Math.random() < Math.min(0.6, 0.2 + wave / 120);
    rock(10 + Math.random() * (W - 20), -16, big ? 3 : 2, (Math.random() - 0.5) * 40, 25 + Math.random() * 30 + wave * 0.6);
    spawnT = Math.max(0.27, (1.4 - wave / 60) * 0.76);
  }
  rocks.forEach((r) => { r.x += r.vx * dt * pace; r.y += r.vy * dt * pace; r.spin += dt; if (r.x < r.r || r.x > W - r.r) r.vx *= -1; });
  // shots hit meteors
  for (const s of shots) for (const r of rocks) {
    if (r.dead || s.hit) continue;
    if ((s.x - r.x) ** 2 + (s.y - r.y) ** 2 < (r.r + 2) ** 2) {
      s.hit = true; r.hp--;
      if (r.hp <= 0) {
        r.dead = true; score += [0, 100, 50, 20][r.size]; burst(r.x, r.y, 6 + r.size * 4, M.orange);
        snd(180 + r.size * 40, 0.18, "sawtooth", 0.05, -120);
        if (r.size > 1) for (const d of [-1, 1]) rock(r.x, r.y, r.size - 1, d * (30 + Math.random() * 30), r.vy * 0.8 + 10);
      } else { burst(s.x, s.y, 3, C.white); snd(600, 0.04, "square", 0.03); }
    }
  }
  shots = shots.filter((s) => !s.hit);
  // meteors reaching the ground, or the ship
  for (const r of rocks) {
    if (r.dead) continue;
    if (r.y - r.r > H) { r.dead = true; continue; }
    if (inv <= 0 && Math.abs(r.x - ship.x) < r.r + 8 && Math.abs(r.y - ship.y) < r.r + 6) {
      r.dead = true; lives--; inv = 2; shake = 0.4; burst(ship.x, ship.y, 24, C.pink); snd(300, 0.5, "sawtooth", 0.07, -250);
      if (lives <= 0) { st = "over"; over = 0; saveBest(score); }
    }
  }
  rocks = rocks.filter((r) => !r.dead);
  sparks.forEach((p) => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }); sparks = sparks.filter((p) => p.t < p.life);
}
const SHIP = ["....w....", "...wgw...", "...ggg...", "..gglgg..", ".ggglggg.", "gg.ggg.gg", "g..ppp..g"];
function drawRock(r) {
  g.fillStyle = "#7c6f8f"; g.beginPath();
  r.pts.forEach((k, i) => { const a = r.spin + (i / r.pts.length) * 6.283, x = Math.round(r.x + Math.cos(a) * r.r * k), y = Math.round(r.y + Math.sin(a) * r.r * k); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.fill();
  rect(r.x - r.r * 0.4, r.y - r.r * 0.45, Math.max(2, r.r * 0.35), Math.max(2, r.r * 0.3), "#b3a6c9");          // light side
  rect(r.x + r.r * 0.1, r.y + r.r * 0.15, Math.max(2, r.r * 0.3), Math.max(2, r.r * 0.25), "#463c5a");          // crater
}
function draw() {
  g.save();
  if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * 6), Math.round((Math.random() - 0.5) * 6));
  rect(-4, -4, W + 8, H + 8, M.bg);
  for (const s of stars) rect(s.x, s.y, 1, s.s > 2 ? 2 : 1, s.s > 2 ? C.white : s.s > 1 ? M.star1 : M.star2);
  if (st === "title") { g.restore(); return titleScreen(); }
  rocks.forEach(drawRock);
  shots.forEach((s) => { rect(s.x - 1, s.y - 4, 2, 6, M.cyan); });
  sparks.forEach((p) => rect(p.x, p.y, 2, 2, p.col));
  if (st === "play" && (inv <= 0 || blink(12))) sprite(SHIP, ship.x - 9, ship.y - 7, { w: C.white, g: M.blue, l: M.cyan, p: T % 0.2 < 0.1 ? C.yellow : M.orange }, 2);
  g.restore();
  txt(String(score).padStart(6, "0"), 8, 8, 8, C.white, "left");
  txt("HI " + String(Math.max(best(), score)).padStart(6, "0"), W / 2, 8, 8, M.cyan);
  for (let i = 0; i < lives; i++) sprite(SHIP, W - 16 - i * 12, 6, { w: C.white, g: M.blue, l: M.cyan, p: M.orange });
  if (st === "play" && faster > 0 && blink(8)) txt("SPEED UP!", W / 2, 26, 8, C.yellow);
  if (st === "over") {
    const px = W / 2 - 100;
    rect(px, 80, 200, 86, M.panel); rect(px, 80, 200, 2, M.cyan); rect(px, 164, 200, 2, M.cyan);
    txt("GAME OVER", W / 2, 94, 16, M.orange); txt("SCORE " + score, W / 2, 120, 8);
    if (score >= best() && score > 0) txt("NEW BEST!", W / 2, 134, 8, C.yellow);
    if (over > 1 && blink()) txt("PRESS A TO PLAY AGAIN", W / 2, 150, 8, M.cyan);
  }
}
function titleScreen() {
  drawRock({ x: 74, y: 120, r: 14, spin: 0.5, pts: [1, .85, .95, .8, 1, .9, .85, 1, .9] });
  drawRock({ x: W - 66, y: 70, r: 9, spin: 2, pts: [.9, 1, .8, .95, .85, 1, .9, .8, 1] });
  drawRock({ x: W - 90, y: 160, r: 5, spin: 1, pts: [1, .9, .9, 1, .85, .95, 1, .9, .85] });
  sprite(SHIP, W / 2 - 9, 186, { w: C.white, g: M.blue, l: M.cyan, p: M.orange }, 2);
  rect(W / 2 - 1, 156, 2, 18, M.cyan);
  txt("METEOR", W / 2, 40, 32, M.orange); txt("RUN", W / 2, 78, 32, M.cyan);
  txt("BLAST THE ROCKS - DODGE THE REST", W / 2, 116, 8, C.white);
  if (COVER || blink()) txt("PRESS A TO START", W / 2, 132, 8, C.yellow);
}
start();

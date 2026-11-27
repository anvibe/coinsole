// Pixel Serpent: steer the serpent, eat the glowing fruit, grow longer, don't bite yourself or the walls.
// Golden fruit appears now and then for a short time and is worth more. It gets faster as you grow.
const GAME_ID = "pixel-serpent";
const CELL = 10, COLS = 42, ROWS = 21, TOP = 30;          // field 420x210 under a 30px score bar
const LEFT = (W - COLS * CELL) / 2;                        // the field sits in the middle
let st = "title", snake, dir, queue, food, gold, goldT, score, stepT, step, dead, deathT, pops;

function place() {
  while (true) {
    const c = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
    if (!snake.some((s) => s.x === c.x && s.y === c.y) && !(food && food.x === c.x && food.y === c.y)) return c;
  }
}
function newGame() {
  snake = [{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  dir = { x: 1, y: 0 }; queue = []; food = null; food = place(); gold = null; goldT = 0;
  score = 0; step = 0.12; stepT = 0; dead = false; deathT = 0; pops = []; st = "play";
  snd(523, 0.08); snd(784, 0.12, "square", 0.05, 0);
}
function turn(x, y) {
  const last = queue.length ? queue[queue.length - 1] : dir;
  if ((x && x === -last.x) || (y && y === -last.y) || (x === last.x && y === last.y)) return;
  if (queue.length < 2) queue.push({ x, y });
}
function update(dt) {
  if (st !== "play") { if (pressed("a")) newGame(); return; }
  if (pressed("left")) turn(-1, 0); if (pressed("right")) turn(1, 0);
  if (pressed("up")) turn(0, -1); if (pressed("down")) turn(0, 1);
  pops = pops.filter((p) => (p.t += dt) < 0.6);
  if (dead) { deathT += dt; if (deathT > 1.2) { st = "over"; saveBest(score); } return; }
  if (gold && (goldT -= dt) <= 0) gold = null;
  stepT += dt;
  while (stepT >= step) {
    stepT -= step;
    if (queue.length) dir = queue.shift();
    const h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (h.x < 0 || h.y < 0 || h.x >= COLS || h.y >= ROWS || snake.slice(0, -1).some((s) => s.x === h.x && s.y === h.y)) {
      dead = true; snd(220, 0.5, "sawtooth", 0.06, -170); return;
    }
    snake.unshift(h);
    if (h.x === food.x && h.y === food.y) {
      score += 10; pops.push({ x: h.x, y: h.y, t: 0, v: 10 }); food = place();
      step = Math.max(0.055, step - 0.003); snd(880, 0.06); snd(1175, 0.08, "square", 0.04);
      if (!gold && Math.random() < 0.25) { gold = place(); goldT = 6; }
    } else if (gold && h.x === gold.x && h.y === gold.y) {
      score += 50; pops.push({ x: h.x, y: h.y, t: 0, v: 50 }); gold = null;
      snake.push({ ...snake[snake.length - 1] }); [880, 1109, 1319, 1760].forEach((f, i) => setTimeout(() => snd(f, 0.07), i * 50));
    } else snake.pop();
  }
}
const FRUIT = ["..gg..", ".pppp.", "pppppp", "pwpppp", ".pppp.", "..pp.."];
const GOLD = ["..yy..", ".yyyy.", "yywyyy", "yyyyyy", ".yyyy.", "..yy.."];
function draw() {
  rect(0, 0, W, H, C.bg);
  // field: a faint dot grid, running to the edges of the screen
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) rect(LEFT + x * CELL + 4, TOP + y * CELL + 4, 2, 2, "#0b2415");
  txt("SCORE " + String(score || 0).padStart(5, "0"), 8, 10, 8, C.white, "left");
  txt("BEST " + String(Math.max(best(), score || 0)).padStart(5, "0"), W - 8, 10, 8, C.lime, "right");
  if (st === "title") return titleScreen();
  // fruit
  sprite(FRUIT, LEFT + food.x * CELL + 2, TOP + food.y * CELL + 2, { p: C.pink, g: C.green, w: C.white });
  if (gold && (goldT > 2 || blink(8))) sprite(GOLD, LEFT + gold.x * CELL + 2, TOP + gold.y * CELL + 2, { y: C.yellow, w: C.white });
  // serpent: bright head, body fading towards the tail
  snake.forEach((s, i) => {
    const flash = dead && blink(10);
    const col = flash ? C.white : i === 0 ? C.lime : i % 2 ? C.green : "#2fb86d";
    rect(LEFT + s.x * CELL + 1, TOP + s.y * CELL + 1, CELL - 2, CELL - 2, col);
    if (i === 0) {           // eyes looking where it goes
      const ex = dir.x === 0 ? [3, 6] : [dir.x > 0 ? 6 : 2, dir.x > 0 ? 6 : 2], ey = dir.y === 0 ? [3, 6] : [dir.y > 0 ? 6 : 2, dir.y > 0 ? 6 : 2];
      rect(LEFT + s.x * CELL + ex[0], TOP + s.y * CELL + ey[0], 2, 2, C.bg); rect(LEFT + s.x * CELL + ex[1], TOP + s.y * CELL + ey[1], 2, 2, C.bg);
    }
  });
  pops.forEach((p) => txt("+" + p.v, LEFT + p.x * CELL + 5, TOP + p.y * CELL - 8 - p.t * 20, 8, p.v > 10 ? C.yellow : C.white));
  if (st === "over") {
    const px = W / 2 - 100;
    rect(px, 80, 200, 90, "rgba(5,17,10,0.92)"); rect(px, 80, 200, 2, C.green); rect(px, 168, 200, 2, C.green);
    txt("GAME OVER", W / 2, 94, 16, C.pink); txt("SCORE " + score, W / 2, 122, 8);
    if (score >= best() && score > 0) txt("NEW BEST!", W / 2, 136, 8, C.yellow);
    if (blink()) txt("PRESS A TO PLAY AGAIN", W / 2, 152, 8, C.lime);
  }
}
function titleScreen() {
  // a serpent curling across the title screen
  const path = [];
  for (let i = 0; i < 26; i++) path.push({ x: 8 + i, y: 18 + Math.round(Math.sin(i * 0.5 + (COVER ? 0 : T * 3)) * 1.5) });
  path.forEach((s, i) => rect(LEFT + s.x * CELL + 1, TOP + s.y * CELL + 1, CELL - 2, CELL - 2, i === path.length - 1 ? C.lime : i % 2 ? C.green : "#2fb86d"));
  sprite(FRUIT, LEFT + 35 * CELL + 2, TOP + 18 * CELL + 2, { p: C.pink, g: C.green, w: C.white });
  txt("PIXEL", W / 2, 58, 32, C.lime); txt("SERPENT", W / 2, 96, 32, C.green);
  txt("EAT FRUIT - GROW - DON'T BITE", W / 2, 136, 8, C.white);
  if (COVER || blink()) txt("PRESS A TO START", W / 2, 158, 8, C.yellow);
}
start();

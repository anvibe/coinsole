// Coinsole game base: a 426x240 pixel screen (16:9), keyboard + controller input, sound, text, high score.
// Each game defines GAME_ID, update(dt) and draw(), then calls start().
const W = 426, H = 240;
const cv = document.getElementById("c"), g = cv.getContext("2d");
g.imageSmoothingEnabled = false;
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); cv.style.width = W * s + "px"; cv.style.height = H * s + "px"; }
addEventListener("resize", fit); fit();
const COVER = /[?&]cover\b/.test(location.search);           // used to draw the game's cover picture
const C = { bg: "#05110a", green: "#3ddc84", dark: "#0e3a22", lime: "#b6f23c", white: "#eafff1", pink: "#ff4fa3", yellow: "#ffd84a", blue: "#4fb3ff", gray: "#6b7d72" };

// ---- input: keyboard, the Gamepad API, and the controller Coinsole forwards to us ----
const K = {}, HIT = {};                            // HIT: keys tapped since the last frame, so quick taps are never missed
addEventListener("keydown", (e) => {
  K[e.code] = true; HIT[e.code] = true;
  if (e.code === "Escape" && parent !== window) parent.postMessage({ type: "arcade-exit" }, "*"); // back to Coinsole
  if (e.code === "KeyF" && !e.repeat && parent !== window) parent.postMessage({ type: "arcade-bigscreen" }, "*"); // big screen on/off
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { K[e.code] = false; });
let forwarded = null;
addEventListener("message", (e) => { if (e.data && e.data.type === "arcade-pad") forwarded = e.data; });
function pad() {
  let b = [], a = [];
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
  if (gp) { b = gp.buttons.map((x) => x.pressed); a = [...gp.axes]; }
  if (forwarded) {
    const fb = forwarded.b || [];
    for (let i = 0; i < fb.length; i++) b[i] = b[i] || !!fb[i];
    (forwarded.a || []).forEach((v, i) => { if (Math.abs(v || 0) > Math.abs(a[i] || 0)) a[i] = v; });   // the stick that moves wins
  }
  return { b, a };
}
const IN = { left: false, right: false, up: false, down: false, a: false }, PREV = {};
function readInput() {
  const p = pad(), b = (i) => !!p.b[i], ax = (i) => p.a[i] || 0, k = (c) => !!(K[c] || HIT[c]);
  IN.left = !!(k("ArrowLeft") || k("KeyA") || b(14) || ax(0) < -0.5);
  IN.right = !!(k("ArrowRight") || k("KeyD") || b(15) || ax(0) > 0.5);
  IN.up = !!(k("ArrowUp") || k("KeyW") || b(12) || ax(1) < -0.5);
  IN.down = !!(k("ArrowDown") || k("KeyS") || b(13) || ax(1) > 0.5);
  IN.a = !!(k("Space") || k("KeyZ") || k("KeyX") || k("Enter") || b(0) || b(2) || b(9));
}
const pressed = (k) => IN[k] && !PREV[k];
function endInput() { for (const k in IN) PREV[k] = IN[k]; for (const c in HIT) delete HIT[c]; }

// ---- sound: tiny retro bleeps ----
let AC = null;
function snd(freq = 440, dur = 0.08, type = "square", vol = 0.05, slide = 0) {
  if (COVER) return;
  try {
    AC = AC || new AudioContext();
    const o = AC.createOscillator(), v = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(AC.destination); o.start(t); o.stop(t + dur);
  } catch (e) {}
}

// ---- drawing helpers ----
function txt(s, x, y, size = 8, col = C.white, align = "center") {
  g.font = size + "px PS2P, monospace"; g.textAlign = align; g.textBaseline = "top"; g.fillStyle = col; g.fillText(s, x, y);
}
function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function sprite(rows, x, y, cols, s = 1) {        // rows of characters; each character is a colour key in cols
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (cols[ch]) rect(x + i * s, y + j * s, s, s, cols[ch]); }));
}
let T = 0;                                         // seconds since start, for blinking
const blink = (rate = 2) => Math.floor(T * rate) % 2 === 0;

// ---- high score (kept on this Mac) ----
function best() { try { return +localStorage.getItem("coinsole." + GAME_ID) || 0; } catch (e) { return 0; } }
function saveBest(v) { try { if (v > best()) localStorage.setItem("coinsole." + GAME_ID, v); } catch (e) {} }

// ---- main loop ----
function start() {
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t; T += dt;
    readInput(); if (!COVER) update(dt); draw(); endInput();
    requestAnimationFrame(frame);
  }
  // cover picture: draw the title screen once, right away (animation is paused in a hidden page)
  const go = () => COVER ? (draw(), (window.coverReady = true)) : requestAnimationFrame(frame);
  (document.fonts ? document.fonts.load("8px PS2P").then(go, go) : go());
}

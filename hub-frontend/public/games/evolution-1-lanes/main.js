/*
 * EVOLUTION 1: THE RUNNER (lanes) — renderer + input.
 * Fake-3D perspective in a plain 2D canvas (no libraries, no image assets: everything is drawn with shapes).
 * One game instance, one rAF loop, one set of listeners (guarded against double initialisation).
 */
(function () {
  'use strict';
  if (window.__EVO1_LANES__) return;
  var Core = window.EvoLanesCore;
  if (!Core) { document.body.textContent = 'Game failed to load.'; return; }
  var CFG = Core.CFG;

  // ---------------------------------------------------------------- setup
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovText = document.getElementById('ov-text');
  var ovStats = document.getElementById('ov-stats');
  var ovBtn = document.getElementById('ov-btn');
  var ovHelp = document.getElementById('ov-help');
  var hookBtn = document.getElementById('hook-btn'), pauseBtn = document.getElementById('pause-btn');

  var game = new Core.Game();
  var W = 0, H = 0, DPR = 1, F = 300, HOR = 300;
  var CAM_H = 5, CAM_D = 6.5, VIEW = 115, SEG = 2.5, PATH_HALF = 3.8;
  var camX = 0, rz = 0, attract = 0, shake = 0, hintT = 0, overT = 0, flash = 0, coinBump = 0, r3 = null;
  var best = 0, overTimer = null, lastT = 0, running = true;
  try { best = parseInt(localStorage.getItem('evo1lanes.best') || '0', 10) || 0; } catch (e) { best = 0; }

  var FOG = [118, 168, 146];
  var REASON = {
    rock: 'You hit a rock. Swipe up to jump it.',
    log: 'You tripped on a log. Swipe up to jump it.',
    wall: 'Stone wall! Swipe left or right to change lane.',
    branch: 'Low branch! Swipe down to slide under it.',
    ledge: 'Stone ledge! Tap HOOK early to be pulled up.',
    pit: 'You fell in the pit. Swipe up to jump it.',
    fell: 'You fell into the chasm. Tap HOOK to swing across.'
  };

  function resize() {
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HOR = H * 0.38;
    F = Math.min(W * 0.9, H * 0.62);
    if (r3 && r3.resize) r3.resize(W, H, DPR);
  }

  // ---------------------------------------------------------------- projection + colour helpers
  // Sprite mode: the explorer is drawn into an off-screen canvas (same artwork as the 2D game) that the 3D scene shows as a billboard.
  var SPR = { w: 384, h: 480, s: 150, feetY: 405 }, spr = document.createElement('canvas'), sprCtx = spr.getContext('2d'), sprCalls = 0, sprMode = false;
  spr.width = SPR.w; spr.height = SPR.h;
  function drawPlayerSprite(t) {
    var main = ctx; ctx = sprCtx; sprMode = true; sprCalls = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, SPR.w, SPR.h);
    try { drawPlayer(t); } finally { ctx = main; sprMode = false; }
  }
  function proj(x, y, z) {            // z is relative to the player
    if (sprMode) {
      sprCalls++;
      if (z === 0) return sprCalls === 1 ? { x: SPR.w / 2, y: SPR.feetY, s: SPR.s } : { x: SPR.w / 2, y: -9999, s: SPR.s };   // 1st call = the runner, 2nd = ground shadow (the 3D scene has its own)
      return { x: SPR.w / 2 + 0.2 * SPR.s, y: SPR.feetY - (y - game.y) * SPR.s, s: SPR.s };                                       // hook anchor: aim the arm up and slightly right
    }
    var zc = z + CAM_D; if (zc < 0.35) zc = 0.35;
    var s = F / zc;
    return { x: W / 2 + (x - camX) * s, y: HOR + (CAM_H - y) * s, s: s };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fogT(z) { return clamp(z / VIEW, 0, 1) * 0.85; }
  function mix(c, z, k) {
    var t = fogT(z), r = Math.round(c[0] + (FOG[0] - c[0]) * t), g = Math.round(c[1] + (FOG[1] - c[1]) * t), b = Math.round(c[2] + (FOG[2] - c[2]) * t);
    if (k) { r = clamp(Math.round(r * k), 0, 255); g = clamp(Math.round(g * k), 0, 255); b = clamp(Math.round(b * k), 0, 255); }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function poly(pts, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }

  // A box in world space (z relative). Draws only the faces the camera can see, back to front.
  function box(x0, x1, y0, y1, z0, z1, cFront, cTop, cSide, zFog) {
    var a, b, c, d;
    if (camX < x0) poly([proj(x0, y0, z0), proj(x0, y0, z1), proj(x0, y1, z1), proj(x0, y1, z0)], mix(cSide, zFog));
    if (camX > x1) poly([proj(x1, y0, z0), proj(x1, y0, z1), proj(x1, y1, z1), proj(x1, y1, z0)], mix(cSide, zFog));
    if (CAM_H > y1) poly([proj(x0, y1, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x0, y1, z1)], mix(cTop, zFog));
    a = proj(x0, y0, z0); b = proj(x1, y0, z0); c = proj(x1, y1, z0); d = proj(x0, y1, z0);
    poly([a, b, c, d], mix(cFront, zFog));
    return { a: a, b: b, c: c, d: d };
  }

  // ---------------------------------------------------------------- background
  var hills = [];
  (function () { for (var l = 0; l < 2; l++) { var arr = []; for (var i = 0; i <= 24; i++) arr.push(hash(i * 3 + l * 50)); hills.push(arr); } })();

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, HOR + 4);
    g.addColorStop(0, '#0a2a3a'); g.addColorStop(0.55, '#2f7c78'); g.addColorStop(1, '#9ad8b4');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HOR + 4);

    // temple glow + silhouette, drifting slightly closer as you run
    var grow = 0.62 + Math.min(game.pz / 4000, 0.3), cx = W / 2 - camX * 2, tw = W * 0.5 * grow, th = H * 0.13 * grow;
    var rg = ctx.createRadialGradient(cx, HOR - th, 4, cx, HOR - th, W * 0.55);
    rg.addColorStop(0, 'rgba(120,255,235,.55)'); rg.addColorStop(1, 'rgba(120,255,235,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, HOR + 4);

    for (var l = 0; l < 2; l++) {      // distant jungle ridges
      ctx.beginPath(); ctx.moveTo(0, HOR + 2);
      for (var i = 0; i <= 24; i++) ctx.lineTo((i / 24) * W, HOR - (l ? 0.05 : 0.085) * H * (0.4 + hills[l][i]) - 2);
      ctx.lineTo(W, HOR + 2); ctx.closePath();
      ctx.fillStyle = l ? 'rgb(52,112,92)' : 'rgb(36,86,72)'; ctx.fill();
    }
    // stepped temple
    var steps = 4, i2;
    for (i2 = 0; i2 < steps; i2++) {
      var w = tw * (1 - i2 * 0.2), h = th / steps;
      ctx.fillStyle = 'rgb(' + (30 + i2 * 6) + ',' + (70 + i2 * 8) + ',' + (68 + i2 * 6) + ')';
      ctx.fillRect(cx - w / 2, HOR - h * (i2 + 1) - 2, w, h + 1);
    }
    ctx.fillStyle = '#aaffee'; ctx.fillRect(cx - tw * 0.04, HOR - th - h * 0.3 - 2, tw * 0.08, h * 0.5);   // glowing doorway
    ctx.fillStyle = 'rgba(150,255,240,.9)'; ctx.beginPath(); ctx.arc(cx, HOR - th - 8, Math.max(3, tw * 0.03), 0, 6.3); ctx.fill();
  }

  function drawGround() {
    var g = ctx.createLinearGradient(0, HOR, 0, H);
    g.addColorStop(0, 'rgb(' + FOG.join(',') + ')'); g.addColorStop(0.18, '#2d6a4a'); g.addColorStop(1, '#10351f');
    ctx.fillStyle = g; ctx.fillRect(0, HOR, W, H - HOR);

    // path
    var zn = -CAM_D + 0.6, zf = VIEW;
    poly([proj(-PATH_HALF, 0, zn), proj(PATH_HALF, 0, zn), proj(PATH_HALF, 0, zf), proj(-PATH_HALF, 0, zf)], mix([128, 94, 54], 20));
    var k0 = Math.floor((rz + zn) / SEG), k;
    for (k = k0; k * SEG - rz < zf; k++) {
      var za = Math.max(k * SEG - rz, zn), zb = k * SEG + SEG - rz;
      if (zb <= zn) continue;
      var zm = (za + zb) / 2, par = (k & 1) ? 1 : 0;
      poly([proj(-PATH_HALF, 0, za), proj(PATH_HALF, 0, za), proj(PATH_HALF, 0, zb), proj(-PATH_HALF, 0, zb)], mix(par ? [158, 118, 70] : [138, 102, 60], zm));
      if (par) {                       // lane markings (also give a strong sense of speed)
        for (var lx = -1; lx <= 1; lx += 2) {
          var xl = lx * CFG.LANE_W / 2;
          poly([proj(xl - 0.06, 0, za), proj(xl + 0.06, 0, za), proj(xl + 0.06, 0, zb - 0.6), proj(xl - 0.06, 0, zb - 0.6)], mix([96, 68, 38], zm));
        }
      }
    }
    // path edge roots
    for (var sd = -1; sd <= 1; sd += 2) {
      poly([proj(sd * PATH_HALF, 0, zn), proj(sd * (PATH_HALF + 0.5), 0, zn), proj(sd * (PATH_HALF + 0.5), 0, zf), proj(sd * PATH_HALF, 0, zf)], mix([60, 96, 52], 25));
    }
  }

  function drawVoid(o) {                // pits & chasms: no floor, you look into darkness
    var z0 = o.z - rz, z1 = o.z + o.len - rz;
    if (z1 < -CAM_D + 0.5 || z0 > VIEW) return;
    z0 = Math.max(z0, -CAM_D + 0.6);
    var a = proj(-PATH_HALF, 0, z0), b = proj(PATH_HALF, 0, z0), c = proj(PATH_HALF, 0, z1), d = proj(-PATH_HALF, 0, z1);
    var g = ctx.createLinearGradient(0, d.y, 0, a.y);
    g.addColorStop(0, mix([70, 60, 44], z1)); g.addColorStop(0.35, '#16120c'); g.addColorStop(1, '#020302');
    poly([a, b, c, d], g);
    // lips
    ctx.strokeStyle = mix([200, 170, 110], z1); ctx.lineWidth = Math.max(1, d.s * 0.12);
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    if (o.z - rz > -CAM_D + 0.7) { ctx.strokeStyle = mix([225, 195, 130], z0); ctx.lineWidth = Math.max(1, a.s * 0.12); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }

  // ---------------------------------------------------------------- scenery & obstacles
  function drawTree(x, z, sd, hs, kind) {
    var base = proj(x, 0, z); if (base.s <= 0 || z + CAM_D < 0.5) return;
    var th = 9 + hs * 8, tw = 0.42 + hs * 0.3, top = proj(x, th, z), s = base.s;
    ctx.fillStyle = mix([82, 58, 36], z);
    ctx.fillRect(base.x - tw * s, top.y, tw * 2 * s, base.y - top.y);
    var r = (3 + hs * 2.4) * s, cy = top.y + r * 0.1, cols = kind ? [[34, 122, 66], [46, 142, 78], [64, 164, 92]] : [[28, 104, 60], [40, 126, 72], [58, 150, 86]];
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = mix(cols[i], z);
      ctx.beginPath(); ctx.arc(base.x + (i - 1) * r * 0.55 * sd, cy + (i === 1 ? -r * 0.35 : r * 0.18), r * (i === 1 ? 1.0 : 0.82), 0, 6.3); ctx.fill();
    }
  }
  function drawBush(x, z, hs) {
    var p = proj(x, 0, z); if (z + CAM_D < 0.5) return;
    var s = p.s, w = (0.9 + hs) * s;
    ctx.fillStyle = mix([40, 122, 62], z); ctx.beginPath(); ctx.ellipse(p.x, p.y, w, w * 0.55, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = mix([70, 160, 88], z); ctx.beginPath(); ctx.ellipse(p.x - w * 0.25, p.y - w * 0.1, w * 0.55, w * 0.3, 0, Math.PI, 0); ctx.fill();
  }

  function laneSpan(o) { var mn = 9, mx = -9; o.lanes.forEach(function (l) { if (l < mn) mn = l; if (l > mx) mx = l; }); return [mn * CFG.LANE_W - CFG.LANE_W * 0.46, mx * CFG.LANE_W + CFG.LANE_W * 0.46]; }

  var coinImg = new Image(); coinImg.src = '/games/evolution-1-lanes/xera-coin.png';
  function drawCoin(c, t) {
    var z = c.z - rz; if (z + CAM_D < 0.5) return;
    var p = proj(c.lane * CFG.LANE_W, c.y, z), r = 0.42 * p.s, w = Math.max(1.5, r * Math.abs(Math.cos(t / 220 + c.z)));
    if (coinImg.complete && coinImg.naturalWidth) { ctx.drawImage(coinImg, p.x - w, p.y - r, w * 2, r * 2); return; }
    ctx.fillStyle = '#2a64d8'; ctx.beginPath(); ctx.ellipse(p.x, p.y, w, r, 0, 0, 6.3); ctx.fill();
  }
  function drawRock(o, lane) {
    var z = o.z - rz, x = lane * CFG.LANE_W, w = 0.95, s;
    var a = proj(x - w, 0, z), b = proj(x + w, 0, z), t1 = proj(x - w * 0.55, o.h, z + o.len * 0.4), t2 = proj(x + w * 0.5, o.h * 1.05, z + o.len * 0.4);
    s = a.s;
    ctx.fillStyle = mix([112, 112, 116], z);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t1.x - s * 0.1, t1.y); ctx.quadraticCurveTo((t1.x + t2.x) / 2, t1.y - s * 0.28, t2.x + s * 0.1, t2.y); ctx.lineTo(b.x, b.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = mix([160, 160, 164], z); ctx.beginPath(); ctx.moveTo(t1.x, t1.y + s * 0.05); ctx.quadraticCurveTo((t1.x + t2.x) / 2, t1.y - s * 0.3, t2.x, t2.y + s * 0.05); ctx.lineTo(t2.x - s * 0.1, t2.y + s * 0.25); ctx.lineTo(t1.x + s * 0.1, t1.y + s * 0.25); ctx.fill();
    ctx.fillStyle = mix([60, 120, 70], z); ctx.beginPath(); ctx.ellipse(a.x + s * 0.5, a.y - s * 0.05, s * 0.4, s * 0.1, 0, 0, 6.3); ctx.fill();
  }
  function drawLog(o, lane) {
    var z = o.z - rz, x = lane * CFG.LANE_W, w = CFG.LANE_W * 0.47;
    var f = box(x - w, x + w, 0, o.h, z, z + o.len, [122, 82, 44], [150, 104, 58], [96, 64, 34], z);
    ctx.strokeStyle = mix([84, 54, 28], z); ctx.lineWidth = Math.max(1, f.a.s * 0.05);
    for (var i = 1; i < 4; i++) { var px = f.a.x + (f.b.x - f.a.x) * i / 4; ctx.beginPath(); ctx.moveTo(px, f.a.y); ctx.lineTo(px, f.d.y); ctx.stroke(); }
  }
  function drawWall(o, lane) {
    var z = o.z - rz, x = lane * CFG.LANE_W, w = CFG.LANE_W * 0.48;
    var f = box(x - w, x + w, 0, o.h, z, z + o.len, [122, 128, 120], [150, 156, 146], [92, 98, 92], z);
    ctx.strokeStyle = mix([70, 76, 70], z); ctx.lineWidth = Math.max(1, f.a.s * 0.04);
    for (var r = 1; r < 5; r++) { var yy = f.a.y + (f.d.y - f.a.y) * r / 5; ctx.beginPath(); ctx.moveTo(f.a.x, yy); ctx.lineTo(f.b.x, yy); ctx.stroke(); }
    ctx.fillStyle = mix([90, 200, 160], z); ctx.globalAlpha = 0.9;                   // glowing EVO rune
    ctx.fillRect((f.a.x + f.b.x) / 2 - f.a.s * 0.1, f.d.y + (f.a.y - f.d.y) * 0.45, f.a.s * 0.2, f.a.s * 0.5); ctx.globalAlpha = 1;
  }
  function drawBranch(o) {
    var z = o.z - rz, sp = laneSpan(o), x0 = sp[0], x1 = sp[1];
    var postC = [92, 62, 36], p;
    [x0, x1].forEach(function (x) {                                   // posts
      var a = proj(x - 0.25, 0, z), b = proj(x + 0.25, 0, z), t = proj(x, o.h + 0.5, z);
      ctx.fillStyle = mix(postC, z); ctx.fillRect(a.x, t.y, b.x - a.x, a.y - t.y);
    });
    var f = box(x0, x1, o.low, o.h, z, z + o.len, [108, 72, 40], [130, 92, 52], [84, 56, 30], z);
    ctx.fillStyle = mix([46, 140, 70], z);                                // leaves
    var n = Math.max(3, Math.round((x1 - x0) / 0.8));
    for (var i = 0; i <= n; i++) { p = f.d.x + (f.c.x - f.d.x) * i / n; ctx.beginPath(); ctx.arc(p, f.d.y, f.a.s * 0.3, 0, 6.3); ctx.fill(); }
    ctx.strokeStyle = mix([60, 150, 80], z); ctx.lineWidth = Math.max(1, f.a.s * 0.05);      // hanging vines
    for (i = 1; i < n; i += 2) { p = f.a.x + (f.b.x - f.a.x) * i / n; ctx.beginPath(); ctx.moveTo(p, f.a.y - f.a.s * 0.05); ctx.lineTo(p, f.a.y + f.a.s * 0.55); ctx.stroke(); }
  }
  function drawLedge(o, pulse) {
    var z = o.z - rz, f = box(-PATH_HALF, PATH_HALF, 0, o.h, z, z + o.len, [116, 124, 116], [92, 140, 96], [84, 92, 86], z);
    ctx.strokeStyle = mix([68, 76, 70], z); ctx.lineWidth = Math.max(1, f.a.s * 0.04);
    for (var r = 1; r < 4; r++) { var yy = f.a.y + (f.d.y - f.a.y) * r / 4; ctx.beginPath(); ctx.moveTo(f.a.x, yy); ctx.lineTo(f.b.x, yy); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(120,255,225,' + (0.5 + 0.4 * pulse) + ')'; ctx.lineWidth = Math.max(1.5, f.a.s * 0.07);        // runes
    for (var i = 0; i < 5; i++) { var rx = f.a.x + (f.b.x - f.a.x) * (0.12 + i * 0.19); ctx.beginPath(); ctx.moveTo(rx, f.d.y + (f.a.y - f.d.y) * 0.3); ctx.lineTo(rx, f.d.y + (f.a.y - f.d.y) * 0.7); ctx.stroke(); }
    drawAnchor(o.anchor, true, pulse);
  }
  function drawAnchor(a, pull, pulse) {
    var z = a.z - rz; if (z + CAM_D < 0.5) return;
    var p = proj(0, a.y, z), s = p.s, r = (pull ? 0.7 : 0.55) * s;
    if (!pull) {                                   // vine from the canopy
      var top = proj(0, a.y + 14, z);
      ctx.strokeStyle = mix([70, 140, 60], z); ctx.lineWidth = Math.max(2, s * 0.14);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.quadraticCurveTo(p.x + s * 0.3, (top.y + p.y) / 2, p.x, p.y); ctx.stroke();
    }
    var glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 3.2);
    glow.addColorStop(0, pull ? 'rgba(255,170,60,' + (0.5 + 0.3 * pulse) + ')' : 'rgba(255,240,110,' + (0.5 + 0.3 * pulse) + ')'); glow.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = glow; ctx.fillRect(p.x - r * 3.2, p.y - r * 3.2, r * 6.4, r * 6.4);
    ctx.strokeStyle = pull ? '#ffa33a' : '#ffe86a'; ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.8, 0, 6.3); ctx.stroke();
  }

  // ---------------------------------------------------------------- player
  // Explorer seen from behind. Drawn in "character units" (1 unit ~ 1 m, y up, feet at 0) so the pose maths
  // stays readable; only the look changes here - physics, hitboxes and controls live in core.js.
  var leanS = 0, lastPx = 0, crashAt = 0, hookSwayT = 0;
  var SKIN = '#c68a5a', SKIN_D = '#a9714a', HAIR = '#2a1c14', JACKET = '#d9b25f', JACKET_D = '#b8913f', JACKET_L = '#ecc979',
      PANTS = '#27405a', PANTS_D = '#1c3248', BOOT = '#3a2a1a', SOLE = '#160e08', PACK = '#2f6b4c', PACK_D = '#22513a', PACK_L = '#41905f',
      MINT = '#7cf0cf', SCARF = '#f08a1f', SCARF_D = '#c46a0f', METAL = '#9fb2bf', METAL_D = '#6c808e', STRAP = '#4a3220';

  function limb(x0, y0, x1, y1, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function leg(side, hipY, lift, spread, squat) {
    var hx = side * 0.15, fx = side * (0.16 + spread), ay = lift + 0.16;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (squat) {                                                     // slide: knees pushed out
      var kx = side * 0.36, ky = hipY * 0.6;
      ctx.strokeStyle = PANTS; ctx.lineWidth = 0.23; ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, ay); ctx.stroke();
      ctx.strokeStyle = PANTS_D; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(hx + side * 0.07, hipY - 0.05); ctx.lineTo(kx + side * 0.07, ky); ctx.stroke();
    } else {
      limb(hx, hipY, fx, ay, 0.23, PANTS);
      limb(hx + side * 0.075, hipY - 0.04, fx + side * 0.075, ay + 0.1, 0.045, PANTS_D);
    }
    ctx.lineCap = 'butt';
    // boot: when the foot is lifted the sole faces the camera
    var up = Math.min(1, lift / 0.25);
    ctx.fillStyle = BOOT; roundRect(fx - 0.115, lift + 0.02, 0.23, 0.2, 0.07); ctx.fill();
    ctx.fillStyle = SOLE; roundRect(fx - 0.12, lift - 0.015, 0.24, 0.07 + 0.09 * up, 0.035); ctx.fill();
    if (up > 0.4) { ctx.fillStyle = '#2d1f14'; ctx.fillRect(fx - 0.08, lift + 0.01, 0.16, 0.025); ctx.fillRect(fx - 0.08, lift + 0.07, 0.16, 0.02); }
    ctx.fillStyle = '#5a4128'; ctx.fillRect(fx - 0.1, lift + 0.18, 0.2, 0.035);                    // boot cuff
  }
  function arm(side, sx, sy, hx, hy, gauntlet, t) {
    ctx.lineCap = 'round';
    var ex = sx + (hx - sx) * 0.5 + side * 0.07, ey = sy + (hy - sy) * 0.5;
    limb(sx, sy, ex, ey, 0.17, JACKET_D); limb(ex, ey, hx, hy, 0.15, JACKET);
    ctx.lineCap = 'butt';
    if (gauntlet) {                                                   // hook launcher on the right forearm
      var dx = hx - ex, dy = hy - ey, L = Math.sqrt(dx * dx + dy * dy) || 1, ang = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(ex + dx * 0.55, ey + dy * 0.55); ctx.rotate(ang);
      ctx.fillStyle = METAL; roundRect(-L * 0.4, -0.1, L * 0.78, 0.2, 0.06); ctx.fill();
      ctx.fillStyle = METAL_D; ctx.fillRect(-L * 0.4, -0.1, L * 0.78, 0.04);
      ctx.fillStyle = MINT; ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t / 220); ctx.fillRect(-0.02, -0.105, 0.07, 0.21); ctx.globalAlpha = 1;
      ctx.restore();
    }
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(hx, hy, 0.085, 0, 6.3); ctx.fill();               // glove-less hand
    ctx.fillStyle = SKIN_D; ctx.beginPath(); ctx.arc(hx + side * 0.015, hy - 0.02, 0.05, 0, 6.3); ctx.fill();
  }

  function drawPlayer(t) {
    var g = game, p = proj(g.px, g.y, 0), s = p.s, X = p.x, Y = p.y;
    var playing = g.state === 'playing', over = g.state === 'over', hooked = !!g.hook;
    var sl = g.slideT > 0 && g.onGround, air = !g.onGround && !hooked;

    // ground shadow (unchanged behaviour)
    if (g.y > -0.3) {
      var gy = (g.y >= CFG.LEDGE_H - 0.2) ? CFG.LEDGE_H : 0, sp = proj(g.px, gy, 0);
      var sc = clamp(1 - (g.y - gy) / 6, 0.3, 1);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * sc) + ')'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 0.55 * s * sc, 0.16 * s * sc, 0, 0, 6.3); ctx.fill();
    }

    // ---- pose --------------------------------------------------------------------------------------------------
    var ph = (playing || g.state === 'paused') ? g.pz * 0.85 : (g.state === 'menu' ? t / 115 : 0.6);
    var running = (playing || g.state === 'paused' || g.state === 'menu') && g.onGround && !sl;
    var sA = Math.sin(ph), bob = running ? Math.abs(Math.cos(ph)) * 0.07 : 0;
    var hipY = 0.95, shY = 1.55, headY = 1.8, spreadL = 0, spreadR = 0, liftL = 0, liftR = 0;
    var armLx, armLy, armRx, armRy;
    var breath = (g.state === 'menu') ? Math.sin(t / 420) * 0.012 : 0;

    if (running) {
      liftL = Math.max(0, sA) * 0.52; liftR = Math.max(0, -sA) * 0.52;
      armLx = -0.5; armLy = 1.08 - sA * 0.3; armRx = 0.5; armRy = 1.08 + sA * 0.3;
    } else if (sl) {                                                   // slide: low and wide
      hipY = 0.5; shY = 1.02; headY = 1.22; spreadL = spreadR = 0.16;
      armLx = -0.52; armLy = 0.72; armRx = 0.52; armRy = 0.72;
    } else if (hooked) {
      liftL = 0.28; liftR = 0.42; spreadL = 0.04; spreadR = 0.05;
      armLx = -0.55; armLy = 1.2; armRx = 0.5; armRy = 2.0;           // right arm overridden below
    } else if (air && g.vy > 0.5) {                                    // rising: knees tucked, arms up
      liftL = 0.4; liftR = 0.26; armLx = -0.5; armLy = 1.95; armRx = 0.5; armRy = 1.95; headY = 1.82;
    } else if (air) {                                                  // falling: legs reaching, arms out
      liftL = 0.1; liftR = 0.18; spreadL = spreadR = 0.1; armLx = -0.78; armLy = 1.55; armRx = 0.78; armRy = 1.55;
    } else {                                                           // idle / stunned
      armLx = -0.46; armLy = 0.98; armRx = 0.46; armRy = 0.98;
    }
    hipY += bob; shY += bob + breath; headY += bob + breath;
    var crashRot = 0, stars = false;
    if (over) {
      if (!crashAt) crashAt = t;
      var age = (t - crashAt) / 1000;
      if (g.reason !== 'fell') { crashRot = Math.min(age * 5.5, 1.35) * (g.lane >= 0 ? 1 : -1); stars = age > 0.25; }
      armLx = -0.7; armLy = 1.6; armRx = 0.7; armRy = 1.6; liftL = 0.15; liftR = 0.3;
    } else crashAt = 0;

    // lean into lane changes (only while running)
    var dpx = g.px - lastPx; lastPx = g.px;
    var leanT = running ? clamp(dpx * 12, -0.26, 0.26) : 0;
    leanS += (leanT - leanS) * 0.3;

    // right hand reaches for the anchor while hooked (character units, relative to feet)
    var hookEnd = null;
    if (hooked) {
      var a = g.hook.anchor, ap = proj(0, a.y, a.z - rz);
      var tx = (ap.x - X) / s, ty = (Y - ap.y) / s;
      var shx = 0.34, dx = tx - shx, dy = ty - shY, L = Math.sqrt(dx * dx + dy * dy) || 1;
      armRx = shx + dx / L * 0.62; armRy = shY + dy / L * 0.62;
      hookEnd = { x: ap.x, y: ap.y, kind: g.hook.kind };
    }

    // ---- draw (y-up local space) --------------------------------------------------------------------------------
    ctx.save();
    ctx.translate(X, Y); ctx.scale(s, -s);
    if (crashRot) ctx.rotate(crashRot * 0.95); else ctx.rotate(-leanS * 0.55);

    leg(-1, hipY, liftL, spreadL, sl); leg(1, hipY, liftR, spreadR, sl);

    // torso (jacket) with shading
    var tw = sl ? 0.74 : 0.62, tb = hipY + 0.02, tt = shY + 0.04;
    ctx.fillStyle = JACKET; roundRect(-tw / 2, tb, tw, tt - tb, 0.16); ctx.fill();
    ctx.fillStyle = JACKET_D; roundRect(-tw / 2, tb, tw * 0.2, tt - tb, 0.1); ctx.fill(); roundRect(tw / 2 - tw * 0.2, tb, tw * 0.2, tt - tb, 0.1); ctx.fill();
    ctx.fillStyle = JACKET_L; ctx.fillRect(-0.025, tb + 0.05, 0.05, tt - tb - 0.12);               // back seam
    ctx.fillStyle = STRAP; ctx.fillRect(-tw / 2, tb + 0.02, tw, 0.075);                            // belt
    ctx.fillStyle = METAL; ctx.fillRect(-0.04, tb + 0.015, 0.08, 0.085);

    // coiled rope on the left hip
    ctx.strokeStyle = '#d8c79a'; ctx.lineWidth = 0.03;
    for (var c = 0; c < 3; c++) { ctx.beginPath(); ctx.ellipse(-tw / 2 - 0.02, tb + 0.12 + c * 0.001, 0.09 - c * 0.012, 0.075 - c * 0.01, 0, 0, 6.3); ctx.stroke(); }

    // arms (left behind the pack edge, right with the hook gauntlet)
    arm(-1, -tw / 2 + 0.02, shY - 0.03, armLx, armLy, false, t);
    arm(1, tw / 2 - 0.02, shY - 0.03, armRx, armRy, true, t);

    // backpack with the EVO light
    var pw = tw * 0.78, pb = tb + 0.1, pt = tt - 0.02;
    ctx.fillStyle = '#8a5a2b'; roundRect(-pw / 2 - 0.03, pt - 0.02, pw + 0.06, 0.12, 0.06); ctx.fill();   // bedroll
    ctx.fillStyle = '#6e4620'; ctx.fillRect(-pw * 0.2, pt - 0.02, 0.03, 0.12); ctx.fillRect(pw * 0.2 - 0.03, pt - 0.02, 0.03, 0.12);
    ctx.fillStyle = PACK; roundRect(-pw / 2, pb, pw, pt - pb, 0.1); ctx.fill();
    ctx.fillStyle = PACK_D; roundRect(-pw / 2, pb, pw * 0.16, pt - pb, 0.07); ctx.fill();
    ctx.fillStyle = PACK_L; ctx.fillRect(-pw / 2 + pw * 0.2, pb + 0.04, pw * 0.6, 0.03);
    ctx.fillStyle = PACK_D; roundRect(-pw / 2 - 0.04, pb + 0.06, 0.09, 0.2, 0.04); ctx.fill(); roundRect(pw / 2 - 0.05, pb + 0.06, 0.09, 0.2, 0.04); ctx.fill();   // side pouches
    var gl = 0.7 + 0.3 * Math.sin(t / 260);
    ctx.fillStyle = 'rgba(124,240,207,' + (0.22 * gl) + ')'; ctx.beginPath(); ctx.arc(0, (pb + pt) / 2 + 0.02, 0.17, 0, 6.3); ctx.fill();
    ctx.fillStyle = MINT; ctx.globalAlpha = gl; roundRect(-0.045, (pb + pt) / 2 - 0.08, 0.09, 0.2, 0.04); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = STRAP; ctx.fillRect(-pw / 2 + 0.02, pt - 0.14, pw - 0.04, 0.03);                // chest-strap hint

    // scarf tails flick in the wind
    var wv = running ? Math.sin(t / 90) * 0.06 + (-leanS) * 0.5 : Math.sin(t / 300) * 0.02;
    ctx.fillStyle = SCARF; ctx.beginPath(); ctx.moveTo(-0.17, shY + 0.02); ctx.quadraticCurveTo(-0.3 + wv, shY - 0.15, -0.34 + wv * 1.6, shY - 0.34); ctx.lineTo(-0.2 + wv, shY - 0.3); ctx.quadraticCurveTo(-0.14, shY - 0.1, -0.06, shY + 0.02); ctx.fill();
    ctx.fillStyle = SCARF_D; ctx.beginPath(); ctx.moveTo(0.17, shY + 0.02); ctx.quadraticCurveTo(0.3 + wv, shY - 0.1, 0.32 + wv * 1.8, shY - 0.26); ctx.lineTo(0.2 + wv, shY - 0.24); ctx.quadraticCurveTo(0.14, shY - 0.08, 0.06, shY + 0.02); ctx.fill();
    ctx.fillStyle = SCARF; roundRect(-0.24, shY - 0.02, 0.48, 0.1, 0.05); ctx.fill();                    // neck wrap

    // head from behind: hair, headband, goggle strap
    var hr = 0.215;
    ctx.fillStyle = SKIN; roundRect(-0.07, shY + 0.02, 0.14, 0.12, 0.04); ctx.fill();                  // neck
    ctx.fillStyle = HAIR; ctx.beginPath(); ctx.arc(0, headY, hr, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#3b2a1d'; ctx.beginPath(); ctx.arc(-0.05, headY + 0.07, hr * 0.62, 0.3, 2.5); ctx.fill();   // hair highlight
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.ellipse(-hr * 0.96, headY - 0.03, 0.035, 0.06, 0, 0, 6.3); ctx.fill(); ctx.beginPath(); ctx.ellipse(hr * 0.96, headY - 0.03, 0.035, 0.06, 0, 0, 6.3); ctx.fill();   // ears
    ctx.fillStyle = '#1f4f46'; ctx.fillRect(-hr * 0.99, headY + 0.03, hr * 1.98, 0.07);               // goggle strap
    ctx.fillStyle = MINT; ctx.fillRect(-0.03, headY + 0.03, 0.06, 0.07);                              // strap buckle
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.arc(-0.07, headY + 0.1, 0.07, 3.4, 5.2); ctx.fill();

    if (stars) {                                                       // dizzy stars after a crash
      for (var q = 0; q < 3; q++) {
        var qa = t / 220 + q * 2.1; ctx.fillStyle = '#ffe86a';
        ctx.beginPath(); ctx.arc(Math.cos(qa) * 0.34, headY + 0.34 + Math.sin(qa) * 0.07, 0.045, 0, 6.3); ctx.fill();
      }
    }
    ctx.restore();

    // hook rope from the gauntlet to the anchor (screen space)
    if (hookEnd && !sprMode) {
      var hx = X + armRx * s, hy = Y - armRy * s;
      ctx.lineCap = 'round';
      ctx.strokeStyle = hookEnd.kind === 'swing' ? ropeColor() : '#ffa33a'; ctx.lineWidth = Math.max(2, 0.07 * s);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hookEnd.x, hookEnd.y); ctx.stroke();
      ctx.fillStyle = METAL; ctx.beginPath(); ctx.arc(hookEnd.x, hookEnd.y, Math.max(2.5, 0.06 * s), 0, 6.3); ctx.fill();
      ctx.lineCap = 'butt';
    }
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  }

  // ---------------------------------------------------------------- HUD
  function drawHUD(t) {
    var menu = game.state === 'menu', sc = menu ? 0 : game.score(), pts = menu ? 0 : game.points(), m = Math.min(W, H);
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.font = '800 ' + Math.round(m * 0.09) + 'px system-ui, sans-serif';
    var ty = Math.max(48, H * 0.075);
    ctx.fillText(sc + ' m', W / 2 + 2, ty + 2);
    ctx.fillStyle = '#fff'; ctx.fillText(sc + ' m', W / 2, ty);
    // coin counter
    if (coinBump > 0) coinBump = Math.max(0, coinBump - 0.08);
    var cy = ty + m * 0.055, cr = m * 0.026 * (1 + coinBump * 0.35);
    ctx.font = '800 ' + Math.round(m * 0.048) + 'px system-ui, sans-serif';
    var ctxt = String(menu ? 0 : game.coins), cw = ctx.measureText(ctxt).width, cx0 = W / 2 - (cw + cr * 2.6) / 2 + cr;
    if (coinImg.complete && coinImg.naturalWidth) ctx.drawImage(coinImg, cx0 - cr * 1.1, cy - cr * 0.35 - cr * 1.1, cr * 2.2, cr * 2.2);
    else { ctx.fillStyle = '#2a64d8'; ctx.beginPath(); ctx.arc(cx0, cy - cr * 0.35, cr, 0, 6.3); ctx.fill(); }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(ctxt, cx0 + cr * 1.6 + 2, cy + 2); ctx.fillStyle = '#ffe9a0'; ctx.fillText(ctxt, cx0 + cr * 1.6, cy);
    ctx.font = '700 ' + Math.round(m * 0.034) + 'px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.textAlign = 'left'; ctx.fillText('BEST ' + Math.max(best, pts), 14, ty - 10);
    // health: two pips; one is lost while wounded (a second hit then ends the run)
    for (var hp = 0; hp < 2; hp++) {
      var full = hp === 0 || game.wounded <= 0, hx = 22 + hp * m * 0.06, hy = ty + m * 0.018, hr = m * 0.022;
      var beat = game.wounded > 0 && hp === 1 ? 0.5 + 0.5 * Math.sin(t / 120) : 1;
      ctx.fillStyle = full ? '#ff5a5a' : 'rgba(255,255,255,.18)'; ctx.globalAlpha = full ? 1 : beat;
      ctx.beginPath(); ctx.arc(hx - hr * 0.5, hy, hr * 0.62, Math.PI, 0); ctx.arc(hx + hr * 0.5, hy, hr * 0.62, Math.PI, 0); ctx.lineTo(hx, hy + hr * 1.35); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'right'; ctx.fillText('x' + (game.speed / CFG.START_SPEED).toFixed(1), W - 14, ty - 10);
    ctx.textAlign = 'center';
    // contextual hint for the hook
    var near = null, i, o;
    if (game.state === 'playing' && !game.hook) for (i = 0; i < game.obstacles.length; i++) {
      o = game.obstacles[i];
      if (o.anchor && !o.used && o.z - game.pz < 60 && o.z + (o.type === 'chasm' ? 0.4 : 0) > game.pz) { near = o; break; }
    }
    var show = !!near;
    if (show) {
      ctx.font = '800 ' + Math.round(Math.min(W, H) * 0.06) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.4)'; var msg = near.type === 'chasm' ? 'TAP HOOK: SWING!' : 'TAP HOOK: PULL UP!';
      ctx.fillText(msg, W / 2 + 2, H * 0.2 + 2); ctx.fillStyle = (Math.floor(t / 250) % 2) ? '#ffe86a' : '#fff'; ctx.fillText(msg, W / 2, H * 0.2);
    } else if (game.state === 'playing' && hintT > 0) {
      ctx.font = '700 ' + Math.round(Math.min(W, H) * 0.05) + 'px system-ui, sans-serif';
      ctx.globalAlpha = Math.min(1, hintT); ctx.fillStyle = '#fff';
      ctx.fillText('Swipe to dodge', W / 2, H * 0.2); ctx.globalAlpha = 1;
    }
    hookBtn.classList.toggle('hint', show);

    if (flash > 0) {                                              // red flash + label after a stumble
      var fg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      fg.addColorStop(0, 'rgba(255,40,40,0)'); fg.addColorStop(1, 'rgba(255,40,40,' + (0.55 * flash) + ')');
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = Math.min(1, flash * 1.5); ctx.font = '900 ' + Math.round(Math.min(W, H) * 0.08) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillText('STUMBLE!', W / 2 + 2, H * 0.3 + 2); ctx.fillStyle = '#ffd0d0'; ctx.fillText('STUMBLE!', W / 2, H * 0.3); ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- frame
  function drawHookLine() {           // the hook line is drawn on the HUD so it stays clearly visible even though it points straight away from the camera
    var rp = r3 && r3.rope; if (!rp || !game.hook) return;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(rp.x1, rp.y1); ctx.lineTo(rp.x2, rp.y2); ctx.stroke();
    ctx.strokeStyle = game.hook.kind === 'pull' ? '#ffa33a' : ropeColor(); ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(rp.x1, rp.y1); ctx.lineTo(rp.x2, rp.y2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rp.x2, rp.y2, 5, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  function drawPlayerBlink(t) {            // flicker while invulnerable after a stumble
    if (game.state === 'playing' && game.invuln > 0 && Math.floor(t / 90) % 2) return;
    drawPlayer(t);
  }

  function render(t) {
    if (storeOpen) drawStorePreview(t);
    if (r3 && !r3.ready) canvas.style.background = '#0b2a1f';     // 3D lost its context: fall back to the 2D scene
    if (r3 && r3.ready) {                  // real 3D scene underneath; this canvas only carries the HUD
      canvas.style.background = 'transparent';
      ctx.clearRect(0, 0, W, H);
      drawPlayerSprite(t);
      r3.render(game, t, { attract: attract, shake: shake, flash: flash, sprite: spr, spriteInfo: SPR, ropeColor: game.hook && game.hook.kind === 'pull' ? '#ffa33a' : ropeColor() });
      drawHookLine();
      drawHUD(t);
      return;
    }
    var pulse = 0.5 + 0.5 * Math.sin(t / 180);
    camX += (game.px * 0.6 - camX) * 0.25;
    rz = game.pz + (game.state === 'menu' ? attract : 0);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
    drawSky();
    drawGround();

    var items = [], i, o, k, sd;
    var k0 = Math.floor((rz - CAM_D) / 4.5);
    for (k = k0; k * 4.5 - rz < VIEW; k++) {
      var z = k * 4.5 - rz + 0.9;
      for (sd = -1; sd <= 1; sd += 2) {
        var hs = hash(k * 2 + (sd > 0 ? 1 : 0));
        if (hs < 0.22) continue;
        items.push({ z: z + hs, f: drawTree, a: [sd * (5.0 + hs * 9), z + hs, sd, hash(k + sd * 7.7), hs > 0.6] });
      }
      var hb = hash(k * 5.3);
      if (hb > 0.35) items.push({ z: z + 1.4, f: drawBush, a: [(hb > 0.7 ? 1 : -1) * (4.6 + hb * 2), z + 1.4, hb] });
    }
    if (game.state !== 'menu') {
      for (i = 0; i < game.obstacles.length; i++) {
        o = game.obstacles[i];
        var rel = o.z - rz; if (rel > VIEW || rel + o.len < -CAM_D + 0.5) continue;
        if (o.type === 'pit' || o.type === 'chasm') { drawVoid(o); if (o.anchor) items.push({ z: rel + o.len / 2, f: drawAnchor, a: [o.anchor, false, pulse] }); continue; }
        if (o.type === 'ledge') { items.push({ z: (game.pz >= o.z - 0.5 && game.pz <= o.z + o.len) ? 1e3 : rel, f: drawLedge, a: [o, pulse] }); continue; }
        if (o.type === 'branch') { items.push({ z: rel, f: drawBranch, a: [o] }); continue; }
        var fn = o.type === 'rock' ? drawRock : o.type === 'log' ? drawLog : drawWall;
        o.lanes.forEach(function (l) { items.push({ z: rel, f: fn, a: [o, l] }); });
      }
    }
    if (game.state !== 'menu') {
      for (i = 0; i < game.coinList.length; i++) {
        var cn = game.coinList[i], cr = cn.z - rz;
        if (!cn.taken && cr < VIEW * 0.75 && cr > -CAM_D + 0.8) items.push({ z: cr, f: drawCoin, a: [cn, t] });
      }
    }
    items.sort(function (a, b) { return b.z - a.z; });
    var drewPlayer = false;
    for (i = 0; i < items.length; i++) {
      if (!drewPlayer && items[i].z < 0.2) { drawPlayerBlink(t); drewPlayer = true; }
      items[i].f.apply(null, items[i].a);
    }
    if (!drewPlayer) drawPlayerBlink(t);

    // light mist over the far distance
    var mg = ctx.createLinearGradient(0, HOR - 6, 0, HOR + H * 0.16);
    mg.addColorStop(0, 'rgba(' + FOG.join(',') + ',.55)'); mg.addColorStop(1, 'rgba(' + FOG.join(',') + ',0)');
    ctx.fillStyle = mg; ctx.fillRect(0, HOR - 6, W, H * 0.16 + 6);
    ctx.restore();
    drawHUD(t);
  }

  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);            // schedule first: an error below can never stop the loop (that looked like a freeze)
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0; lastT = t;
    if (game.state === 'menu') attract += dt * 12;
    try { game.update(dt); } catch (err) { if (window.console) console.error(err); }
    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (hintT > 0) hintT -= dt;
    if (game.state === 'playing' && game.score() >= nextMs) { nextMs += 100; say('far'); }
    if (voiceHideAt && performance.now() > voiceHideAt) silenceVoice();
    if (riddleOpen) { riddleT -= dt; rdBar.style.width = Math.max(0, riddleT / RIDDLE_TIME * 100) + '%'; if (riddleT <= 0) closeRiddle(null); }
    else if (routeOpen) { routeT -= dt; rtBar.style.width = Math.max(0, routeT / ROUTE_TIME * 100) + '%'; if (routeT <= 0) closeRoute(null); }
    else if (game.state === 'playing' && game.score() >= riddleNext && game.score() >= quietUntil && riddleSafeMoment()) openRiddle();
    else if (game.state === 'playing' && game.score() >= routeNext && game.score() >= quietUntil && routeSafeMoment()) openRoute();
    if (routePicked && game.routeObstacle && game.state === 'playing' && game.pz > game.routeObstacle.z + game.routeObstacle.len + 1) {
      game.coins += routePicked.bonus; coinBump = 1; routePicked = null; game.routeObstacle = null; say('routeWin', true);
    }
    try { render(t); }
    catch (err) {
      if (r3 && r3.ready) { r3.ready = false; canvas.style.background = '#0b2a1f'; if (window.console) console.warn('3D renderer disabled after an error:', err); }
      else if (window.console) console.error(err);
    }
  }

  // ---------------------------------------------------------------- wallet + store (saved on this device)
  var DEF_PAL = { JACKET: JACKET, JACKET_D: JACKET_D, JACKET_L: JACKET_L, SCARF: SCARF, SCARF_D: SCARF_D };
  var SKINS = [
    { id: 'classic', name: 'Explorer', cost: 0, pal: null, sw: '#d9b25f' },
    { id: 'crimson', name: 'Crimson jacket', cost: 150, pal: ['#c0392b', '#8e2a20', '#e0685a', '#f1f1f1', '#cfcfcf'], sw: '#c0392b' },
    { id: 'ocean', name: 'Ocean jacket', cost: 250, pal: ['#2f80c8', '#1f5f98', '#5aa4e6', '#ffd84a', '#d3b02a'], sw: '#2f80c8' },
    { id: 'midnight', name: 'Midnight jacket', cost: 350, pal: ['#3b3b4f', '#26263a', '#5a5a78', '#7cf0cf', '#4fc4a5'], sw: '#3b3b4f' },
    { id: 'xera', name: 'XERA royal', cost: 500, pal: ['#1f3fa8', '#142a78', '#4a6fe0', '#c9d6e8', '#98a9c2'], sw: '#2a5bff' }
  ];
  var ROPES = [
    { id: 'gold', name: 'Gold rope', cost: 0, col: '#ffe86a' },
    { id: 'cyan', name: 'Cyan rope', cost: 80, col: '#6ff0ff' },
    { id: 'pink', name: 'Pink rope', cost: 80, col: '#ff7ad9' },
    { id: 'blue', name: 'XERA blue rope', cost: 120, col: '#4f8cff' }
  ];
  var REACH_COST = [100, 250, 500];
  var save = { wallet: 0, skin: 'classic', rope: 'gold', owned: { classic: 1, gold: 1 }, reach: 0 }, banked = false, storeOpen = false;
  try { var sv = JSON.parse(localStorage.getItem('evo1lanes.save') || 'null'); if (sv && typeof sv === 'object') { save.wallet = Math.max(0, sv.wallet | 0); save.skin = sv.skin || 'classic'; save.rope = sv.rope || 'gold'; save.owned = Object.assign({ classic: 1, gold: 1 }, sv.owned || {}); save.reach = Math.min(3, Math.max(0, sv.reach | 0)); } } catch (e) { /* no saved data */ }
  function persist() { try { localStorage.setItem('evo1lanes.save', JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  function applyLoadout() {
    var sk = byId(SKINS, save.skin), p = sk.pal;
    JACKET = p ? p[0] : DEF_PAL.JACKET; JACKET_D = p ? p[1] : DEF_PAL.JACKET_D; JACKET_L = p ? p[2] : DEF_PAL.JACKET_L; SCARF = p ? p[3] : DEF_PAL.SCARF; SCARF_D = p ? p[4] : DEF_PAL.SCARF_D;
    game.reach = save.reach;
  }
  function ropeColor() { return byId(ROPES, save.rope).col; }
  function bankRun() { if (banked || !game.coins) { banked = true; return 0; } banked = true; save.wallet += game.coins; persist(); return game.coins; }
  var stList = document.getElementById('st-list'), stCoins = document.getElementById('st-coins'), stPrev = document.getElementById('st-prev'), storeEl = document.getElementById('store'), walletMini = document.getElementById('wallet-mini');
  var stPrevCtx = stPrev.getContext('2d');
  function row(kind, it, owned, equipped, cost, label, sub, sw) {
    var btn = equipped ? '<button class="eq" disabled>EQUIPPED</button>' : owned ? '<button data-a="equip" data-k="' + kind + '" data-i="' + it + '">EQUIP</button>'
      : '<button data-a="buy" data-k="' + kind + '" data-i="' + it + '"' + (save.wallet < cost ? ' disabled' : '') + '>' + cost + ' &#9679;</button>';
    return '<div class="it">' + (sw ? '<span class="sw" style="background:' + sw + '"></span>' : '') + '<span class="nm">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + btn + '</div>';
  }
  function renderStore() {
    var h = '<h3>SKINS</h3>', i;
    for (i = 0; i < SKINS.length; i++) h += row('skin', SKINS[i].id, !!save.owned[SKINS[i].id], save.skin === SKINS[i].id, SKINS[i].cost, SKINS[i].name, '', SKINS[i].sw);
    h += '<h3>HOOK ROPE</h3>';
    for (i = 0; i < ROPES.length; i++) h += row('rope', ROPES[i].id, !!save.owned[ROPES[i].id], save.rope === ROPES[i].id, ROPES[i].cost, ROPES[i].name, '', ROPES[i].col);
    h += '<h3>HOOK UPGRADE</h3>';
    var lv = save.reach, desc = 'Level ' + lv + '/3 &middot; longer arming time + wider latch zones';
    h += lv >= 3 ? '<div class="it"><span class="nm">Hook reach<small>' + desc + '</small></span><button class="eq" disabled>MAX</button></div>'
      : '<div class="it"><span class="nm">Hook reach<small>' + desc + '</small></span><button data-a="buy" data-k="reach" data-i="1"' + (save.wallet < REACH_COST[lv] ? ' disabled' : '') + '>' + REACH_COST[lv] + ' &#9679;</button></div>';
    stList.innerHTML = h; stCoins.textContent = save.wallet; walletMini.textContent = save.wallet ? '\u25CF ' + save.wallet : '';
  }
  stList.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b || b.disabled) return;
    var k = b.getAttribute('data-k'), id = b.getAttribute('data-i'), a = b.getAttribute('data-a');
    if (k === 'reach') { var c = REACH_COST[save.reach]; if (c != null && save.wallet >= c) { save.wallet -= c; save.reach++; } }
    else {
      var item = byId(k === 'skin' ? SKINS : ROPES, id);
      if (a === 'buy' && !save.owned[id] && save.wallet >= item.cost) { save.wallet -= item.cost; save.owned[id] = 1; a = 'equip'; }
      if (a === 'equip' && save.owned[id]) save[k] = id;
    }
    persist(); applyLoadout(); renderStore();
  });
  function openStore() { storeOpen = true; renderStore(); overlay.hidden = true; storeEl.hidden = false; }
  function closeStore() { storeOpen = false; storeEl.hidden = true; showOverlay(game.state === 'over' ? 'over' : game.state === 'paused' ? 'paused' : 'menu'); }   // always bring the previous screen back (it was hidden when the store opened)
  document.getElementById('store-open').addEventListener('click', openStore);
  document.getElementById('store-close').addEventListener('click', closeStore);
  function drawStorePreview(t) {            // the same explorer artwork, running on the spot, with the equipped skin
    var real = game; game = { px: 0, y: 0, vy: 0, pz: 0, lane: 0, state: 'menu', onGround: true, hook: null, slideT: 0, reason: null, speed: 0, wounded: 0, invuln: 0 };
    try { drawPlayerSprite(t); } finally { game = real; }
    stPrevCtx.clearRect(0, 0, 150, 190); stPrevCtx.drawImage(spr, 40, 70, 304, 380, 0, 0, 150, 190);
  }
  applyLoadout(); renderStore();

  // ---------------------------------------------------------------- overlay / state
  function showOverlay(mode) {
    overlay.hidden = false; hookBtn.hidden = true; pauseBtn.hidden = true; silenceVoice();
    ovStats.hidden = true; ovHelp.hidden = false;
    if (mode === 'menu') { ovTitle.innerHTML = 'EVOLUTION 1<br><span>THE RUNNER</span>'; ovText.textContent = 'A laboratory fell from the sky and became a temple in the jungle. Run toward it.'; ovBtn.textContent = 'START'; }
    else if (mode === 'paused') { ovTitle.innerHTML = 'PAUSED'; ovText.textContent = ''; ovBtn.textContent = 'RESUME'; }
    else {
      var sc = game.points(), isBest = sc > best;
      if (isBest) { best = sc; try { localStorage.setItem('evo1lanes.best', String(best)); } catch (e) { /* storage unavailable */ } }
      ovTitle.innerHTML = 'RUN OVER'; ovText.textContent = REASON[game.reason] || 'You crashed.';
      var vl = document.createElement('em'); vl.className = 'voice-line'; vl.textContent = '\u201C' + pickVoice(game.score() >= 150 ? VOICE.overFar : VOICE.over) + '\u201D';
      ovText.appendChild(document.createElement('br')); ovText.appendChild(vl);
      var got = bankRun();
      ovStats.hidden = false; ovStats.innerHTML = game.score() + ' m &middot; ' + game.coins + ' coins' + (got ? ' (saved)' : '') + '<br>' + sc + ' pts' + (isBest && sc > 0 ? ' &middot; NEW BEST!' : ' <small>(best ' + best + ')</small>');
      ovBtn.textContent = 'RESTART'; ovHelp.hidden = true;
    }
    walletMini.textContent = save.wallet ? '\u25CF ' + save.wallet : '';
    document.getElementById('store-open').hidden = false;
    setTimeout(function () { try { ovBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 0);
  }
  function hideOverlay() { overlay.hidden = true; hookBtn.hidden = false; pauseBtn.hidden = false; ovBtn.blur(); }

  // ---------------------------------------------------------------- THE VOICE: a grumpy, mysterious narrator (text only, never blocks touches)
  var voiceEl = document.createElement('div'); voiceEl.id = 'voice'; voiceEl.setAttribute('aria-hidden', 'true'); document.getElementById('app').appendChild(voiceEl);
  var VOICE = {
    start: ['So. Another runner.', 'Run. It is watching.', 'The jungle remembers every step.', 'Do try not to die immediately.'],
    stumble: ['Clumsy.', 'Tch. Watch your feet.', 'Again? Truly?', 'The ground was right there.'],
    far: ['Still alive? Hm.', 'Do not get proud.', 'The temple is not impressed.', 'Keep going. I am merely curious.'],
    hook: ['Hm. Not terrible.', 'A lucky swing.', 'The vine tolerates you.'],
    coins: ['Shiny things. Typical.', 'Collect away. I will keep judging.', 'Greedy. I approve.'],
    over: ['That was it?', 'Predictable.', 'The jungle sighs.', 'Again. Perhaps with eyes open.'],
    overFar: ['...Fine. Not bad.', 'You almost deserved that.', 'Again. I am not impressed. Yet.']
  };
  var voiceHideAt = 0, voiceLast = '', voiceNextOk = 0, nextMs = 100;
  function pickVoice(pool) { var l, n = 0; do { l = pool[Math.floor(Math.random() * pool.length)]; } while (l === voiceLast && pool.length > 1 && ++n < 6); voiceLast = l; return l; }
  function say(pool, force) {
    var now = performance.now(); if (!force && now < voiceNextOk) return;
    voiceEl.textContent = pickVoice(VOICE[pool]); voiceEl.className = 'show'; voiceHideAt = now + 2800; voiceNextOk = now + 7000;
  }
  function silenceVoice() { voiceEl.className = ''; voiceHideAt = 0; }

  // ---------------------------------------------------------------- RIDDLES: the run freezes on a safe moment, 8 s to answer, correct = +10 coins, no penalty otherwise
  var RIDDLES = [
    ['I speak without a mouth and answer in the mountains. What am I?', 'An echo', 'The wind'],
    ['The more you take, the more you leave behind. What am I?', 'Footsteps', 'Coins'],
    ['I have cities but no houses, and rivers but no water. What am I?', 'A map', 'A dream'],
    ['What gets wetter the more it dries?', 'A towel', 'A river'],
    ['What has hands but cannot clap?', 'A clock', 'A statue'],
    ['I follow you in the sun and vanish in the dark. What am I?', 'Your shadow', 'Your echo'],
    ['What runs but never walks, and has a mouth but never talks?', 'A river', 'A runner'],
    ['The more of me there is, the less you see. What am I?', 'Darkness', 'Light'],
    ['What has a spine but no bones?', 'A book', 'A fish'],
    ['What goes up but never comes back down?', 'Your age', 'A leaf']
  ];
  var RIDDLE_TIME = 8, RIDDLE_EVERY = 250, RIDDLE_FIRST = 150, RIDDLE_BONUS = 10;
  VOICE.riddleOk = ['Correct. Do not let it go to your head.', 'Hm. You listen.', 'Lucky. Or clever. I will decide later.'];
  VOICE.riddleNo = ['Wrong. Of course.', 'The jungle laughs.', 'Not even close.'];
  VOICE.riddleLate = ['Too slow.', 'Silence is also an answer. A wrong one.'];
  var riddleEl = document.createElement('div'); riddleEl.id = 'riddle'; riddleEl.hidden = true;
  riddleEl.innerHTML = '<div class="rd-card"><p class="rd-eyebrow">THE VOICE ASKS</p><p class="rd-q" id="rd-q"></p><div class="rd-bar"><i id="rd-bar"></i></div><div class="rd-opts"><button type="button" id="rd-a" data-i="0"></button><button type="button" id="rd-b" data-i="1"></button></div><p class="rd-note">+' + RIDDLE_BONUS + ' coins if you are right</p></div>';
  document.getElementById('app').appendChild(riddleEl);
  var rdQ = document.getElementById('rd-q'), rdBar = document.getElementById('rd-bar'), rdBtn = [document.getElementById('rd-a'), document.getElementById('rd-b')];
  // The riddle comes shortly BEFORE a pit, chasm or ledge (30-70 m ahead), so the answer happens right before a big moment.
  // If no such hazard shows up for a long stretch, it falls back to any quiet moment (nothing within 14 m, no hazard closer than 30 m).
  var HAZARD = { pit: 1, chasm: 1, ledge: 1 }, RD_NEAR = 30, RD_FAR = 70, RD_FALLBACK = 120;
  function riddleSafeMoment() {
    if (!game.onGround || game.hook || game.hookArmed > 0 || game.wounded > 0) return false;
    var os = game.obstacles, pz = game.pz, i, o, dz, hazard = -1, any = Infinity;
    for (i = 0; i < os.length; i++) {
      o = os[i]; dz = o.z - pz;
      if (o.z + (o.len || 0) < pz) continue;                       // already behind us
      if (dz < any) any = dz;
      if (HAZARD[o.type] && dz > 0 && (hazard < 0 || dz < hazard)) hazard = dz;
    }
    if (any < 14) return false;                                    // something right in front, or under us: never now
    if (hazard >= RD_NEAR && hazard <= RD_FAR) return true;        // the sweet spot
    return game.score() >= riddleNext + RD_FALLBACK && (hazard < 0 || hazard >= RD_NEAR);
  }
  var riddleOpen = false, riddleT = 0, riddleRight = 0, riddleNext = RIDDLE_FIRST, riddleLastIdx = -1;
  function openRiddle() {
    var idx; do { idx = Math.floor(Math.random() * RIDDLES.length); } while (idx === riddleLastIdx && RIDDLES.length > 1); riddleLastIdx = idx;
    var rd = RIDDLES[idx]; riddleRight = Math.random() < 0.5 ? 0 : 1;
    rdQ.textContent = rd[0]; rdBtn[riddleRight].textContent = rd[1]; rdBtn[1 - riddleRight].textContent = rd[2];
    riddleOpen = true; riddleT = RIDDLE_TIME; rdBar.style.width = '100%'; silenceVoice(); clearTouch();
    game.pause(); hookBtn.hidden = true; pauseBtn.hidden = true; riddleEl.hidden = false;
  }
  function closeRiddle(choice) {
    if (!riddleOpen) return; riddleOpen = false; riddleEl.hidden = true; riddleNext = game.score() + RIDDLE_EVERY; quietUntil = game.score() + 60;
    var ok = choice === riddleRight;
    if (ok) { game.coins += RIDDLE_BONUS; coinBump = 1; }
    if (game.state === 'paused') { lastT = 0; resumedAt = Date.now(); game.resume(); game.invuln = Math.max(game.invuln || 0, 1.2); hookBtn.hidden = false; pauseBtn.hidden = false; }
    say(ok ? 'riddleOk' : choice == null ? 'riddleLate' : 'riddleNo', true);
  }
  riddleEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  rdBtn.forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeRiddle(+b.getAttribute('data-i')); }); });
  document.addEventListener('keydown', function (e) { if (riddleOpen && (e.key === '1' || e.key === '2')) closeRiddle(+e.key - 1); });

  // ---------------------------------------------------------------- ROUTE CHOICE: 5 s to pick the next hazard (harder = more bonus coins when you clear it)
  var ROUTES = [
    { kind: 'pit', name: 'STONE PITS', how: 'Jump', level: 'EASY', bonus: 10 },
    { kind: 'chasm', name: 'VINE CHASM', how: 'Swing the vine', level: 'MEDIUM', bonus: 20 },
    { kind: 'ledge', name: 'TEMPLE LEDGE', how: 'Pull yourself up', level: 'HARD', bonus: 30 }
  ];
  var ROUTE_TIME = 5, ROUTE_FIRST = 300, ROUTE_EVERY = 400, QUIET_GAP = 80;
  VOICE.routePick = ['Bold choice.', 'Hm. That one.', 'The jungle noted your choice.'];
  VOICE.routeLate = ['Indecision. I will choose for you.', 'Too slow. The pits it is.'];
  VOICE.routeWin = ['You chose well. This time.', 'Hm. Not afraid, then.', 'Brave. Or lucky.'];
  var routeEl = document.createElement('div'); routeEl.id = 'route'; routeEl.hidden = true;
  routeEl.innerHTML = '<div class="rd-card"><p class="rd-eyebrow">CHOOSE YOUR ROUTE</p><div class="rd-bar"><i id="rt-bar"></i></div><div class="rt-opts">' +
    ROUTES.map(function (r, i) { return '<button type="button" data-i="' + i + '"><b>' + r.name + '</b><span>' + r.how + ' \u00B7 ' + r.level + '</span><em>+' + r.bonus + '</em></button>'; }).join('') +
    '</div><p class="rd-note">Clear it to win the bonus coins</p></div>';
  document.getElementById('app').appendChild(routeEl);
  var rtBar = document.getElementById('rt-bar');
  var routeOpen = false, routeT = 0, routeNext = ROUTE_FIRST, quietUntil = 0, routePicked = null;
  function routeSafeMoment() {
    if (!game.onGround || game.hook || game.hookArmed > 0 || game.wounded > 0) return false;
    var os = game.obstacles, i, o, dz;
    for (i = 0; i < os.length; i++) { o = os[i]; if (o.z + (o.len || 0) < game.pz) continue; dz = o.z - game.pz; if (dz < 14) return false; }
    return true;
  }
  function openRoute() {
    routeOpen = true; routeT = ROUTE_TIME; rtBar.style.width = '100%'; silenceVoice(); clearTouch();
    game.pause(); hookBtn.hidden = true; pauseBtn.hidden = true; routeEl.hidden = false;
  }
  function closeRoute(idx) {
    if (!routeOpen) return; routeOpen = false; routeEl.hidden = true;
    var r = idx == null ? ROUTES[0] : ROUTES[idx];
    game.setRoute(r.kind); routePicked = r;
    routeNext = game.score() + ROUTE_EVERY; quietUntil = game.score() + QUIET_GAP;
    if (game.state === 'paused') { lastT = 0; resumedAt = Date.now(); game.resume(); game.invuln = Math.max(game.invuln || 0, 1.2); hookBtn.hidden = false; pauseBtn.hidden = false; }
    say(idx == null ? 'routeLate' : 'routePick', true);
  }
  routeEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  [].forEach.call(routeEl.querySelectorAll('.rt-opts button'), function (b) { b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeRoute(+b.getAttribute('data-i')); }); });
  document.addEventListener('keydown', function (e) { if (routeOpen && (e.key === '1' || e.key === '2' || e.key === '3')) closeRoute(+e.key - 1); });

  game.onEvent = function (type) {
    if (type === 'start') { banked = false; applyLoadout(); if (overTimer) { clearTimeout(overTimer); overTimer = null; } hideOverlay(); hintT = 4; shake = 0; nextMs = 100; voiceNextOk = 0; riddleNext = RIDDLE_FIRST; if (riddleOpen) { riddleOpen = false; riddleEl.hidden = true; }
    routeNext = ROUTE_FIRST; quietUntil = 0; routePicked = null; if (routeOpen) { routeOpen = false; routeEl.hidden = true; } setTimeout(function () { if (game.state === 'playing') say('start', true); }, 900); }
    else if (type === 'stumble') { flash = 1; shake = Math.max(shake, 0.8); say('stumble'); }
    else if (type === 'release') { say('hook'); }
    else if (type === 'coin') { coinBump = 1; if (game.coins > 0 && game.coins % 15 === 0) say('coins'); }
    else if (type === 'crash') { shake = 1; silenceVoice(); overTimer = setTimeout(function () { overTimer = null; if (game.state === 'over') showOverlay('over'); }, 550); }
  };

  var ptr = null, resumedAt = 0;
  function clearTouch() { ptr = null; hookBtn.classList.remove('down'); }
  function resumeGame() {
    if (game.state !== 'paused' || riddleOpen || routeOpen) return;
    clearTouch(); lastT = 0; resumedAt = Date.now();      // fresh clock: no time jump after the pause
    game.resume(); hideOverlay();
  }
  function pauseIfPlaying() {
    if (game.state !== 'playing') return;
    if (Date.now() - resumedAt < 600) return;            // some phones fire a stray blur right after a tap: don't re-pause at once
    clearTouch(); game.pause(); showOverlay('paused');
  }
  ovBtn.addEventListener('click', function () {
    if (game.state === 'paused') resumeGame();
    else if (game.state === 'menu' || game.state === 'over') game.start();
  });
  pauseBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
  pauseBtn.addEventListener('pointerup', function (e) { e.preventDefault(); e.stopPropagation(); resumedAt = 0; pauseIfPlaying(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseIfPlaying(); });
  window.addEventListener('blur', pauseIfPlaying);
  window.addEventListener('pagehide', pauseIfPlaying);

  // ---------------------------------------------------------------- input
  var SWIPE = 24;
  canvas.addEventListener('pointerdown', function (e) {
    if (game.state !== 'playing') return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, done: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!ptr || ptr.id !== e.pointerId || ptr.done || game.state !== 'playing') return;
    var dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    ptr.done = true;
    if (Math.abs(dx) > Math.abs(dy)) game.moveLane(dx < 0 ? -1 : 1);
    else if (dy < 0) game.jump(); else game.slide();
    e.preventDefault();
  });
  function endPointer(e) {
    if (!ptr || ptr.id !== e.pointerId) return;
    var tap = !ptr.done && e.type === 'pointerup' && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) < 14 && e.timeStamp - ptr.t < 900;   // generous: a stuttering phone can stretch a quick tap a long way
    ptr = null;
    if (tap && game.state === 'playing') game.hookPress();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });   // no scroll / pull-to-refresh
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  hookBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); hookBtn.classList.add('down'); game.hookPress(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { hookBtn.addEventListener(n, function () { hookBtn.classList.remove('down'); }); });

  window.addEventListener('keydown', function (e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, used = true;
    if (game.state === 'paused' && (k === 'Escape' || k === 'p' || k === 'P')) { resumeGame(); e.preventDefault(); return; }
    if (game.state !== 'playing') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') game.moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') game.moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') game.jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') game.slide();
    else if (k === 'x' || k === 'X' || k === 'h' || k === 'H' || k === 'k' || k === 'K' || k === 'Shift') game.hookPress();
    else if (k === 'Escape' || k === 'p' || k === 'P') { resumedAt = 0; pauseIfPlaying(); }
    else used = false;
    if (used) e.preventDefault();
  });

  var rsT = null;
  function onResize() { clearTimeout(rsT); rsT = setTimeout(resize, 60); resize(); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // ---------------------------------------------------------------- go
  resize();
  hookBtn.hidden = true;
  showOverlay('menu');
  // The optional real-3D renderer (render3d.js, an ES module) announces itself when three.js has loaded.
  function attach3D() {
    var r = window.EvoLanes3D;
    if (!r || !r.ready || r3 === r) return;
    r3 = r; canvas.style.background = 'transparent'; r3.resize(W, H, DPR);
  }
  window.addEventListener('evo3d-ready', attach3D);
  window.__EVO1_LANES__ = { game: game, core: Core, render: render, stop: function () { running = false; },
                            mode: function () { return r3 && r3.ready ? '3d' : '2d'; }, attach3D: attach3D };
  attach3D();
  requestAnimationFrame(frame);
})();

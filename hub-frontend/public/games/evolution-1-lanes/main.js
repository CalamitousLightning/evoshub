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
  var hookBtn = document.getElementById('hook-btn');

  var game = new Core.Game();
  var W = 0, H = 0, DPR = 1, F = 300, HOR = 300;
  var CAM_H = 5, CAM_D = 6.5, VIEW = 115, SEG = 2.5, PATH_HALF = 3.8;
  var camX = 0, rz = 0, attract = 0, shake = 0, hintT = 0, overT = 0;
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
  }

  // ---------------------------------------------------------------- projection + colour helpers
  function proj(x, y, z) {            // z is relative to the player
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
  function drawPlayer(t) {
    var g = game, p = proj(g.px, g.y, 0), s = p.s, sl = g.slideT > 0, hooked = !!g.hook;
    // ground shadow
    if (g.y > -0.3) {
      var gy = (g.y >= CFG.LEDGE_H - 0.2) ? CFG.LEDGE_H : 0, sp = proj(g.px, gy, 0);
      var sc = clamp(1 - (g.y - gy) / 6, 0.3, 1);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * sc) + ')'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 0.55 * s * sc, 0.16 * s * sc, 0, 0, 6.3); ctx.fill();
    }
    var ph = g.onGround && g.state === 'playing' ? g.pz * 0.85 : 1.2, sw = Math.sin(ph) * 0.3, k = sl ? 0.48 : 1;
    var X = p.x, Y = p.y;                                    // feet position on screen
    function Yh(h) { return Y - h * k * s; }
    // legs
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#27405a'; ctx.lineWidth = 0.2 * s;
    ctx.beginPath(); ctx.moveTo(X - 0.15 * s, Yh(0.85)); ctx.lineTo(X - 0.17 * s, Yh(0.05 + (g.onGround ? Math.max(0, sw) * 0.5 : 0.2))); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X + 0.15 * s, Yh(0.85)); ctx.lineTo(X + 0.17 * s, Yh(0.05 + (g.onGround ? Math.max(0, -sw) * 0.5 : 0.35))); ctx.stroke();
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.22 * s;                // boots
    ctx.beginPath(); ctx.moveTo(X - 0.17 * s, Yh(0.05 + (g.onGround ? Math.max(0, sw) * 0.5 : 0.2))); ctx.lineTo(X - 0.17 * s, Yh(0.0 + (g.onGround ? Math.max(0, sw) * 0.5 : 0.2))); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X + 0.17 * s, Yh(0.05 + (g.onGround ? Math.max(0, -sw) * 0.5 : 0.35))); ctx.lineTo(X + 0.17 * s, Yh(0.0 + (g.onGround ? Math.max(0, -sw) * 0.5 : 0.35))); ctx.stroke();
    // torso + backpack
    var tw = (sl ? 0.85 : 0.68) * s;
    ctx.fillStyle = '#d9b25f'; roundRect(X - tw / 2, Yh(1.5), tw, 0.78 * k * s, 0.16 * s); ctx.fill();
    ctx.fillStyle = '#2f6b4c'; roundRect(X - tw * 0.38, Yh(1.38), tw * 0.76, 0.55 * k * s, 0.1 * s); ctx.fill();
    ctx.fillStyle = '#7cf0cf'; ctx.fillRect(X - tw * 0.08, Yh(1.22), tw * 0.16, 0.22 * k * s);        // EVO light on the pack
    // arms
    ctx.strokeStyle = '#c68a5a'; ctx.lineWidth = 0.15 * s;
    var armSw = g.onGround ? sw * 0.9 : 0.1;
    ctx.beginPath(); ctx.moveTo(X - tw / 2, Yh(1.38)); ctx.lineTo(X - tw / 2 - 0.08 * s, Yh(0.9 + armSw * 0.5)); ctx.stroke();
    if (hooked) {
      var a = g.hook.anchor, ap = proj(0, a.y, a.z - rz), hand = { x: X + tw / 2, y: Yh(1.4) };
      ctx.beginPath(); ctx.moveTo(X + tw / 2, Yh(1.38)); ctx.lineTo(hand.x + 0.05 * s, hand.y - 0.2 * s); ctx.stroke();
      ctx.strokeStyle = g.hook.kind === 'swing' ? '#ffe86a' : '#ffa33a'; ctx.lineWidth = Math.max(2, 0.07 * s);
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y - 0.2 * s); ctx.lineTo(ap.x, ap.y); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(X + tw / 2, Yh(1.38)); ctx.lineTo(X + tw / 2 + 0.08 * s, Yh(0.9 - armSw * 0.5)); ctx.stroke();
    }
    // head
    ctx.fillStyle = '#c68a5a'; ctx.beginPath(); ctx.arc(X, Yh(1.68), 0.22 * s, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#2a1c14'; ctx.beginPath(); ctx.arc(X, Yh(1.72), 0.23 * s, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.lineCap = 'butt';
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  }

  // ---------------------------------------------------------------- HUD
  function drawHUD(t) {
    var sc = game.state === 'menu' ? 0 : game.score();
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.font = '800 ' + Math.round(Math.min(W, H) * 0.09) + 'px system-ui, sans-serif';
    var ty = Math.max(48, H * 0.075);
    ctx.fillText(sc + ' m', W / 2 + 2, ty + 2);
    ctx.fillStyle = '#fff'; ctx.fillText(sc + ' m', W / 2, ty);
    ctx.font = '700 ' + Math.round(Math.min(W, H) * 0.034) + 'px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.textAlign = 'left'; ctx.fillText('BEST ' + Math.max(best, sc) + ' m', 14, ty - 10);
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
  }

  // ---------------------------------------------------------------- frame
  function render(t) {
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
    items.sort(function (a, b) { return b.z - a.z; });
    var drewPlayer = false;
    for (i = 0; i < items.length; i++) {
      if (!drewPlayer && items[i].z < 0.2) { drawPlayer(t); drewPlayer = true; }
      items[i].f.apply(null, items[i].a);
    }
    if (!drewPlayer) drawPlayer(t);

    // light mist over the far distance
    var mg = ctx.createLinearGradient(0, HOR - 6, 0, HOR + H * 0.16);
    mg.addColorStop(0, 'rgba(' + FOG.join(',') + ',.55)'); mg.addColorStop(1, 'rgba(' + FOG.join(',') + ',0)');
    ctx.fillStyle = mg; ctx.fillRect(0, HOR - 6, W, H * 0.16 + 6);
    ctx.restore();
    drawHUD(t);
  }

  function frame(t) {
    if (!running) return;
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0; lastT = t;
    if (game.state === 'menu') attract += dt * 12;
    game.update(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    if (hintT > 0) hintT -= dt;
    render(t);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- overlay / state
  function showOverlay(mode) {
    overlay.hidden = false; hookBtn.hidden = true;
    ovStats.hidden = true; ovHelp.hidden = false;
    if (mode === 'menu') { ovTitle.innerHTML = 'EVOLUTION 1<br><span>THE RUNNER</span>'; ovText.textContent = 'A laboratory fell from the sky and became a temple in the jungle. Run toward it.'; ovBtn.textContent = 'START'; }
    else if (mode === 'paused') { ovTitle.innerHTML = 'PAUSED'; ovText.textContent = ''; ovBtn.textContent = 'RESUME'; }
    else {
      var sc = game.score(), isBest = sc > best;
      if (isBest) { best = sc; try { localStorage.setItem('evo1lanes.best', String(best)); } catch (e) { /* storage unavailable */ } }
      ovTitle.innerHTML = 'RUN OVER'; ovText.textContent = REASON[game.reason] || 'You crashed.';
      ovStats.hidden = false; ovStats.innerHTML = sc + ' m' + (isBest && sc > 0 ? ' &middot; NEW BEST!' : '<br><small>Best ' + best + ' m</small>');
      ovBtn.textContent = 'RESTART'; ovHelp.hidden = true;
    }
    setTimeout(function () { try { ovBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 0);
  }
  function hideOverlay() { overlay.hidden = true; hookBtn.hidden = false; ovBtn.blur(); }

  game.onEvent = function (type) {
    if (type === 'start') { if (overTimer) { clearTimeout(overTimer); overTimer = null; } hideOverlay(); hintT = 4; shake = 0; }
    else if (type === 'crash') { shake = 1; overTimer = setTimeout(function () { overTimer = null; if (game.state === 'over') showOverlay('over'); }, 550); }
  };

  ovBtn.addEventListener('click', function () {
    if (game.state === 'paused') { game.resume(); hideOverlay(); lastT = 0; }
    else if (game.state === 'menu' || game.state === 'over') game.start();
  });

  function pauseIfPlaying() { if (game.state === 'playing') { game.pause(); showOverlay('paused'); } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseIfPlaying(); });
  window.addEventListener('blur', pauseIfPlaying);

  // ---------------------------------------------------------------- input
  var ptr = null, SWIPE = 24;
  canvas.addEventListener('pointerdown', function (e) {
    if (game.state !== 'playing') return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), done: false };
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
    var tap = !ptr.done && e.type === 'pointerup' && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) < 14 && performance.now() - ptr.t < 350;
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
    if (game.state === 'paused' && (k === 'Escape' || k === 'p' || k === 'P')) { game.resume(); hideOverlay(); lastT = 0; e.preventDefault(); return; }
    if (game.state !== 'playing') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') game.moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') game.moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') game.jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') game.slide();
    else if (k === 'x' || k === 'X' || k === 'h' || k === 'H' || k === 'k' || k === 'K' || k === 'Shift') game.hookPress();
    else if (k === 'Escape' || k === 'p' || k === 'P') pauseIfPlaying();
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
  window.__EVO1_LANES__ = { game: game, core: Core, render: render, stop: function () { running = false; } };
  requestAnimationFrame(frame);
})();

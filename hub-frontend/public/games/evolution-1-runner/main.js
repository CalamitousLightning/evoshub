/*
 * EVOLUTION 1: THE RUNNER — renderer, input and UI wiring.
 * Canvas 2D only, no libraries, placeholder art drawn with shapes (no image assets to break).
 * Initialises once (guarded) and tracks every listener so destroy() removes them all.
 */
(function () {
  'use strict';
  if (window.__EVO1_RUNNER__) return;                 // never initialise twice
  var Core = window.EvoRunnerCore;
  if (!Core) { console.error('EvoRunnerCore missing'); return; }

  var CFG = Core.CFG, W = CFG.W, H = CFG.H, G = CFG.GROUND_Y;
  var FIXED = 1 / 120;                                // fixed physics step, independent of display refresh
  var BEST_KEY = 'evo1_runner_best';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovText = document.getElementById('ov-text');
  var ovStats = document.getElementById('ov-stats');
  var ovBtn = document.getElementById('ov-btn');
  var ovHelp = document.getElementById('ov-help');
  var jumpBtn = document.getElementById('jump-btn');
  jumpBtn.tabIndex = -1;
  ovBtn.tabIndex = 0;

  var game = new Core.Game();
  var best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* storage may be blocked */ }

  var raf = 0, last = 0, acc = 0, overAt = 0, shake = 0, menuDist = 0, hint = 0, newBest = false;
  var cssScale = 1, listeners = [], ro = null;
  var HOOK_KEY = 'evo1_runner_hooked', learnedHook = false;
  try { learnedHook = localStorage.getItem(HOOK_KEY) === '1'; } catch (e) { /* ignore */ }
  var hookBtn = document.getElementById('hook-btn');
  hookBtn.tabIndex = -1;

  // ---------- listener bookkeeping (no duplicates, full cleanup) ----------
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  // ---------- sizing ----------
  function resize() {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    cssScale = Math.min(sw / W, sh / H);
    var cw = Math.max(1, Math.floor(W * cssScale)), ch = Math.max(1, Math.floor(H * cssScale));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }

  // ---------- pre-built art ----------
  var sky = ctx.createLinearGradient(0, 0, 0, G);
  sky.addColorStop(0, '#0b3b4a'); sky.addColorStop(0.55, '#1a6a55'); sky.addColorStop(1, '#6fb36a');

  var glow = document.createElement('canvas');
  glow.width = glow.height = 160;
  (function () {
    var g = glow.getContext('2d'), rg = g.createRadialGradient(80, 80, 0, 80, 80, 80);
    rg.addColorStop(0, 'rgba(160,255,240,.85)'); rg.addColorStop(0.35, 'rgba(110,230,215,.35)'); rg.addColorStop(1, 'rgba(110,230,215,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 160, 160);
  })();

  var TREES = [ // x within a 640px tile: [x, trunkHeight, canopyRadius]
    [40, 250, 62], [190, 200, 52], [330, 270, 70], [480, 220, 56], [585, 190, 48]
  ];
  var BUSHES = [[30, 18], [150, 26], [270, 16], [380, 30], [470, 20]]; // 520px tile: [x, radius]
  var VINES = [[60, 34], [210, 48], [330, 28], [450, 40]];              // 520px tile: [x, length]

  function mod(a, n) { return ((a % n) + n) % n; }

  // ---------- particles (small fixed pool) ----------
  var parts = [], PMAX = 24;
  for (var pi = 0; pi < PMAX; pi++) parts.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0.5 });
  var pcur = 0;
  function puff(x, y, n) {
    for (var i = 0; i < n; i++) {
      var p = parts[pcur]; pcur = (pcur + 1) % PMAX;
      p.x = x + Math.random() * 10; p.y = y; p.vx = -game.speed * 0.5 - Math.random() * 60;
      p.vy = -30 - Math.random() * 60; p.life = p.max = 0.35 + Math.random() * 0.25;
    }
  }
  function updateParts(dt) {
    for (var i = 0; i < PMAX; i++) {
      var p = parts[i]; if (p.life <= 0) continue;
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
    }
  }
  function clearParts() { for (var i = 0; i < PMAX; i++) parts[i].life = 0; }

  // ---------- drawing ----------
  function drawFar(d) {
    var off = -mod(d * 0.06, 1200), k;
    for (k = 0; k < 2; k++) {
      var ox = off + k * 1200;
      ctx.fillStyle = '#0f4a3a';
      ctx.beginPath(); ctx.moveTo(ox, G);
      for (var x = 0; x <= 1200; x += 30) {
        var y = 262 + Math.sin(x / 1200 * Math.PI * 4) * 22 + Math.sin(x / 1200 * Math.PI * 10) * 8;
        ctx.lineTo(ox + x, y);
      }
      ctx.lineTo(ox + 1200, G); ctx.closePath(); ctx.fill();
      // the fallen laboratory, now a temple: stepped silhouette with a glowing apex
      var tx = ox + 760, ty = 258;
      ctx.fillStyle = '#0a3027';
      ctx.fillRect(tx - 70, ty - 18, 140, 22);
      ctx.fillRect(tx - 52, ty - 38, 104, 20);
      ctx.fillRect(tx - 34, ty - 58, 68, 20);
      ctx.fillRect(tx - 18, ty - 76, 36, 18);
      ctx.fillStyle = '#9ffff0';
      ctx.fillRect(tx - 4, ty - 70, 8, 10);
      ctx.drawImage(glow, tx - 80, ty - 150, 160, 160);
    }
  }

  function drawFireflies(t, d) {
    ctx.fillStyle = '#eaff9a';
    for (var i = 0; i < 14; i++) {
      var fx = mod(i * 97 - d * 0.3, W + 40) - 20;
      var fy = 120 + (i * 53) % 190 + Math.sin(t * 1.5 + i) * 10;
      ctx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(t * 2 + i * 1.7));
      ctx.fillRect(fx, fy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawTrees(d) {
    var off = -mod(d * 0.25, 640), k, i;
    for (k = 0; k < 3; k++) {
      for (i = 0; i < TREES.length; i++) {
        var t = TREES[i], x = off + k * 640 + t[0];
        if (x < -90 || x > W + 90) continue;
        ctx.fillStyle = '#16372a'; ctx.fillRect(x - 11, G - t[1], 22, t[1]);
        ctx.fillStyle = '#135039';
        ctx.beginPath(); ctx.arc(x, G - t[1], t[2], 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(x - t[2] * 0.7, G - t[1] + 14, t[2] * 0.7, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(x + t[2] * 0.7, G - t[1] + 14, t[2] * 0.7, 0, 6.2832); ctx.fill();
        // side branch
        ctx.fillStyle = '#16372a'; ctx.fillRect(x + 8, G - t[1] * 0.55, 46, 7);
      }
    }
  }

  function drawNear(d) {
    var k, i, off = -mod(d * 0.6, 520);
    for (k = 0; k < 3; k++) {
      for (i = 0; i < BUSHES.length; i++) {
        var b = BUSHES[i], x = off + k * 520 + b[0];
        if (x < -50 || x > W + 50) continue;
        ctx.fillStyle = '#1d7a47';
        ctx.beginPath(); ctx.ellipse(x, G + 2, b[1] * 1.5, b[1], 0, Math.PI, 0); ctx.fill();
      }
    }
    var voff = -mod(d * 0.9, 520);
    ctx.strokeStyle = 'rgba(8,40,26,.85)'; ctx.fillStyle = 'rgba(10,60,36,.9)'; ctx.lineWidth = 3;
    for (k = 0; k < 3; k++) {
      for (i = 0; i < VINES.length; i++) {
        var v = VINES[i], vx = voff + k * 520 + v[0];
        if (vx < -20 || vx > W + 20) continue;
        ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx, v[1]); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(vx, v[1] + 4, 7, 11, 0, 0, 6.2832); ctx.fill();
      }
    }
  }

  function drawGround(d, obstacles) {
    var cursor = 0, i, o;
    ctx.fillStyle = '#3b2a1a';
    for (i = 0; i < obstacles.length; i++) {
      o = obstacles[i]; if (o.type !== 'gap') continue;
      if (o.x > cursor) ctx.fillRect(cursor, G, Math.min(o.x, W) - cursor, H - G);
      cursor = Math.max(cursor, o.x + o.w);
      if (cursor >= W) break;
    }
    if (cursor < W) ctx.fillRect(cursor, G, W - cursor, H - G);
    // grass strip + scrolling soil marks, clipped by the same gaps
    cursor = 0;
    for (i = 0; i <= obstacles.length; i++) {
      o = obstacles[i];
      var segEnd = (o && o.type === 'gap') ? o.x : (i === obstacles.length ? W : -1);
      if (segEnd >= 0 && segEnd > cursor) {
        var a = Math.max(0, cursor), b = Math.min(W, segEnd);
        if (b > a) {
          ctx.fillStyle = '#2fa35b'; ctx.fillRect(a, G, b - a, 8);
          ctx.fillStyle = '#2a1d11';
          for (var mx = a - mod(a + d, 70) + 70; mx < b; mx += 70) ctx.fillRect(mx, G + 28, 26, 4);
        }
      }
      if (o && o.type === 'gap') cursor = Math.max(cursor, o.x + o.w);
    }
    // dark pits with hanging roots
    for (i = 0; i < obstacles.length; i++) {
      o = obstacles[i]; if (o.type !== 'gap' || o.x > W || o.x + o.w < 0) continue;
      ctx.fillStyle = '#030a07'; ctx.fillRect(o.x, G, o.w, H - G);
      ctx.fillStyle = '#4d3520';
      ctx.fillRect(o.x, G, 5, 26); ctx.fillRect(o.x + o.w - 5, G, 5, 26);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(o.x + 6, G, 3, 14); ctx.fillRect(o.x + o.w - 9, G, 3, 18);
    }
  }

  function drawObstacle(o) {
    var x = o.x, y = o.y, w = o.w, h = o.h;
    if (x > W + 10 || x + w < -10) return;
    if (o.type === 'platform') {
      // one-way canopy ledge: land on top, pass through from below
      ctx.fillStyle = '#4a2f17'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#6b4423'; ctx.fillRect(x, y + 2, w, 4);
      ctx.fillStyle = '#2fa35b'; ctx.fillRect(x, y - 5, w, 7);
      ctx.fillStyle = '#3ec071';
      for (var gx = x + 6; gx < x + w - 6; gx += 34) ctx.fillRect(gx, y - 8, 12, 4);
      ctx.strokeStyle = '#2a6b3a'; ctx.lineWidth = 3;
      for (var vx2 = x + 14; vx2 < x + w - 8; vx2 += 46) {
        ctx.beginPath(); ctx.moveTo(vx2, y + h); ctx.lineTo(vx2 + 2, y + h + 14 + ((vx2 | 0) % 22)); ctx.stroke();
      }
    } else if (o.type === 'rock') {
      ctx.fillStyle = '#6b7682';
      ctx.beginPath();
      ctx.moveTo(x, G); ctx.lineTo(x + w * 0.1, G - h * 0.65); ctx.lineTo(x + w * 0.4, G - h);
      ctx.lineTo(x + w * 0.75, G - h * 0.8); ctx.lineTo(x + w, G - h * 0.2); ctx.lineTo(x + w, G);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#93a0ad';
      ctx.beginPath(); ctx.moveTo(x + w * 0.1, G - h * 0.65); ctx.lineTo(x + w * 0.4, G - h); ctx.lineTo(x + w * 0.5, G - h * 0.55); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3f4a54'; ctx.fillRect(x + w * 0.55, G - 8, w * 0.45, 8);
    } else if (o.type === 'log') {
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#6a4220'; ctx.fillRect(x, y + h * 0.55, w, 3);
      ctx.fillStyle = '#2f8f4f'; ctx.fillRect(x + w * 0.3, y - 3, w * 0.35, 4);
      ctx.fillStyle = '#c58a4a'; ctx.beginPath(); ctx.ellipse(x + w, y + h / 2, 6, h / 2, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x + w, y + h / 2, 3, h / 4, 0, 0, 6.2832); ctx.stroke();
    } else if (o.type === 'branch') {
      // honest hitbox: the whole column is solid, so the player must run UNDER it, not jump
      ctx.fillStyle = '#5a3a1c'; ctx.fillRect(x + 4, 0, w - 8, h);
      ctx.fillStyle = '#7a4f26'; ctx.fillRect(x + 4, 0, 10, h);
      ctx.fillStyle = '#3c2611'; ctx.fillRect(x + w - 16, 0, 6, h);
      ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.ellipse(x + w / 2, h, w / 2 - 2, 9, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#2fa35b';
      ctx.beginPath(); ctx.ellipse(x + 8, h - 2, 9, 14, 0.4, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w - 8, h - 2, 9, 14, -0.4, 0, 6.2832); ctx.fill();
    }
  }

  function drawAnchors(t) {
    var near = game.state === 'playing' && !game.hook ? game.nearestAnchor() : null, i;
    for (i = 0; i < game.anchors.length; i++) {
      var a = game.anchors[i];
      if (a.x < -30 || a.x > W + 30) continue;
      var pull = a.kind === 'pull';
      ctx.strokeStyle = pull ? '#6b4423' : '#2a8a4a'; ctx.lineWidth = pull ? 6 : 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, -6); ctx.lineTo(a.x, a.y - 8); ctx.stroke();
      if (!pull) { ctx.fillStyle = '#35b25c'; ctx.beginPath(); ctx.ellipse(a.x - 6, a.y * 0.5, 8, 5, -0.6, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.ellipse(a.x + 6, a.y * 0.8, 8, 5, 0.6, 0, 6.2832); ctx.fill(); }
      ctx.lineWidth = 4; ctx.strokeStyle = pull ? '#ff9d2e' : '#ffd84a';
      ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, 6.2832); ctx.stroke();
      if (a === near) { // this ring is in reach right now
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(t * 9); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(a.x, a.y, 17, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (!learnedHook && a.x > CFG.PLAYER_X && a.x < W - 20) {
        ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        var msg = pull ? 'HOLD HOOK' : 'JUMP + HOLD HOOK';
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(msg, a.x + 1, a.y - 17);
        ctx.fillStyle = '#ffffff'; ctx.fillText(msg, a.x, a.y - 18);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      }
    }
  }

  function drawRope() {
    if (!game.hook) return;
    var a = game.hook.a, h = game.handPos();
    ctx.strokeStyle = '#e8d29a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(a.x, a.y); ctx.stroke();
  }

  function drawPlayer(t) {
    var p = game.player, px = p.x, py = p.y;
    var air = !p.onGround, phase = game.dmax * 0.045, hooked = !!game.hook;
    var supported = game.isSupported(), pu = game.platformUnder();
    var sy = p.onGround ? p.standY : (pu !== null && py + CFG.PLAYER_H <= pu + 6 ? pu : G);
    if (p.onGround || sy !== G || supported) { // shadow on whatever you would land on
      var lift = Math.max(0, Math.min(1, (sy - (py + CFG.PLAYER_H)) / 150));
      ctx.fillStyle = 'rgba(0,0,0,' + (0.32 - lift * 0.2) + ')';
      ctx.beginPath(); ctx.ellipse(px + 17, sy + 3, 18 - lift * 8, 4, 0, 0, 6.2832); ctx.fill();
    }
    var hipX = px + 17, hipY = py + 34, a1, a2;
    if (air) { a1 = 0.7; a2 = -0.5; } else { a1 = Math.sin(phase) * 0.85; a2 = -a1; }
    ctx.lineCap = 'round'; ctx.lineWidth = 7;
    ctx.strokeStyle = '#2b3d6b';
    ctx.beginPath(); ctx.moveTo(hipX - 2, hipY); ctx.lineTo(hipX - 2 + Math.sin(a2) * 20, hipY + Math.cos(a2) * 20); ctx.stroke();
    ctx.strokeStyle = '#3a5199';
    ctx.beginPath(); ctx.moveTo(hipX + 2, hipY); ctx.lineTo(hipX + 2 + Math.sin(a1) * 20, hipY + Math.cos(a1) * 20); ctx.stroke();
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px, py + 16, 9, 18);                 // backpack
    ctx.fillStyle = '#ff8a2b'; ctx.fillRect(px + 6, py + 14, 22, 24);            // jacket
    ctx.fillStyle = '#ffb066'; ctx.fillRect(px + 6, py + 14, 22, 5);
    ctx.strokeStyle = '#ff8a2b'; ctx.lineWidth = 6;                              // arm
    if (hooked) { // arm reaches up to the rope
      ctx.beginPath(); ctx.moveTo(px + 20, py + 18); ctx.lineTo(px + 17, py + 12); ctx.stroke();
    } else {
      var arm = air ? -1.2 : Math.sin(phase + 3.14) * 0.9;
      ctx.beginPath(); ctx.moveTo(px + 20, py + 18); ctx.lineTo(px + 20 + Math.sin(arm) * 15 + 5, py + 18 + Math.cos(arm) * 15); ctx.stroke();
    }
    ctx.fillStyle = '#f1c9a0'; ctx.beginPath(); ctx.arc(px + 19, py + 9, 8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#d9a441'; ctx.fillRect(px + 8, py + 4, 24, 3);              // hat brim
    ctx.beginPath(); ctx.arc(px + 19, py + 4, 8, Math.PI, 0); ctx.fill();        // hat crown
    ctx.fillStyle = '#1c1c1c'; ctx.fillRect(px + 23, py + 8, 2, 3);              // eye
  }

  function drawHud(t) {
    ctx.font = '700 24px system-ui, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(game.score() + ' m', 17, 15);
    ctx.fillStyle = '#ffffff'; ctx.fillText(game.score() + ' m', 15, 13);
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd84a'; ctx.fillText('BEST ' + Math.max(best, game.state === 'playing' ? 0 : game.score()) + ' m', W - 14, 16);
    ctx.textAlign = 'left';
    if (game.state === 'playing' && hint < 4) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 4 - hint));
      ctx.font = '700 18px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff'; ctx.fillText('TAP / SPACE TO JUMP  •  duck under low branches by NOT jumping', W / 2, 60);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }

  function render(t) {
    var d = game.state === 'menu' ? menuDist : game.dmax;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 20, (Math.random() - 0.5) * shake * 20);
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
    drawFar(d);
    drawFireflies(t, d);
    drawTrees(d);
    drawGround(d, game.obstacles);
    for (var i = 0; i < game.obstacles.length; i++) drawObstacle(game.obstacles[i]);
    drawAnchors(t);
    drawNear(d);
    // dust
    ctx.fillStyle = '#c9b48a';
    for (i = 0; i < PMAX; i++) {
      var p = parts[i]; if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.7;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    ctx.globalAlpha = 1;
    drawRope();
    drawPlayer(t);
    drawHud(t);
    if (game.state === 'over' && shake > 0) { ctx.fillStyle = 'rgba(255,40,40,' + (shake * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // ---------- overlay ----------
  function showOverlay(title, text, stats, btn, help) {
    ovTitle.innerHTML = title; ovText.textContent = text;
    ovStats.hidden = !stats; ovStats.textContent = stats || '';
    ovBtn.textContent = btn; ovHelp.textContent = help;
    overlay.hidden = false;
  }
  function showMenu() {
    showOverlay('EVOLUTION 1<br><span>THE RUNNER</span>',
      'A laboratory fell from the sky and became a temple in the jungle. Run toward it. Jump rocks, logs and gaps, run under low branches — and use the HOOK on the big chasms.',
      '', 'START', 'JUMP: tap the button or screen · HOOK: hold it. Rings pull you up; on vines, jump first, then let go to fling. Keys: Space, Shift/X');
  }
  function showPaused() {
    showOverlay('PAUSED', 'Take a breath, explorer.', '', 'RESUME', 'Esc / P also resumes');
  }
  function showOver() {
    var line = 'Distance: ' + game.score() + ' m  •  Best: ' + best + ' m' + (newBest ? '  ★ NEW BEST' : '');
    showOverlay('GAME OVER',
      game.reason === 'fall' ? 'You fell into a gap.' : 'You hit an obstacle.',
      line, 'RESTART', 'Enter / Space also restarts');
  }

  // ---------- game events ----------
  game.onEvent = function (type) {
    if (type === 'start') { clearParts(); hint = 0; shake = 0; newBest = false; overlay.hidden = true; }
    else if (type === 'land') { puff(CFG.PLAYER_X + 8, G - 2, 4); }
    else if (type === 'hook') { if (!learnedHook) { learnedHook = true; try { localStorage.setItem(HOOK_KEY, '1'); } catch (e) { /* ignore */ } } }
    else if (type === 'pause') { game.hookUp(); showPaused(); }
    else if (type === 'resume') { overlay.hidden = true; last = 0; }
    else if (type === 'over') {
      overAt = performance.now(); shake = 0.35;
      var s = game.score();
      if (s > best) { best = s; newBest = s > 0; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ } }
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* ignore */ }
      showOver();
    }
  };

  // ---------- input ----------
  function action() {
    var s = game.state;
    if (s === 'playing') game.press();
    else if (s === 'menu') game.start();
    else if (s === 'over') { if (performance.now() - overAt > 450) game.start(); }
    else if (s === 'paused') game.resume();
  }

  on(document, 'keydown', function (e) {
    var c = e.code;
    if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
      e.preventDefault(); if (!e.repeat) action();
    } else if (c === 'Enter') {
      if (game.state !== 'playing') { e.preventDefault(); if (!e.repeat) action(); }
    } else if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyX' || c === 'KeyK') {
      e.preventDefault(); if (!e.repeat) { hookBtn.classList.add('down'); game.hookDown(); }
    } else if (c === 'Escape' || c === 'KeyP') {
      if (game.state === 'playing') game.pause(); else if (game.state === 'paused') game.resume();
    }
  });

  on(document, 'keyup', function (e) {
    var c = e.code;
    if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyX' || c === 'KeyK') { hookBtn.classList.remove('down'); game.hookUp(); }
  });

  on(canvas, 'pointerdown', function (e) { e.preventDefault(); if (game.state === 'playing') game.press(); }, { passive: false });

  on(jumpBtn, 'pointerdown', function (e) {
    e.preventDefault(); jumpBtn.classList.add('down'); action();
  }, { passive: false });
  function jumpUp() { jumpBtn.classList.remove('down'); }
  on(jumpBtn, 'pointerup', jumpUp);
  on(jumpBtn, 'pointercancel', jumpUp);
  on(jumpBtn, 'pointerleave', jumpUp);

  on(hookBtn, 'pointerdown', function (e) {
    e.preventDefault(); hookBtn.classList.add('down'); game.hookDown();
  }, { passive: false });
  function hookRelease() { hookBtn.classList.remove('down'); game.hookUp(); }
  on(hookBtn, 'pointerup', hookRelease);
  on(hookBtn, 'pointercancel', hookRelease);
  on(hookBtn, 'pointerleave', hookRelease);

  on(ovBtn, 'click', function () { action(); ovBtn.blur(); });

  // Stop the browser from scrolling, zooming or opening menus while playing
  on(document, 'touchmove', function (e) { e.preventDefault(); }, { passive: false });
  on(document, 'gesturestart', function (e) { e.preventDefault(); });
  on(document, 'contextmenu', function (e) { e.preventDefault(); });

  // Auto-pause when the tab/app goes to the background
  function autoPause() { if (game.state === 'playing') game.pause(); hookBtn.classList.remove('down'); }
  on(document, 'visibilitychange', function () { if (document.hidden) autoPause(); });
  on(window, 'pagehide', autoPause);
  on(window, 'blur', autoPause);

  on(window, 'resize', resize);
  on(window, 'orientationchange', function () { setTimeout(resize, 120); });
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(stage); }

  // ---------- main loop ----------
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = (ts - last) / 1000; last = ts;
    if (dt > 0.1) dt = 0.1;
    if (game.state === 'playing') {
      acc += dt; hint += dt;
      while (acc >= FIXED) { game.step(FIXED); acc -= FIXED; }
      updateParts(dt);
      if (game.player.onGround && game.state === 'playing' && Math.random() < dt * 14) puff(CFG.PLAYER_X + 6, G - 2, 1);
    } else {
      acc = 0;
      if (game.state === 'menu') menuDist += 70 * dt;
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    render(ts / 1000);
  }

  function destroy() {
    cancelAnimationFrame(raf);
    for (var i = 0; i < listeners.length; i++) listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2], listeners[i][3]);
    listeners.length = 0;
    if (ro) ro.disconnect();
    window.__EVO1_RUNNER__ = null;
  }

  window.__EVO1_RUNNER__ = { game: game, destroy: destroy, resize: resize };
  showMenu();
  resize();
  raf = requestAnimationFrame(frame);
})();

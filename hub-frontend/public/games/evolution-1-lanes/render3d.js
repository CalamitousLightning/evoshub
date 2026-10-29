/*
 * EVOLUTION 1: THE RUNNER (lanes) — real 3D renderer (three.js, vendored in ./vendor so the Hub's CSP 'self' rule holds).
 *
 * This file only DRAWS. All rules, physics and collisions stay in core.js, so the 2D version and the 3D version play
 * identically. If WebGL is unavailable (or ?mode=2d is in the URL) this module does nothing and main.js keeps using the
 * 2D renderer. The HUD is drawn by main.js on a transparent canvas above the 3D canvas.
 *
 * World axes: +z = forward (run direction), +x = right, +y = up. Units are metres.
 */
import * as THREE from './vendor/three.module.min.js';

(function () {
  'use strict';
  if (window.EvoLanes3D) return;
  if (/[?&]mode=2d\b/.test(location.search)) return;
  var Core = window.EvoLanesCore, glCanvas = document.getElementById('gl');
  if (!Core || !glCanvas) return;
  var CFG = Core.CFG;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: (window.devicePixelRatio || 1) < 2, alpha: false, powerPreference: 'high-performance' });   // MSAA only on low-DPR screens
  } catch (e) { return; }
  if (!renderer.getContext()) return;

  // ------------------------------------------------------------------ helpers
  var TILE = CFG.TILE, PATH_W = 7.6, DEPTH = 16, SIDE_W = 60;
  function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function col(hex) { return new THREE.Color(hex); }
  var HORIZON = col(0x8fcaa9);

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON.getHex(), 38, 138);
  var camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

  var hemi = new THREE.HemisphereLight(0xdff5e6, 0x4a5a3a, 1.15); scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff0cc, 1.6); scene.add(sun); scene.add(sun.target);

  // ------------------------------------------------------------------ materials
  function lambert(c, o) { var m = new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {})); return m; }
  function std(c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9, metalness: 0.0 }, o || {})); }
  function glow(c, o) { return new THREE.MeshBasicMaterial(Object.assign({ color: c, fog: false }, o || {})); }

  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  var radialTex = canvasTex(64, 64, function (g, w, h) {
    var gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  var pathTex = canvasTex(128, 128, function (g, w, h) {            // packed earth with lane markings
    g.fillStyle = '#9a7040'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 260; i++) { g.fillStyle = 'rgba(' + (60 + (i * 37) % 60) + ',' + (40 + (i * 53) % 40) + ',20,' + (0.08 + (i % 5) * 0.03) + ')'; g.fillRect((i * 97) % w, (i * 61) % h, 2 + (i % 4), 2 + (i % 3)); }
    g.fillStyle = 'rgba(70,46,22,.65)';
    var u1 = w * (0.5 - (CFG.LANE_W / 2) / PATH_W), u2 = w * (0.5 + (CFG.LANE_W / 2) / PATH_W);
    g.fillRect(u1 - 1.5, h * 0.12, 3, h * 0.62); g.fillRect(u2 - 1.5, h * 0.12, 3, h * 0.62);
  });
  pathTex.anisotropy = 4;
  var grassTex = canvasTex(64, 64, function (g, w, h) {
    g.fillStyle = '#2f6a46'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 90; i++) { g.fillStyle = 'rgba(' + (30 + (i * 29) % 40) + ',' + (90 + (i * 43) % 60) + ',' + (50 + (i * 17) % 30) + ',.35)'; g.fillRect((i * 53) % w, (i * 31) % h, 3, 5); }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(SIDE_W / 4, 18);

  // ------------------------------------------------------------------ sky + distant temple
  var skyTex = new THREE.CanvasTexture(document.createElement('canvas'));
  function paintSky(horizonFrac) {
    var c = skyTex.image; c.width = 4; c.height = 256; var g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#08222f'); gr.addColorStop(Math.max(0.05, horizonFrac * 0.6), '#1f6670'); gr.addColorStop(Math.min(0.95, horizonFrac), '#8fcaa9'); gr.addColorStop(1, '#8fcaa9');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256); skyTex.colorSpace = THREE.SRGBColorSpace; skyTex.needsUpdate = true;
  }
  scene.background = skyTex;

  var temple = new THREE.Group();
  (function () {
    var tiers = 5, i, m = new THREE.MeshBasicMaterial({ color: 0x1d4a48, fog: false }), m2 = new THREE.MeshBasicMaterial({ color: 0x2a6663, fog: false });
    for (i = 0; i < tiers; i++) {
      var w = 56 - i * 9, b = new THREE.Mesh(new THREE.BoxGeometry(w, 7, w * 0.8), i % 2 ? m2 : m); b.position.y = 3.5 + i * 7; temple.add(b);
    }
    var door = new THREE.Mesh(new THREE.PlaneGeometry(4, 8), glow(0xaafff0)); door.position.set(0, 6, -22.2); door.rotation.y = Math.PI; temple.add(door);
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 7, 160, 16, 1, true), glow(0x78ffe6, { transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 110; temple.add(beam);
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex, color: 0x78ffe6, fog: false, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(150, 150, 1); halo.position.y = 44; temple.add(halo);
    scene.add(temple);
  })();

  // ------------------------------------------------------------------ ground
  var tileMats = [lambert(0x8a6a44), lambert(0x8a6a44), lambert(0xffffff, { map: pathTex }), lambert(0x5a4630), lambert(0x7a5c3a), lambert(0x7a5c3a)];
  var TILES = 64;
  var tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(PATH_W, DEPTH, TILE), tileMats, TILES);
  tiles.frustumCulled = false; tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(tiles);
  var tileA = col(0xffffff), tileB = col(0xd9c8aa);
  for (var ti = 0; ti < TILES; ti++) { tiles.setColorAt(ti, tileA); }

  var sideMat = lambert(0xffffff, { map: grassTex });
  var sideMats = [lambert(0x4a3a28), lambert(0x4a3a28), sideMat, lambert(0x2a2218), lambert(0x4a3a28), lambert(0x4a3a28)];
  var sideL = new THREE.Mesh(new THREE.BoxGeometry(SIDE_W, DEPTH, 280), sideMats), sideR = sideL.clone();
  sideL.frustumCulled = sideR.frustumCulled = false; scene.add(sideL); scene.add(sideR);
  var voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x010201, fog: false }));
  voidPlane.rotation.x = -Math.PI / 2; voidPlane.position.y = -DEPTH - 0.05; scene.add(voidPlane);

  // ------------------------------------------------------------------ scenery (instanced, recycled around the player)
  var NT = 90;
  var trunkGeo = new THREE.CylinderGeometry(0.62, 0.9, 1, 7); trunkGeo.translate(0, 0.5, 0);
  var trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x5a3e24), NT);
  var canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  var canopyA = new THREE.InstancedMesh(canopyGeo, lambert(0x2a8048, { flatShading: true }), NT * 2);
  var canopyB = new THREE.InstancedMesh(canopyGeo, lambert(0x4aa660, { flatShading: true }), NT * 2);
  var bushGeo = new THREE.IcosahedronGeometry(1, 1);
  var NB = 80, bushes = new THREE.InstancedMesh(bushGeo, lambert(0x3a9a50, { flatShading: true }), NB);
  var NF = 60, ferns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.4, 5), lambert(0x59b56a, { flatShading: true }), NF);
  [trunks, canopyA, canopyB, bushes, ferns].forEach(function (m) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
  var dummy = new THREE.Object3D(), zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

  // spores floating in the air (mysterious jungle)
  var NS = 140, sporeBase = new Float32Array(NS * 3), sporePos = new Float32Array(NS * 3);
  for (var si = 0; si < NS; si++) { sporeBase[si * 3] = (hash(si * 3.1) - 0.5) * 30; sporeBase[si * 3 + 1] = 0.5 + hash(si * 5.7) * 9; sporeBase[si * 3 + 2] = hash(si * 7.3) * 120; }
  var sporeGeo = new THREE.BufferGeometry(); sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  var spores = new THREE.Points(sporeGeo, new THREE.PointsMaterial({ map: radialTex, color: 0xbfffe6, size: 0.55, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  spores.frustumCulled = false; scene.add(spores);

  function updateScenery(vz) {
    var k0 = Math.floor((vz - 14) / 4.5), k, sd, ti = 0, bi = 0, fi = 0, ci = 0;
    for (k = k0; k * 4.5 - vz < 135 && ti < NT; k++) {
      var z = k * 4.5 + 0.9;
      for (sd = -1; sd <= 1; sd += 2) {
        var hs = hash(k * 2 + (sd > 0 ? 1 : 0));
        if (hs < 0.2 || ti >= NT) continue;
        var th = 8 + hs * 9, x = sd * (5.6 + hs * 11), rr = 3.2 + hs * 2.4, zz = z + hs * 2, h2 = hash(k + sd * 7.7);
        dummy.rotation.set(0, h2 * 6, 0); dummy.scale.set(0.5 + hs * 0.4, th, 0.5 + hs * 0.4); dummy.position.set(x, 0, zz); dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
        dummy.rotation.set(h2, h2 * 5, 0); dummy.scale.set(rr, rr * 0.85, rr); dummy.position.set(x, th + 0.5, zz); dummy.updateMatrix(); canopyA.setMatrixAt(ci, dummy.matrix);
        dummy.scale.set(rr * 0.75, rr * 0.7, rr * 0.75); dummy.position.set(x + sd * -1.1, th + rr * 0.55, zz + 0.8); dummy.updateMatrix(); canopyB.setMatrixAt(ci, dummy.matrix); ci++;
        dummy.scale.set(rr * 0.7, rr * 0.6, rr * 0.7); dummy.position.set(x + sd * 1.6, th - 0.8, zz - 0.8); dummy.updateMatrix(); canopyA.setMatrixAt(ci, dummy.matrix);
        dummy.scale.set(rr * 0.5, rr * 0.45, rr * 0.5); dummy.position.set(x + sd * 0.9, th + rr * 0.9, zz - 0.3); dummy.updateMatrix(); canopyB.setMatrixAt(ci, dummy.matrix); ci++;
        ti++;
      }
      var hb = hash(k * 5.3);
      if (hb > 0.3 && bi < NB) {
        var bs = (hb > 0.7 ? 1 : -1), bw = 0.9 + hb * 1.2;
        dummy.rotation.set(0, hb * 9, 0); dummy.scale.set(bw, bw * 0.6, bw); dummy.position.set(bs * (4.5 + hb * 3), bw * 0.25, z + 1.4); dummy.updateMatrix(); bushes.setMatrixAt(bi++, dummy.matrix);
      }
      var hf = hash(k * 9.1 + 2);
      if (hf > 0.25 && fi < NF) {
        var fs = (hf > 0.62 ? 1 : -1);
        dummy.rotation.set(0, hf * 7, 0); dummy.scale.set(1, 0.8 + hf, 1); dummy.position.set(fs * (4.3 + hf * 2.5), 0.5, z + 3); dummy.updateMatrix(); ferns.setMatrixAt(fi++, dummy.matrix);
      }
    }
    for (var q = ti; q < NT; q++) trunks.setMatrixAt(q, zeroM);
    for (q = ci; q < NT * 2; q++) { canopyA.setMatrixAt(q, zeroM); canopyB.setMatrixAt(q, zeroM); }
    for (q = bi; q < NB; q++) bushes.setMatrixAt(q, zeroM);
    for (q = fi; q < NF; q++) ferns.setMatrixAt(q, zeroM);
    trunks.instanceMatrix.needsUpdate = canopyA.instanceMatrix.needsUpdate = canopyB.instanceMatrix.needsUpdate = bushes.instanceMatrix.needsUpdate = ferns.instanceMatrix.needsUpdate = true;
  }

  function updateGround(vz, game, hideObstacles) {
    var k0 = Math.floor((vz - 14) / TILE), i, k, zc, hide, j, o, n = 0;
    for (i = 0; i < TILES; i++) {
      k = k0 + i; zc = (k + 0.5) * TILE; hide = false;
      if (!hideObstacles) for (j = 0; j < game.obstacles.length; j++) {
        o = game.obstacles[j];
        if ((o.type === 'pit' || o.type === 'chasm') && zc > o.z && zc < o.z + o.len) { hide = true; break; }
      }
      if (hide) tiles.setMatrixAt(i, zeroM);
      else { dummy.position.set(0, -DEPTH / 2, zc); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); tiles.setMatrixAt(i, dummy.matrix); }
      tiles.setColorAt(i, (k & 1) ? tileB : tileA);
    }
    tiles.instanceMatrix.needsUpdate = true; tiles.instanceColor.needsUpdate = true;
    sideL.position.set(-(PATH_W / 2 + SIDE_W / 2), -DEPTH / 2, vz + 110); sideR.position.set(PATH_W / 2 + SIDE_W / 2, -DEPTH / 2, vz + 110);
    grassTex.offset.y = 0;
    voidPlane.position.x = 0; voidPlane.position.z = vz;
  }

  // ------------------------------------------------------------------ obstacles
  var stone = std(0x7d847c, { flatShading: true }), stoneDark = std(0x5d645c, { flatShading: true }), moss = std(0x3f8f4e, { flatShading: true });
  var rockMat = std(0x777b80, { flatShading: true }), woodMat = std(0x7a5230), woodCap = std(0xb08a58), barkMat = std(0x5c3d22);
  var leafMat = lambert(0x2f9a4c, { flatShading: true }), vineMat = lambert(0x4f9a3c);
  var runeMat = glow(0x78ffe6), ringYellow = new THREE.MeshStandardMaterial({ color: 0xffe86a, emissive: 0xffd23a, emissiveIntensity: 1.0, roughness: 0.4 });
  var ringOrange = new THREE.MeshStandardMaterial({ color: 0xffa33a, emissive: 0xff8a1f, emissiveIntensity: 1.0, roughness: 0.4 });
  var glowYellow = new THREE.SpriteMaterial({ map: radialTex, color: 0xffe36a, fog: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  var glowOrange = new THREE.SpriteMaterial({ map: radialTex, color: 0xff9a2a, fog: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

  var rockGeo = new THREE.IcosahedronGeometry(1, 0), boxGeo = new THREE.BoxGeometry(1, 1, 1), cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12), sphGeo = new THREE.IcosahedronGeometry(1, 1), torusGeo = new THREE.TorusGeometry(0.55, 0.1, 8, 20);
  function mesh(g, m, x, y, z, sx, sy, sz) { var o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o; }

  function buildRock(o, lane) {
    var g = new THREE.Group(), x = lane * CFG.LANE_W, h = o.h, j = hash(o.z * 1.7 + lane);
    var r = mesh(rockGeo, rockMat, 0, h * 0.5, 0, 0.98, h * 0.55, o.len * 0.55); r.rotation.y = j * 3; g.add(r);
    g.add(mesh(sphGeo, moss, 0.2, h * 0.9, 0.1, 0.5, 0.16, 0.45));
    g.position.set(x, 0, o.z + o.len / 2); return g;
  }
  function buildLog(o, lane) {
    var g = new THREE.Group(), r = o.h / 2, x = lane * CFG.LANE_W, len = CFG.LANE_W * 0.94;
    var c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), [woodMat, woodCap, woodCap]); c.rotation.z = Math.PI / 2; c.position.set(0, r, 0); g.add(c);
    g.add(mesh(sphGeo, moss, -0.2, o.h * 0.95, 0, 0.35, 0.1, 0.25));
    g.position.set(x, 0, o.z + o.len / 2); g.rotation.y = (hash(o.z) - 0.5) * 0.12; return g;
  }
  function buildWall(o, lane) {
    var g = new THREE.Group(), x = lane * CFG.LANE_W, w = CFG.LANE_W * 0.94;
    g.add(mesh(boxGeo, stone, 0, o.h / 2, 0, w, o.h, o.len));
    for (var i = 1; i < 4; i++) g.add(mesh(boxGeo, stoneDark, 0, i * o.h / 4, 0, w + 0.06, 0.07, o.len + 0.06));
    g.add(mesh(boxGeo, moss, 0.2, o.h + 0.02, 0, w * 0.8, 0.12, o.len * 0.9));
    var rune = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.1), runeMat); rune.position.set(0, o.h * 0.55, -o.len / 2 - 0.02); rune.rotation.y = Math.PI; g.add(rune);
    g.position.set(x, 0, o.z + o.len / 2); return g;
  }
  function laneSpan(o) { var mn = 9, mx = -9; o.lanes.forEach(function (l) { if (l < mn) mn = l; if (l > mx) mx = l; }); return [mn * CFG.LANE_W - CFG.LANE_W * 0.47, mx * CFG.LANE_W + CFG.LANE_W * 0.47]; }
  function buildBranch(o) {
    var g = new THREE.Group(), sp = laneSpan(o), w = sp[1] - sp[0], cx = (sp[0] + sp[1]) / 2, i;
    var bar = mesh(cylGeo, barkMat, 0, o.low + CFG.BRANCH_THICK / 2, 0, 0.62, w + 0.6, 0.62); bar.rotation.z = Math.PI / 2; g.add(bar);
    [sp[0] - 0.2 - cx, sp[1] + 0.2 - cx].forEach(function (px) { g.add(mesh(cylGeo, barkMat, px, (o.h + 0.6) / 2, 0, 0.3, o.h + 0.6, 0.3)); });
    var n = Math.max(3, Math.round(w / 1.1));
    for (i = 0; i <= n; i++) g.add(mesh(sphGeo, leafMat, -w / 2 + w * i / n, o.h + 0.05, (hash(i + o.z) - 0.5) * 0.3, 0.55, 0.38, 0.55));
    for (i = 1; i < n; i += 2) g.add(mesh(cylGeo, vineMat, -w / 2 + w * i / n, o.low - 0.1, 0, 0.04, 0.9, 0.04));
    g.position.set(cx, 0, o.z + o.len / 2); return g;
  }
  function buildAnchor(a, orange) {
    var g = new THREE.Group();
    var ring = new THREE.Mesh(torusGeo, orange ? ringOrange : ringYellow); ring.scale.setScalar(orange ? 1.05 : 1); g.add(ring);
    var gl = new THREE.Sprite(orange ? glowOrange : glowYellow); gl.scale.set(4.2, 4.2, 1); g.add(gl);
    if (!orange) { var v = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 40, 6), vineMat); v.position.y = 20.5; g.add(v); }
    g.position.set(0, a.y, a.z); g.userData.ring = ring; g.userData.glow = gl; return g;
  }
  function buildLedge(o) {
    var g = new THREE.Group(), h = o.h, mats = [stone, stone, moss, stoneDark, stone, stone];
    var b = new THREE.Mesh(boxGeo, mats); b.scale.set(PATH_W, h, o.len); b.position.set(0, h / 2, o.len / 2); g.add(b);
    for (var i = 1; i < 4; i++) g.add(mesh(boxGeo, stoneDark, 0, i * h / 4, 0, PATH_W + 0.04, 0.07, 0.04));
    for (i = 0; i < 5; i++) { var r = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.2), runeMat); r.position.set(-2.9 + i * 1.45, h * 0.55, -0.03); r.rotation.y = Math.PI; g.add(r); }
    g.position.set(0, 0, o.z); return g;
  }

  var obsMap = new Map();
  function buildObstacle(o) {
    var g = new THREE.Group(), anchorG = null;
    if (o.type === 'rock') o.lanes.forEach(function (l) { g.add(buildRock(o, l)); });
    else if (o.type === 'log') o.lanes.forEach(function (l) { g.add(buildLog(o, l)); });
    else if (o.type === 'wall') o.lanes.forEach(function (l) { g.add(buildWall(o, l)); });
    else if (o.type === 'branch') g.add(buildBranch(o));
    else if (o.type === 'ledge') { g.add(buildLedge(o)); anchorG = buildAnchor(o.anchor, true); g.add(anchorG); }
    else if (o.type === 'chasm') { anchorG = buildAnchor(o.anchor, false); g.add(anchorG); }
    g.userData.anchor = anchorG;
    return g;
  }
  function syncObstacles(vz, game, hide) {
    var seen = new Set(), i, o, e;
    if (!hide) for (i = 0; i < game.obstacles.length; i++) {
      o = game.obstacles[i];
      if (o.z - vz > 150 || o.z + o.len - vz < -20) continue;
      if (o.type === 'pit') continue;
      seen.add(o); e = obsMap.get(o);
      if (!e) { e = buildObstacle(o); obsMap.set(o, e); scene.add(e); }
    }
    obsMap.forEach(function (g, key) { if (!seen.has(key)) { scene.remove(g); obsMap.delete(key); } });
  }

  // ------------------------------------------------------------------ coins + sparkles
  var NC = 110, coinTex = new THREE.TextureLoader().load('/games/evolution-1-lanes/xera-coin.png');
  coinTex.colorSpace = THREE.SRGBColorSpace; coinTex.anisotropy = 4;
  // round XERA token: silver rim + the token art on both faces (the PNG is already circular with transparent corners)
  var faceMat = new THREE.MeshStandardMaterial({ map: coinTex, emissiveMap: coinTex, emissive: 0xffffff, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.45, transparent: true, alphaTest: 0.4 });
  var rimMat = new THREE.MeshStandardMaterial({ color: 0xc9d6e8, emissive: 0x1a3c8c, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.25 });
  var coinMat = [rimMat, faceMat, faceMat];
  var coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 40); coinGeo.rotateX(Math.PI / 2);
  var coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, NC); coinMesh.frustumCulled = false; coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(coinMesh);
  var sparks = [], sparkMat = new THREE.SpriteMaterial({ map: radialTex, color: 0x7ab8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  for (var sp = 0; sp < 14; sp++) { var s = new THREE.Sprite(sparkMat.clone()); s.visible = false; s.userData.life = 0; scene.add(s); sparks.push(s); }
  function spark(x, y, z) {
    for (var i = 0; i < sparks.length; i++) if (sparks[i].userData.life <= 0) { var s = sparks[i]; s.position.set(x, y, z); s.userData.life = 1; s.visible = true; s.scale.set(0.6, 0.6, 1); return; }
  }
  function updateCoins(vz, game, t, dt, hide) {
    var n = 0, i, c, spin = t / 380;
    if (!hide) for (i = 0; i < game.coinList.length && n < NC; i++) {
      c = game.coinList[i];
      if (c.taken) { if (!c.fx) { c.fx = true; spark(c.lane * CFG.LANE_W, c.y, c.z); } continue; }
      if (c.z - vz > 120 || c.z - vz < -6) continue;
      dummy.position.set(c.lane * CFG.LANE_W, c.y + Math.sin(t / 260 + c.z) * 0.06, c.z); dummy.rotation.set(0, spin + c.z * 0.7, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      coinMesh.setMatrixAt(n++, dummy.matrix);
    }
    for (i = n; i < NC; i++) coinMesh.setMatrixAt(i, zeroM);
    coinMesh.instanceMatrix.needsUpdate = true;
    for (i = 0; i < sparks.length; i++) {
      var s = sparks[i]; if (s.userData.life <= 0) continue;
      s.userData.life -= dt * 3.2; if (s.userData.life <= 0) { s.visible = false; continue; }
      s.scale.setScalar(0.6 + (1 - s.userData.life) * 2.4); s.material.opacity = s.userData.life; s.position.y += dt * 1.5;
    }
  }

  // ------------------------------------------------------------------ the explorer (low-poly, built from capsules and boxes)
  var M = {
    jacket: lambert(0xd9b25f), jacketD: lambert(0xb8913f), pants: lambert(0x27405a), boot: lambert(0x3a2a1a), skin: lambert(0xc68a5a),
    hair: lambert(0x2a1c14), pack: lambert(0x2f6b4c), packD: lambert(0x22513a), scarf: lambert(0xf08a1f), scarfD: lambert(0xc46a0f),
    strap: lambert(0x4a3220), metal: new THREE.MeshStandardMaterial({ color: 0x9fb2bf, metalness: 0.6, roughness: 0.4 }), bedroll: lambert(0x8a5a2b),
    mint: new THREE.MeshBasicMaterial({ color: 0x7cf0cf, fog: false })
  };
  function caps(r, len, m) { return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), m); }
  function box(w, h, d, m, x, y, z) { var b = new THREE.Mesh(boxGeo, m); b.scale.set(w, h, d); b.position.set(x, y, z); return b; }

  var P = {};
  var player = new THREE.Group(), hip = new THREE.Group();
  (function () {
    hip.position.y = 0.95; player.add(hip);
    function leg(side) {
      var th = new THREE.Group(); th.position.set(side * 0.15, 0, 0);
      var up = caps(0.115, 0.26, M.pants); up.position.y = -0.24; th.add(up);
      var sh = new THREE.Group(); sh.position.y = -0.46; th.add(sh);
      var lo = caps(0.1, 0.26, M.pants); lo.position.y = -0.22; sh.add(lo);
      var boot = box(0.22, 0.17, 0.34, M.boot, 0, -0.43, 0.04); sh.add(boot);
      var cuff = box(0.2, 0.05, 0.2, M.strap, 0, -0.34, 0); sh.add(cuff);
      hip.add(th); return { th: th, sh: sh };
    }
    P.legL = leg(-1); P.legR = leg(1);
    var torso = caps(0.26, 0.34, M.jacket); torso.position.y = 0.42; torso.scale.set(1.05, 1, 0.78); hip.add(torso);
    hip.add(box(0.56, 0.07, 0.4, M.strap, 0, 0.14, 0));
    hip.add(box(0.07, 0.08, 0.02, M.metal, 0, 0.14, -0.21));
    // backpack (faces the camera) with the glowing EVO light
    var pack = box(0.5, 0.52, 0.26, M.pack, 0, 0.5, -0.32); hip.add(pack);
    hip.add(box(0.12, 0.34, 0.08, M.packD, -0.3, 0.44, -0.3), box(0.12, 0.34, 0.08, M.packD, 0.3, 0.44, -0.3));
    hip.add(box(0.07, 0.24, 0.02, M.mint, 0, 0.5, -0.46));
    var roll = new THREE.Mesh(cylGeo, M.bedroll); roll.scale.set(0.12, 0.62, 0.12); roll.rotation.z = Math.PI / 2; roll.position.set(0, 0.8, -0.32); hip.add(roll);
    // rope coil on the left hip
    var coil = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), lambert(0xd8c79a)); coil.position.set(-0.3, 0.16, -0.05); coil.rotation.y = Math.PI / 2; hip.add(coil);
    // head
    var head = new THREE.Group(); head.position.y = 0.88; hip.add(head); P.head = head;
    var skull = new THREE.Mesh(sphGeo, M.skin); skull.scale.set(0.2, 0.22, 0.21); head.add(skull);
    var hair = new THREE.Mesh(sphGeo, M.hair); hair.scale.set(0.225, 0.23, 0.225); hair.position.set(0, 0.025, -0.03); head.add(hair);
    head.add(box(0.46, 0.06, 0.4, lambert(0x1f4f46), 0, 0.03, 0));
    head.add(box(0.05, 0.06, 0.02, M.mint, 0, 0.03, -0.205));
    var neck = caps(0.07, 0.06, M.skin); neck.position.y = -0.2; head.add(neck);
    // scarf: wrap + two tails that flutter
    hip.add(box(0.46, 0.1, 0.38, M.scarf, 0, 0.74, 0));
    P.tailL = box(0.12, 0.34, 0.03, M.scarf, 0, 0, 0); P.tailR = box(0.12, 0.3, 0.03, M.scarfD, 0, 0, 0);
    P.tailLg = new THREE.Group(); P.tailLg.position.set(-0.14, 0.72, -0.2); P.tailL.position.y = -0.17; P.tailLg.add(P.tailL); hip.add(P.tailLg);
    P.tailRg = new THREE.Group(); P.tailRg.position.set(0.14, 0.72, -0.2); P.tailR.position.y = -0.15; P.tailRg.add(P.tailR); hip.add(P.tailRg);
    // arms
    function arm(side, gaunt) {
      var sh = new THREE.Group(); sh.position.set(side * 0.34, 0.66, 0);
      var up = caps(0.085, 0.2, M.jacketD); up.position.y = -0.17; sh.add(up);
      var el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
      var lo = caps(0.075, 0.2, M.jacket); lo.position.y = -0.17; el.add(lo);
      var hand = new THREE.Mesh(sphGeo, M.skin); hand.scale.setScalar(0.08); hand.position.y = -0.36; el.add(hand);
      var tip = new THREE.Object3D(); tip.position.y = -0.38; el.add(tip);
      if (gaunt) { el.add(box(0.14, 0.3, 0.14, M.metal, 0, -0.18, 0)); el.add(box(0.05, 0.1, 0.152, M.mint, 0, -0.14, 0)); }
      hip.add(sh); return { sh: sh, el: el, tip: tip };
    }
    P.armL = arm(-1, false); P.armR = arm(1, true);
  })();
  scene.add(player);
  var shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ map: radialTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  var rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffe86a, fog: false })); rope.visible = false; scene.add(rope);

  var lastPx = 0, lean = 0, crashAt = 0, _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
  function aimRope(a, b) {
    var d = _b.copy(b).sub(a), len = d.length() || 0.001;
    rope.position.copy(a).addScaledVector(d, 0.5); rope.scale.set(1, len, 1); rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / len));
  }

  function poseExplorer(game, t, vz, dt) {
    var menu = game.state === 'menu', over = game.state === 'over', playing = game.state === 'playing' || game.state === 'paused';
    var sl = game.slideT > 0 && game.onGround, hooked = !!game.hook, air = !game.onGround && !hooked;
    var ph = playing ? vz * 0.85 : (menu ? t / 115 : 0.6), running = (playing || menu) && game.onGround && !sl;
    var sA = Math.sin(ph), bob = running ? Math.abs(Math.cos(ph)) * 0.07 : 0;
    var lx = 0, lsx = 0, rx = 0, rsx = 0, alx = 0, aly = 0, arx = 0, ary = 0, elL = 0, elR = 0, tiltX = 0, hipDrop = 0, tiltZ = 0;

    if (running) {
      lx = sA * 0.95; rx = -sA * 0.95; lsx = Math.max(0, -sA) * 1.35 + 0.1; rsx = Math.max(0, sA) * 1.35 + 0.1;
      alx = -sA * 0.95; arx = sA * 0.95; elL = elR = -0.95; tiltX = 0.14;
    } else if (sl) {
      tiltX = -1.15; hipDrop = -0.3; lx = rx = -0.2; lsx = rsx = 0.2; alx = arx = -0.3; ary = 0.0; elL = elR = -0.4;
    } else if (hooked) {
      lx = 0.25; rx = 0.45; lsx = 0.5; rsx = 0.9; alx = -0.4; elL = -0.5; tiltX = 0.1;
    } else if (air && game.vy > 0.5) {
      lx = -1.15; lsx = 1.7; rx = -0.5; rsx = 0.9; alx = arx = -2.5; elL = elR = -0.35; tiltX = 0.05;
    } else if (air) {
      lx = -0.25; lsx = 0.3; rx = 0.25; rsx = 0.6; alx = arx = -0.4; aly = -0.9; ary = 0.9; tiltX = 0.2;
    } else { alx = arx = 0.05; elL = elR = -0.2; }

    var age = 0;
    if (over) {
      if (!crashAt) crashAt = t; age = (t - crashAt) / 1000;
      if (game.reason !== 'fell') { tiltX = Math.min(age * 5, 1.45); hipDrop = -0.5 * Math.min(age * 5, 1); }
      alx = arx = -2.2; elL = elR = -0.2;
    } else crashAt = 0;

    var dpx = game.px - lastPx; lastPx = game.px; var leanT = running ? clamp(dpx * 14, -0.3, 0.3) : 0; lean += (leanT - lean) * 0.3; tiltZ = -lean * 0.8;

    P.legL.th.rotation.x = lx; P.legL.sh.rotation.x = lsx; P.legR.th.rotation.x = rx; P.legR.sh.rotation.x = rsx;
    P.armL.sh.rotation.set(alx, 0, aly - 0.08); P.armL.el.rotation.x = elL; P.armR.sh.rotation.set(arx, 0, ary + 0.08); P.armR.el.rotation.x = elR;
    P.head.rotation.x = running ? -0.08 : 0;

    var wv = running ? Math.sin(t / 90) * 0.15 : Math.sin(t / 300) * 0.04;
    P.tailLg.rotation.x = 0.35 + (running ? 0.35 : 0.1) + wv; P.tailRg.rotation.x = 0.4 + (running ? 0.3 : 0.1) - wv; P.tailLg.rotation.z = lean * 0.6; P.tailRg.rotation.z = lean * 0.6;

    // rope hand: lift the right arm toward the anchor
    var rapeAnchor = null;
    hip.position.y = 0.95 + bob + hipDrop; hip.rotation.set(tiltX, 0, tiltZ);
    if (hooked) {
      var a = game.hook.anchor, ph2 = game.hook;
      if (ph2.kind === 'swing') hip.rotation.x = clamp(-Math.atan2(ph2.rz, -ph2.ry) * 0.7, -0.9, 0.9);
      rapeAnchor = _a.set(0, a.y, a.z);
    }
    player.position.set(game.px, game.y, vz); player.visible = !(game.state === 'playing' && game.invuln > 0 && Math.floor(t / 90) % 2);
    player.updateMatrixWorld(true);
    if (rapeAnchor) {
      var loc = hip.worldToLocal(rapeAnchor.clone()), sh = P.armR.sh.position, dir = loc.sub(sh).normalize();
      P.armR.sh.quaternion.setFromUnitVectors(DOWN, dir); P.armR.el.rotation.x = 0;
      player.updateMatrixWorld(true);
      P.armR.tip.getWorldPosition(_b); aimRope(_b, rapeAnchor); rope.visible = true;
      rope.material.color.set(game.hook.kind === 'swing' ? 0xffe86a : 0xffa33a);
    } else rope.visible = false;

    // blob shadow on whatever is below
    var floor = (game.y >= CFG.LEDGE_H - 0.2) ? CFG.LEDGE_H : 0, hgt = Math.max(0, game.y - floor), over0 = game.y > -0.3;
    shadow.visible = over0; shadow.position.set(game.px, floor + 0.03, vz); var ss = clamp(1 - hgt / 7, 0.3, 1); shadow.scale.set(ss, ss, 1);
    shadow.material.opacity = 0.55 * ss;
  }

  // ------------------------------------------------------------------ camera
  var camPos = new THREE.Vector3(0, 4.8, -7.5), camLook = new THREE.Vector3(0, 1.4, 8), baseFov = 62, W = 1, H = 1, camY = 4.8, camXs = 0, fovS = 62;
  function resize(w, h, dpr) {
    W = w; H = h;
    var pr = Math.min(dpr || 1, quality);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = camera.aspect < 0.9 ? 66 : camera.aspect < 1.4 ? 58 : 50;
    camera.fov = baseFov; camera.updateProjectionMatrix();
    var pitch = Math.atan2(5.3 - 1.5, 16.4), hf = 0.5 - Math.tan(pitch) / (2 * Math.tan(baseFov * Math.PI / 360));
    paintSky(clamp(hf, 0.08, 0.6));
    lastDpr = dpr || 1;
  }
  var quality = 2, lastDpr = 1, frameAcc = 0, frameN = 0, lastT = 0;

  function render(game, t, opts) {
    opts = opts || {};
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0.016; lastT = t;
    var menu = game.state === 'menu', vz = game.pz + (menu ? (opts.attract || 0) : 0);

    updateGround(vz, game, menu); updateScenery(vz); syncObstacles(vz, game, menu); updateCoins(vz, game, t, dt, menu);
    poseExplorer(game, t, vz, dt);

    // temple on the horizon: slowly closer as you run
    temple.position.set(0, 0, vz + Math.max(150, 280 - game.pz * 0.03)); temple.scale.setScalar(1);
    // anchors pulse
    obsMap.forEach(function (g, o) {
      var a = g.userData.anchor; if (!a) return;
      a.visible = !o.used || (game.hook && game.hook.o === o);          // a used vine / ring disappears once you let go
      var k = 0.8 + 0.4 * Math.sin(t / 150); a.userData.ring.material.emissiveIntensity = k; a.userData.glow.material.opacity = 0.55 + 0.35 * Math.sin(t / 150);
      a.userData.ring.rotation.y = t / 700;
    });
    // spores drift toward the player
    var i, pa = sporePos;
    for (i = 0; i < NS; i++) {
      var zz = (((sporeBase[i * 3 + 2] - vz * 0.8) % 120) + 120) % 120;
      pa[i * 3] = sporeBase[i * 3] + Math.sin(t / 1400 + i) * 0.6; pa[i * 3 + 1] = sporeBase[i * 3 + 1] + Math.sin(t / 1100 + i * 2) * 0.4; pa[i * 3 + 2] = vz - 10 + zz;
    }
    sporeGeo.attributes.position.needsUpdate = true;

    // lights follow the runner (no shadow maps: cheap)
    sun.position.set(vz * 0 - 8, 16, vz - 6); sun.target.position.set(0, 0, vz + 4); sun.target.updateMatrixWorld();

    // chase camera: lateral follow, rises with the runner, speed-based field of view, shake after a hit
    var py = clamp(game.y, -1, 4.5), want = game.hook ? 6.0 : 5.3 + Math.max(0, py) * 0.55;
    camY += (want - camY) * 0.1; camXs += (game.px * 0.62 - camXs) * 0.18;
    var fovT = baseFov + clamp((game.speed * game.slow - CFG.START_SPEED) * 0.35, -2, 7) + (game.hook ? 3 : 0);
    fovS += (fovT - fovS) * 0.08; if (Math.abs(camera.fov - fovS) > 0.01) { camera.fov = fovS; camera.updateProjectionMatrix(); }
    var sk = (opts.shake || 0) * 0.35;
    camera.position.set(camXs + (Math.random() - 0.5) * sk, camY + (Math.random() - 0.5) * sk, vz - 8.4 - (game.hook ? 1.5 : 0));
    camera.lookAt(camXs * 0.4, 1.5 + Math.max(0, py) * 0.5, vz + 8);

    renderer.render(scene, camera);

    // adaptive resolution: if the device cannot keep up, lower the pixel ratio a little
    frameAcc += dt; frameN++;
    if (frameN >= 90) {
      var avg = frameAcc / frameN; frameAcc = 0; frameN = 0;
      if (avg > 0.026 && quality > 1) { quality = Math.max(1, quality - 0.5); resize(W, H, lastDpr); }
    }
  }

  glCanvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); api.ready = false; });
  glCanvas.addEventListener('webglcontextrestored', function () { api.ready = true; resize(W, H, lastDpr); });

  var api = { ready: true, resize: resize, render: render, THREE: THREE, renderer: renderer, scene: scene, camera: camera };
  window.EvoLanes3D = api;
  window.dispatchEvent(new Event('evo3d-ready'));
})();

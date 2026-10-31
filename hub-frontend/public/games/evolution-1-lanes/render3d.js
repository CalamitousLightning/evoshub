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

  // ------------------------------------------------------------------ STAGES: jungle -> temple ruins (600 m) -> falling laboratory (1200 m), blended over 90 m
  var STAGE_T = 600, STAGE_L = 1200, STAGE_BLEND = 90;
  function stageW(z, o) {
    var t = clamp((z - (STAGE_T - STAGE_BLEND / 2)) / STAGE_BLEND, 0, 1), l = clamp((z - (STAGE_L - STAGE_BLEND / 2)) / STAGE_BLEND, 0, 1);
    o.j = 1 - t; o.t = t - l; o.l = l; return o;
  }
  var curW = { j: 1, t: 0, l: 0 }, tmpW = { j: 1, t: 0, l: 0 }, swO = { j: 1, t: 0, l: 0 }, sceneTime = 0;
  var THEMES = {
    j: { hor: col(0x8fcaa9), top: col(0x08222f), mid: col(0x1f6670), hs: col(0xdff5e6), hg: col(0x4a5a3a), sun: col(0xfff0cc), tA: col(0xffffff), tB: col(0xd9c8aa), ray: col(0xfff0b0), fogN: 38, fogF: 138, hi: 1.15, si: 1.6 },
    t: { hor: col(0xf0b07a), top: col(0x2a1b3d), mid: col(0xb8605a), hs: col(0xffe1b8), hg: col(0x6a4a30), sun: col(0xffc27a), tA: col(0xf3e0c2), tB: col(0xd2b48c), ray: col(0xffd08a), fogN: 34, fogF: 124, hi: 1.1, si: 1.7 },
    l: { hor: col(0xa6d8ee), top: col(0x050b18), mid: col(0x1b4f80), hs: col(0xbfe6ff), hg: col(0x2a3a4a), sun: col(0xcfe8ff), tA: col(0xd4e4f0), tB: col(0x9db4c8), ray: col(0x9fe8ff), fogN: 30, fogF: 108, hi: 1.2, si: 1.5 }
  };
  var theme = { hor: col(0), top: col(0), mid: col(0), hs: col(0), hg: col(0), sun: col(0), tA: col(0), tB: col(0), ray: col(0), fogN: 38, fogF: 138, hi: 1.15, si: 1.6 };
  var CK = ['hor', 'top', 'mid', 'hs', 'hg', 'sun', 'tA', 'tB', 'ray'], NK = ['fogN', 'fogF', 'hi', 'si'], tmpC = col(0);
  function blendTheme(out, w) {
    var i, k, a = THEMES.j, b = THEMES.t, c = THEMES.l;
    for (i = 0; i < CK.length; i++) { k = CK[i]; out[k].setRGB(a[k].r * w.j + b[k].r * w.t + c[k].r * w.l, a[k].g * w.j + b[k].g * w.t + c[k].g * w.l, a[k].b * w.j + b[k].b * w.t + c[k].b * w.l); }
    for (i = 0; i < NK.length; i++) { k = NK[i]; out[k] = a[k] * w.j + b[k] * w.t + c[k] * w.l; }
  }
  blendTheme(theme, curW);
  function tileColor(out, zc, odd) {
    var w = stageW(zc, tmpW), k = odd ? 'tB' : 'tA', a = THEMES.j[k], b = THEMES.t[k], c = THEMES.l[k];
    out.setRGB(a.r * w.j + b.r * w.t + c.r * w.l, a.g * w.j + b.g * w.t + c.g * w.l, a.b * w.j + b.b * w.t + c.b * w.l);
  }

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
  var sandTex = canvasTex(64, 64, function (g, w, h) {              // temple stage: sun-baked sand and chips of stone
    g.fillStyle = '#c9a56e'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 110; i++) { g.fillStyle = 'rgba(' + (120 + (i * 29) % 70) + ',' + (90 + (i * 41) % 50) + ',' + (50 + (i * 17) % 30) + ',.35)'; g.fillRect((i * 53) % w, (i * 31) % h, 2 + i % 3, 2 + i % 2); }
  });
  var metalTex = canvasTex(64, 64, function (g, w, h) {             // lab stage: dark plating with seams and rivets
    g.fillStyle = '#31465a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(10,20,30,.7)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.fillStyle = 'rgba(160,220,255,.45)'; for (var i = 0; i < 8; i++) g.fillRect(6 + (i % 4) * 16, 6 + Math.floor(i / 4) * 40, 2, 2);
  });
  sandTex.wrapS = sandTex.wrapT = metalTex.wrapS = metalTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(SIDE_W / 4, 18); metalTex.repeat.set(SIDE_W / 4, 18);
  var flagTex = canvasTex(128, 128, function (g, w, h) {            // temple stage path: worn flagstones
    g.fillStyle = '#b79b72'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,60,36,.75)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w * 0.33, 0); g.lineTo(w * 0.33, h / 2); g.moveTo(w * 0.7, h / 2); g.lineTo(w * 0.7, h); g.stroke();
    for (var i = 0; i < 90; i++) { g.fillStyle = 'rgba(90,64,36,' + (0.05 + (i % 4) * 0.03) + ')'; g.fillRect((i * 97) % w, (i * 61) % h, 2 + i % 4, 2 + i % 3); }
    g.fillStyle = 'rgba(70,46,22,.55)'; var a1 = w * (0.5 - (CFG.LANE_W / 2) / PATH_W), a2 = w * (0.5 + (CFG.LANE_W / 2) / PATH_W);
    g.fillRect(a1 - 1.5, h * 0.12, 3, h * 0.62); g.fillRect(a2 - 1.5, h * 0.12, 3, h * 0.62);
  });
  var plateTex = canvasTex(128, 128, function (g, w, h) {           // lab stage path: metal plates with glowing lane lines
    g.fillStyle = '#42607a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(12,24,36,.85)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = 'rgba(190,235,255,.5)'; [[8, 8], [w - 10, 8], [8, h - 10], [w - 10, h - 10], [8, h / 2 + 6], [w - 10, h / 2 + 6]].forEach(function (p) { g.fillRect(p[0], p[1], 3, 3); });
    g.fillStyle = 'rgba(120,240,255,.85)'; var b1 = w * (0.5 - (CFG.LANE_W / 2) / PATH_W), b2 = w * (0.5 + (CFG.LANE_W / 2) / PATH_W);
    g.fillRect(b1 - 1.5, h * 0.12, 3, h * 0.62); g.fillRect(b2 - 1.5, h * 0.12, 3, h * 0.62);
  });
  flagTex.anisotropy = plateTex.anisotropy = 4;

  // ------------------------------------------------------------------ sky + distant temple
  var skyTex = new THREE.CanvasTexture(document.createElement('canvas'));
  var skyHf = 0.4;
  function paintSky(horizonFrac) {
    skyHf = horizonFrac;
    var c = skyTex.image; c.width = 4; c.height = 256; var g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 256), hh = '#' + theme.hor.getHexString();
    gr.addColorStop(0, '#' + theme.top.getHexString()); gr.addColorStop(Math.max(0.05, horizonFrac * 0.6), '#' + theme.mid.getHexString()); gr.addColorStop(Math.min(0.95, horizonFrac), hh); gr.addColorStop(1, hh);
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
  var tileA = col(0xffffff), tileB = col(0xd9c8aa), sideTexs = [grassTex, sandTex, metalTex], pathTexs = [pathTex, flagTex, plateTex], texIdx = 0, themeKey = -1;
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

  // --- forest extras: slim palms, glowing flowers, falling leaves, light rays (all cheap; the soft effects switch off on slow phones)
  var NP = 40;
  var palmTrunks = new THREE.InstancedMesh(trunkGeo, lambert(0x84603a), NP);
  var palmCrowns = new THREE.InstancedMesh(canopyGeo, lambert(0x3fbf5a, { flatShading: true }), NP * 2);
  var FL_N = 24, flowerGeo = new THREE.IcosahedronGeometry(0.2, 0);
  var flowerSets = [0x5ff5ff, 0xff7ad9, 0xffc45a].map(function (c) { return new THREE.InstancedMesh(flowerGeo, new THREE.MeshBasicMaterial({ color: c }), FL_N); });
  [palmTrunks, palmCrowns].concat(flowerSets).forEach(function (m) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });

  var leafTex = canvasTex(32, 32, function (g, w, h) {
    g.translate(w / 2, h / 2); g.rotate(-0.6); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(-12, 0); g.quadraticCurveTo(0, -11, 12, 0); g.quadraticCurveTo(0, 11, -12, 0); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-11, 0); g.lineTo(11, 0); g.stroke();
  });
  var NLF = 70, leafBase = new Float32Array(NLF * 3), leafPos = new Float32Array(NLF * 3), leafCol = new Float32Array(NLF * 3), leafPal = [col(0x7dd65a), col(0xc7e35a), col(0xf0b43c), col(0x4fb868)];
  for (var li = 0; li < NLF; li++) {
    leafBase[li * 3] = (hash(li * 2.3) - 0.5) * 22; leafBase[li * 3 + 1] = hash(li * 4.1) * 14; leafBase[li * 3 + 2] = hash(li * 6.7) * 60;
    var lc = leafPal[li % 4]; leafCol[li * 3] = lc.r; leafCol[li * 3 + 1] = lc.g; leafCol[li * 3 + 2] = lc.b;
  }
  var leafGeo = new THREE.BufferGeometry(); leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPos, 3)); leafGeo.setAttribute('color', new THREE.BufferAttribute(leafCol, 3));
  var leaves = new THREE.Points(leafGeo, new THREE.PointsMaterial({ map: leafTex, vertexColors: true, size: 0.55, transparent: true, opacity: 0.9, alphaTest: 0.05, depthWrite: false, sizeAttenuation: true }));
  leaves.frustumCulled = false; scene.add(leaves);

  var rayTex = canvasTex(32, 128, function (g, w, h) {
    var gv = g.createLinearGradient(0, 0, 0, h); gv.addColorStop(0, 'rgba(255,255,255,.9)'); gv.addColorStop(0.6, 'rgba(255,255,255,.35)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gv; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in'; var gh = g.createLinearGradient(0, 0, w, 0); gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gh; g.fillRect(0, 0, w, h);
  });
  var NRAY = 6, rays = [];
  for (var ri = 0; ri < NRAY; ri++) {
    var rm = new THREE.Mesh(new THREE.PlaneGeometry(2.4 + hash(ri) * 2, 24), new THREE.MeshBasicMaterial({ map: rayTex, color: 0xfff0b0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    rm.frustumCulled = false; rm.userData.i = ri; scene.add(rm); rays.push(rm);
  }

  // spores floating in the air (mysterious jungle)
  var NS = 140, sporeBase = new Float32Array(NS * 3), sporePos = new Float32Array(NS * 3);
  for (var si = 0; si < NS; si++) { sporeBase[si * 3] = (hash(si * 3.1) - 0.5) * 30; sporeBase[si * 3 + 1] = 0.5 + hash(si * 5.7) * 9; sporeBase[si * 3 + 2] = hash(si * 7.3) * 120; }
  var sporeGeo = new THREE.BufferGeometry(); sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  var spores = new THREE.Points(sporeGeo, new THREE.PointsMaterial({ map: radialTex, color: 0xbfffe6, size: 0.55, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  spores.frustumCulled = false; scene.add(spores);

  // --- temple stage (600 m+): broken pillars, rubble, braziers. lab stage (1200 m+): glowing tubes and tilted floating panels
  var NPIL = 30, NRU = 40, NBR = 14, NTU = 30, NPN = 36;
  var pillarGeo = new THREE.CylinderGeometry(0.75, 0.9, 1, 8); pillarGeo.translate(0, 0.5, 0);
  var postGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6); postGeo.translate(0, 0.5, 0);
  var tubeGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 8); tubeGeo.translate(0, 0.5, 0);
  var pillars = new THREE.InstancedMesh(pillarGeo, lambert(0xc9b28a, { flatShading: true }), NPIL);
  var pillarCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(0xb59c72, { flatShading: true }), NPIL);
  var rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(0xb09a74, { flatShading: true }), NRU);
  var brazierPosts = new THREE.InstancedMesh(postGeo, lambert(0x6a5a48), NBR);
  var brazierFires = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xff9a2a }), NBR);
  var labTubes = new THREE.InstancedMesh(tubeGeo, new THREE.MeshBasicMaterial({ color: 0x6fe8ff }), NTU);
  var labPanels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(0x6b8398, { flatShading: true }), NPN);
  var stageSets = [pillars, pillarCaps, rubble, brazierPosts, brazierFires, labTubes, labPanels];
  stageSets.forEach(function (m) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.visible = false; scene.add(m); });

  // drifting particles: warm embers rising (temple), cyan-grey debris falling (lab)
  function makeDrift(n, size, colors, tex, additive, seed) {
    var base = new Float32Array(n * 3), pos = new Float32Array(n * 3), cl = new Float32Array(n * 3), i, c, geo = new THREE.BufferGeometry();
    for (i = 0; i < n; i++) {
      base[i * 3] = (hash(i * 2.9 + seed) - 0.5) * 22; base[i * 3 + 1] = hash(i * 4.7 + seed) * 14; base[i * 3 + 2] = hash(i * 6.1 + seed) * 60;
      c = colors[i % colors.length]; cl[i * 3] = c.r; cl[i * 3 + 1] = c.g; cl[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex || null, vertexColors: true, size: size, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    pts.frustumCulled = false; pts.visible = false; scene.add(pts);
    return { pts: pts, geo: geo, base: base, pos: pos, n: n };
  }
  var embers = makeDrift(60, 0.28, [col(0xffb04a), col(0xff8a2a), col(0xffd27a)], radialTex, true, 5.5);
  var debris = makeDrift(70, 0.3, [col(0x9fe8ff), col(0x7a94a8), col(0xd4e4f0), col(0x5a7088)], null, false, 9.1);
  function driftUpdate(d, vz, ts, speed, sway) {
    var i, p = d.pos, b = d.base, n = d.n;
    for (i = 0; i < n; i++) {
      p[i * 3] = b[i * 3] + Math.sin(ts * 1.1 + i) * sway;
      p[i * 3 + 1] = (((b[i * 3 + 1] - ts * speed * (0.7 + (i % 5) * 0.12)) % 14) + 14) % 14 + 0.3;
      p[i * 3 + 2] = vz - 6 + (((b[i * 3 + 2] - vz * 0.8) % 60) + 60) % 60;
    }
    d.geo.attributes.position.needsUpdate = true;
  }

  // blends sky, fog, light, ground textures and tint by distance (called every frame; the sky is only repainted while a blend is moving)
  function applyTheme(vz) {
    var w = stageW(vz + 30, curW);
    blendTheme(theme, w);
    scene.fog.color.copy(theme.hor); scene.fog.near = theme.fogN; scene.fog.far = theme.fogF;
    hemi.color.copy(theme.hs); hemi.groundColor.copy(theme.hg); hemi.intensity = theme.hi; sun.color.copy(theme.sun); sun.intensity = theme.si;
    var key = Math.round(w.t * 24) * 100 + Math.round(w.l * 24) + (w.j < 1 ? 7 : 0);
    if (key !== themeKey) { themeKey = key; paintSky(skyHf); }
    var p = (1 - w.j) + w.l, idx = Math.round(p), dist = Math.abs(p - idx), bright = 1 - 0.6 * (dist * 2);     // darkest at the middle of a blend, where the ground texture swaps (reads as passing through a gate)
    if (idx !== texIdx) { texIdx = idx; sideMat.map = sideTexs[idx]; tileMats[2].map = pathTexs[idx]; sideMat.needsUpdate = true; tileMats[2].needsUpdate = true; }
    sideMat.color.setScalar(bright); tileMats[2].color.setScalar(bright);
  }

  // ------------------------------------------------------------------ FORKS: the track splits into three separate pathways (one per lane), each with its own look.
  // The look shows the path's THEME (vine / temple / river), never its kind: which one is safe is for the Voice's riddle to tell.
  var FK = { vine: { lint: col(0x3f7a2c), glow: col(0x8dff6a) }, temple: { lint: col(0xc9a56e), glow: col(0xffc45a) }, river: { lint: col(0x4a8fb0), glow: col(0x7fe8ff) } };
  var FK_POST_N = 90, FK_LINT_N = 70, FK_GLOW_N = 70, FK_VINE_N = 180, FK_WALL_N = 10, FK_FLOOR_N = 6, FK_SIGN_N = 6;
  function topGeo(g, y) { g.translate(0, y, 0); return g; }
  var fkPosts = new THREE.InstancedMesh(topGeo(new THREE.BoxGeometry(0.5, 1, 0.5), 0.5), lambert(0x6a6450, { flatShading: true }), FK_POST_N);
  var fkLint = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff, { flatShading: true }), FK_LINT_N);
  var fkGlow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), FK_GLOW_N);
  var fkVines = new THREE.InstancedMesh(topGeo(new THREE.CylinderGeometry(0.04, 0.04, 1, 5), -0.5), lambert(0x4fae48), FK_VINE_N);
  var fkWalls = new THREE.InstancedMesh(topGeo(new THREE.BoxGeometry(1, 1, 1), 0.5), lambert(0x4e5a44, { flatShading: true }), FK_WALL_N);
  var floorTex = {
    vine: canvasTex(64, 64, function (g, w, h) {
      g.fillStyle = '#3f7a35'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) { g.fillStyle = 'rgba(' + (30 + (i * 13) % 40) + ',' + (110 + (i * 29) % 70) + ',' + (40 + (i * 7) % 30) + ',.55)'; g.fillRect((i * 47) % w, (i * 31) % h, 2 + i % 4, 3 + i % 3); }
      g.strokeStyle = 'rgba(20,60,20,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.25, 0); g.quadraticCurveTo(w * 0.4, h / 2, w * 0.2, h); g.moveTo(w * 0.75, 0); g.quadraticCurveTo(w * 0.6, h / 2, w * 0.8, h); g.stroke();
    }),
    temple: canvasTex(64, 64, function (g, w, h) {
      g.fillStyle = '#c9a56e'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,64,30,.7)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.fillStyle = 'rgba(255,200,90,.55)'; g.fillRect(w / 2 - 2, 4, 4, h - 8);
    }),
    river: canvasTex(64, 64, function (g, w, h) {
      g.fillStyle = '#2f78a8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190,240,255,.6)'; g.lineWidth = 2;
      for (var r = 0; r < 4; r++) { g.beginPath(); g.moveTo(0, r * 16 + 6); g.quadraticCurveTo(w * 0.25, r * 16, w * 0.5, r * 16 + 6); g.quadraticCurveTo(w * 0.75, r * 16 + 12, w, r * 16 + 6); g.stroke(); }
    })
  };
  var fkFloors = {};
  ['vine', 'temple', 'river'].forEach(function (id) {
    var t = floorTex[id]; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 26);
    var pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    fkFloors[id] = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ map: t, emissive: id === 'river' ? 0x103a58 : 0x18200f }), FK_FLOOR_N);
  });
  var fkAll = [fkPosts, fkLint, fkGlow, fkVines, fkWalls, fkFloors.vine, fkFloors.temple, fkFloors.river];
  fkAll.forEach(function (m) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.visible = false; scene.add(m); });
  var signMats = {}, fkSigns = [];
  function signMat(name, id) {
    if (!signMats[name]) {
      var tx = canvasTex(256, 64, function (g, w, h) {
        g.fillStyle = 'rgba(8,16,12,.88)'; g.fillRect(0, 0, w, h); g.strokeStyle = '#' + FK[id].glow.getHexString(); g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
        g.fillStyle = '#ffffff'; g.font = '800 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, h / 2 + 1);
      });
      signMats[name] = new THREE.MeshBasicMaterial({ map: tx, transparent: true });
    }
    return signMats[name];
  }
  for (var si = 0; si < FK_SIGN_N; si++) { var sm = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.52), signMats.x || (signMats.x = new THREE.MeshBasicMaterial({ color: 0x000000 }))); sm.rotation.y = Math.PI; sm.visible = false; sm.frustumCulled = false; scene.add(sm); fkSigns.push(sm); }

  function updateForks(game, vz) {
    var LW = CFG.LANE_W, bx = [-1.5 * LW, -0.5 * LW, 0.5 * LW, 1.5 * LW], i, j, q, f, r, th, n = { po: 0, li: 0, gl: 0, vi: 0, wa: 0, fl: { vine: 0, temple: 0, river: 0 }, sg: 0 };
    var fs = game.forks || [], len, zf, lx, hh;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.end < vz - 25 || f.z > vz + 135 || !f.routes) continue;
      len = f.end - f.z;
      // gate: four posts, a lintel and a glow bar over every lane, and the name sign
      for (j = 0; j < 4 && n.po < FK_POST_N; j++) { dummy.rotation.set(0, 0, 0); dummy.scale.set(1.2, 4.4, 1.2); dummy.position.set(bx[j], 0, f.z); dummy.updateMatrix(); fkPosts.setMatrixAt(n.po++, dummy.matrix); }
      for (j = 0; j < f.routes.length; j++) {
        r = f.routes[j]; th = FK[r.id]; lx = r.lane * LW;
        if (n.li < FK_LINT_N) { dummy.rotation.set(0, 0, 0); dummy.scale.set(LW, 0.55, 0.8); dummy.position.set(lx, 4.4 + 0.27, f.z); dummy.updateMatrix(); fkLint.setMatrixAt(n.li, dummy.matrix); fkLint.setColorAt(n.li++, th.lint); }
        if (n.gl < FK_GLOW_N) { dummy.scale.set(LW * 0.82, 0.16, 0.14); dummy.position.set(lx, 4.2, f.z); dummy.updateMatrix(); fkGlow.setMatrixAt(n.gl, dummy.matrix); fkGlow.setColorAt(n.gl++, th.glow); }
        if (n.fl[r.id] < FK_FLOOR_N) { dummy.rotation.set(0, 0, 0); dummy.scale.set(LW * 0.8, 1, len); dummy.position.set(lx, 0.025, f.z + len / 2); dummy.updateMatrix(); fkFloors[r.id].setMatrixAt(n.fl[r.id]++, dummy.matrix); }
        if (n.sg < FK_SIGN_N) { var sg = fkSigns[n.sg++]; sg.material = signMat(r.name, r.id); sg.position.set(lx, 5.45, f.z); sg.visible = true; }
        // rib arches along the path, 13 m apart; vine paths also get hanging vines
        for (zf = f.z + 13; zf < f.end; zf += 13) {
          if (n.li < FK_LINT_N) { dummy.rotation.set(0, 0, 0); dummy.scale.set(LW, 0.4, 0.5); dummy.position.set(lx, 3.5 + 0.2, zf); dummy.updateMatrix(); fkLint.setMatrixAt(n.li, dummy.matrix); fkLint.setColorAt(n.li++, th.lint); }
          if (n.gl < FK_GLOW_N) { dummy.scale.set(LW * 0.8, 0.1, 0.1); dummy.position.set(lx, 3.4, zf); dummy.updateMatrix(); fkGlow.setMatrixAt(n.gl, dummy.matrix); fkGlow.setColorAt(n.gl++, th.glow); }
          if (r.id === 'vine') for (q = -1; q <= 1 && n.vi < FK_VINE_N; q++) { hh = 1.0 + hash(zf * 1.3 + q + lx) * 1.5; dummy.rotation.set(0, 0, 0); dummy.scale.set(1, hh, 1); dummy.position.set(lx + q * 0.6, 3.5, zf + 0.1); dummy.updateMatrix(); fkVines.setMatrixAt(n.vi++, dummy.matrix); }
        }
      }
      for (zf = f.z + 13; zf < f.end; zf += 13) for (j = 0; j < 4 && n.po < FK_POST_N; j++) { dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 3.5, 1); dummy.position.set(bx[j], 0, zf); dummy.updateMatrix(); fkPosts.setMatrixAt(n.po++, dummy.matrix); }
      // dividers that keep the three lanes apart, from just before the gate to just past the end
      for (j = 0; j < 4 && n.wa < FK_WALL_N; j++) { dummy.rotation.set(0, 0, 0); dummy.scale.set(0.42, 1.1, len + 6); dummy.position.set(bx[j], 0, f.z - 3 + (len + 6) / 2); dummy.updateMatrix(); fkWalls.setMatrixAt(n.wa++, dummy.matrix); }
    }
    for (q = n.po; q < FK_POST_N; q++) fkPosts.setMatrixAt(q, zeroM);
    for (q = n.li; q < FK_LINT_N; q++) fkLint.setMatrixAt(q, zeroM);
    for (q = n.gl; q < FK_GLOW_N; q++) fkGlow.setMatrixAt(q, zeroM);
    for (q = n.vi; q < FK_VINE_N; q++) fkVines.setMatrixAt(q, zeroM);
    for (q = n.wa; q < FK_WALL_N; q++) fkWalls.setMatrixAt(q, zeroM);
    ['vine', 'temple', 'river'].forEach(function (id) { for (var z2 = n.fl[id]; z2 < FK_FLOOR_N; z2++) fkFloors[id].setMatrixAt(z2, zeroM); fkFloors[id].visible = n.fl[id] > 0; fkFloors[id].instanceMatrix.needsUpdate = true; });
    for (q = n.sg; q < FK_SIGN_N; q++) fkSigns[q].visible = false;
    fkPosts.visible = n.po > 0; fkLint.visible = n.li > 0; fkGlow.visible = n.gl > 0; fkVines.visible = n.vi > 0; fkWalls.visible = n.wa > 0;
    [fkPosts, fkLint, fkGlow, fkVines, fkWalls].forEach(function (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    floorTex.river.offset.y = -((sceneTime * 0.7) % 1);
  }

  function updateScenery(vz) {
    var k0 = Math.floor((vz - 14) / 4.5), k, sd, ti = 0, bi = 0, fi = 0, ci = 0, pi = 0, pc = 0, fc = [0, 0, 0], pl = 0, pcap = 0, ru = 0, br = 0, tu = 0, pn = 0;
    for (k = k0; k * 4.5 - vz < 135 && ti < NT; k++) {
      var z = k * 4.5 + 0.9; stageW(z, swO);
      for (sd = -1; sd <= 1; sd += 2) {
        var hs = hash(k * 2 + (sd > 0 ? 1 : 0));
        if (hs < 0.2 || ti >= NT || hash(k * 1.3 + sd * 3.1) > swO.j) continue;
        var th = 8 + hs * 9, x = sd * (5.6 + hs * 11), rr = 3.2 + hs * 2.4, zz = z + hs * 2, h2 = hash(k + sd * 7.7);
        dummy.rotation.set(0, h2 * 6, 0); dummy.scale.set(0.5 + hs * 0.4, th, 0.5 + hs * 0.4); dummy.position.set(x, 0, zz); dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
        dummy.rotation.set(h2, h2 * 5, 0); dummy.scale.set(rr, rr * 0.85, rr); dummy.position.set(x, th + 0.5, zz); dummy.updateMatrix(); canopyA.setMatrixAt(ci, dummy.matrix);
        dummy.scale.set(rr * 0.75, rr * 0.7, rr * 0.75); dummy.position.set(x + sd * -1.1, th + rr * 0.55, zz + 0.8); dummy.updateMatrix(); canopyB.setMatrixAt(ci, dummy.matrix); ci++;
        dummy.scale.set(rr * 0.7, rr * 0.6, rr * 0.7); dummy.position.set(x + sd * 1.6, th - 0.8, zz - 0.8); dummy.updateMatrix(); canopyA.setMatrixAt(ci, dummy.matrix);
        dummy.scale.set(rr * 0.5, rr * 0.45, rr * 0.5); dummy.position.set(x + sd * 0.9, th + rr * 0.9, zz - 0.3); dummy.updateMatrix(); canopyB.setMatrixAt(ci, dummy.matrix); ci++;
        ti++;
      }
      var hp = hash(k * 3.7 + 11);
      if (hp > 0.55 && pi < NP && hash(k * 2.1 + 4) <= swO.j) {
        var ps = hp > 0.78 ? 1 : -1, ph = 11 + hp * 7, px0 = ps * (6.4 + hash(k * 1.9) * 8), pz0 = z + 2.2;
        dummy.rotation.set(0, hp * 8, ps * 0.07); dummy.scale.set(0.3, ph, 0.3); dummy.position.set(px0, 0, pz0); dummy.updateMatrix(); palmTrunks.setMatrixAt(pi, dummy.matrix);
        dummy.rotation.set(0, hp * 5, ps * 0.12); dummy.scale.set(3.1, 0.5, 3.1); dummy.position.set(px0 - ps * 0.5, ph + 0.2, pz0); dummy.updateMatrix(); palmCrowns.setMatrixAt(pc++, dummy.matrix);
        dummy.rotation.set(0, hp * 5 + 0.8, -ps * 0.1); dummy.scale.set(2.6, 0.42, 2.6); dummy.position.set(px0 - ps * 0.3, ph + 0.7, pz0); dummy.updateMatrix(); palmCrowns.setMatrixAt(pc++, dummy.matrix);
        pi++;
      }
      var hfl = hash(k * 6.1 + 5);
      if (hfl > 0.35 && hash(k * 3.3 + 1) <= swO.j) {
        var fg = Math.floor(hash(k * 8.3) * 3), fsd = hfl > 0.68 ? 1 : -1;
        if (fc[fg] < FL_N) { dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(fsd * (4.15 + hash(k * 2.7) * 1.4), 0.3 + hash(k) * 0.15, z + 1); dummy.updateMatrix(); flowerSets[fg].setMatrixAt(fc[fg]++, dummy.matrix); }
      }
      var hb = hash(k * 5.3);
      if (hb > 0.3 && bi < NB && hash(k * 4.9 + 2) <= swO.j) {
        var bs = (hb > 0.7 ? 1 : -1), bw = 0.9 + hb * 1.2;
        dummy.rotation.set(0, hb * 9, 0); dummy.scale.set(bw, bw * 0.6, bw); dummy.position.set(bs * (4.5 + hb * 3), bw * 0.25, z + 1.4); dummy.updateMatrix(); bushes.setMatrixAt(bi++, dummy.matrix);
      }
      var hf = hash(k * 9.1 + 2);
      if (hf > 0.25 && fi < NF && hash(k * 5.9 + 3) <= swO.j) {
        var fs = (hf > 0.62 ? 1 : -1);
        dummy.rotation.set(0, hf * 7, 0); dummy.scale.set(1, 0.8 + hf, 1); dummy.position.set(fs * (4.3 + hf * 2.5), 0.5, z + 3); dummy.updateMatrix(); ferns.setMatrixAt(fi++, dummy.matrix);
      }
      if (swO.t > 0.02) {                                           // temple ruins
        var h1 = hash(k * 7.9 + 21), h2b = hash(k * 3.1 + 8), sdT = h1 > 0.5 ? 1 : -1;
        if (h1 > 0.3 && hash(k * 5.5 + 2) <= swO.t && pl < NPIL) {
          var phh = 3.5 + h2b * 6, broken = h2b > 0.72, px = sdT * (5.4 + hash(k * 1.7) * 6.5), pzz = z + 1.5;
          if (broken) phh *= 0.45;
          dummy.rotation.set(0, h1 * 6, broken ? (h2b - 0.8) * 0.4 : 0); dummy.scale.set(1, phh, 1); dummy.position.set(px, 0, pzz); dummy.updateMatrix(); pillars.setMatrixAt(pl++, dummy.matrix);
          if (!broken) { dummy.rotation.set(0, h1 * 6, 0); dummy.scale.set(2.1, 0.42, 2.1); dummy.position.set(px, phh + 0.2, pzz); dummy.updateMatrix(); pillarCaps.setMatrixAt(pcap++, dummy.matrix); }
        }
        if (hash(k * 2.7 + 13) > 0.45 && hash(k * 6.3) <= swO.t && ru < NRU) {
          var rs2 = hash(k * 9.7) > 0.5 ? 1 : -1, ra = 0.8 + hash(k * 1.1) * 1.0, rb = 0.4 + hash(k * 2.3) * 0.6;
          dummy.rotation.set(hash(k) * 0.4, hash(k * 3) * 6, hash(k * 5) * 0.3); dummy.scale.set(ra, rb, ra * 0.8); dummy.position.set(rs2 * (4.4 + hash(k * 4.1) * 3.5), rb * 0.4, z + 0.5); dummy.updateMatrix(); rubble.setMatrixAt(ru++, dummy.matrix);
        }
        if (k % 6 === 0 && hash(k * 1.9) <= swO.t && br < NBR) {
          var bx = (k % 12 === 0 ? 1 : -1) * 4.0;
          dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1.1, 1); dummy.position.set(bx, 0, z); dummy.updateMatrix(); brazierPosts.setMatrixAt(br, dummy.matrix);
          dummy.scale.set(0.3, 0.34 + 0.08 * Math.sin(sceneTime * 9 + k), 0.3); dummy.position.set(bx, 1.35, z); dummy.updateMatrix(); brazierFires.setMatrixAt(br++, dummy.matrix);
        }
      }
      if (swO.l > 0.02) {                                           // falling laboratory
        var l1 = hash(k * 8.3 + 31), l2 = hash(k * 2.9 + 17), sdL = l1 > 0.5 ? 1 : -1;
        if (l1 > 0.28 && hash(k * 5.1 + 6) <= swO.l && tu < NTU) {
          dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 6 + l2 * 11, 1); dummy.position.set(sdL * (5.2 + hash(k * 2.2) * 7), 0, z + 1); dummy.updateMatrix(); labTubes.setMatrixAt(tu++, dummy.matrix);
        }
        if (l2 > 0.3 && hash(k * 7.3 + 3) <= swO.l && pn < NPN) {
          dummy.rotation.set(Math.sin(sceneTime * 0.6 + k) * 0.35 + l1, l2 * 6, Math.cos(sceneTime * 0.5 + k * 1.7) * 0.4);
          dummy.scale.set(2 + l1 * 1.6, 0.18, 1.5 + l2 * 1.2); dummy.position.set(sdL * (6 + hash(k * 3.9) * 8), 3.5 + hash(k * 6.1) * 8 + Math.sin(sceneTime * 0.7 + k) * 0.5, z + 2); dummy.updateMatrix(); labPanels.setMatrixAt(pn++, dummy.matrix);
        }
      }
    }
    for (var q = ru; q < NRU; q++) rubble.setMatrixAt(q, zeroM);
    for (q = pl; q < NPIL; q++) pillars.setMatrixAt(q, zeroM);
    for (q = pcap; q < NPIL; q++) pillarCaps.setMatrixAt(q, zeroM);
    for (q = br; q < NBR; q++) { brazierPosts.setMatrixAt(q, zeroM); brazierFires.setMatrixAt(q, zeroM); }
    for (q = tu; q < NTU; q++) labTubes.setMatrixAt(q, zeroM);
    for (q = pn; q < NPN; q++) labPanels.setMatrixAt(q, zeroM);
    pillars.visible = pillarCaps.visible = pl > 0; rubble.visible = ru > 0; brazierPosts.visible = brazierFires.visible = br > 0; labTubes.visible = tu > 0; labPanels.visible = pn > 0;
    stageSets.forEach(function (m) { m.instanceMatrix.needsUpdate = true; });
    for (var q0 = ti; q0 < NT; q0++) trunks.setMatrixAt(q0, zeroM);
    for (q = ci; q < NT * 2; q++) { canopyA.setMatrixAt(q, zeroM); canopyB.setMatrixAt(q, zeroM); }
    for (q = bi; q < NB; q++) bushes.setMatrixAt(q, zeroM);
    for (q = fi; q < NF; q++) ferns.setMatrixAt(q, zeroM);
    for (q = pi; q < NP; q++) palmTrunks.setMatrixAt(q, zeroM);
    for (q = pc; q < NP * 2; q++) palmCrowns.setMatrixAt(q, zeroM);
    palmTrunks.instanceMatrix.needsUpdate = palmCrowns.instanceMatrix.needsUpdate = true;
    for (var fq = 0; fq < 3; fq++) { for (q = fc[fq]; q < FL_N; q++) flowerSets[fq].setMatrixAt(q, zeroM); flowerSets[fq].instanceMatrix.needsUpdate = true; }
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
      tileColor(tmpC, zc, k & 1); tiles.setColorAt(i, tmpC);
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
  var coinTexF = new THREE.TextureLoader().load('/games/evolution-1-lanes/xera-coin.png'); coinTexF.colorSpace = THREE.SRGBColorSpace; coinTexF.anisotropy = 4; coinTexF.wrapS = THREE.RepeatWrapping; coinTexF.repeat.x = -1; coinTexF.offset.x = 1;   // the canvas is mirrored by CSS, so the face that looks at the camera is pre-flipped
  var faceMatF = new THREE.MeshStandardMaterial({ map: coinTexF, emissiveMap: coinTexF, emissive: 0xffffff, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.45, transparent: true, alphaTest: 0.4 });
  var faceMat = new THREE.MeshStandardMaterial({ map: coinTex, emissiveMap: coinTex, emissive: 0xffffff, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.45, transparent: true, alphaTest: 0.4 });
  var rimMat = new THREE.MeshStandardMaterial({ color: 0xc9d6e8, emissive: 0x1a3c8c, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.25 });
  var coinMat = [rimMat, faceMat, faceMatF];
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
      var th = new THREE.Group(); th.position.set(side * 0.12, 0, 0);
      var up = caps(0.085, 0.28, M.pants); up.position.y = -0.24; th.add(up);
      var sh = new THREE.Group(); sh.position.y = -0.46; th.add(sh);
      var lo = caps(0.075, 0.28, M.pants); lo.position.y = -0.22; sh.add(lo);
      var boot = box(0.22, 0.17, 0.34, M.boot, 0, -0.43, 0.04); sh.add(boot);
      var cuff = box(0.2, 0.05, 0.2, M.strap, 0, -0.34, 0); sh.add(cuff);
      hip.add(th); return { th: th, sh: sh };
    }
    P.legL = leg(-1); P.legR = leg(1);
    var torso = caps(0.21, 0.36, M.jacket); torso.position.y = 0.42; torso.scale.set(1.0, 1, 0.72); hip.add(torso);
    hip.add(box(0.44, 0.06, 0.32, M.strap, 0, 0.14, 0));
    hip.add(box(0.07, 0.08, 0.02, M.metal, 0, 0.14, -0.21));
    // backpack (faces the camera) with the glowing EVO light
    var pack = box(0.4, 0.46, 0.22, M.pack, 0, 0.48, -0.27); hip.add(pack);
    hip.add(box(0.08, 0.26, 0.08, M.packD, -0.24, 0.42, -0.27), box(0.08, 0.26, 0.08, M.packD, 0.24, 0.42, -0.27));
    hip.add(box(0.06, 0.22, 0.02, M.mint, 0, 0.5, -0.39));
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
    P.tailLg = new THREE.Group(); P.tailLg.position.set(-0.13, 0.72, -0.4); P.tailL.position.y = -0.17; P.tailLg.add(P.tailL); hip.add(P.tailLg);
    P.tailRg = new THREE.Group(); P.tailRg.position.set(0.13, 0.72, -0.4); P.tailR.position.y = -0.15; P.tailRg.add(P.tailR); hip.add(P.tailRg);
    // arms
    function arm(side, gaunt) {
      var sh = new THREE.Group(); sh.position.set(side * 0.29, 0.66, 0);
      var up = caps(0.06, 0.22, M.jacketD); up.position.y = -0.17; sh.add(up);
      var el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
      var lo = caps(0.055, 0.22, M.jacket); lo.position.y = -0.17; el.add(lo);
      var hand = new THREE.Mesh(sphGeo, M.skin); hand.scale.setScalar(0.065); hand.position.y = -0.36; el.add(hand);
      var tip = new THREE.Object3D(); tip.position.y = -0.38; el.add(tip);
      if (gaunt) { el.add(box(0.14, 0.3, 0.14, M.metal, 0, -0.18, 0)); el.add(box(0.05, 0.1, 0.152, M.mint, 0, -0.14, 0)); }
      hip.add(sh); return { sh: sh, el: el, tip: tip };
    }
    P.armL = arm(-1, false); P.armR = arm(1, true);
  })();
  scene.add(player);
  // The runner itself is the 2D explorer artwork (drawn by main.js into a canvas) shown as a camera-facing billboard.
  var sprTex = null, sprMesh = null;
  function ensureSprite(o) {
    if (sprMesh || !o.sprite) return;
    sprTex = new THREE.CanvasTexture(o.sprite); sprTex.colorSpace = THREE.SRGBColorSpace; sprTex.minFilter = THREE.LinearFilter; sprTex.generateMipmaps = false;
    var I = o.spriteInfo;
    sprMesh = new THREE.Mesh(new THREE.PlaneGeometry(I.w / I.s, I.h / I.s), new THREE.MeshBasicMaterial({ map: sprTex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    sprMesh.userData.dy = (I.feetY - I.h / 2) / I.s; scene.add(sprMesh);
  }
  var shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ map: radialTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  var rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffe86a, fog: false })); rope.visible = false; scene.add(rope);

  var ropeCol = '#ffe86a', ropeA = new THREE.Vector3(), ropeB = new THREE.Vector3(), _v = new THREE.Vector3();
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
      P.armR.tip.getWorldPosition(ropeA); _b.copy(ropeA); aimRope(_b, rapeAnchor); rope.visible = true;
      rope.material.color.set(ropeCol); ropeB.copy(rapeAnchor);
    } else { rope.visible = false; api.rope = null; }

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

    sceneTime = t / 1000; applyTheme(vz);
    updateGround(vz, game, menu); updateScenery(vz); updateForks(game, vz); syncObstacles(vz, game, menu); updateCoins(vz, game, t, dt, menu);
    poseExplorer(game, t, vz, dt);
    ensureSprite(opts); ropeCol = opts.ropeColor || '#ffe86a';
    if (sprMesh) {
      sprTex.needsUpdate = true; player.visible = false;
      sprMesh.visible = !(game.state === 'playing' && game.invuln > 0 && Math.floor(t / 90) % 2);
      sprMesh.position.set(game.px, game.y + sprMesh.userData.dy, vz);
    }

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

    // falling leaves + light rays (soft effects: off when the phone is struggling)
    var fxOn = quality > 1.4; leaves.visible = fxOn && curW.j > 0.04; leaves.material.opacity = 0.9 * curW.j; for (i = 0; i < NRAY; i++) rays[i].visible = fxOn; for (i = 0; i < 3; i++) flowerSets[i].visible = fxOn && curW.j > 0.04;
    embers.pts.visible = fxOn && curW.t > 0.03; debris.pts.visible = fxOn && curW.l > 0.03;
    if (embers.pts.visible) { embers.pts.material.opacity = 0.85 * curW.t; driftUpdate(embers, vz, t / 1000, -0.9, 0.9); }
    if (debris.pts.visible) { debris.pts.material.opacity = 0.9 * curW.l; driftUpdate(debris, vz, t / 1000, 3.6, 0.5); }
    if (fxOn) {
      var lp = leafPos, ts = t / 1000;
      for (i = 0; i < NLF; i++) {
        var lz = (((leafBase[i * 3 + 2] - vz * 0.8) % 60) + 60) % 60, ly = ((leafBase[i * 3 + 1] - ts * (0.7 + (i % 5) * 0.12)) % 14 + 14) % 14 + 0.3;
        lp[i * 3] = leafBase[i * 3] + Math.sin(ts * 1.3 + i) * 1.1; lp[i * 3 + 1] = ly; lp[i * 3 + 2] = vz - 6 + lz;
      }
      leafGeo.attributes.position.needsUpdate = true;
      for (i = 0; i < NRAY; i++) {
        var rm2 = rays[i], rs = i % 2 ? 1 : -1, rz = (((i * 17 - vz * 0.5) % 100) + 100) % 100;
        rm2.position.set(rs * (7 + (i % 3) * 3.2), 12, vz + 14 + rz); rm2.rotation.z = rs * 0.32;
        rm2.material.opacity = 0.11 + 0.07 * Math.sin(ts * 0.7 + i * 1.9); rm2.material.color.copy(theme.ray);
      }
    }

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

    if (rope.visible) {            // screen-space ends of the hook line for the HUD (x is mirrored like the canvas)
      camera.updateMatrixWorld(true);
      _v.copy(ropeA).project(camera); var x1 = (1 - (_v.x * 0.5 + 0.5)) * W, y1 = (1 - (_v.y * 0.5 + 0.5)) * H;
      _v.copy(ropeB).project(camera); var x2 = (1 - (_v.x * 0.5 + 0.5)) * W, y2 = (1 - (_v.y * 0.5 + 0.5)) * H;
      api.rope = { x1: x1, y1: y1, x2: x2, y2: y2 };
    }
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

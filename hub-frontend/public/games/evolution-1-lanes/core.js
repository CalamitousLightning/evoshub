/*
 * EVOLUTION 1: THE RUNNER (lanes) — game core
 * Pure logic: no DOM, no canvas, no network. Runs in the browser and in Node (for tests).
 *
 * World: the runner moves forward along +z through 3 lanes (x = -1, 0, +1 times LANE_W). y is height.
 * Controls (all map to methods): moveLane(-1|1), jump(), slide(), hookPress().
 *
 * Hook (tap): has TWO real functions that act on the movement/physics:
 *   - SWING  (vine over a chasm that cannot be jumped): the rope is a real pendulum constraint. Your speed is
 *            turned into swing motion; you are released at the far side with your momentum and fly onto solid ground.
 *   - PULL   (ring above a tall stone ledge that cannot be jumped): a real reel force hauls you up onto the ledge.
 * Tapping HOOK arms the hook for a moment; it latches when the runner reaches the correct launch point.
 *
 * Coins: lines in the gaps, arcs over jumpable obstacles, a trail along the swing arc and a line on top of ledges.
 * Stumble: the first hit on a rock / log / branch / wall is survivable (brief invulnerability + slow-down). A second hit
 *          while still "wounded" ends the run; WOUND_T seconds without a hit heals you. Falls and ledge hits are always fatal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EvoLanesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    LANE_W: 2.2,
    LANE_SPEED: 16,        // lateral units/s (a lane change takes ~0.14s)
    HIT_X: 1.12,           // lateral overlap needed to touch an obstacle in a lane
    PZ: 0.3,               // player half depth
    HEAD_H: 1.8,
    SLIDE_H: 0.8,
    SLIDE_T: 0.6,
    GRAV: 34,
    JUMP_V: 11.5,          // apex ~1.94, airtime ~0.68s
    FALL_V: -16,           // swipe down in the air = fast fall
    COYOTE: 0.09,
    BUFFER: 0.14,
    START_SPEED: 14,
    MAX_SPEED: 32,
    ACCEL: 0.22,           // units/s gained per second
    FIRST_Z: 50,
    SPAWN_AHEAD: 130,
    ROCK_H: 0.9,
    LOG_H: 0.8,
    WALL_H: 4.2,
    BRANCH_LOW: 1.15,      // low branch: slide under it (jumping or standing hits it)
    BRANCH_THICK: 1.2,
    LEDGE_H: 3.2,
    HAND_H: 1.4,           // hand height above the feet
    ARM_TIME: 2.0,
    PULL_FROM: 9,          // pull latches between LEDGE-9 and LEDGE-5.2 units before the ledge front
    PULL_TO: 5.2,
    PULL_RING_DZ: 1.6,
    PULL_RING_DY: 2.4,
    SWING_K: 0.55,         // vine height above the hand = SWING_K * chasm length
    CHASM_MIN: 16,
    CHASM_MAX: 30,
    DEATH_Y: -9,
    // ---- stumble / coins ----
    WOUND_T: 12,           // seconds you stay wounded after a stumble (a 2nd hit in this time ends the run)
    INVULN_T: 1.4,         // ghosting through obstacles right after a stumble
    SLOW_MIN: 0.55,        // speed factor right after a stumble ...
    SLOW_REC: 0.18,        // ... recovering by this much per second
    COIN_R: 0.35,
    COIN_VALUE: 10,
    COIN_STEP: 2.0,
    TILE: 2.5              // ground tile length (pits / chasms are aligned to it)
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function Game(seed) {
    this.seed = seed == null ? (Date.now() & 0x7fffffff) : seed;
    this.onEvent = null;
    this.reach = 0;               // hook upgrade level 0-3 (kept across runs): longer arm time, wider latch zones
    this.reset();
    this.state = 'menu';
  }

  Game.prototype.emit = function (type) { if (this.onEvent) this.onEvent(type, this); };

  Game.prototype.reset = function () {
    this.rng = mulberry32(this.seed);
    this.time = 0;
    this.speed = CFG.START_SPEED;
    this.pz = 0; this.px = 0; this.lane = 0;
    this.y = 0; this.vy = 0; this.airVz = null;
    this.onGround = true;
    this.coyote = CFG.COYOTE;
    this.jumpBuf = 0; this.slideBuf = 0; this.slideT = 0;
    this.obstacles = [];
    this.nextZ = CFG.FIRST_Z;
    this.hook = null; this.hookArmed = 0;
    this.hooksUsed = 0; this.swings = 0; this.pulls = 0;
    this.reason = null;
    this.coins = 0; this.coinList = []; this.stumbles = 0;
    this.wounded = 0; this.invuln = 0; this.slow = 1;
    this.lastEnd = 6; this.lastKind = 'start';
    while (this.nextZ < CFG.SPAWN_AHEAD) this.spawnRow();
  };

  Game.prototype.start = function (seed) {
    this.seed = seed != null ? seed : ((Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff);
    this.reset();
    this.state = 'playing';
    this.emit('start');
  };
  Game.prototype.pause = function () { if (this.state === 'playing') { this.state = 'paused'; this.emit('pause'); } };
  Game.prototype.resume = function () { if (this.state === 'paused') { this.state = 'playing'; this.emit('resume'); } };
  Game.prototype.score = function () { return Math.floor(this.pz); };                       // distance in metres
  Game.prototype.points = function () { return Math.floor(this.pz) + this.coins * CFG.COIN_VALUE; };

  // ------------------------------------------------------------ inputs
  Game.prototype.moveLane = function (dir) {
    if (this.state !== 'playing') return;
    var n = clamp(this.lane + (dir < 0 ? -1 : 1), -1, 1);
    if (n !== this.lane) { this.lane = n; this.emit('lane'); }
  };
  Game.prototype.jump = function () { if (this.state === 'playing') this.jumpBuf = CFG.BUFFER; };
  Game.prototype.slide = function () {
    if (this.state !== 'playing') return;
    this.slideBuf = CFG.BUFFER;
    if (!this.onGround && !this.hook && this.vy > CFG.FALL_V) this.vy = CFG.FALL_V;
  };
  Game.prototype.hookPress = function () {
    if (this.state !== 'playing') return;
    if (this.hook) { if (this.hook.kind === 'swing') this.releaseHook(); return; }
    this.hookArmed = CFG.ARM_TIME + 0.3 * this.reach;
    this.emit('arm');
  };

  // ------------------------------------------------------------ world generation
  Game.prototype.pickLanes = function (k) {
    var l = [-1, 0, 1], r = this.rng, out = [];
    while (k-- > 0 && l.length) out.push(l.splice(Math.floor(r() * l.length), 1)[0]);
    return out;
  };

  Game.prototype.spawnRow = function () {
    var r = this.rng, v = Math.min(CFG.MAX_SPEED, Math.max(this.speed, CFG.START_SPEED) + 3), m = this.nextZ;
    var pool = ['jump', 'jump', 'lane'];
    if (m >= 40) pool.push('pit');
    if (m >= 60) pool.push('chasm');
    if (m >= 80) pool.push('slide', 'mixed');
    if (m >= 100) pool.push('ledge');
    if (m >= 300) pool.push('slide', 'mixed', 'chasm', 'ledge', 'pit');
    var kind = pool[Math.floor(r() * pool.length)];
    var hookRow = kind === 'chasm' || kind === 'ledge';
    var z = this.nextZ + (hookRow ? v * 0.5 + 6 : 0);
    // pits and chasms sit on the 2.5-unit ground-tile grid so the 3D floor can have clean edges
    if (kind === 'pit' || kind === 'chasm') z = Math.ceil(z / CFG.TILE) * CFG.TILE;
    var rowLen = 2.2, gap = v * (0.95 + 0.6 * r());
    var i, lanes, o;

    if (kind === 'jump') {
      var rock = r() < 0.5;
      lanes = this.pickLanes(1 + Math.floor(r() * 3));
      for (i = 0; i < 1; i++) this.obstacles.push({ type: rock ? 'rock' : 'log', z: z, len: rock ? 1.6 : 2.2, lanes: lanes, h: rock ? CFG.ROCK_H : CFG.LOG_H });
      rowLen = rock ? 1.6 : 2.2;
    } else if (kind === 'slide') {
      this.obstacles.push({ type: 'branch', z: z, len: 1.2, lanes: this.pickLanes(1 + Math.floor(r() * 3)), low: CFG.BRANCH_LOW, h: CFG.BRANCH_LOW + CFG.BRANCH_THICK });
      rowLen = 1.2;
    } else if (kind === 'lane') {
      this.obstacles.push({ type: 'wall', z: z, len: 2.0, lanes: this.pickLanes(1 + Math.floor(r() * 2)), h: CFG.WALL_H });
      rowLen = 2.0;
    } else if (kind === 'mixed') {
      lanes = this.pickLanes(3);
      this.obstacles.push({ type: 'wall', z: z, len: 2.0, lanes: [lanes[0]], h: CFG.WALL_H });
      var rock2 = r() < 0.5;
      this.obstacles.push({ type: rock2 ? 'rock' : 'log', z: z, len: 2.0, lanes: r() < 0.5 ? [lanes[1]] : [lanes[1], lanes[2]], h: rock2 ? CFG.ROCK_H : CFG.LOG_H });
      rowLen = 2.0;
    } else if (kind === 'pit') {
      rowLen = Math.ceil(v * (0.26 + r() * 0.14) / CFG.TILE) * CFG.TILE;
      this.obstacles.push({ type: 'pit', z: z, len: rowLen, lanes: [-1, 0, 1] });
      gap = v * 1.0;
    } else if (kind === 'chasm') {
      rowLen = Math.ceil(clamp(v + 3, CFG.CHASM_MIN, CFG.CHASM_MAX) / CFG.TILE) * CFG.TILE;
      o = { type: 'chasm', z: z, len: rowLen, lanes: [-1, 0, 1] };
      o.anchor = { kind: 'swing', z: z + rowLen / 2, y: CFG.HAND_H + CFG.SWING_K * rowLen, farZ: z + rowLen };
      this.obstacles.push(o);
      gap = 0.0295 * v * v + v * 1.0 + 4;     // room for the flight after the swing
    } else { // ledge
      rowLen = Math.round(clamp(v + 8, 16, 36));
      o = { type: 'ledge', z: z, len: rowLen, lanes: [-1, 0, 1], h: CFG.LEDGE_H };
      o.anchor = { kind: 'pull', z: z + CFG.PULL_RING_DZ, y: CFG.LEDGE_H + CFG.PULL_RING_DY };
      this.obstacles.push(o);
      gap = v * 0.9 + 4;
    }
    this.addCoins(kind, z, rowLen, v);
    this.lastEnd = z + rowLen; this.lastKind = kind;
    this.nextZ = z + rowLen + gap;
  };

  Game.prototype.addCoin = function (z, lane, y, tol) {
    this.coinList.push({ z: z, lane: lane, y: y, tol: tol || 1.0, taken: false });
  };

  // a straight line of coins on the ground between z0 and z1 (optionally switching lane half way)
  Game.prototype.coinLine = function (z0, z1, lane, y, zig) {
    if (z1 - z0 < 4) return;
    var n = Math.min(9, Math.floor((z1 - z0) / CFG.COIN_STEP) + 1), i, l = lane;
    for (i = 0; i < n; i++) {
      if (zig && i === Math.floor(n / 2)) l = clamp(lane + zig, -1, 1);
      this.addCoin(z0 + i * CFG.COIN_STEP, l, y);
    }
  };

  Game.prototype.addCoins = function (kind, z, len, v) {
    var r = this.rng, os = this.obstacles, last = os[os.length - 1], i, lane, h;
    // 1) a trail in the free space before this row (after the flight, if the previous row was a chasm)
    var from = this.lastEnd + (this.lastKind === 'chasm' ? 0.0295 * v * v + 3 : 3), to = z - 3;
    if (r() < 0.8) this.coinLine(from, to, Math.floor(r() * 3) - 1, 0.9, r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0);
    // 2) rewards that sit on the row itself
    if (kind === 'jump') {                                    // arc over the rock / log: reward for jumping
      lane = last.lanes[0]; h = [1.3, 2.0, 2.4, 2.0, 1.3];
      for (i = 0; i < 5; i++) this.addCoin(z + last.len / 2 + (i - 2) * 1.8, lane, h[i]);
    } else if (kind === 'slide') {                            // low coins under the branch: reward for sliding
      lane = last.lanes[0];
      for (i = 0; i < 3; i++) this.addCoin(z + (i - 1) * 1.6 + last.len / 2, lane, 0.5);
    } else if (kind === 'pit') {                              // arc over the pit
      h = [1.2, 1.9, 2.3, 1.9, 1.2];
      for (i = 0; i < 5; i++) this.addCoin(z - 1 + (len + 2) * i / 4, 0, h[i], 1.4);
    } else if (kind === 'chasm') {                            // trail along the swing arc: guides and rewards the hook
      var a = last.anchor, D = Math.hypot(len / 2, a.y - CFG.HAND_H), th = Math.asin((len / 2) / D) * 0.85, ph;
      for (i = 0; i < 7; i++) {
        ph = -th + (2 * th) * i / 6;
        this.addCoin(a.z + D * Math.sin(ph), 0, a.y - D * Math.cos(ph) - 0.5, 3.4);
      }
    } else if (kind === 'ledge') {                            // line on top of the ledge: reward for pulling up
      lane = Math.floor(r() * 3) - 1;
      for (i = 0; i < 7; i++) this.addCoin(z + 4 + i * CFG.COIN_STEP, lane, CFG.LEDGE_H + 0.9);
    }
  };

  // ------------------------------------------------------------ support / collision helpers
  // Heights of surfaces the runner could stand on under their footprint.
  Game.prototype.surfaces = function () {
    var left = this.pz - CFG.PZ, right = this.pz + CFG.PZ, ground = true, out = [], i, o;
    for (i = 0; i < this.obstacles.length; i++) {
      o = this.obstacles[i];
      if ((o.type === 'pit' || o.type === 'chasm') && left >= o.z - 0.1 && right <= o.z + o.len + 0.1) ground = false;
      else if (o.type === 'ledge' && right > o.z && left < o.z + o.len) out.push(o.h);
    }
    if (ground) out.push(0);
    return out;
  };

  Game.prototype.laneHit = function (o) {
    for (var i = 0; i < o.lanes.length; i++) if (Math.abs(this.px - o.lanes[i] * CFG.LANE_W) < CFG.HIT_X) return true;
    return false;
  };

  // A hit on a soft obstacle: the first one is a stumble, a second one while still wounded ends the run.
  Game.prototype.hit = function (reason) {
    if (this.invuln > 0) return;
    if (this.wounded > 0) return this.die(reason);
    this.wounded = CFG.WOUND_T; this.invuln = CFG.INVULN_T; this.slow = CFG.SLOW_MIN; this.stumbles++;
    this.lastHit = reason;
    this.emit('stumble');
  };

  Game.prototype.die = function (reason) {
    this.hook = null;
    this.state = 'over';
    this.reason = reason;
    this.emit('crash');
  };

  Game.prototype.collide = function () {
    var head = this.slideT > 0 ? CFG.SLIDE_H : CFG.HEAD_H, top = this.y + head, i, o;
    for (i = 0; i < this.obstacles.length; i++) {
      o = this.obstacles[i];
      if (!(this.pz + CFG.PZ > o.z && this.pz - CFG.PZ < o.z + o.len)) continue;
      if (o.type === 'rock' || o.type === 'log' || o.type === 'wall') {
        if (this.laneHit(o) && this.y < o.h - 0.08) { this.hit(o.type); if (this.state !== 'playing') return; }
      } else if (o.type === 'branch') {
        if (this.laneHit(o) && top > o.low && this.y < o.low + CFG.BRANCH_THICK) { this.hit('branch'); if (this.state !== 'playing') return; }
      } else if (o.type === 'ledge') {
        if (this.y < o.h - 0.15) return this.die('ledge');
      }
    }
  };

  Game.prototype.collectCoins = function () {
    var head = this.slideT > 0 ? CFG.SLIDE_H : CFG.HEAD_H, lo = this.y - 0.3, hi = this.y + head + 0.3, i, c;
    for (i = 0; i < this.coinList.length; i++) {
      c = this.coinList[i];
      if (c.taken || Math.abs(c.z - this.pz) > 0.8) continue;
      if (Math.abs(this.px - c.lane * CFG.LANE_W) < c.tol && c.y >= lo && c.y <= hi) { c.taken = true; this.coins++; this.emit('coin'); }
    }
  };

  // ------------------------------------------------------------ hook
  Game.prototype.tryLatch = function () {
    var i, o, a, hx, hy, rz, ry, R, t, sp;
    for (i = 0; i < this.obstacles.length; i++) {
      o = this.obstacles[i];
      if (!o.anchor || o.used) continue;
      a = o.anchor;
      if (o.type === 'chasm' && this.pz >= o.z - 1.2 - 0.25 * this.reach && this.pz <= o.z + 0.4 && this.y > -0.6) {
        hx = this.pz; hy = this.y + CFG.HAND_H;
        rz = hx - a.z; ry = hy - a.y; R = Math.hypot(rz, ry);
        sp = Math.max(this.speed, this.airVz || 0);
        // tangent of the circle at the hand, pointing forward (and down): speed becomes pendulum motion
        this.hook = { kind: 'swing', o: o, anchor: a, R: R, rz: rz, ry: ry, uz: (-ry / R) * sp, uy: (rz / R) * sp, t: 0 };
        o.used = true; this.hookArmed = 0; this.onGround = false; this.emit('latch');
        return true;
      }
      if (o.type === 'ledge' && this.pz >= o.z - CFG.PULL_FROM - this.reach && this.pz <= o.z - CFG.PULL_TO) {
        this.hook = { kind: 'pull', o: o, anchor: a, t: 0 };
        o.used = true; this.hookArmed = 0; this.onGround = false; this.emit('latch');
        return true;
      }
    }
    return false;
  };

  Game.prototype.releaseHook = function () {
    var h = this.hook;
    if (!h) return;
    if (h.kind === 'swing') {
      this.airVz = Math.max(h.uz, this.speed * 0.6);
      this.vy = h.uy;
      this.swings++;
    } else {
      this.airVz = this.speed;
      this.vy = 0;
      this.pulls++;
    }
    this.hook = null; this.hookArmed = 0; this.hooksUsed++; this.onGround = false;
    this.emit('release');
  };

  Game.prototype.stepHook = function (dt) {
    var h = this.hook, a = h.anchor;
    h.t += dt;
    if (h.kind === 'swing') {
      h.uy -= CFG.GRAV * dt;
      h.rz += h.uz * dt; h.ry += h.uy * dt;
      var d = Math.hypot(h.rz, h.ry);
      if (d > h.R) {                       // taut rope: stay on the circle, drop the outward velocity
        var nz = h.rz / d, ny = h.ry / d;
        h.rz = nz * h.R; h.ry = ny * h.R;
        var vr = h.uz * nz + h.uy * ny;
        if (vr > 0) { h.uz -= nz * vr; h.uy -= ny * vr; }
      }
      this.pz = a.z + h.rz;
      this.y = a.y + h.ry - CFG.HAND_H;
      this.vy = h.uy;
      if ((this.pz >= a.farZ - 1 && this.y >= -0.1) || (h.t > 0.3 && h.uz < 0.5) || h.t > 3.5) this.releaseHook();
    } else {
      var hy = this.y + CFG.HAND_H, dz = a.z - this.pz, dy = a.y - hy, dist = Math.hypot(dz, dy);
      var reel = Math.max(24, this.speed * 1.5) * dt;
      if (dist <= Math.max(reel, 0.4)) { this.pz = a.z; this.y = a.y - CFG.HAND_H; this.releaseHook(); }
      else { this.pz += dz / dist * reel; this.y += dy / dist * reel; }
      this.vy = 0;
      if (this.hook && h.t > 1.5) this.releaseHook();
    }
  };

  // ------------------------------------------------------------ simulation
  Game.prototype.stepFree = function (dt) {
    var i, s, best, landed = false, prevY = this.y;

    if (this.slideBuf > 0 && this.onGround) { this.slideT = CFG.SLIDE_T; this.slideBuf = 0; this.emit('slide'); }
    if (this.jumpBuf > 0 && (this.onGround || this.coyote > 0)) {
      this.vy = CFG.JUMP_V; this.onGround = false; this.coyote = 0; this.jumpBuf = 0; this.slideT = 0;
      this.emit('jump');
    }

    this.pz += (this.airVz != null ? this.airVz : this.speed * this.slow) * dt;
    this.vy -= CFG.GRAV * dt;
    var ny = this.y + this.vy * dt;

    var surf = this.surfaces();
    best = null;
    for (i = 0; i < surf.length; i++) {
      s = surf[i];
      if (prevY >= s - 0.15 && ny <= s && this.vy <= 0 && (best === null || s > best)) best = s;
    }
    if (best !== null) { this.y = best; this.vy = 0; landed = true; }
    else {
      this.y = ny;
      // fell into a pit/chasm and came up against the far wall, or dropped out of the world
      if (this.y < -0.4 && surf.indexOf(0) !== -1) return this.die('pit');
      if (this.y < CFG.DEATH_Y) return this.die('fell');
    }

    if (landed) {
      if (!this.onGround) this.emit('land');
      this.onGround = true; this.airVz = null; this.coyote = CFG.COYOTE;
      if (this.slideBuf > 0) { this.slideT = CFG.SLIDE_T; this.slideBuf = 0; }
    } else {
      this.onGround = false;
      this.coyote -= dt;
    }
  };

  Game.prototype.step = function (dt) {
    this.time += dt;
    this.speed = Math.min(CFG.MAX_SPEED, CFG.START_SPEED + CFG.ACCEL * this.time);
    var target = this.lane * CFG.LANE_W, d = target - this.px, m = CFG.LANE_SPEED * dt;
    this.px += clamp(d, -m, m);
    this.jumpBuf -= dt; this.slideBuf -= dt; this.hookArmed -= dt;
    if (this.slideT > 0) this.slideT -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.wounded > 0) { this.wounded -= dt; if (this.wounded <= 0) this.emit('recover'); }
    if (this.slow < 1) this.slow = Math.min(1, this.slow + CFG.SLOW_REC * dt);

    if (this.hookArmed > 0 && !this.hook) this.tryLatch();
    if (this.hook) this.stepHook(dt); else this.stepFree(dt);
    if (this.state !== 'playing') return;
    this.collide();
    if (this.state !== 'playing') return;
    this.collectCoins();

    while (this.nextZ < this.pz + CFG.SPAWN_AHEAD) this.spawnRow();
    while (this.obstacles.length && this.obstacles[0].z + this.obstacles[0].len < this.pz - 20) this.obstacles.shift();
    if (this.coinList.length && this.coinList[0].z < this.pz - 20) { var pz0 = this.pz - 20; this.coinList = this.coinList.filter(function (c) { return c.z >= pz0; }); }
  };

  Game.prototype.update = function (dt) {
    if (this.state !== 'playing') return;
    dt = Math.min(dt, 0.1);
    var n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (var i = 0; i < n && this.state === 'playing'; i++) this.step(h);
  };

  return { Game: Game, CFG: CFG, mulberry32: mulberry32 };
});

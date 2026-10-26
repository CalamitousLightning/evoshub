/*
 * EVOLUTION 1: THE RUNNER — game core
 * Pure logic: no DOM, no canvas, no network. Runs in the browser and in Node (for tests).
 * World is a fixed 800x450 logical space; the renderer scales it to the screen.
 *
 * Hook (hold to use):
 *   - SWING anchors (vines over a wide chasm): the rope is a real constraint. Velocity is converted
 *     to pendulum motion; letting go keeps your momentum, so you fly across the chasm.
 *   - PULL anchors (rings on a canopy platform): a real pulling force accelerates you toward the ring,
 *     hauling you up onto the platform.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EvoRunnerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    W: 800,
    H: 450,
    GROUND_Y: 360,        // y of the running surface
    PLAYER_X: 140,
    PLAYER_W: 34,
    PLAYER_H: 54,
    HIT_INSET: 6,         // player hitbox is slightly smaller than the sprite (forgiving)
    GRAVITY: 2400,
    JUMP_V: -820,         // apex ~140px, airtime ~0.68s
    COYOTE: 0.09,         // can still jump this long after leaving the ground
    BUFFER: 0.12,         // a jump pressed this early before landing still counts
    START_SPEED: 300,     // px/s
    MAX_SPEED: 720,
    ACCEL: 9,             // px/s gained per second
    PX_PER_M: 50,
    BRANCH_BOTTOM: 288,   // low branch: run under it, do NOT jump
    FIRST_OBSTACLE_X: 1050,
    // ---- hook ----
    HAND_DY: 12,          // hand position below the top of the player sprite
    HOOK_RANGE: 340,      // max distance to latch onto an anchor
    PULL_V: 1000,         // pull-up reel speed (px/s)
    PLATFORM_Y: 190,      // top of canopy platforms (one-way: land on top, pass through from below/sides)
    PLATFORM_H: 16,
    PULL_ANCHOR_DY: 62,   // ring sits this far above the platform top
    CHASM_MAX: 520,       // keeps chasms impossible to jump even at max speed
    SWING_MAX: 440
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Game(seed) {
    this.seed = seed == null ? (Date.now() & 0x7fffffff) : seed;
    this.onEvent = null;
    this.resetWorld();
    this.state = 'menu';
  }

  Game.prototype.emit = function (type) {
    if (this.onEvent) this.onEvent(type, this);
  };

  Game.prototype.resetWorld = function () {
    this.rng = mulberry32(this.seed);
    this.time = 0;
    this.speed = CFG.START_SPEED;
    this.distance = 0;
    this.dmax = 0;
    this.obstacles = [];
    this.anchors = [];
    this.lastEnd = CFG.FIRST_OBSTACLE_X;
    this.buffer = 0;
    this.coyote = CFG.COYOTE;
    this.reason = null;
    this.hook = null;          // active rope: {a, L, rx, ry, ux, uy}  (r = hand - anchor, u = world velocity)
    this.hookHeld = false;
    this.hookLock = false;     // after a release/arrival, must let go of the button before hooking again
    this.hooksUsed = 0;
    this.airVx = null;         // horizontal speed kept after letting go of a rope, until you land
    this.player = { x: CFG.PLAYER_X, y: CFG.GROUND_Y - CFG.PLAYER_H, vy: 0, onGround: true, standY: CFG.GROUND_Y };
    while (this.lastEnd < CFG.W + 300) this.spawn();
  };

  Game.prototype.start = function (seed) {
    this.seed = seed != null ? seed : ((Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff);
    this.resetWorld();
    this.state = 'playing';
    this.emit('start');
  };

  Game.prototype.pause = function () {
    if (this.state === 'playing') { this.state = 'paused'; this.emit('pause'); }
  };

  Game.prototype.resume = function () {
    if (this.state === 'paused') { this.state = 'playing'; this.emit('resume'); }
  };

  Game.prototype.press = function () {
    if (this.state === 'playing') this.buffer = CFG.BUFFER;
  };

  Game.prototype.hookDown = function () {
    if (this.state !== 'playing') return;
    this.hookHeld = true; this.hookLock = false;
  };

  Game.prototype.hookUp = function () {
    this.hookHeld = false; this.hookLock = false;
  };

  Game.prototype.score = function () {
    return Math.floor(this.dmax / CFG.PX_PER_M);
  };

  Game.prototype.handPos = function () {
    return { x: CFG.PLAYER_X + CFG.PLAYER_W / 2, y: this.player.y + CFG.HAND_DY };
  };

  // ---------------------------------------------------------------- spawning
  Game.prototype.spawn = function (forceType) {
    var r = this.rng, m = this.dmax / CFG.PX_PER_M, speed = this.speed;
    var pool = ['rock', 'log', 'gap', 'rock'];
    if (m >= 120) pool.push('branch');
    if (m >= 250) pool.push('branch', 'gap');
    if (m >= 40) pool.push('pullChasm', 'swingChasm');
    if (m >= 200) pool.push('pullChasm', 'swingChasm');
    var type = forceType || pool[Math.floor(r() * pool.length)];
    var o = { type: type, x: 0, y: 0, w: 0, h: 0, ins: 0 };
    var chasm = (type === 'pullChasm' || type === 'swingChasm');

    if (type === 'rock') {
      o.w = 36 + Math.floor(r() * 24); o.h = 30 + Math.floor(r() * 22); o.ins = 6;
      o.y = CFG.GROUND_Y - o.h;
    } else if (type === 'log') {
      o.w = 70 + Math.floor(r() * 24); o.h = 26; o.ins = 3;
      o.y = CFG.GROUND_Y - o.h;
    } else if (type === 'branch') {
      o.w = 56; o.y = 0; o.h = CFG.BRANCH_BOTTOM; o.ins = 4;
    } else if (chasm) { // wide pit: cannot be jumped, needs the hook
      o.w = Math.min(type === 'swingChasm' ? CFG.SWING_MAX : CFG.CHASM_MAX, Math.round(speed * (0.95 + r() * 0.1)));
      o.y = CFG.GROUND_Y; o.chasm = type === 'pullChasm' ? 'pull' : 'swing'; o.type = 'gap';
    } else { // normal gap: width scales with speed so it always stays jumpable
      o.w = Math.round(speed * (0.28 + r() * 0.12)); o.y = CFG.GROUND_Y;
    }

    // Spacing from the previous obstacle: always enough room to land, then jump again.
    var spacing = speed * (0.9 + r() * 0.8) * (chasm ? 1.15 : 1);
    o.x = this.lastEnd + spacing;
    this.lastEnd = o.x + o.w;
    this.obstacles.push(o);

    if (type === 'pullChasm') {
      this.obstacles.push({ type: 'platform', x: o.x, y: CFG.PLATFORM_Y, w: o.w, h: CFG.PLATFORM_H, ins: 0 });
      this.anchors.push({ kind: 'pull', x: o.x + 22, y: CFG.PLATFORM_Y - CFG.PULL_ANCHOR_DY });
    } else if (type === 'swingChasm') {
      // Anchor height is chosen so the rope is exactly taut at the near lip and the arc is shallow:
      // you swing down into the chasm, back up to the far lip at the same height, and let go to be flung across.
      var handG = CFG.GROUND_Y - CFG.PLAYER_H + CFG.HAND_DY;
      var ay = Math.max(40, handG - 0.687 * o.w), L = Math.hypot(o.w / 2, handG - ay);
      this.anchors.push({ kind: 'swing', x: o.x + o.w * 0.5, y: ay, range: L + 30 });
    }
  };

  // ---------------------------------------------------------------- support helpers
  // The player is over solid ground unless their footprint sits entirely inside a gap.
  Game.prototype.isSupported = function () {
    var left = CFG.PLAYER_X + 8, right = CFG.PLAYER_X + CFG.PLAYER_W - 8;
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (o.type === 'gap' && o.x <= left && o.x + o.w >= right) return false;
    }
    return true;
  };

  // Top of the highest one-way platform under the player's footprint, or null.
  Game.prototype.platformUnder = function () {
    var left = CFG.PLAYER_X + 8, right = CFG.PLAYER_X + CFG.PLAYER_W - 8, best = null;
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (o.type === 'platform' && o.x < right && o.x + o.w > left && (best === null || o.y < best)) best = o.y;
    }
    return best;
  };

  Game.prototype.shiftWorld = function (s) {
    var i;
    this.distance += s;
    if (this.distance > this.dmax) this.dmax = this.distance;
    this.lastEnd -= s;
    for (i = 0; i < this.obstacles.length; i++) this.obstacles[i].x -= s;
    for (i = 0; i < this.anchors.length; i++) this.anchors[i].x -= s;
    while (this.obstacles.length && this.obstacles[0].x + this.obstacles[0].w < -80) this.obstacles.shift();
    while (this.anchors.length && this.anchors[0].x < -120 && !(this.hook && this.hook.a === this.anchors[0])) this.anchors.shift();
  };

  Game.prototype.die = function (reason) {
    if (this.hook) { this.hook = null; }
    this.state = 'over';
    this.reason = reason;
    this.emit('over');
  };

  // ---------------------------------------------------------------- hook
  Game.prototype.nearestAnchor = function () {
    var h = this.handPos(), best = null, bd = 1e9;
    for (var i = 0; i < this.anchors.length; i++) {
      var a = this.anchors[i];
      if (a.x < h.x - 10 || a.y > h.y - 10) continue;       // only anchors ahead of you and above your hand
      var d = Math.hypot(a.x - h.x, a.y - h.y);
      if (d <= (a.range || CFG.HOOK_RANGE) && d < bd) { bd = d; best = a; }
    }
    return best;
  };

  Game.prototype.tryAttach = function () {
    var a = this.nearestAnchor();
    if (!a) return;
    var p = this.player, h = this.handPos();
    var ux = this.airVx != null ? this.airVx : this.speed;
    var uy = p.onGround ? 0 : p.vy;
    var rx = h.x - a.x, ry = h.y - a.y, L = Math.hypot(rx, ry);
    if (a.kind === 'swing') { // a rope can only pull: drop any velocity component pointing away from the anchor
      var vr = (ux * rx + uy * ry) / L;
      if (vr > 0) { ux -= vr * rx / L; uy -= vr * ry / L; }
    }
    this.hook = { a: a, L: L, rx: rx, ry: ry, ux: ux, uy: uy };
    p.onGround = false; this.coyote = 0; this.buffer = 0;
    this.hooksUsed++;
    this.emit('hook');
  };

  Game.prototype.detach = function (reason) {
    var h = this.hook, p = this.player;
    if (!h) return;
    this.airVx = Math.max(this.speed * 0.6, Math.min(900, h.ux));
    p.vy = h.uy;
    if (reason === 'arrive') { this.airVx = this.speed; p.vy = -60; }
    this.hook = null;
    this.hookLock = this.hookHeld;                         // must let go before hooking again
    p.onGround = false; this.coyote = 0;
    this.emit('unhook');
  };

  Game.prototype.stepHooked = function (dt) {
    var h = this.hook, a = h.a, p = this.player, rx0 = h.rx, prevFeet = p.y + CFG.PLAYER_H, d, nx, ny, vr;

    if (a.kind === 'pull') {
      d = Math.hypot(h.rx, h.ry) || 1; nx = -h.rx / d; ny = -h.ry / d;
      var k = Math.min(1, 10 * dt);                        // pulling force: accelerate toward the ring
      h.ux += (nx * CFG.PULL_V - h.ux) * k;
      h.uy += (ny * CFG.PULL_V - h.uy) * k;
      h.rx += h.ux * dt; h.ry += h.uy * dt;
    } else {
      h.uy += CFG.GRAVITY * dt;
      h.rx += h.ux * dt; h.ry += h.uy * dt;
      d = Math.hypot(h.rx, h.ry);
      if (d < h.L) h.L = d;                                // the rope reels in slack, so it never snaps taut with a jerk
      else if (d > h.L) {                                  // taut rope: constrain + kill outward velocity
        nx = h.rx / d; ny = h.ry / d;
        h.rx = nx * h.L; h.ry = ny * h.L;
        vr = h.ux * nx + h.uy * ny;
        if (vr > 0) { h.ux -= vr * nx; h.uy -= vr * ny; }
      }
      // solid ground stops you from swinging through it
      var feet = a.y + h.ry - CFG.HAND_DY + CFG.PLAYER_H;
      if (this.isSupported() && feet > CFG.GROUND_Y && prevFeet <= CFG.GROUND_Y + 10) {
        h.ry -= feet - CFG.GROUND_Y; if (h.uy > 0) h.uy = 0;
      }
    }

    this.shiftWorld(h.rx - rx0);                           // camera follows the player: the world scrolls by your horizontal motion
    p.y = a.y + h.ry - CFG.HAND_DY;
    p.vy = h.uy;

    if (a.kind === 'pull' && Math.hypot(h.rx, h.ry) < 34) { this.detach('arrive'); return; }
    if (!this.isSupported() && p.y + CFG.PLAYER_H > CFG.GROUND_Y + 90) this.die('fall');
  };

  // ---------------------------------------------------------------- free movement
  Game.prototype.stepFree = function (dt) {
    var p = this.player;
    this.shiftWorld((this.airVx != null ? this.airVx : this.speed) * dt);

    // Jump (with coyote time + input buffer so taps feel reliable)
    var supported = this.isSupported(), pu = this.platformUnder();
    if (p.onGround) {
      var stands = p.standY === CFG.GROUND_Y ? supported : (pu !== null && pu === p.standY);
      if (!stands) p.onGround = false;
    }
    if (p.onGround) this.coyote = CFG.COYOTE; else this.coyote -= dt;
    if (this.buffer > 0) this.buffer -= dt;
    if (this.buffer > 0 && this.coyote > 0) {
      p.vy = CFG.JUMP_V; p.onGround = false; this.coyote = 0; this.buffer = 0;
      this.airVx = null;
      this.emit('jump');
    }

    // Physics
    if (!p.onGround) {
      var prevFeet = p.y + CFG.PLAYER_H;
      p.vy += CFG.GRAVITY * dt;
      p.y += p.vy * dt;
      var feet = p.y + CFG.PLAYER_H, landY = null;
      if (p.vy >= 0 && pu !== null && prevFeet <= pu + 6 && feet >= pu) landY = pu;
      else if (p.vy >= 0 && supported && prevFeet <= CFG.GROUND_Y + 10 && feet >= CFG.GROUND_Y) landY = CFG.GROUND_Y;
      if (landY !== null) {
        p.y = landY - CFG.PLAYER_H; p.vy = 0; p.onGround = true; p.standY = landY; this.airVx = null;
        this.emit('land');
      } else if (feet > CFG.GROUND_Y + 10 && supported) {
        this.die('hit');            // sank into a gap and hit the far wall
      } else if (feet > CFG.GROUND_Y + 60 && !supported) {
        this.die('fall');
      }
    }
  };

  Game.prototype.collide = function () {
    var p = this.player, o, i;
    var hx = CFG.PLAYER_X + CFG.HIT_INSET, hy = p.y + CFG.HIT_INSET;
    var hw = CFG.PLAYER_W - 2 * CFG.HIT_INSET, hh = CFG.PLAYER_H - CFG.HIT_INSET;
    for (i = 0; i < this.obstacles.length; i++) {
      o = this.obstacles[i];
      if (o.type === 'gap' || o.type === 'platform') continue;
      if (hx < o.x + o.w - o.ins && hx + hw > o.x + o.ins &&
          hy < o.y + o.h && hy + hh > o.y + (o.type === 'branch' ? 0 : o.ins)) {
        this.die('hit');
        return;
      }
    }
  };

  Game.prototype.step = function (dt) {
    if (this.state !== 'playing') return;

    this.time += dt;
    this.speed = Math.min(CFG.MAX_SPEED, CFG.START_SPEED + CFG.ACCEL * this.time);

    if (this.hookHeld && !this.hook && !this.hookLock) this.tryAttach();
    if (!this.hookHeld && this.hook) this.detach('release');

    if (this.hook) this.stepHooked(dt); else this.stepFree(dt);
    if (this.state !== 'playing') return;

    while (this.lastEnd < CFG.W + 300) this.spawn();
    this.collide();
  };

  return { Game: Game, CFG: CFG };
});

'use strict';
// Headless logic tests for the game core. Run: node tests/core.test.js
const assert = require('assert');
const { Game, CFG } = require('../../public/games/evolution-1-runner/core.js');

const DT = 1 / 120;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
function run(g, seconds) { for (let t = 0; t < seconds && g.state === 'playing'; t += DT) g.step(DT); }
function fresh(seed) { const g = new Game(seed || 1); g.start(seed || 1); return g; }
function clearObstacles(g) { g.obstacles = []; g.lastEnd = 99999; }

test('starts in menu, start() begins play with clean state', () => {
  const g = new Game(1);
  assert.strictEqual(g.state, 'menu');
  g.start(1);
  assert.strictEqual(g.state, 'playing');
  assert.strictEqual(g.score(), 0);
  assert.ok(g.player.onGround);
});

test('automatic forward running: distance and score increase', () => {
  const g = fresh(); clearObstacles(g);
  run(g, 3);
  assert.ok(g.distance > 800, 'distance ' + g.distance);
  assert.ok(g.score() >= 16, 'score ' + g.score());
});

test('jump: leaves ground, apex ~140px, lands again', () => {
  const g = fresh(); clearObstacles(g);
  const ground = g.player.y;
  g.press();
  let apex = 0, airborne = false;
  for (let i = 0; i < 120 * 1.2; i++) {
    g.step(DT);
    apex = Math.max(apex, ground - g.player.y);
    if (!g.player.onGround) airborne = true;
  }
  assert.ok(airborne, 'never left ground');
  assert.ok(apex > 130 && apex < 150, 'apex ' + apex);
  assert.ok(g.player.onGround && g.player.y === ground, 'did not land');
  assert.strictEqual(g.state, 'playing');
});

test('jump buffer: press just before landing still jumps on landing', () => {
  const g = fresh(); clearObstacles(g);
  g.press();
  while (g.player.vy <= 0 || g.player.y < g.player.y) g.step(DT); // reach descent
  while (CFG.GROUND_Y - (g.player.y + CFG.PLAYER_H) > 20) g.step(DT);
  g.press();
  let jumped = false;
  g.onEvent = (t) => { if (t === 'jump') jumped = true; };
  for (let i = 0; i < 30; i++) g.step(DT);
  assert.ok(jumped, 'buffered jump was dropped');
});

test('collision: running into a rock ends the game with reason "hit"', () => {
  const g = fresh(); clearObstacles(g);
  g.obstacles.push({ type: 'rock', x: CFG.PLAYER_X + 100, y: CFG.GROUND_Y - 40, w: 40, h: 40, ins: 6 });
  g.lastEnd = 99999;
  run(g, 2);
  assert.strictEqual(g.state, 'over');
  assert.strictEqual(g.reason, 'hit');
});

test('jumping over a rock works', () => {
  const g = fresh(); clearObstacles(g);
  g.obstacles.push({ type: 'rock', x: CFG.PLAYER_X + 200, y: CFG.GROUND_Y - 45, w: 50, h: 45, ins: 6 });
  let jumped = false;
  for (let i = 0; i < 120 * 3 && g.state === 'playing'; i++) {
    const o = g.obstacles[0];
    if (!jumped && o.x - (CFG.PLAYER_X + CFG.PLAYER_W) < g.speed * 0.2) { g.press(); jumped = true; }
    g.step(DT);
  }
  assert.strictEqual(g.state, 'playing');
});

test('gap: running into a gap makes the player fall ("fall"/"hit")', () => {
  const g = fresh(); clearObstacles(g);
  g.obstacles.push({ type: 'gap', x: CFG.PLAYER_X - 20, y: CFG.GROUND_Y, w: 220, h: 0, ins: 0 });
  run(g, 2);
  assert.strictEqual(g.state, 'over');
  assert.ok(g.reason === 'fall' || g.reason === 'hit');
});

test('low branch: running under is safe, jumping into it is not', () => {
  let g = fresh(); clearObstacles(g);
  g.obstacles.push({ type: 'branch', x: CFG.PLAYER_X + 150, y: 0, w: 56, h: CFG.BRANCH_BOTTOM, ins: 4 });
  run(g, 2);
  assert.strictEqual(g.state, 'playing', 'ran under branch but died');
  g = fresh(); clearObstacles(g);
  g.obstacles.push({ type: 'branch', x: CFG.PLAYER_X + 150, y: 0, w: 56, h: CFG.BRANCH_BOTTOM, ins: 4 });
  g.press();
  run(g, 2);
  assert.strictEqual(g.state, 'over', 'jumped into branch and survived');
});

test('difficulty ramps up and is capped', () => {
  const g = fresh(); clearObstacles(g);
  const s0 = g.speed;
  run(g, 10);
  assert.ok(g.speed > s0 + 50, 'speed did not increase');
  run(g, 120);
  assert.strictEqual(g.speed, CFG.MAX_SPEED);
});

test('game over then restart resets everything', () => {
  const g = fresh();
  run(g, 60); // no input: must die on the first obstacles
  assert.strictEqual(g.state, 'over');
  const events = [];
  g.onEvent = (t) => events.push(t);
  g.start(2);
  assert.strictEqual(g.state, 'playing');
  assert.strictEqual(g.score(), 0);
  assert.strictEqual(g.time, 0);
  assert.strictEqual(g.speed, CFG.START_SPEED);
  assert.ok(g.player.onGround);
  assert.deepStrictEqual(events, ['start']);
});

test('pause/resume freezes the world', () => {
  const g = fresh(); clearObstacles(g);
  run(g, 1);
  g.pause();
  const d = g.distance;
  for (let i = 0; i < 100; i++) g.step(DT);
  assert.strictEqual(g.distance, d);
  g.resume();
  run(g, 0.5);
  assert.ok(g.distance > d);
});

// ---- Hook tests ----
function chasmWorld(kind, speed) {
  const g = new Game(5); g.start(5);
  g.time = (speed - CFG.START_SPEED) / CFG.ACCEL; g.speed = speed;
  g.obstacles = []; g.anchors = []; g.lastEnd = 0; g.rng = () => 0.5;
  g.spawn(kind === 'pull' ? 'pullChasm' : 'swingChasm');
  g.lastEnd = 99999;
  return g;
}

test('hook does nothing when there is no anchor in range', () => {
  const g = fresh(); clearObstacles(g);
  g.hookDown(); run(g, 1);
  assert.strictEqual(g.hook, null);
  assert.strictEqual(g.state, 'playing');
});

test('pull-up: hooking a ring really pulls the player UP onto the platform', () => {
  const g = chasmWorld('pull', 400);
  g.hookDown();
  let minY = 1e9, attached = false, arrived = false;
  g.onEvent = (t) => { if (t === 'hook') attached = true; if (t === 'unhook') arrived = true; };
  for (let i = 0; i < 120 * 6 && g.state === 'playing'; i++) {
    g.step(DT); minY = Math.min(minY, g.player.y);
    if (arrived && g.player.onGround && g.player.standY === CFG.PLATFORM_Y) break;
  }
  assert.ok(attached, 'never attached');
  assert.ok(arrived, 'rope never finished pulling');
  assert.strictEqual(g.state, 'playing');
  assert.strictEqual(g.player.standY, CFG.PLATFORM_Y, 'did not land on the platform');
  assert.ok(g.player.y + CFG.PLAYER_H <= CFG.PLATFORM_Y + 0.01, 'not standing on top of the platform');
  assert.ok(minY < CFG.GROUND_Y - CFG.PLAYER_H - 60, 'player never gained height');
});

test('pull-up needs the hook: without it you fall into the chasm', () => {
  const g = chasmWorld('pull', 400);
  run(g, 8);
  assert.strictEqual(g.state, 'over');
});

test('swing chasm cannot be jumped (at any speed) and needs the hook', () => {
  for (const sp of [300, 450, 600, 720]) {
    const g = chasmWorld('swing', sp);
    let jumped = false;
    for (let i = 0; i < 120 * 8 && g.state === 'playing'; i++) {
      const o = g.obstacles[0];
      if (!jumped && o.x - (CFG.PLAYER_X + 17) <= sp * 0.25 && g.player.onGround) { g.press(); jumped = true; }
      g.step(DT);
    }
    assert.strictEqual(g.state, 'over', 'jump alone cleared a swing chasm at speed ' + sp);
  }
});

test('swing: rope is a real constraint (never longer than its length) and gravity acts on it', () => {
  const g = chasmWorld('swing', 450);
  let jumped = false, worst = 0, swung = false;
  for (let i = 0; i < 120 * 6 && g.state === 'playing'; i++) {
    const o = g.obstacles[0];
    if (!jumped && o.x - (CFG.PLAYER_X + 17) <= 150 && g.player.onGround) { g.press(); jumped = true; g.hookDown(); }
    g.step(DT);
    if (g.hook) {
      swung = true;
      worst = Math.max(worst, Math.hypot(g.hook.rx, g.hook.ry) - g.hook.L);
      const h = g.handPos(), a = g.hook.a;
      assert.ok(Math.abs((h.x - a.x) - g.hook.rx) < 0.5, 'anchor drifted from rope state');
      if (g.hook.rx > 60) g.hookUp();
    }
  }
  assert.ok(swung, 'never swung');
  assert.ok(worst < 0.01, 'rope stretched by ' + worst);
});

test('swing: letting go keeps momentum and flings you across the chasm', () => {
  for (const sp of [300, 450, 600, 720]) {
    const g = chasmWorld('swing', sp);
    const o0 = g.obstacles[0];
    let jumped = false, released = false, flungVx = 0;
    for (let i = 0; i < 120 * 10 && g.state === 'playing'; i++) {
      if (!jumped && o0.x - (CFG.PLAYER_X + 17) <= 150 && g.player.onGround) { g.press(); jumped = true; g.hookDown(); }
      if (g.hook && !released && g.hook.rx >= 60) { g.hookUp(); released = true; }
      g.step(DT);
      if (released && !flungVx && g.airVx) flungVx = g.airVx;
      if (released && g.player.onGround && o0.x + o0.w < CFG.PLAYER_X) break;
    }
    assert.strictEqual(g.state, 'playing', 'speed ' + sp + ': died (' + g.reason + ')');
    assert.ok(released && flungVx > 100, 'no momentum kept');
    assert.ok(g.player.onGround && g.player.standY === CFG.GROUND_Y, 'did not land on the far side');
  }
});

test('hook lock: staying on the button after arriving does not instantly re-hook', () => {
  const g = chasmWorld('pull', 400);
  g.hookDown();
  let hooks = 0; g.onEvent = (t) => { if (t === 'hook') hooks++; };
  run(g, 3);
  assert.strictEqual(hooks, 1);
});

// ---- Fairness: a bot that uses jump + hook must survive long runs ----
function bot(seed, jumpLead, meters, rel) {
  const g = new Game(seed); g.start(seed);
  const left = CFG.PLAYER_X + 8, front = CFG.PLAYER_X + CFG.PLAYER_W - CFG.HIT_INSET, handX = CFG.PLAYER_X + 17;
  let swingJumped = null;
  for (let i = 0; i < 120 * 500 && g.state === 'playing' && g.score() < meters; i++) {
    let next = null;
    for (const o of g.obstacles) if (o.type !== 'platform' && o.x + o.w > left) { next = o; break; }
    const chasm = next && next.type === 'gap' && next.chasm;
    if (chasm && next.chasm === 'pull') {
      if (!g.hookHeld && !g.hook && !g.hookLock) g.hookDown();
    } else if (chasm && next.chasm === 'swing') {
      if (g.player.onGround && swingJumped !== next && next.x - handX <= 150) { g.press(); g.hookDown(); swingJumped = next; }
      if (g.hook && g.hook.rx >= (rel == null ? 60 : rel)) g.hookUp();
    } else if (next && g.player.onGround && next.type !== 'branch' && !g.hook) {
      const ref = next.type === 'gap' ? left : front;
      if ((next.x - ref) / g.speed <= jumpLead) g.press();
    }
    // let go of the button once nothing is hooked and no chasm is next
    if (!g.hook && g.hookHeld && !chasm) g.hookUp();
    if (!g.hook && g.hookLock && g.player.onGround && g.player.standY === CFG.PLATFORM_Y) g.hookUp();
    g.step(DT);
  }
  return g;
}

test('fairness: bot (jump + both hook types) clears 1500m on 25 seeds', () => {
  const fails = [];
  for (let s = 1; s <= 25; s++) {
    const g = bot(s, 0.2, 1500);
    if (g.state !== 'playing') fails.push('seed ' + s + ' died at ' + g.score() + 'm (' + g.reason + ')');
  }
  assert.deepStrictEqual(fails, []);
});

test('fairness: jump timing window — leads 0.12s..0.30s all survive 800m', () => {
  const fails = [];
  for (let lead = 0.12; lead <= 0.301; lead += 0.02) {
    for (let s = 100; s < 108; s++) {
      const g = bot(s, lead, 800);
      if (g.state !== 'playing') fails.push('lead ' + lead.toFixed(2) + ' seed ' + s + ' died at ' + g.score() + 'm (' + g.reason + ')');
    }
  }
  assert.deepStrictEqual(fails, []);
});

test('fairness: swing release window — releasing anywhere from 20px to 100px past the anchor works', () => {
  const fails = [];
  for (const rel of [20, 60, 100]) {
    for (let s = 200; s < 210; s++) {
      const g = bot(s, 0.2, 800, rel);
      if (g.state !== 'playing') fails.push('rel ' + rel + ' seed ' + s + ' died at ' + g.score() + 'm (' + g.reason + ')');
    }
  }
  assert.deepStrictEqual(fails, []);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' — WITH FAILURES' : ''));

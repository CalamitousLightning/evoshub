// Headless logic tests for EVOLUTION 1 (lanes). Run: node tests/evolution-1-lanes/core.test.js
const path = require('path');
const { Game, CFG } = require(path.join(__dirname, '../../public/games/evolution-1-lanes/core.js'));

let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!cond) failed++;
}
const DT = 1 / 60;
function run(g, secs) { for (let t = 0; t < secs && g.state === 'playing'; t += DT) g.update(DT); }

// An empty, controlled world: no auto-spawning.
function world(obstacles, soft) {
  const g = new Game(1); g.start(1);
  g.obstacles = obstacles || []; g.nextZ = 1e9; g.coinList = [];
  if (!soft) g.wounded = 1e9;          // already wounded: the first hit is fatal (stumble is tested in its own section)
  return g;
}
const rock = (z, lanes) => ({ type: 'rock', z, len: 1.6, lanes, h: CFG.ROCK_H });
const wall = (z, lanes) => ({ type: 'wall', z, len: 2, lanes, h: CFG.WALL_H });
const branch = (z, lanes) => ({ type: 'branch', z, len: 1.2, lanes, low: CFG.BRANCH_LOW, h: CFG.BRANCH_LOW + CFG.BRANCH_THICK });
const chasm = (z, len) => ({ type: 'chasm', z, len, lanes: [-1, 0, 1], anchor: { kind: 'swing', z: z + len / 2, y: CFG.HAND_H + CFG.SWING_K * len, farZ: z + len } });
const ledge = (z, len) => ({ type: 'ledge', z, len, lanes: [-1, 0, 1], h: CFG.LEDGE_H, anchor: { kind: 'pull', z: z + CFG.PULL_RING_DZ, y: CFG.LEDGE_H + CFG.PULL_RING_DY } });

console.log('Basics');
{
  const g = new Game(5);
  ok('starts in menu', g.state === 'menu');
  g.start(5); ok('start -> playing', g.state === 'playing');
  g.obstacles = []; g.nextZ = 1e9;
  run(g, 1);
  ok('runner moves forward automatically', g.pz > 13 && g.pz < 16, g.pz.toFixed(2));
  const s0 = g.speed; run(g, 20);
  ok('difficulty rises over time (speed)', g.speed > s0 + 3, g.speed.toFixed(1));
  ok('speed is capped', (() => { const h = world(); h.time = 1e6; run(h, 0.1); return h.speed === CFG.MAX_SPEED; })());
  ok('score tracks distance', g.score() === Math.floor(g.pz));
  g.pause(); const z = g.pz; g.update(1); ok('pause freezes the world', g.pz === z && g.state === 'paused');
  g.resume(); ok('resume continues', g.state === 'playing');
}

console.log('Lanes');
{
  const g = world();
  g.moveLane(-1); run(g, 0.3);
  ok('swipe left moves to the left lane', Math.abs(g.px + CFG.LANE_W) < 0.01, g.px.toFixed(2));
  g.moveLane(-1); g.moveLane(-1); run(g, 0.3);
  ok('cannot leave the track (left)', g.lane === -1);
  g.moveLane(1); g.moveLane(1); run(g, 0.5);
  ok('two swipes right reach the right lane', Math.abs(g.px - CFG.LANE_W) < 0.01 && g.lane === 1);
  const h = world(); h.moveLane(1); run(h, 0.07);
  ok('lane change is quick (half-way in 70ms)', h.px > 0.5 && h.px < CFG.LANE_W, h.px.toFixed(2));
}

console.log('Jump / slide');
{
  const g = world(); g.jump(); let apex = 0, air = 0;
  for (let t = 0; t < 1.2; t += DT) { g.update(DT); apex = Math.max(apex, g.y); if (!g.onGround) air += DT; }
  ok('jump apex ~1.9', apex > 1.8 && apex < 2.05, apex.toFixed(2));
  ok('airtime ~0.68s', air > 0.6 && air < 0.78, air.toFixed(2));
  ok('lands back on the ground', g.onGround && g.y === 0);
  const s = world(); s.slide(); run(s, 0.1);
  ok('slide lowers the hitbox then ends', s.slideT > 0); run(s, 0.7); ok('slide ends', s.slideT <= 0);
  const b = world(); b.jump(); run(b, 0.2); b.slide();
  ok('swipe down in the air fast-falls', b.vy <= CFG.FALL_V + 0.01);
  const c = world(); run(c, 0.3); c.jump(); run(c, 0.001); // buffered/immediate jump from ground
  ok('jump from the ground works', c.y > 0 || c.vy > 0);
  const d = world(); d.jump(); run(d, 0.55); d.jump(); run(d, 0.2); // pressed slightly before landing -> buffered
  ok('early jump press before landing is buffered', d.vy > 0 || d.y > 0.3, d.y.toFixed(2));
}

console.log('Collisions');
{
  let g = world([rock(30, [0])]); run(g, 3);
  ok('running into a rock ends the run', g.state === 'over' && g.reason === 'rock', g.reason);
  g = world([rock(30, [0])]); run(g, (30 - 14 * 0.28 - 0.4) / 14 - 0.1); g.jump(); run(g, 3);
  ok('jumping over a rock works', g.state === 'playing' && g.pz > 33, g.state);
  g = world([rock(30, [1])]); run(g, 3);
  ok('rock in another lane is harmless', g.state === 'playing');
  g = world([wall(30, [0])]); run(g, 0.5); g.jump(); run(g, 3);
  ok('tall wall cannot be jumped', g.state === 'over' && g.reason === 'wall', g.reason);
  g = world([wall(30, [0])]); g.moveLane(1); run(g, 3);
  ok('changing lane avoids the wall', g.state === 'playing');
  g = world([branch(30, [0])]); run(g, 3);
  ok('standing into a low branch is a hit', g.state === 'over' && g.reason === 'branch', g.reason);
  g = world([branch(30, [0])]); run(g, (30 - 14 * 0.12 - 0.4) / 14 - 0.06); g.slide(); run(g, 3);
  ok('sliding under a low branch works', g.state === 'playing' && g.pz > 33, g.state);
  g = world([branch(30, [0])]); run(g, 1.2); g.jump(); run(g, 3);
  ok('jumping into a low branch is a hit', g.state === 'over', g.state);
  // pits
  g = world([{ type: 'pit', z: 30, len: 4, lanes: [-1, 0, 1] }]); run(g, 4);
  ok('walking into a pit ends the run', g.state === 'over' && (g.reason === 'fell' || g.reason === 'pit'), g.reason);
  g = world([{ type: 'pit', z: 30, len: 4, lanes: [-1, 0, 1] }]); run(g, (30 - 14 * 0.1) / 14 - 0.1); g.jump(); run(g, 3);
  ok('a normal pit can be jumped', g.state === 'playing' && g.pz > 36, g.state);
}

console.log('Hook: swing');
{
  // chasm of 20 units at speed 14 (airtime covers only ~9.6): not jumpable
  let g = world([chasm(40, 20)]); run(g, (40 - 14 * 0.12 - 0.4) / 14); g.jump(); run(g, 4);
  ok('a chasm cannot be jumped', g.state === 'over', g.state);
  g = world([chasm(40, 20)]); run(g, 1.2); g.hookPress(); run(g, 0.3);
  ok('tap arms the hook (nothing happens yet, no free flight)', !g.hook && g.hookArmed > 0 && g.state === 'playing');
  let minY = 0, latched = false, swung = false, maxUy = 0;
  g = world([chasm(40, 20)]); run(g, 1.2); g.hookPress();
  for (let t = 0; t < 6 && g.state === 'playing'; t += DT) {
    g.update(DT);
    if (g.hook) { latched = true; minY = Math.min(minY, g.y); const r = Math.hypot(g.hook.rz, g.hook.ry); if (Math.abs(r - g.hook.R) > 1e-6) swung = 'rope-broken'; else if (swung !== 'rope-broken') swung = true; }
  }
  ok('hook latches onto the vine near the chasm', latched);
  ok('rope stays taut (real pendulum constraint)', swung === true, swung);
  ok('swing dips below the track level (pendulum)', minY < -1, minY.toFixed(2));
  ok('swing carries the runner across the chasm and lands', g.state === 'playing' && g.pz > 62 && g.onGround && g.swings === 1, `${g.state} z=${g.pz.toFixed(1)} swings=${g.swings}`);
  const g2 = world([chasm(40, 20)]);
  ok('without the hook the same chasm kills', (() => { run(g2, 6); return g2.state === 'over'; })());
  // tapping HOOK again mid-swing releases early (too early = falls)
  g = world([chasm(40, 20)]); run(g, 1.2); g.hookPress();
  for (let t = 0; t < 3 && !g.hook; t += DT) g.update(DT);
  run(g, 0.15); g.hookPress(); run(g, 4);
  ok('releasing the rope too early makes you miss the far side', g.state === 'over', g.state);
  // a late tap (after the latch window) cannot latch
  g = world([chasm(40, 20)]); run(g, (40 + 1) / 14); g.hookPress(); run(g, 4);
  ok('a hook tap that is too late does not rescue you', g.state === 'over');
}

console.log('Hook: pull-up');
{
  let g = world([ledge(40, 24)]); run(g, (40 - 3) / 14);
  ok('ledge cannot be jumped', (() => { g.jump(); run(g, 3); return g.state === 'over' && g.reason === 'ledge'; })(), g.reason);
  g = world([ledge(40, 24)]); run(g, 1.2); g.hookPress();
  let maxY = 0, pulled = false, minPullY = 99;
  for (let t = 0; t < 6 && g.state === 'playing'; t += DT) { g.update(DT); maxY = Math.max(maxY, g.y); if (g.hook && g.hook.kind === 'pull') pulled = true; }
  ok('pull latches onto the ring', pulled);
  ok('pull hauls the runner up above the ledge', maxY > CFG.LEDGE_H, maxY.toFixed(2));
  ok('runner is alive and has run along the ledge top', g.state === 'playing' && g.pz > 42, `${g.state} z=${g.pz.toFixed(1)}`);
  ok('pull counted', g.pulls === 1);
  // runs off the far end and drops to the ground
  run(g, 3); ok('drops back to the ground at the end of the ledge', g.state === 'playing' && g.y === 0 && g.pz > 66, `y=${g.y} z=${g.pz.toFixed(1)}`);
}


console.log('Stumble (one mistake is survivable)');
{
  let g = world([rock(30, [0]), rock(46, [0])], true); run(g, 2.5);
  ok('first hit is a stumble, not game over', g.state === 'playing' && g.stumbles === 1 && g.wounded > 0, `${g.state} stumbles=${g.stumbles}`);
  ok('stumble slows the runner down', g.slow < 1);
  ok('invulnerable for a moment after the stumble', g.invuln > 0);
  g = world([rock(30, [0]), rock(46, [0])], true); run(g, 6);
  ok('a second hit while still wounded ends the run', g.state === 'over' && g.reason === 'rock', `${g.state} ${g.reason}`);
  g = world([rock(30, [0]), rock(30 + 14 * 15 + 30, [0])], true); run(g, 30);
  ok('wounds heal: a second hit after WOUND_T is only another stumble', g.state === 'playing' && g.stumbles === 2, `${g.state} stumbles=${g.stumbles}`);
  g = world([wall(30, [0]), branch(44, [0])], true); run(g, 6);
  ok('walls and branches stumble too (then a 2nd hit ends it)', g.state === 'over' && g.stumbles === 1 && g.reason === 'branch', `${g.state} ${g.reason} ${g.stumbles}`);
  g = world([{ type: 'pit', z: 30, len: 4, lanes: [-1, 0, 1] }], true); run(g, 5);
  ok('falling into a pit is always fatal (no stumble)', g.state === 'over' && g.stumbles === 0);
  g = world([ledge(30, 20)], true); run(g, 5);
  ok('hitting a ledge face is always fatal', g.state === 'over' && g.reason === 'ledge');
  g = world([rock(30, [0])], true); run(g, 5);
  ok('stumble lets you keep running through the obstacle', g.state === 'playing' && g.pz > 40);
  const sp = world([], true); sp.hit('rock'); const s0 = sp.slow; run(sp, 4);
  ok('speed recovers after a stumble', sp.slow === 1 && s0 < 0.6);
}

console.log('Coins');
{
  const coin = (z, lane, y) => ({ z, lane, y, tol: 1, taken: false });
  let g = world([]); const c1 = coin(20, 0, 0.9), c2 = coin(30, 1, 0.9), c3 = coin(40, 0, 2.6);
  g.coinList = [c1, c2, c3]; run(g, 4);
  ok('running through a coin collects it', c1.taken && g.coins === 1);
  ok('a coin in another lane is not collected', !c2.taken);
  ok('a high coin is not collected when running underneath it', !c3.taken);
  g = world([]); const c4 = coin(20, 0, 2.6); g.coinList = [c4]; run(g, 20 / 14 - 0.45); g.jump(); run(g, 1.5);
  ok('a jump collects a high coin', c4.taken);
  g = world([]); const c5 = coin(20, 0, 0.5); g.coinList = [c5]; run(g, 20 / 14 - 0.3); g.slide(); run(g, 1.5);
  ok('a sliding runner collects low coins', c5.taken);
  g = world([]); const c6 = coin(20, 0, 0.9); g.coinList = [c6]; run(g, 3);
  ok('points = distance + 10 per coin', g.points() === g.score() + 10 * g.coins && g.coins === 1);
  let events = 0; g = world([]); g.coinList = [coin(20, 0, 0.9)]; g.onEvent = t => { if (t === 'coin') events++; }; run(g, 3);
  ok("'coin' event fires once per coin", events === 1);
  // generated coins: plenty, never embedded in solid obstacles, restart clears them
  let total = 0, embedded = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const h = new Game(seed); h.start(seed); h.time = (seed % 5) * 20; while (h.nextZ < 3000) h.spawnRow();
    total += h.coinList.length;
    for (const c of h.coinList) for (const o of h.obstacles) {
      const solid = o.type === 'rock' || o.type === 'log' || o.type === 'wall' || o.type === 'branch' || o.type === 'ledge';
      if (!solid || !(c.z > o.z - 0.2 && c.z < o.z + o.len + 0.2) || !o.lanes.includes(c.lane)) continue;
      const lo = o.type === 'branch' ? o.low : 0;
      if (c.y + CFG.COIN_R > lo && c.y - CFG.COIN_R < o.h) embedded++;
    }
  }
  ok('generator places lots of coins', total > 2000, total);
  ok('no coin is embedded inside a solid obstacle', embedded === 0, embedded);
  const r = new Game(3); r.start(3); r.coins = 5; r.start(4);
  ok('restart resets coins', r.coins === 0 && r.stumbles === 0 && r.wounded === 0 && r.slow === 1);
}

console.log('Generator fairness');
{
  let rows = 0, bad = 0, hookRows = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g = new Game(seed); g.start(seed);
    g.time = (seed % 6) * 18; // sample different speeds
    while (g.nextZ < 4000) g.spawnRow();
    const byZ = {};
    g.obstacles.forEach(o => { (byZ[o.z] = byZ[o.z] || []).push(o); });
    for (const z in byZ) {
      rows++;
      // each lane must be passable: not blocked by a wall, and (if blocked by a jump/slide item) never by both kinds at once
      const lanes = [-1, 0, 1].map(l => byZ[z].filter(o => o.lanes.includes(l)));
      const passable = lanes.filter(items => !items.some(o => o.type === 'wall'));
      const wallsOnly = byZ[z].every(o => o.type === 'wall' || o.type === 'branch' || o.type === 'rock' || o.type === 'log' || o.type === 'pit' || o.type === 'chasm' || o.type === 'ledge');
      if (!passable.length || !wallsOnly) bad++;
      if (byZ[z].some(o => o.anchor)) hookRows++;
    }
    // spacing between consecutive rows must leave time to react (>= 0.9s at the speed they were spawned for)
    const sorted = g.obstacles.slice().sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].z !== sorted[i - 1].z && sorted[i].z - (sorted[i - 1].z + sorted[i - 1].len) < 11) bad++;
  }
  ok('every row leaves at least one lane free of tall walls; spacing >= 11 units', bad === 0, `${rows} rows, ${bad} bad`);
  ok('hook sections appear', hookRows > 20, hookRows);
}

console.log('Bot survival (lane-aware bot using lanes, jumps, slides and both hooks)');
function bot(g, st) {
  if (g.hook) return;
  const v = g.speed, pz = g.pz;
  for (const o of g.obstacles) {
    // arm the hook shortly before a chasm / ledge, but keep handling any other hazard in the meantime
    if ((o.type === 'chasm' && o.z + 0.4 > pz && o.z - pz < 20) || (o.type === 'ledge' && o.z > pz && o.z - pz < 20)) { if (g.hookArmed <= 0) g.hookPress(); }
  }
  const ahead = g.obstacles.filter(o => !o.anchor && o.z + o.len > pz - 0.3 && o.z - pz < v * 0.7 + 1).sort((a, b) => a.z - b.z);
  if (!ahead.length) return;
  const rz = ahead[0].z, row = ahead.filter(o => Math.abs(o.z - rz) < 0.5);
  const cost = (l) => { let c = 0; for (const o of row) if (o.lanes.includes(l)) c = o.type === 'wall' ? 99 : Math.max(c, 1); return c; };
  const cur = g.lane, d = rz - pz;
  if (st.cool > 0) st.cool -= DT;
  if (cost(cur) >= 99) {
    if (st.cool <= 0) {
      // pick the best free lane (may be two swipes away: the bot starts early enough, like a human looking ahead)
      const opts = [-1, 0, 1].filter(l => cost(l) < 99).sort((a, b) => cost(a) - cost(b) || Math.abs(a - cur) - Math.abs(b - cur));
      if (opts.length) { g.moveLane(Math.sign(opts[0] - cur)); st.cool = 0.1; }
    }
    return;
  }
  const item = row.find(o => o.lanes.includes(cur));
  if (!item) return;
  if (item.type === 'rock' || item.type === 'log') { if (g.onGround && d <= v * 0.2) g.jump(); }
  else if (item.type === 'pit') { if (g.onGround && d <= v * 0.1) g.jump(); }
  else if (item.type === 'branch') { if (g.onGround && d <= v * 0.12) g.slide(); }
}
{
  let deaths = 0, swings = 0, pulls = 0, maxScore = 0, firstFail = null; const N = 40, GOAL = 2500;
  for (let seed = 1; seed <= N; seed++) {
    const g = new Game(seed); g.start(seed); const st = { cool: 0 };
    for (let i = 0; i < 60 * 400 && g.state === 'playing' && g.pz < GOAL; i++) { bot(g, st); g.update(DT); }
    if (g.state !== 'playing') { deaths++; if (!firstFail) firstFail = `seed ${seed} died (${g.reason}) at ${g.pz.toFixed(0)}m`; }
    swings += g.swings; pulls += g.pulls; maxScore = Math.max(maxScore, g.score());
  }
  ok(`bot survives ${GOAL}m on ${N} seeds`, deaths === 0, `${deaths} deaths ${firstFail || ''}`);
  ok('bot used both hook functions during those runs', swings > 20 && pulls > 20, `${swings} swings, ${pulls} pulls`);
  const idle = new Game(3); idle.start(3); run(idle, 60);
  ok('an idle player eventually crashes (obstacles matter)', idle.state === 'over', idle.reason);
}

console.log('Route choice (the track forks into 3 paths)');
// a game whose first fork exists; the runner is placed `before` metres ahead of its gate (clear ground, nothing in between)
function forkWorld(seed, before, lane) {
  const g = new Game(seed); g.start(seed);
  while (!g.forks.length) g.spawnRow();
  const f = g.forks[0]; g.pz = f.z - before; g.invuln = 1e9;
  if (lane != null) { g.lane = lane; g.px = lane * CFG.LANE_W; }
  return { g, f };
}
const kindOf = (f, lane) => f.routes.find(r => r.lane === lane).kind;
{
  const g0 = new Game(11); g0.start(11);
  ok('no fork in the first stretch', g0.forks.length === 0 || g0.forks[0].z >= CFG.ROUTE_FIRST);
  const { g, f } = forkWorld(11, CFG.ROUTE_TIME * CFG.START_SPEED - 0.2);
  g.update(0.001);
  const fi = g.forkInfo();
  ok('a fork is announced with about 5 s to go', fi && fi.state === 'approach' && fi.shown && fi.t <= CFG.ROUTE_TIME + 0.06 && fi.t > CFG.ROUTE_TIME - 0.4, fi && fi.t.toFixed(2));
  const far = forkWorld(11, CFG.ROUTE_TIME * CFG.START_SPEED + 40); far.g.update(0.001);
  ok('it is not shown earlier than 5 s', far.g.forkInfo() && !far.g.forkInfo().shown);
  ok('three paths, one per lane, with all three kinds', f.routes.length === 3 && [-1, 0, 1].every(l => f.routes.some(r => r.lane === l)) && ['life', 'mid', 'death'].every(k => f.routes.some(r => r.kind === k)));
  ok('the Voice\'s correct path is the life door', kindOf(f, f.correct) === 'life');
  const inFork = g.obstacles.filter(o => o.z >= f.z && o.z <= f.end);
  ok('path obstacles are ordinary types, one lane each', inFork.length > 0 && inFork.every(o => ['rock', 'log', 'branch'].includes(o.type) && o.lanes.length === 1));
  const lane = k => f.routes.find(r => r.kind === k).lane;
  const perLane = l => inFork.filter(o => o.lanes[0] === l).length, coinsIn = l => g.coinList.filter(c => c.z > f.z + 1 && c.z < f.end && c.lane === l).length;
  ok('hazards: life 2, mid 3, death 5', perLane(lane('life')) === 2 && perLane(lane('mid')) === 3 && perLane(lane('death')) === 5, [perLane(lane('life')), perLane(lane('mid')), perLane(lane('death'))].join('/'));
  ok('coins on the path: life 8, mid 11, death 23', coinsIn(lane('life')) === 8 && coinsIn(lane('mid')) === 11 && coinsIn(lane('death')) === 23, [coinsIn(lane('life')), coinsIn(lane('mid')), coinsIn(lane('death'))].join('/'));
  ok('end bonus grows with the risk (10 / 20 / 40)', f.routes.find(r => r.kind === 'life').bonus === 10 && f.routes.find(r => r.kind === 'mid').bonus === 20 && f.routes.find(r => r.kind === 'death').bonus === 40);
}
{
  // the order of lanes / kinds is shuffled, so the safe path is not always the same one
  const seen = new Set(), themes = new Set();
  for (let seed = 1; seed <= 40; seed++) { const { f } = forkWorld(seed, 12); seen.add(f.correct); f.routes.forEach(r => themes.add(r.kind + ':' + r.id)); }
  ok('the safe path appears in every lane across forks', seen.size === 3, [...seen].join(','));
  ok('path names are mixed across kinds', themes.size >= 6, themes.size);
}
{
  // choosing: the lane you are in when the gate arrives is locked until the end; no swipe = default (current lane)
  [-1, 0, 1].forEach(l => {
    const { g, f } = forkWorld(11, 6, l); run(g, 0.7);
    ok(`lane ${l}: path committed at the gate`, g.route === f && f.pick === l && g.routesTaken === 1);
    g.moveLane(1); g.moveLane(-1); run(g, 0.3);
    ok(`lane ${l}: swipes are ignored during the path`, g.lane === l);
  });
  const { g, f } = forkWorld(11, 6, 0); run(g, 0.7);
  g.pz = f.end - 1; run(g, 0.5);
  ok('the path ends and the lane is free again', g.route === null && g.pz > f.end - 1);
  g.moveLane(1); ok('swiping works again after the path', g.lane === 1);
}
{
  // finishing a path alive pays its bonus; the life door also mends a stumble; events fire once each
  const done = kind => {
    const w = forkWorld(11, 6, null); const f = w.f, g = w.g, l = f.routes.find(r => r.kind === kind).lane;
    g.lane = l; g.px = l * CFG.LANE_W; g.wounded = 9; const ev = []; g.onEvent = t => ev.push(t);
    run(g, 0.7); const c0 = g.coins; g.pz = f.end - 0.5; run(g, 0.5);
    return { g, gain: g.coins - c0, ev };
  };
  const life = done('life'), mid = done('mid'), death = done('death');
  ok('life door: +10 coins and the wound is mended', life.gain === 10 && life.g.wounded === 0, life.gain);
  ok('mid door: +20 coins, wound stays', mid.gain === 20 && mid.g.wounded > 0, mid.gain);
  ok('death door: +40 coins', death.gain === 40, death.gain);
  ok('route and routeEnd events fire once each', death.ev.filter(e => e === 'route').length === 1 && death.ev.filter(e => e === 'routeEnd').length === 1, death.ev.join(','));
  const dead = forkWorld(11, 6, null); const dl = dead.f.routes.find(r => r.kind === 'death').lane; dead.g.lane = dl; dead.g.px = dl * CFG.LANE_W; dead.g.invuln = 0; dead.g.wounded = 1e9;
  run(dead.g, 3);
  ok('dying inside a path pays nothing', dead.g.state === 'over' && dead.g.lastRoute === null);
}
{
  // every path is fair for the lane-aware bot at all speeds, and there are many forks over a long run
  let forks = 0, deaths = 0, by = { life: 0, mid: 0, death: 0 };
  for (const lanePref of [-1, 0, 1]) for (let seed = 1; seed <= 12; seed++) {
    const g = new Game(seed); g.start(seed); g.time = (seed % 6) * 18; const st = { cool: 0 };
    for (let i = 0; i < 60 * 300 && g.state === 'playing' && g.pz < 2500; i++) { bot(g, st); g.update(DT); }
    forks += g.routesTaken; if (g.state !== 'playing') deaths++;
  }
  ok('bot clears the paths at every speed', deaths === 0 && forks > 30, `${forks} paths, ${deaths} deaths`);
}

console.log('Restart');
{
  const g = new Game(9); g.start(9); run(g, 60);
  ok('game over state reached', g.state === 'over');
  const best = g.score(); g.start(10);
  ok('restart resets state', g.state === 'playing' && g.pz === 0 && g.score() === 0 && g.reason === null && best > 0);
  ok('restart: world regenerated', g.obstacles.length > 0);
}

console.log('Hook upgrade (store)');
{
  const base = world([]); base.hookPress();
  const up = world([]); up.reach = 3; up.hookPress();
  ok('reach 0 keeps the default arming time', Math.abs(base.hookArmed - CFG.ARM_TIME) < 1e-9, base.hookArmed);
  ok('reach 3 arms longer (+0.9 s) - capped, not unlimited', Math.abs(up.hookArmed - (CFG.ARM_TIME + 0.9)) < 1e-9, up.hookArmed);
  ok('reach is kept when a new run starts', (() => { const g = new Game(3); g.reach = 2; g.start(4); return g.reach === 2; })());
  // a swing latch that is 1.4 m too early works only with the upgrade
  const mk = (lv) => { const g = world([{ type: 'chasm', z: 40, len: 20, lanes: [-1, 0, 1], anchor: { kind: 'swing', z: 50, y: CFG.HAND_H + CFG.SWING_K * 20, farZ: 60 } }]); g.reach = lv; g.pz = 40 - 1.4; g.hookPress(); g.tryLatch(); return !!g.hook; };
  ok('swing latch zone is wider with reach', mk(0) === false && mk(2) === true);
}

console.log('Route choice');
for (const kind of ['pit', 'chasm', 'ledge']) {
  const g = new Game(11); g.start(11); g.pz = 320; g.obstacles = []; g.coinList = []; g.nextZ = g.pz + 10; g.lastEnd = g.pz;
  while (g.nextZ < g.pz + CFG.SPAWN_AHEAD) g.spawnRow();
  const before = g.obstacles.filter(o => o.z < g.pz + 45).map(o => o.z + ':' + o.type).join();
  const o = g.setRoute(kind);
  ok('route ' + kind + ': returns the chosen obstacle', !!o && o.type === kind);
  ok('route ' + kind + ': near rows (<45 m) are untouched', g.obstacles.filter(x => x.z < g.pz + 45).map(x => x.z + ':' + x.type).join() === before);
  ok('route ' + kind + ': chosen hazard is at least 45 m ahead', o.z >= g.pz + 45, Math.round(o.z - g.pz));
  const rowsClash = (a) => a.some((x, i) => a.some((y, j) => j > i && Math.abs(x.z - y.z) > 0.01 && x.z < y.z + y.len - 0.01 && y.z < x.z + x.len - 0.01));   // same-z obstacles belong to one row (e.g. wall + log in different lanes)
  ok('route ' + kind + ': obstacles from different rows never overlap', !rowsClash(g.obstacles));
  ok('route ' + kind + ': generation keeps going to the spawn horizon', g.nextZ >= g.pz + CFG.SPAWN_AHEAD);
  ok('route ' + kind + ': no orphan coins inside the free gap before the hazard sits on a removed row', g.coinList.every(c => c.z > g.pz - 1));
}
{
  const g = new Game(5); g.start(5); ok('bad route kind is ignored', g.setRoute('lava') === null && g.forcedKind === null);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

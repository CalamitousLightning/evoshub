# Evolution 1: Lane Runner — tests

Game: `public/games/evolution-1-lanes/` (route `/games/evolution-1-lanes/`, not linked from any Hub page).

- `core.js` pure game logic (3 lanes, jump, slide, swing/pull hooks, coins, one-stumble allowance). Runs in Node and the browser.
- `render3d.js` Three.js (r169, vendored in `vendor/`, MIT licence in `vendor/three.LICENSE`) 3D renderer. Falls back to the 2D canvas renderer in `main.js` when WebGL is unavailable or on error; force it with `?mode=2d`.
- Scoring: `points = metres + 10 x coins`. Soft obstacles (rock, log, wall, branch) cost a stumble (slow + 1.4 s invulnerability, wounded for 12 s); a second hit while wounded, or any pit/chasm/ledge failure, ends the run.

## Run
- `node tests/evolution-1-lanes/core.test.js` logic, bot on 40 seeds, stumble and coin rules.
- `python3 tests/evolution-1-lanes/e2e.py` headless Chromium (SwiftShader) with real CDP touch, Hub CSP headers; runs portrait-3D, landscape-3D and 2D fallback. `EVO_ROOT=public|dist`, `EVO_ONLY=<label substring>`, `SHOTS_DIR=<dir>`.
  Software GL is slow (~12 fps), so timing-critical steps are dispatched from inside the page. Run it with no other heavy processes.
- The 3D canvas is mirrored once in CSS (`#gl { transform: scaleX(-1) }`) so swipe right = right lane; the coin face texture is pre-flipped to compensate.
- The runner in 3D is the 2D explorer artwork (drawn by main.js into an off-screen canvas, `drawPlayerSprite`) shown as a billboard, so the character is identical in 2D and 3D.

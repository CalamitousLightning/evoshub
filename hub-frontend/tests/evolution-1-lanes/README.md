# EVOLUTION 1: THE RUNNER (lanes, portrait) — tests & notes

Temple Run / Subway Surfers-style version. Lives at `hub-frontend/public/games/evolution-1-lanes/` and is copied untouched into `dist/` by Vite, served at **`/games/evolution-1-lanes/`**.
The side-scroller at `/games/evolution-1-runner/` is untouched. Isolated: no backend, auth, database, XERA/Pi code; **no navigation links point to it**; the page is `noindex`.

Tests live here (outside `public/`, never deployed):
- `node tests/evolution-1-lanes/core.test.js` — headless logic tests (lanes, jump, slide, collisions, both hook physics, generator fairness, lane-aware bot that must survive 2500 m on 40 seeds).
- `npm run build && python3 tests/evolution-1-lanes/e2e.py` — headless Chromium, emulated Android phone, REAL touch events, under the Hub's CSP, portrait + landscape. `EVO_ROOT=public` tests sources instead.

Controls: swipe left/right = lane · swipe up = jump · swipe down = slide (fast-fall in the air) · tap anywhere or HOOK button = hook.
Keyboard: arrows / WASD, Space = jump, X / H / Shift = hook, Esc / P = pause.
Hook: tap shortly BEFORE a chasm (yellow vine = swing) or a stone ledge (orange ring = pull up). The tap arms the hook for 2 s; it latches at the correct launch point.

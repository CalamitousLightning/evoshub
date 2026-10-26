# EVOLUTION 1: THE RUNNER — tests & notes

The game lives at `hub-frontend/public/games/evolution-1-runner/` and is copied untouched into `dist/games/evolution-1-runner/` by Vite (served at `/games/evolution-1-runner/`).
It is isolated: no backend, auth, database, XERA/Pi code, and **no navigation links point to it yet**. It is not in `sitemap.xml`; the page itself is `noindex`.

Tests live here (outside `public/`, so they are never deployed):
- `node tests/evolution-1-runner/core.test.js` — 21 headless logic tests (physics, collisions, hook, bot fairness).
- `npm run build && python3 tests/evolution-1-runner/e2e.py` — headless-Chromium Android-phone test of the BUILT game under the Hub's CSP (needs Playwright). `EVO_ROOT=public` tests the sources instead.

Controls: JUMP (button / screen / Space / Up / W) · HOOK hold (button / Shift / X / K) · Esc or P pauses.
Pull-up: hold HOOK near an orange ring. Swing: JUMP, then hold HOOK on a yellow vine, release just past it to fling across.

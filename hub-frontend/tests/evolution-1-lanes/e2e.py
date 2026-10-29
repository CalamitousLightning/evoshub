"""Browser end-to-end test for EVOLUTION 1 (lanes): headless Chromium, emulated Android phone, REAL touch events.
Runs the real-3D renderer in portrait + landscape, and the 2D fallback (?mode=2d) in portrait.
Run from hub-frontend/:   npm run build && python3 tests/evolution-1-lanes/e2e.py      (tests the BUILT Hub in dist/)
                          EVO_ROOT=public python3 tests/evolution-1-lanes/e2e.py       (tests the sources)
Needs: pip install playwright && playwright install chromium.  WebGL runs on software GL (SwiftShader) here, so frame
rates are low; the test checks behaviour and that the 3D canvas really draws, not performance.
"""
import http.server, socketserver, threading, os, sys, time, functools
from playwright.sync_api import sync_playwright

HF = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(HF, os.environ.get("EVO_ROOT", "dist"))
# Same security headers the Hub sends in production (netlify.toml): any CSP violation shows up as a console error.
HUB_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
           "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/evo1-lanes-shots")
os.makedirs(SHOTS, exist_ok=True)
GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Content-Security-Policy", HUB_CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{port}/games/evolution-1-lanes/"

failed = False
def check(name, cond, extra=""):
    global failed
    print(("  ok  " if cond else "FAIL  ") + name + (f"  [{extra}]" if extra else ""))
    if not cond: failed = True

def G(page, expr): return page.evaluate(f"(() => {{ const g = window.__EVO1_LANES__.game; const C = window.__EVO1_LANES__.core.CFG; return {expr}; }})()")
def X(page, stmts):
    """Run several statements in the page (G() wraps its argument in a single `return`)."""
    page.evaluate(f"(() => {{ const g = window.__EVO1_LANES__.game; const C = window.__EVO1_LANES__.core.CFG; {stmts} }})()")
def wait(page, expr, timeout=8000):
    try: _wait(page, expr, timeout)
    except Exception:
        print("   (wait timed out: %s) state=%s pz=%s" % (expr, page.evaluate("window.__EVO1_LANES__.game.state"), page.evaluate("window.__EVO1_LANES__.game.pz")))
        print("   debug:", page.evaluate("(() => { const g = window.__EVO1_LANES__.game; return JSON.stringify({armed: g.hookArmed, hook: !!g.hook, obs: g.obstacles.map(o => [o.type, o.z, o.used]), y: g.y, lane: g.lane, slow: g.slow, px: g.px, slideT: g.slideT, cl: g.coinList.map(c=>[c.z,c.taken]), pz: g.pz}); })()"))
        raise
def _wait(page, expr, timeout=8000):
    page.wait_for_function(f"() => {{ const g = window.__EVO1_LANES__.game; const C = window.__EVO1_LANES__.core.CFG; return {expr}; }}", timeout=timeout)
def setup(page, obstacles_js, coins_js="[]", time_s=0, wounded=True):
    """Empty controlled world starting now; z positions via Z(n) = n metres ahead of the runner."""
    page.evaluate(f"""(() => {{ const g = window.__EVO1_LANES__.game; const C = window.__EVO1_LANES__.core.CFG; const Z = n => g.pz + n;
      g.obstacles = []; g.nextZ = 1e9; g.time = {time_s}; g.wounded = {1e9 if wounded else 0}; g.invuln = 0; g.slow = 1;
      g.obstacles.push(...({obstacles_js})); g.coinList = ({coins_js}); }})()""")

def touch(cdp, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pts[0][0], "y": pts[0][1]}]})
    for p in pts[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": p[0], "y": p[1]}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
def swipe(cdp, x, y, dx, dy):
    touch(cdp, [(x, y), (x + dx * 0.4, y + dy * 0.4), (x + dx, y + dy)])
def tap_hook(page, cdp):
    """Real touch tap at the centre of the HOOK button (it pulses when a hook is needed, so no actionability waits)."""
    b = page.evaluate("(() => { const r = document.getElementById('hook-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
    touch(cdp, [(b[0], b[1])])

def tap_hook_fast(page):
    """Same HOOK-button handler, but dispatched inside the page: no CDP latency (timing-critical flows only)."""
    page.evaluate("""() => { const b = document.getElementById('hook-btn');
      b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
      b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch', isPrimary: true, bubbles: true })); }""")

def gl_draws(page):
    """Render one frame and report how many distinct colours the 3D canvas contains (blank canvas = 1)."""
    return page.evaluate("""() => { const r = window.EvoLanes3D; if (!r || !r.ready) return -1;
      r.render(window.__EVO1_LANES__.game, performance.now(), {}); const src = r.renderer.domElement;
      const c = document.createElement('canvas'); c.width = 48; c.height = 96; const x = c.getContext('2d'); x.drawImage(src, 0, 0, 48, 96);
      const d = x.getImageData(0, 0, 48, 96).data, set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return set.size; }""")

RUNS = [("portrait-3d", {"width": 412, "height": 892}, ""), ("landscape-3d", {"width": 892, "height": 412}, ""), ("portrait-2d-fallback", {"width": 412, "height": 892}, "?mode=2d")]

with sync_playwright() as p:
    browser = p.chromium.launch(args=GL_ARGS)
    for label, vp, query in RUNS:
        if os.environ.get('EVO_ONLY') and os.environ['EVO_ONLY'] not in label: continue
        want3d = "3d" in label
        print(f"\n== Android-style phone, {label} {vp['width']}x{vp['height']} ==")
        ctx = browser.new_context(viewport=vp, device_scale_factor=1.5, has_touch=True, is_mobile=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36")
        page = ctx.new_page(); cdp = ctx.new_cdp_session(page)
        errors, bad = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: bad.append(r.url))
        page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        page.goto(URL + query); page.wait_for_function("() => window.__EVO1_LANES__"); time.sleep(2.0 if want3d else 0.5)
        cx, cy = vp["width"] / 2, vp["height"] * 0.55

        check("loads with no JS errors, CSP violations or failed requests", not errors and not bad, f"{errors} {bad}")
        mode = page.evaluate("window.__EVO1_LANES__.mode()")
        check(f"renderer in use is {'real 3D (three.js)' if want3d else '2D fallback'}", mode == ("3d" if want3d else "2d"), mode)
        if want3d: check("3D canvas really draws a scene (many distinct colours)", gl_draws(page) > 25, gl_draws(page))
        check("start screen shown", page.is_visible("#overlay") and page.inner_text("#ov-btn") == "START" and G(page, "g.state") == "menu")
        page.screenshot(path=f"{SHOTS}/{label}-1-start.png")

        page.tap("#ov-btn"); time.sleep(0.2)
        check("START (touch tap) starts the game", G(page, "g.state") == "playing" and not page.is_visible("#overlay"))
        check("hook button visible & reachable (inside the screen, bottom-right)", page.evaluate("""(()=>{const r=document.getElementById('hook-btn').getBoundingClientRect();
            return r.width>=60 && r.right<=innerWidth && r.bottom<=innerHeight && r.left>innerWidth*0.5 && r.top>innerHeight*0.45})()"""))
        X(page, "window.__cnt = { jump: 0, slide: 0 }; const old = g.onEvent; g.onEvent = (t, gg) => { if (t in window.__cnt) window.__cnt[t]++; if (old) old(t, gg); };")
        setup(page, "[]")
        z0 = G(page, "g.pz"); wait(page, f"g.pz > {z0 + 4}", 15000)
        check("character runs forward automatically", G(page, "g.pz") > z0 + 4, f"{z0:.1f} -> {G(page, 'g.pz'):.1f}")

        # --- real touch swipes
        swipe(cdp, cx, cy, -140, 0); time.sleep(0.5)
        check("swipe LEFT changes to the left lane", G(page, "g.lane") == -1 and G(page, "g.px") < -1.5, f"lane={G(page, 'g.lane')} px={G(page, 'g.px'):.2f}")
        swipe(cdp, cx, cy, 140, 0); time.sleep(0.3); swipe(cdp, cx, cy, 140, 0); time.sleep(0.6)
        check("swipe RIGHT x2 reaches the right lane", G(page, "g.lane") == 1)
        swipe(cdp, cx, cy, 0, -140)
        try: page.wait_for_function("() => window.__cnt.jump > 0", timeout=5000)
        except Exception: pass
        check("swipe UP jumps", page.evaluate("window.__cnt.jump") > 0, f"jumps={page.evaluate('window.__cnt.jump')}")
        page.screenshot(path=f"{SHOTS}/{label}-2-jump.png")
        wait(page, "g.onGround", 4000)
        swipe(cdp, cx, cy, 0, 140)
        try: page.wait_for_function("() => window.__cnt.slide > 0", timeout=5000)
        except Exception: pass
        check("swipe DOWN slides", page.evaluate("window.__cnt.slide") > 0)
        check("page does not scroll or zoom during swipes", page.evaluate("scrollY===0 && scrollX===0 && visualViewport.scale===1"))
        touch(cdp, [(cx, cy)])
        try: wait(page, "g.hookArmed > 0", 4000)
        except Exception: pass
        check("tap on the screen arms the hook", G(page, "g.hookArmed") > 0)
        X(page, "g.hookArmed = 0;")
        tap_hook(page, cdp)
        try: wait(page, "g.hookArmed > 0", 6000)
        except Exception: pass
        check("a real touch on the HOOK button arms the hook", G(page, "g.hookArmed") > 0)

        # --- coins
        X(page, "g.lane = 0; g.px = 0;")
        setup(page, "[]", "[{z:Z(9), lane:0, y:0.9, tol:1, taken:false},{z:Z(11), lane:0, y:0.9, tol:1, taken:false},{z:Z(13), lane:0, y:0.9, tol:1, taken:false}]")
        wait(page, "g.coins === 3", 6000)
        check("running through coins collects them (counter = 3)", G(page, "g.coins") == 3 and G(page, "g.points()") == G(page, "g.score()") + 30)
        page.screenshot(path=f"{SHOTS}/{label}-3-coins.png")

        # --- stumble: first hit survivable, second ends the run; restart works
        setup(page, "[{type:'rock', z:Z(16), len:1.6, lanes:[0,1,-1], h:C.ROCK_H}]", wounded=False)
        wait(page, "g.stumbles === 1", 6000)
        check("first collision is a STUMBLE (still playing, slowed, wounded)", G(page, "g.state") == "playing" and G(page, "g.wounded") > 0 and G(page, "g.slow") < 1, f"slow={G(page, 'g.slow'):.2f}")
        page.screenshot(path=f"{SHOTS}/{label}-4-stumble.png")
        X(page, "g.obstacles.push({type:'rock', z:g.pz + 12, len:1.6, lanes:[0,1,-1], h:C.ROCK_H}); g.invuln = 0;")
        wait(page, "g.state === 'over'", 8000)
        check("second collision while wounded ends the run (reason = rock)", G(page, "g.reason") == "rock")
        page.wait_for_selector("#overlay:not([hidden])", timeout=4000)
        check("game-over screen with distance, coins + restart button", "RUN OVER" in page.inner_text("#ov-title") and page.inner_text("#ov-btn") == "RESTART" and "coins" in page.inner_text("#ov-stats"))
        page.screenshot(path=f"{SHOTS}/{label}-5-gameover.png")
        page.tap("#ov-btn"); time.sleep(0.3)
        check("RESTART works (playing again, score + coins reset)", G(page, "g.state") == "playing" and G(page, "g.score()") < 8 and G(page, "g.coins") == 0 and not page.is_visible("#overlay"))

        # --- jump over a rock with a real swipe at the right moment
        setup(page, "[{type:'rock', z:Z(14), len:1.6, lanes:[0], h:C.ROCK_H}]")
        rock_end = G(page, "g.obstacles[0].z + 1.6")
        # Timing-critical gesture: fire the swipe from INSIDE the page (same pointer handlers, zero latency) when the rock is 3 m ahead.
        # (CDP touch events take up to ~0.5 s under software GL, which would make a real-time jump meaningless.)
        page.evaluate("""() => new Promise(res => { const g = window.__EVO1_LANES__.game, c = document.getElementById('game');
            const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
            (function f() { if (g.obstacles[0].z - g.pz < 3.0) { ev('pointerdown', 200, 500); ev('pointermove', 200, 460); ev('pointermove', 200, 400); ev('pointerup', 200, 400); res(); } else requestAnimationFrame(f); })(); })""")
        wait(page, f"g.pz > {rock_end} || g.state === 'over'", 15000)
        check("jumping with a swipe clears the rock", G(page, "g.state") == "playing" and G(page, "g.pz") > rock_end and G(page, "g.stumbles") == 0, G(page, "g.reason"))

        # --- both hook functions, driven by taps on the HOOK button
        setup(page, "[{type:'chasm', z:Math.ceil(Z(40)/C.TILE)*C.TILE, len:20, lanes:[-1,0,1], anchor:{kind:'swing', z:Math.ceil(Z(40)/C.TILE)*C.TILE+10, y:C.HAND_H+C.SWING_K*20, farZ:Math.ceil(Z(40)/C.TILE)*C.TILE+20}}]")
        chasm_z = G(page, "g.obstacles[0].z")
        wait(page, "g.obstacles[0].z - g.pz < 22", 8000)
        tap_hook_fast(page)   # no screenshot between wait and tap: it would consume the 2 s arm window
        wait(page, "!!g.hook || g.swings === 1", 6000)
        wait(page, "g.swings === 1 || g.state === 'over'", 8000); time.sleep(2.2)
        check("HOOK swing carries the runner across the chasm", G(page, "g.state") == "playing" and G(page, "g.swings") == 1 and G(page, "g.pz") > chasm_z + 20, f"{G(page, 'g.state')} {G(page, 'g.reason')}")

        setup(page, "[{type:'ledge', z:Z(36), len:26, lanes:[-1,0,1], h:C.LEDGE_H, anchor:{kind:'pull', z:Z(37.6), y:C.LEDGE_H+C.PULL_RING_DY}}]")
        wait(page, "g.obstacles[0].z - g.pz < 22", 8000)
        tap_hook_fast(page)
        wait(page, "(g.hook && g.hook.kind === 'pull') || g.pulls === 1", 6000)
        wait(page, "g.pulls === 1 || g.state === 'over'", 6000)   # check right away: screenshots are slow and the ledge ends
        check("HOOK pull hauls the runner onto the ledge", G(page, "g.state") == "playing" and G(page, "g.pulls") == 1 and G(page, "g.y") > 3.0, f"{G(page, 'g.state')} y={G(page, 'g.y'):.2f}")
        page.screenshot(path=f"{SHOTS}/{label}-9-ledge-top.png")

        # --- pause + final error check
        X(page, "g.pause();"); z = G(page, "g.pz"); time.sleep(0.5)
        check("pause freezes the game", abs(G(page, "g.pz") - z) < 0.01)
        X(page, "g.resume();")
        check("still no errors after the whole session", not errors, errors)
        ctx.close()
    browser.close()

print("\nFAILED" if failed else "\nall passed")
sys.exit(1 if failed else 0)

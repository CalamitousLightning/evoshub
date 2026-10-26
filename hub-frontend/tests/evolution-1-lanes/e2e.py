"""Browser end-to-end test for EVOLUTION 1 (lanes): headless Chromium, emulated Android phone with REAL touch events.
Run from hub-frontend/:   npm run build && python3 tests/evolution-1-lanes/e2e.py      (tests the BUILT Hub in dist/)
                          EVO_ROOT=public python3 tests/evolution-1-lanes/e2e.py       (tests the sources)
Needs: pip install playwright && playwright install chromium
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
def setup(page, obstacles_js, time_s=0):
    """Empty controlled world starting now; obstacles given as JS using g.pz-relative z via Z(n)."""
    page.evaluate(f"""(() => {{ const g = window.__EVO1_LANES__.game; const C = window.__EVO1_LANES__.core.CFG; const Z = n => g.pz + n;
      g.obstacles = []; g.nextZ = 1e9; g.time = {time_s}; g.obstacles.push(...({obstacles_js})); }})()""")

def touch(cdp, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pts[0][0], "y": pts[0][1]}]})
    for p in pts[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": p[0], "y": p[1]}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
def swipe(cdp, x, y, dx, dy):
    touch(cdp, [(x, y), (x + dx * 0.4, y + dy * 0.4), (x + dx, y + dy)])

def tap_hook(page, cdp):
    """Real touch tap at the centre of the HOOK button (the button pulses when a hook is needed, so no actionability waits)."""
    b = page.evaluate("(() => { const r = document.getElementById('hook-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
    touch(cdp, [(b[0], b[1])])

with sync_playwright() as p:
    browser = p.chromium.launch()
    for label, vp in (("portrait", {"width": 412, "height": 892}), ("landscape", {"width": 892, "height": 412})):
        print(f"\n== Android-style phone, {label} {vp['width']}x{vp['height']} ==")
        ctx = browser.new_context(viewport=vp, device_scale_factor=2.6, has_touch=True, is_mobile=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36")
        page = ctx.new_page(); cdp = ctx.new_cdp_session(page)
        errors, bad = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: bad.append(r.url))
        page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        page.goto(URL); page.wait_for_function("() => window.__EVO1_LANES__"); time.sleep(0.4)
        cx, cy = vp["width"] / 2, vp["height"] * 0.55

        check("loads with no JS errors, CSP violations or failed requests", not errors and not bad, f"{errors} {bad}")
        check("start screen shown", page.is_visible("#overlay") and page.inner_text("#ov-btn") == "START" and G(page, "g.state") == "menu")
        check("canvas fills the screen", page.evaluate("(()=>{const r=document.getElementById('game').getBoundingClientRect();return Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2})()"))
        page.screenshot(path=f"{SHOTS}/{label}-1-start.png")

        page.tap("#ov-btn"); time.sleep(0.1)
        check("START (touch tap) starts the game", G(page, "g.state") == "playing" and not page.is_visible("#overlay"))
        check("hook button visible & reachable (inside the screen, bottom-right)", page.evaluate("""(()=>{const r=document.getElementById('hook-btn').getBoundingClientRect();
            return r.width>=60 && r.right<=innerWidth && r.bottom<=innerHeight && r.left>innerWidth*0.5 && r.top>innerHeight*0.45})()"""))
        setup(page, "[]")
        z0 = G(page, "g.pz"); time.sleep(0.5)
        check("character runs forward automatically", G(page, "g.pz") > z0 + 5, f"{z0:.1f} -> {G(page, 'g.pz'):.1f}")
        check("score updates on screen state", G(page, "g.score()") >= 5)

        # --- real touch swipes
        swipe(cdp, cx, cy, -140, 0); time.sleep(0.35)
        check("swipe LEFT changes to the left lane", G(page, "g.lane") == -1 and G(page, "g.px") < -1.5, f"lane={G(page, 'g.lane')} px={G(page, 'g.px'):.2f}")
        swipe(cdp, cx, cy, 140, 0); time.sleep(0.3); swipe(cdp, cx, cy, 140, 0); time.sleep(0.4)
        check("swipe RIGHT x2 reaches the right lane", G(page, "g.lane") == 1)
        swipe(cdp, cx, cy, 0, -140); time.sleep(0.2)
        check("swipe UP jumps", G(page, "g.y") > 0.3 or not G(page, "g.onGround"), f"y={G(page, 'g.y'):.2f}")
        page.screenshot(path=f"{SHOTS}/{label}-2-jump.png")
        time.sleep(0.8)
        swipe(cdp, cx, cy, 0, 140); time.sleep(0.15)
        check("swipe DOWN slides", G(page, "g.slideT") > 0)
        check("page does not scroll or zoom during swipes", page.evaluate("scrollY===0 && scrollX===0 && visualViewport.scale===1"))
        touch(cdp, [(cx, cy)]); time.sleep(0.15)
        check("tap on the screen arms the hook", G(page, "g.hookArmed") > 0)

        # --- collisions + game over + restart
        G(page, "g.lane = 0; g.px = 0; 0"); setup(page, "[{type:'rock', z:Z(18), len:1.6, lanes:[0,1,-1], h:C.ROCK_H}]")
        page.wait_for_function("() => window.__EVO1_LANES__.game.state === 'over'", timeout=6000)
        check("collision is detected (game over, reason = rock)", G(page, "g.reason") == "rock")
        page.wait_for_selector("#overlay:not([hidden])", timeout=3000)
        check("game-over screen with distance + restart button", "RUN OVER" in page.inner_text("#ov-title") and page.inner_text("#ov-btn") == "RESTART" and "m" in page.inner_text("#ov-stats"))
        page.screenshot(path=f"{SHOTS}/{label}-3-gameover.png")
        page.tap("#ov-btn"); time.sleep(0.2)
        check("RESTART works (playing again, score reset)", G(page, "g.state") == "playing" and G(page, "g.score()") < 8 and not page.is_visible("#overlay"))

        # --- jump over a rock with a real swipe at the right moment
        setup(page, "[{type:'rock', z:Z(14), len:1.6, lanes:[0], h:C.ROCK_H}]")
        page.wait_for_function("() => window.__EVO1_LANES__.game.obstacles[0].z - window.__EVO1_LANES__.game.pz < 3.2")
        swipe(cdp, cx, cy, 0, -140)
        time.sleep(1.0)
        check("jumping with a swipe clears the rock", G(page, "g.state") == "playing" and G(page, "g.pz") > G(page, "g.obstacles[0].z + 1.6"), G(page, "g.reason"))

        # --- both hook functions, driven by taps on the HOOK button
        setup(page, "[{type:'chasm', z:Z(40), len:20, lanes:[-1,0,1], anchor:{kind:'swing', z:Z(50), y:C.HAND_H+C.SWING_K*20, farZ:Z(60)}}]")
        chasm_z = G(page, "g.obstacles[0].z")
        page.wait_for_function("() => window.__EVO1_LANES__.game.obstacles[0].z - window.__EVO1_LANES__.game.pz < 22"); page.screenshot(path=f"{SHOTS}/{label}-4-chasm.png")
        tap_hook(page, cdp)
        page.wait_for_function("() => !!window.__EVO1_LANES__.game.hook", timeout=3000)
        page.screenshot(path=f"{SHOTS}/{label}-5-swing.png")
        page.wait_for_function("() => window.__EVO1_LANES__.game.swings === 1 || window.__EVO1_LANES__.game.state === 'over'", timeout=5000)
        time.sleep(1.6)
        check("HOOK swing carries the runner across the chasm", G(page, "g.state") == "playing" and G(page, "g.swings") == 1 and G(page, "g.pz") > chasm_z + 20, f"{G(page, 'g.state')} {G(page, 'g.reason')}")

        setup(page, "[{type:'ledge', z:Z(36), len:26, lanes:[-1,0,1], h:C.LEDGE_H, anchor:{kind:'pull', z:Z(37.6), y:C.LEDGE_H+C.PULL_RING_DY}}]")
        page.wait_for_function("() => window.__EVO1_LANES__.game.obstacles[0].z - window.__EVO1_LANES__.game.pz < 22")
        tap_hook(page, cdp)
        page.wait_for_function("() => window.__EVO1_LANES__.game.hook && window.__EVO1_LANES__.game.hook.kind === 'pull'", timeout=3000)
        page.screenshot(path=f"{SHOTS}/{label}-6-pull.png")
        page.wait_for_function("() => window.__EVO1_LANES__.game.pulls === 1 || window.__EVO1_LANES__.game.state === 'over'", timeout=4000)
        time.sleep(0.8)
        check("HOOK pull hauls the runner onto the ledge", G(page, "g.state") == "playing" and G(page, "g.pulls") == 1 and G(page, "g.y") > 3.0, f"{G(page, 'g.state')} y={G(page, 'g.y'):.2f}")
        page.screenshot(path=f"{SHOTS}/{label}-7-ledge-top.png")

        # --- difficulty over time + natural play + pause
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        G(page, "g.pause(); 0"); z = G(page, "g.pz"); time.sleep(0.4)
        check("pause freezes the game", abs(G(page, "g.pz") - z) < 0.01)
        G(page, "g.resume(); 0")
        errors2 = [e for e in errors]
        check("still no errors after the whole session", not errors2, errors2)
        ctx.close()
    browser.close()

print("\nFAILED" if failed else "\nall passed")
sys.exit(1 if failed else 0)

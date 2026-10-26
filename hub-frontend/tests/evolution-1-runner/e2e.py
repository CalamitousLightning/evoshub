"""Browser end-to-end test (headless Chromium, emulated touch phone).
Run from the game folder:  python3 tests/e2e.py
"""
import http.server, socketserver, threading, os, sys, time, functools
from playwright.sync_api import sync_playwright

# Serves the BUILT Hub (dist/) by default so we test exactly what gets deployed; set EVO_ROOT=public to test sources.
HF = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(HF, os.environ.get("EVO_ROOT", "dist"))
# Same security headers the Hub sends in production (netlify.toml): any CSP violation shows up as a console error.
HUB_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
           "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/evo1-shots")
os.makedirs(SHOTS, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Content-Security-Policy", HUB_CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

handler = functools.partial(Quiet, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{port}/games/evolution-1-runner/"

results, failed = [], False
def check(name, cond, extra=""):
    global failed
    results.append((name, bool(cond), extra))
    print(("  ok  " if cond else "FAIL  ") + name + (f"  [{extra}]" if extra else ""))
    if not cond: failed = True

def st(page): return page.evaluate("window.__EVO1_RUNNER__.game.state")
def g(page, expr): return page.evaluate(f"(() => {{ const g = window.__EVO1_RUNNER__.game; return {expr}; }})()")

with sync_playwright() as p:
    browser = p.chromium.launch()
    for label, vp in (("portrait", {"width": 412, "height": 892}), ("landscape", {"width": 892, "height": 412})):
        print(f"\n== Android-style phone, {label} {vp['width']}x{vp['height']} ==")
        ctx = browser.new_context(viewport=vp, device_scale_factor=2.6, has_touch=True, is_mobile=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36")
        page = ctx.new_page()
        errors, bad = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: bad.append(r.url))
        page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        page.goto(URL); page.wait_for_function("window.__EVO1_RUNNER__")
        time.sleep(0.4)

        check("page loads with no JS errors / failed requests", not errors and not bad, f"{errors} {bad}")
        check("start screen shown", page.is_visible("#overlay") and page.inner_text("#ov-btn") == "START")
        page.screenshot(path=f"{SHOTS}/{label}-1-start.png")

        # layout / reachability
        vw, vh = vp["width"], vp["height"]
        jb = page.locator("#jump-btn").bounding_box(); cb = page.locator("#game").bounding_box()
        check("jump button fully on screen and reachable", jb and jb["x"] >= 0 and jb["y"] >= 0 and jb["x"] + jb["width"] <= vw and jb["y"] + jb["height"] <= vh, str(jb))
        check("canvas fits the viewport", cb and cb["x"] >= -1 and cb["x"] + cb["width"] <= vw + 1 and cb["y"] + cb["height"] <= vh + 1, str(cb))
        check("no page scroll possible", page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1"))

        # start by tapping the START button with a real touch
        box = page.locator("#ov-btn").bounding_box()
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        time.sleep(0.4)
        check("game starts (touch on START)", st(page) == "playing")
        check("overlay hidden while playing", not page.is_visible("#overlay"))

        d0 = g(page, "g.distance"); time.sleep(0.5); d1 = g(page, "g.distance")
        check("character runs forward automatically (distance grows)", d1 > d0 + 100, f"{d0:.0f}->{d1:.0f}")
        check("score updates", g(page, "g.score()") >= 1, str(g(page, "g.score()")))

        # keep the player alive while testing input: clear obstacles
        page.evaluate("(() => { const g = window.__EVO1_RUNNER__.game; g.obstacles = []; g.lastEnd = 99999; })()")
        gy = g(page, "g.player.y")
        jb = page.locator("#jump-btn").bounding_box()
        page.touchscreen.tap(jb["x"] + jb["width"] / 2, jb["y"] + jb["height"] / 2)
        time.sleep(0.25)
        check("touch on JUMP button makes the player jump", g(page, "g.player.y") < gy - 40 and not g(page, "g.player.onGround"), str(g(page, "g.player.y")))
        time.sleep(0.9)
        check("player lands again", g(page, "g.player.onGround"))

        page.touchscreen.tap(cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2)
        time.sleep(0.25)
        check("tapping the game screen also jumps", not g(page, "g.player.onGround"))
        time.sleep(0.9)
        page.keyboard.press("Space"); time.sleep(0.25)
        check("keyboard Space jumps", not g(page, "g.player.onGround"))
        time.sleep(0.9)

        page.screenshot(path=f"{SHOTS}/{label}-2-playing.png")

        # browser scroll / gesture prevention
        prevented = page.evaluate("""() => { const e = new Event('touchmove', {cancelable: true, bubbles: true}); document.body.dispatchEvent(e); return e.defaultPrevented; }""")
        check("touchmove is cancelled (no accidental page scroll)", prevented)
        check("pull-to-refresh / panning disabled via CSS", page.evaluate("getComputedStyle(document.body).touchAction") == "none" and page.evaluate("getComputedStyle(document.body).overscrollBehaviorY") == "none")

        # collision -> game over
        page.evaluate("(() => { const g = window.__EVO1_RUNNER__.game; g.obstacles = [{type:'rock', x: 190, y: 320, w: 40, h: 40, ins: 6}]; g.lastEnd = 99999; })()")
        time.sleep(0.8)
        check("collision detected -> game over", st(page) == "over" and g(page, "g.reason") == "hit")
        check("game-over screen shows score + RESTART", page.is_visible("#overlay") and page.inner_text("#ov-btn") == "RESTART" and "Distance" in page.inner_text("#ov-stats"), page.inner_text("#ov-stats"))
        page.screenshot(path=f"{SHOTS}/{label}-3-gameover.png")

        # gap death
        page.wait_for_timeout(500)
        box = page.locator("#ov-btn").bounding_box()
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        time.sleep(0.3)
        check("RESTART (touch) works: playing again, score reset", st(page) == "playing" and g(page, "g.score()") <= 1, str(g(page, "g.score()")))
        page.evaluate("(() => { const g = window.__EVO1_RUNNER__.game; g.obstacles = [{type:'gap', x: 170, y: 360, w: 250, h: 0, ins: 0}]; g.lastEnd = 99999; })()")
        time.sleep(1.0)
        check("falling into a gap -> game over", st(page) == "over" and g(page, "g.reason") in ("fall", "hit"), str(g(page, "g.reason")))

        # restart by keyboard + best score persisted
        page.wait_for_timeout(500)
        page.keyboard.press("Enter"); time.sleep(0.3)
        check("Enter restarts", st(page) == "playing")

        # pause on background
        page.evaluate("window.dispatchEvent(new Event('blur'))"); time.sleep(0.2)
        check("auto-pauses when app loses focus", st(page) == "paused" and page.is_visible("#overlay"))
        d0 = g(page, "g.distance"); time.sleep(0.4)
        check("world frozen while paused", g(page, "g.distance") == d0)
        page.click("#ov-btn"); time.sleep(0.2)
        check("RESUME works", st(page) == "playing")

        page.evaluate("window.__onPlat = false; window.__platWatch = setInterval(() => { const g = window.__EVO1_RUNNER__.game; if (g.player.onGround && g.player.standY === 190) window.__onPlat = true; }, 8)")
        # HOOK button: real touch on a pull ring, then verify the player is hauled UP onto the platform
        hb = page.locator("#hook-btn").bounding_box()
        cdp = ctx.new_cdp_session(page)
        page.evaluate("""(() => { const g = window.__EVO1_RUNNER__.game;
            g.obstacles = []; g.anchors = []; g.lastEnd = 0; g.rng = () => 0.5; g.spawn('pullChasm'); g.lastEnd = 99999; })()""")
        check("HOOK button fully on screen", hb and hb["x"] >= 0 and hb["y"] >= 0 and hb["x"] + hb["width"] <= vw and hb["y"] + hb["height"] <= vh, str(hb))
        # hold the button with a real touch for 2.5s
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": hb["x"] + hb["width"] / 2, "y": hb["y"] + hb["height"] / 2}]})
        time.sleep(0.5)
        check("holding HOOK near a ring attaches the rope and reels the player up", g(page, "g.hooksUsed") >= 1 and g(page, "g.player.y") < 200, f"hooksUsed={g(page,'g.hooksUsed')} y={g(page,'g.player.y'):.0f}")
        top = g(page, "g.player.y"); time.sleep(0.6)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        time.sleep(1.0)
        check("pull-up hauled the player onto the canopy platform and they survived the chasm", page.evaluate("window.__onPlat") and st(page) == "playing", f"onPlatform={page.evaluate('window.__onPlat')} state={st(page)}")
        page.evaluate("clearInterval(window.__platWatch)")
        page.screenshot(path=f"{SHOTS}/{label}-4-hook.png")

        # fresh swing: jump + hold, release -> lands across
        page.evaluate("""(() => { const g = window.__EVO1_RUNNER__.game; g.start(7); g.obstacles = []; g.anchors = []; g.lastEnd = 0; g.rng = () => 0.5; g.spawn('swingChasm'); g.lastEnd = 99999; })()""")
        page.evaluate("""() => { window.__sw = setInterval(() => {
            const g = window.__EVO1_RUNNER__.game; if (g.state !== 'playing') return;
            const o = g.obstacles[0]; if (!o) return;
            if (!window.__swj && g.player.onGround && o.x - 157 <= 150) { g.press(); g.hookDown(); window.__swj = true; }
            if (g.hook && g.hook.rx >= 60) g.hookUp();
        }, 4); }""")
        time.sleep(4.5)
        check("swing across a chasm in the real page (rope physics + release)", st(page) == "playing" and g(page, "g.hooksUsed") >= 1 and g(page, "g.distance") > 600 and g(page, "g.player.onGround"), f"state={st(page)} reason={g(page,'g.reason')} hooks={g(page,'g.hooksUsed')}")
        page.screenshot(path=f"{SHOTS}/{label}-5-swing.png")
        page.evaluate("clearInterval(window.__sw)")

        # natural play with a bot (jumps + uses the hook on chasms)
        page.evaluate("window.__EVO1_RUNNER__.game.start(11)")
        t0 = g(page, "g.speed")
        page.evaluate("""() => { window.__swj2 = null; window.__bot = setInterval(() => {
            const g = window.__EVO1_RUNNER__.game; if (g.state !== 'playing') return;
            const left = 148, front = 168; let n = null;
            for (const o of g.obstacles) if (o.type !== 'platform' && o.x + o.w > left) { n = o; break; }
            const ch = n && n.type === 'gap' && n.chasm;
            if (ch && n.chasm === 'pull') { if (!g.hookHeld && !g.hook && !g.hookLock) g.hookDown(); }
            else if (ch && n.chasm === 'swing') {
                if (g.player.onGround && window.__swj2 !== n && n.x - 157 <= 150) { g.press(); g.hookDown(); window.__swj2 = n; }
                if (g.hook && g.hook.rx >= 60) g.hookUp();
            } else if (n && g.player.onGround && n.type !== 'branch' && !g.hook) { const ref = n.type === 'gap' ? left : front; if ((n.x - ref) / g.speed <= 0.2) g.press(); }
            if (!g.hook && g.hookHeld && !ch) g.hookUp();
            if (!g.hook && g.hookLock && g.player.onGround && g.player.standY === 190) g.hookUp();
        }, 4); }""")
        time.sleep(20)
        alive = st(page) == "playing"
        check("auto-pilot survives 20s of real obstacles + chasms in the real page", alive, f"state={st(page)} score={g(page,'g.score()')} reason={g(page,'g.reason')}")
        check("difficulty increases over time", g(page, "g.speed") > t0 + 50, f"{t0:.0f}->{g(page,'g.speed'):.0f}")
        page.screenshot(path=f"{SHOTS}/{label}-6-natural.png")
        page.evaluate("clearInterval(window.__bot)")

        # init guard + cleanup
        same = page.evaluate("""() => { const a = window.__EVO1_RUNNER__; const s = document.createElement('script'); s.src = 'main.js?again'; document.body.appendChild(s); return new Promise(r => s.onload = () => r(window.__EVO1_RUNNER__ === a)); }""")
        check("loading the script twice does not re-initialise", same)
        page.evaluate("window.__EVO1_RUNNER__.destroy()")
        check("destroy() clears the game instance", page.evaluate("window.__EVO1_RUNNER__") is None)
        check("no JS errors during the whole session", not errors, str(errors))
        ctx.close()
    browser.close()
httpd.shutdown()
print("\n%d/%d checks passed" % (sum(1 for r in results if r[1]), len(results)))
sys.exit(1 if failed else 0)

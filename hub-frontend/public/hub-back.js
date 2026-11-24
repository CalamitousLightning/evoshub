/* EVOS Hub — floating "back" tab with a two-choice menu.
 *
 * One tiny self-contained script (no dependencies, no build step) that sits on the
 * left edge of the screen, vertically centred, on top of every product that lives in
 * the Hub: EvosData, EVOSGPT, XERA, Website Creation and anything added later.
 * It is not a sidebar — just a small tab that expands on hover/focus.
 *
 * Tapping the tab opens a small menu with two choices:
 *   - Back to ecosystem  -> the product hub (/appevoxera), from any page
 *   - Back one page      -> the previous page (same as the browser's back button).
 *                           Greyed out ("No earlier page") when there is nothing
 *                           earlier on this site (deep link, new tab, refresh).
 * The menu closes when the person taps elsewhere, presses Esc, or picks a choice.
 *
 * Hub pages include it with <script src="/hub-back.js" defer>; the EvosData and
 * EVOSGPT apps inject it when they are built for the Hub mount.
 */
(function () {
  'use strict';
  if (window.__evosHubBack) return;
  window.__evosHubBack = true;

  var HUB_PATH = '/appevoxera';
  // Pages that ARE the hub (or its public front door): nothing to go back to.
  var HIDE_ON = ['/', '/index.html', '/home', '/home.html', '/appevoxera', '/appevoxera.html', '/xera', '/xera/', '/xera/index.html', '/xera/dashboard', '/hub', '/hub/index.html'];
  function hidden() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    return HIDE_ON.indexOf(p) !== -1;
  }

  // The apps (EvosData, EVOSGPT) move between screens with history.pushState, which does not
  // change document.referrer. Count those moves so "Back one page" works inside them too.
  var inSiteSteps = 0;
  try {
    var origPush = history.pushState;
    history.pushState = function () { inSiteSteps++; return origPush.apply(this, arguments); };
  } catch (e) { /* history locked down: fall back to the referrer check only */ }

  function cameFromThisSite() {
    try {
      if (!document.referrer || history.length < 2) return false;
      var r = new URL(document.referrer);
      return r.origin === location.origin && r.pathname !== location.pathname;
    } catch (e) { return false; }
  }
  function canGoBack() { return inSiteSteps > 0 || cameFromThisSite(); }

  var css = [
    '.evos-back{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:2147483000;',
    'display:flex;align-items:center;gap:8px;height:62px;width:64px;padding:0 0 0 8px;overflow:hidden;margin:0;',
    '-webkit-appearance:none;appearance:none;text-align:left;font:inherit;',
    'border:1px solid rgba(150,185,255,.28);border-left:0;border-radius:0 20px 20px 0;',
    'color:#e9f0ff;cursor:pointer;-webkit-tap-highlight-color:transparent;',
    'background:linear-gradient(160deg,rgba(24,34,56,.82),rgba(8,12,22,.9));',
    '-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);',
    'box-shadow:0 10px 30px -8px rgba(0,0,0,.7),0 0 22px -6px rgba(47,123,255,.45),inset 0 1px 0 rgba(255,255,255,.14);',
    'transition:width .35s cubic-bezier(.2,.8,.2,1),box-shadow .3s,border-color .3s;',
    'padding-left:max(8px,env(safe-area-inset-left));font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.evos-back:hover,.evos-back:focus-visible{width:158px;border-color:rgba(120,200,255,.7);',
    'box-shadow:0 10px 34px -8px rgba(0,0,0,.75),0 0 30px -4px rgba(47,123,255,.7),inset 0 1px 0 rgba(255,255,255,.2)}',
    '.evos-back:focus-visible{outline:2px solid #7cc8ff;outline-offset:2px}',
    '.evos-back:active{transform:translateY(-50%) scale(.97)}',
    /* while the menu is open the tab stays compact so the menu has room beside it */
    '.evos-back.is-open,.evos-back.is-open:hover,.evos-back.is-open:focus-visible{width:64px;border-color:rgba(120,200,255,.7)}',
    '.evos-back__chev{flex:none;width:16px;height:16px;opacity:.85}',
    '.evos-back__logo{flex:none;width:30px;height:30px;border-radius:50%;background:#fff;object-fit:contain;',
    'box-shadow:0 0 0 1px rgba(120,160,255,.45),0 0 14px rgba(47,123,255,.5)}',
    '.evos-back__txt{display:flex;flex-direction:column;gap:3px;white-space:nowrap;opacity:0;transform:translateX(-6px);',
    'transition:opacity .25s .05s,transform .3s .05s}',
    '.evos-back:hover .evos-back__txt,.evos-back:focus-visible .evos-back__txt{opacity:1;transform:none}',
    '.evos-back.is-open .evos-back__txt{opacity:0;transform:translateX(-6px)}',
    '.evos-back__txt b{font-size:13px;font-weight:700;letter-spacing:.01em}',
    '.evos-back__txt i{font-style:normal;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8fb4ff}',

    '.evos-bm{position:fixed;left:calc(72px + env(safe-area-inset-left));top:50%;z-index:2147483001;',
    'width:min(264px,calc(100vw - 88px - env(safe-area-inset-left)));display:flex;flex-direction:column;gap:4px;padding:6px;',
    'border:1px solid rgba(150,185,255,.28);border-radius:18px;',
    'background:linear-gradient(160deg,rgba(24,34,56,.94),rgba(8,12,22,.96));',
    '-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);',
    'box-shadow:0 18px 40px -10px rgba(0,0,0,.8),0 0 28px -6px rgba(47,123,255,.5),inset 0 1px 0 rgba(255,255,255,.14);',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9f0ff;',
    'transform:translateY(-50%);transform-origin:left center;animation:evosBmIn .18s cubic-bezier(.2,.8,.2,1)}',
    '.evos-bm[hidden]{display:none}',
    '@keyframes evosBmIn{from{opacity:0;transform:translateY(-50%) scale(.94)}to{opacity:1;transform:translateY(-50%) scale(1)}}',
    '.evos-bm__item{display:flex;align-items:center;gap:12px;width:100%;margin:0;padding:11px 12px;text-align:left;',
    '-webkit-appearance:none;appearance:none;font:inherit;color:inherit;background:transparent;border:0;border-radius:13px;',
    'cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s}',
    '.evos-bm__item:hover,.evos-bm__item:focus-visible{background:rgba(70,120,255,.2)}',
    '.evos-bm__item:focus-visible{outline:2px solid #7cc8ff;outline-offset:-2px}',
    '.evos-bm__item:active{background:rgba(70,120,255,.32)}',
    '.evos-bm__ic{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;',
    'background:rgba(120,160,255,.16);box-shadow:inset 0 0 0 1px rgba(120,160,255,.32)}',
    '.evos-bm__ic svg{width:17px;height:17px}',
    '.evos-bm__t{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.evos-bm__t b{font-size:14px;font-weight:700;letter-spacing:.01em}',
    '.evos-bm__t i{font-style:normal;font-size:11.5px;color:#8fb4ff}',
    '.evos-bm__item[aria-disabled="true"]{opacity:.42;cursor:not-allowed}',
    '.evos-bm__item[aria-disabled="true"]:hover,.evos-bm__item[aria-disabled="true"]:active{background:transparent}',
    '@media (max-width:640px){.evos-back{height:54px;width:56px;padding-left:max(6px,env(safe-area-inset-left))}',
    '.evos-back.is-open,.evos-back.is-open:hover,.evos-back.is-open:focus-visible{width:56px}',
    '.evos-back__logo{width:26px;height:26px}.evos-back__chev{width:14px;height:14px}',
    '.evos-bm{left:calc(64px + env(safe-area-inset-left));width:min(264px,calc(100vw - 80px - env(safe-area-inset-left)))}}',
    '@media (prefers-reduced-motion:reduce){.evos-back,.evos-back__txt,.evos-bm__item{transition:none}.evos-bm{animation:none}}',
    '@media print{.evos-back,.evos-bm{display:none}}'
  ].join('');

  var ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';

  function mount() {
    if (hidden() || document.getElementById('evos-back')) return;
    var style = document.createElement('style');
    style.id = 'evos-back-style';
    style.textContent = css;
    document.head.appendChild(style);

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.id = 'evos-back';
    tab.className = 'evos-back';
    tab.setAttribute('aria-label', 'Back options');
    tab.setAttribute('aria-haspopup', 'menu');
    tab.setAttribute('aria-expanded', 'false');
    tab.setAttribute('aria-controls', 'evos-back-menu');
    tab.innerHTML =
      '<svg class="evos-back__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
      '<img class="evos-back__logo" src="/assets/images/evoxera-mark.png" alt="" width="30" height="30" draggable="false">' +
      '<span class="evos-back__txt"><b>Back</b><i>Menu</i></span>';

    var menu = document.createElement('div');
    menu.id = 'evos-back-menu';
    menu.className = 'evos-bm';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Back options');
    menu.hidden = true;
    menu.innerHTML =
      '<button type="button" class="evos-bm__item" role="menuitem" data-act="hub">' +
        '<span class="evos-bm__ic">' + ICON_HOME + '</span>' +
        '<span class="evos-bm__t"><b>Back to ecosystem</b><i>EVOS Hub home</i></span></button>' +
      '<button type="button" class="evos-bm__item" role="menuitem" data-act="prev">' +
        '<span class="evos-bm__ic">' + ICON_BACK + '</span>' +
        '<span class="evos-bm__t"><b>Back one page</b><i data-sub>Previous page</i></span></button>';

    var hubBtn = menu.querySelector('[data-act="hub"]');
    var prevBtn = menu.querySelector('[data-act="prev"]');
    var prevSub = prevBtn.querySelector('[data-sub]');

    function isOpen() { return !menu.hidden; }

    function refreshPrev() {
      var ok = canGoBack();
      prevBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
      prevSub.textContent = ok ? 'Previous page' : 'No earlier page';
    }

    function enabledItems() {
      return [hubBtn, prevBtn].filter(function (b) { return b.getAttribute('aria-disabled') !== 'true'; });
    }

    function open() {
      refreshPrev();
      menu.hidden = false;
      tab.classList.add('is-open');
      tab.setAttribute('aria-expanded', 'true');
      hubBtn.focus({ preventScroll: true });
    }

    function close(returnFocus) {
      if (!isOpen()) return;
      menu.hidden = true;
      tab.classList.remove('is-open');
      tab.setAttribute('aria-expanded', 'false');
      if (returnFocus) tab.focus({ preventScroll: true });
    }

    tab.addEventListener('click', function (e) {
      e.preventDefault();
      if (isOpen()) close(false); else open();
    });

    hubBtn.addEventListener('click', function () {
      close(false);
      location.href = HUB_PATH;
    });

    prevBtn.addEventListener('click', function () {
      if (prevBtn.getAttribute('aria-disabled') === 'true') return;   // greyed out: nothing earlier
      close(false);
      history.back();
    });

    // Tap anywhere else to dismiss.
    document.addEventListener('pointerdown', function (e) {
      if (!isOpen()) return;
      if (menu.contains(e.target) || tab.contains(e.target)) return;
      close(false);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(true); return; }
      if (e.key === 'Tab') { close(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var items = enabledItems();
        if (!items.length) return;
        var i = items.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[next].focus({ preventScroll: true });
      }
    });

    window.addEventListener('popstate', function () { close(false); });

    document.body.appendChild(tab);
    document.body.appendChild(menu);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();

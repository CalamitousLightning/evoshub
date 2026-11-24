// EVOS Hub — PWA support: service worker registration + optional install prompt.
// Installation is never forced. Tapping an install button either opens the browser's own install
// popup (Chrome, Edge, Samsung Internet on Android/desktop) or, where the browser has no such popup
// (iPhone, in-app browsers like WhatsApp/Facebook, Firefox), our own "Install on your home screen" popup.

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[evos] service worker not registered:', err)
    })
  })
}

// The browser's install offer can arrive before any button exists, so listen from the moment this
// file loads (every page that imports it) and keep the offer for whichever button is pressed.
let deferredPrompt = null
const subscribers = new Set()
const notify = () => subscribers.forEach((fn) => { try { fn() } catch (_e) { /* a bad subscriber must not break the others */ } })

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
  notify()
})
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  closeInstallDialog()
  notify()
})

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

function detect() {
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
  // Browsers that live inside another app cannot install anything: the person must open the page in a real browser.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|Telegram|; wv\)/i.test(ua)
  return { ios, inApp }
}

// ---------------- the install popup ----------------
const DLG_ID = 'evos-install-dlg'
let dlgReturnFocus = null

const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'
const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>'
const ICON_MENU = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>'
const ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'

const DLG_CSS = [
  '.evos-idlg{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:flex-end;justify-content:center;',
  'padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));background:rgba(3,6,14,.66);',
  '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:evosIdFade .18s ease-out;',
  'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.evos-idlg[hidden]{display:none}',
  '@media (min-width:560px){.evos-idlg{align-items:center}}',
  '.evos-idlg__card{position:relative;width:min(400px,100%);padding:22px 20px 18px;border-radius:22px;color:#e9f0ff;text-align:center;',
  'border:1px solid rgba(150,185,255,.28);background:linear-gradient(160deg,rgba(24,34,56,.97),rgba(8,12,22,.98));',
  'box-shadow:0 24px 60px -12px rgba(0,0,0,.85),0 0 40px -8px rgba(47,123,255,.5),inset 0 1px 0 rgba(255,255,255,.14);',
  'animation:evosIdUp .22s cubic-bezier(.2,.8,.2,1)}',
  '.evos-idlg__x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:50%;margin:0;padding:0;',
  'background:rgba(255,255,255,.08);color:#cfd9f2;font:inherit;font-size:18px;line-height:1;cursor:pointer}',
  '.evos-idlg__x:focus-visible,.evos-idlg__btn:focus-visible{outline:2px solid #7cc8ff;outline-offset:2px}',
  '.evos-idlg__logo{display:block;width:60px;height:60px;margin:0 auto 12px;border-radius:16px;background:#fff;object-fit:contain;',
  'box-shadow:0 0 0 1px rgba(120,160,255,.45),0 0 22px rgba(47,123,255,.5)}',
  '.evos-idlg__t{margin:0 0 6px;font-size:19px;font-weight:700;letter-spacing:.01em}',
  '.evos-idlg__p{margin:0 0 14px;font-size:14px;line-height:1.5;color:#b9c8ea}',
  '.evos-idlg__rows{display:flex;flex-direction:column;gap:8px;margin:0 0 16px;text-align:left}',
  '.evos-idlg__row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;',
  'background:rgba(120,160,255,.1);box-shadow:inset 0 0 0 1px rgba(120,160,255,.22);font-size:14px;font-weight:600}',
  '.evos-idlg__row svg{flex:none;width:22px;height:22px;color:#7cc8ff}',
  '.evos-idlg__btn{display:block;width:100%;margin:0;padding:12px 16px;border:0;border-radius:14px;font:inherit;font-size:15px;font-weight:700;',
  'cursor:pointer;color:#fff;background:linear-gradient(135deg,#2f6bff,#1fb6ff);-webkit-tap-highlight-color:transparent}',
  '.evos-idlg__btn:active{transform:scale(.98)}',
  '.evos-idlg__btn--ghost{margin-top:8px;color:#b9c8ea;background:transparent;font-weight:600}',
  '@keyframes evosIdFade{from{opacity:0}to{opacity:1}}',
  '@keyframes evosIdUp{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}',
  '@media (prefers-reduced-motion:reduce){.evos-idlg,.evos-idlg__card{animation:none}}'
].join('')

function row(icon, text) { return '<div class="evos-idlg__row">' + icon + '<span>' + text + '</span></div>' }

function dialogContent() {
  const { ios, inApp } = detect()
  if (inApp) {
    return {
      title: 'Open in your browser to install',
      lead: 'This app’s built-in browser can’t install EVOS Hub. Open the page in Chrome or Safari, then tap Install.',
      rows: row(ICON_OPEN, 'Open in your browser'),
      primary: { label: 'Copy link', action: 'copy' }
    }
  }
  if (ios) {
    return {
      title: 'Install on your home screen',
      lead: 'Add EVOS Hub to your iPhone so it opens like an app.',
      rows: row(ICON_SHARE, 'Tap <b>Share</b>') + row(ICON_PLUS, 'Choose <b>Add to Home Screen</b>'),
      primary: { label: 'Got it', action: 'close' }
    }
  }
  return {
    title: 'Install on your phone',
    lead: 'Add EVOS Hub to your home screen so it opens like an app.',
    rows: row(ICON_MENU, 'Open your browser menu') + row(ICON_PHONE, 'Choose <b>Install app</b> or <b>Add to Home screen</b>'),
    primary: { label: 'Got it', action: 'close' }
  }
}

export function closeInstallDialog() {
  const el = document.getElementById(DLG_ID)
  if (!el) return
  el.remove()
  document.removeEventListener('keydown', onDlgKey, true)
  if (dlgReturnFocus && dlgReturnFocus.focus) { try { dlgReturnFocus.focus({ preventScroll: true }) } catch (_e) { /* gone */ } }
  dlgReturnFocus = null
}

function onDlgKey(e) {
  if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeInstallDialog(); return }
  if (e.key === 'Tab') {   // keep keyboard focus inside the popup
    const el = document.getElementById(DLG_ID)
    if (!el) return
    const f = el.querySelectorAll('button')
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
}

export function showInstallDialog() {
  if (document.getElementById(DLG_ID)) return
  if (!document.getElementById('evos-install-dlg-style')) {
    const st = document.createElement('style'); st.id = 'evos-install-dlg-style'; st.textContent = DLG_CSS
    document.head.appendChild(st)
  }
  const c = dialogContent()
  dlgReturnFocus = document.activeElement
  const wrap = document.createElement('div')
  wrap.id = DLG_ID
  wrap.className = 'evos-idlg'
  wrap.innerHTML =
    '<div class="evos-idlg__card" role="dialog" aria-modal="true" aria-labelledby="evos-idlg-t">' +
      '<button type="button" class="evos-idlg__x" aria-label="Close" data-close>&times;</button>' +
      '<img class="evos-idlg__logo" src="/assets/images/evoxera-mark.png" alt="" width="60" height="60" draggable="false">' +
      '<h2 class="evos-idlg__t" id="evos-idlg-t"></h2>' +
      '<p class="evos-idlg__p"></p>' +
      '<div class="evos-idlg__rows">' + c.rows + '</div>' +
      '<button type="button" class="evos-idlg__btn" data-primary></button>' +
      (c.primary.action === 'copy' ? '<button type="button" class="evos-idlg__btn evos-idlg__btn--ghost" data-close>Not now</button>' : '') +
    '</div>'
  wrap.querySelector('.evos-idlg__t').textContent = c.title
  wrap.querySelector('.evos-idlg__p').textContent = c.lead
  const primary = wrap.querySelector('[data-primary]')
  primary.textContent = c.primary.label
  primary.addEventListener('click', async () => {
    if (c.primary.action === 'copy') {
      try { await navigator.clipboard.writeText(location.href); primary.textContent = 'Link copied' }
      catch (_e) { primary.textContent = 'Copy failed' }
      return
    }
    closeInstallDialog()
  })
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeInstallDialog))
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeInstallDialog() })
  document.body.appendChild(wrap)
  document.addEventListener('keydown', onDlgKey, true)
  primary.focus({ preventScroll: true })
}

// ---------------- the install button ----------------
// Wire any button as an install button:
//   native install popup available  -> tapping opens the browser's own "Install app / Add to Home screen" popup
//   not available (iPhone, in-app browsers, Firefox, already dismissed) -> tapping opens our install popup
// `alwaysShow`: keep the button visible even before the browser says the app is installable.
export function initInstallButton(button, _opts = {}) {
  if (!button) return
  if (isStandalone()) return
  const opts = _opts || {}

  if (opts.alwaysShow) button.classList.add('is-available')
  const sync = () => { if (deferredPrompt) button.classList.add('is-available') }
  subscribers.add(sync)
  sync()
  window.addEventListener('appinstalled', () => button.classList.remove('is-available'))

  button.addEventListener('click', async () => {
    if (!deferredPrompt) { showInstallDialog(); return }
    const offer = deferredPrompt
    deferredPrompt = null   // a browser offer can only be used once
    try {
      await offer.prompt()
      await offer.userChoice
    } catch (_e) { /* the popup was blocked or closed: nothing to do */ }
    if (!opts.alwaysShow) button.classList.remove('is-available')
  })
}

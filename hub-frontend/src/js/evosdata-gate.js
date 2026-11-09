// EVOS Data is a Ghana-only product. When someone opens it from the ecosystem / app home /
// hub, check their country first:
//   - Ghana (or country unknown)  -> go straight to EVOS Data
//   - anywhere else               -> a popup says it is Ghana-only, with  [Okay]  [Proceed]
//
// This is a UX courtesy, not access control. The country comes from the hosting edge
// (/api/country) and a VPN can change it, so "Proceed" is allowed and the real rule is
// enforced by the EVOS Data backend (Ghana mobile number required on every order).
// One delegated listener covers every EVOS Data link on the page, including links added later.
import { detectCountry } from './evoxera-geo.js'

const FLAG = '__evosDataGate'
const HOME_COUNTRY = 'GH'

// Warm the cache so the click is instant (the lookup is cached per tab session).
function warm() { detectCountry().catch(() => {}) }

/** Only the EVOS Data front door. /evosdata/dashxera and other deep links are left alone. */
function isEvosDataLink(a) {
  if (!a || !a.getAttribute) return false
  const raw = a.getAttribute('href') || ''
  if (!raw || raw.startsWith('#')) return false
  let u
  try { u = new URL(raw, window.location.href) } catch { return false }
  if (u.origin !== window.location.origin) return false
  return /^\/evosdata\/?$/i.test(u.pathname)
}

function countryName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code } catch { return code }
}

const CSS = `
.edg-back{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(2,6,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
  animation:edg-in .16s ease-out}
.edg-box{width:min(380px,100%);box-sizing:border-box;padding:22px 20px 18px;border-radius:18px;
  background:var(--surface-solid,#0D121C);color:var(--text,#EAF1FF);
  border:1px solid var(--border2,rgba(148,196,255,.2));box-shadow:var(--shadow-lg,0 20px 60px rgba(0,0,0,.55));
  font-family:inherit;text-align:center}
.edg-ico{width:46px;height:46px;margin:0 auto 12px;border-radius:14px;display:flex;align-items:center;
  justify-content:center;font-size:22px;background:var(--green-dim,rgba(44,230,166,.12))}
.edg-box h2{margin:0 0 8px;font-size:1.12rem;line-height:1.3}
.edg-box p{margin:0 0 18px;font-size:.9rem;line-height:1.5;color:var(--text2,#93A2C2)}
.edg-row{display:flex;gap:10px}
.edg-btn{flex:1;min-height:44px;padding:10px 14px;border-radius:12px;font:inherit;font-weight:700;
  font-size:.92rem;cursor:pointer;border:1px solid var(--border2,rgba(148,196,255,.2));
  background:var(--surface2,rgba(255,255,255,.06));color:var(--text,#EAF1FF)}
.edg-btn--go{background:var(--green,#2CE6A6);border-color:transparent;color:#04120C}
.edg-btn:focus-visible{outline:2px solid var(--blue-light,#5FE3FF);outline-offset:2px}
@keyframes edg-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.edg-back{animation:none}}
`

function ensureStyle() {
  if (document.getElementById('edg-style')) return
  const st = document.createElement('style')
  st.id = 'edg-style'
  st.textContent = CSS
  document.head.appendChild(st)
}

function showPopup(code, href) {
  if (document.querySelector('.edg-back')) return
  ensureStyle()
  const opener = document.activeElement
  const where = code ? countryName(code) : 'your country'

  const back = document.createElement('div')
  back.className = 'edg-back'
  back.innerHTML = `
    <div class="edg-box" role="dialog" aria-modal="true" aria-labelledby="edg-t" aria-describedby="edg-d">
      <div class="edg-ico" aria-hidden="true">🇬🇭</div>
      <h2 id="edg-t">EVOS Data is only for Ghana</h2>
      <p id="edg-d">EVOS Data sells mobile data bundles for Ghana networks, and orders need a Ghana phone number.
        We see you are in ${where}.</p>
      <div class="edg-row">
        <button type="button" class="edg-btn" data-edg="ok">Okay</button>
        <button type="button" class="edg-btn edg-btn--go" data-edg="go">Proceed</button>
      </div>
    </div>`

  const close = () => {
    back.remove()
    document.removeEventListener('keydown', onKey, true)
    if (opener && opener.focus) { try { opener.focus() } catch { /* ignore */ } }
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Tab') {                       // keep focus inside the dialog
      const btns = back.querySelectorAll('button')
      const first = btns[0], last = btns[btns.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
  back.addEventListener('click', (e) => {
    if (e.target === back) { close(); return }   // tap outside = Okay
    const which = e.target.closest && e.target.closest('[data-edg]')
    if (!which) return
    if (which.getAttribute('data-edg') === 'go') { back.remove(); window.location.href = href }
    else close()
  })
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(back)
  back.querySelector('[data-edg="ok"]').focus()
}

async function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
  if (!isEvosDataLink(a)) return
  if (a.target && a.target !== '_self') return

  e.preventDefault()
  const href = a.href
  const code = await detectCountry()
  // Ghana -> straight in. Unknown (lookup failed / local test) is not treated as "abroad".
  if (!code || code === HOME_COUNTRY) { window.location.href = href; return }
  showPopup(code, href)
}

export function initEvosDataGate() {
  if (window[FLAG]) return
  window[FLAG] = true
  document.addEventListener('click', onClick)
  warm()
}

initEvosDataGate()

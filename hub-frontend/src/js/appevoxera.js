// EVOXERA — Evos Hub app landing (/appevoxera)
// Four sections: XERA, Ecosystem, Integrated, Company. Each tile is a plain link,
// so navigation works with no JS.
import './theme.js'
import './hub-auth.js'
import { initInstallButton } from './pwa.js'

initInstallButton(document.getElementById('install-btn'))

// Glass logo plates: use the real logo image once it loads, else keep the glyph fallback.
document.querySelectorAll('.ptile__glass').forEach((glass) => {
  const img = glass.querySelector('.ptile__img')
  if (!img) return
  const ready = () => { if (img.naturalWidth > 0) glass.classList.add('has-img') }
  if (img.complete) ready()
  else img.addEventListener('load', ready, { once: true })
})

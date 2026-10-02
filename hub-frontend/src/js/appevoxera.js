// EVOXERA — product hub (/appevoxera)
import './theme.js'
import { initInstallButton } from './pwa.js'
import { detectCountry } from './evoxera-geo.js'

initInstallButton(document.getElementById('install-btn'))

// ── EvosData: Ghana-only availability ──────────────────────────────
// The card is a normal link, so it works with no JS. Detection starts in the
// background; we only intercept the click when we *know* the visitor is
// outside Ghana. If the country can't be determined, we let them through
// (EvosData itself is the place to enforce eligibility).
const AVAILABLE_IN = 'GH'
let country = null
detectCountry().then((code) => { country = code })

const dialog = document.getElementById('evosdata-dialog')
const closeBtn = document.getElementById('evosdata-dialog-close')
const card = document.getElementById('card-evosdata')
let lastFocus = null

function openDialog() {
  lastFocus = document.activeElement
  dialog.hidden = false
  dialog.classList.add('is-open')
  closeBtn.focus()
}
function closeDialog() {
  dialog.classList.remove('is-open')
  dialog.hidden = true
  lastFocus?.focus?.()
}

card?.addEventListener('click', (e) => {
  if (country && country !== AVAILABLE_IN) {
    e.preventDefault()
    openDialog()
  }
})
closeBtn?.addEventListener('click', closeDialog)
dialog?.addEventListener('click', (e) => { if (e.target === dialog) closeDialog() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog && !dialog.hidden) closeDialog() })

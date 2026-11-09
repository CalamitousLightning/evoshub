// EVOS Hub — PWA support: service worker registration + optional install prompt.
// Installation is never forced: the install button only appears when the
// browser itself reports the app is installable.

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[evos] service worker not registered:', err)
    })
  })
}

let deferredPrompt = null

export function initInstallButton(button, opts = {}) {
  if (!button) return

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  if (standalone) return

  // `alwaysShow`: keep the button visible even before the browser says the app is installable
  // (iOS Safari never says it). Tapping it then shows how to install by hand in `opts.hint`.
  const hint = opts.hint || null
  if (opts.alwaysShow) button.classList.add('is-available')

  const manualSteps = () => {
    const ua = navigator.userAgent || ''
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
    if (ios) return 'To install: tap the Share button in Safari, then “Add to Home Screen”.'
    return 'To install: open your browser menu (⋮ or ⋯) and choose “Install app” or “Add to Home screen”.'
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    button.classList.add('is-available')
  })

  button.addEventListener('click', async () => {
    if (!deferredPrompt) {
      if (hint) {
        hint.textContent = manualSteps()
        hint.hidden = !hint.hidden
      }
      return
    }
    deferredPrompt.prompt()
    await deferredPrompt.userChoice.catch(() => null)
    deferredPrompt = null
    if (!opts.alwaysShow) button.classList.remove('is-available')
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    button.classList.remove('is-available')
    if (hint) hint.hidden = true
  })
}

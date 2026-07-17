// EVOSHUB — Theme toggle (dark default, persisted in localStorage)
// The initial theme is already applied by a blocking inline script in
// <head> before paint — this file only wires up the toggle button.
const KEY = 'evos-theme'
const root = document.documentElement
const toggles = document.querySelectorAll('[data-theme-toggle]')

function syncToggles(theme) {
  toggles.forEach(btn => {
    btn.setAttribute('aria-checked', theme === 'light' ? 'false' : 'true')
    btn.classList.toggle('is-light', theme === 'light')
  })
}
syncToggles(root.getAttribute('data-theme') || 'dark')

toggles.forEach(btn => {
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    root.setAttribute('data-theme', next)
    try { localStorage.setItem(KEY, next) } catch (e) {}
    syncToggles(next)
  })
})

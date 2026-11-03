// App-style icon grids (Ecosystem, Integrated): swap in real logo images when they
// load, and (on the Ecosystem page) append admin-curated links as extra icons.
import './nav.js'
import { fetchPublicJson } from './xera-public.js'
import { resolveEcosystemLink } from './internal-links.js'

function wireImages(root) {
  root.querySelectorAll('.appicon__tile img').forEach((img) => {
    const svg = img.parentElement.querySelector('svg')
    const ok = () => { if (img.naturalWidth > 0 && svg) svg.style.display = 'none' }
    img.addEventListener('error', () => img.remove(), { once: true })
    if (img.complete) { if (img.naturalWidth > 0) ok(); else img.remove() }   // already failed before this ran
    else img.addEventListener('load', ok, { once: true })
  })
}

const grid = document.getElementById('appGrid')
if (grid) {
  wireImages(grid)
  if (grid.dataset.curated === 'true') {
    fetchPublicJson('/api/xera/ecosystem').then((d) => {
      (d.links || []).forEach((l) => {
        const dest = resolveEcosystemLink(l.url)
        const a = document.createElement('a')
        a.className = 'appicon'
        a.href = dest.href
        if (dest.external) { a.target = '_blank'; a.rel = 'noopener' }
        const tile = document.createElement('span')
        tile.className = 'appicon__tile'
        const img = document.createElement('img')
        img.src = l.image_url; img.alt = ''; img.loading = 'lazy'
        tile.appendChild(img)
        const name = document.createElement('span')
        name.className = 'appicon__name'
        name.textContent = l.name          // textContent only: admin text is never parsed as HTML
        a.append(tile, name)
        grid.appendChild(a)
      })
      wireImages(grid)
    }).catch(() => { /* curated icons are optional */ })
  }
}

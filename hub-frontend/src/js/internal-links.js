// Ecosystem links are admin-curated (xera_ecosystem_links), so a row can still
// hold the standalone EVOS Data address. EVOS Data now lives inside the Hub at
// /evosdata, so those rows open in-app instead of leaving for evosdata.xyz.
// Every other link is returned untouched and stays an external, new-tab link.
const STANDALONE_EVOSDATA_HOSTS = new Set(['evosdata.xyz', 'www.evosdata.xyz'])

export function resolveEcosystemLink(rawUrl) {
  try {
    const u = new URL(rawUrl, window.location.origin)
    if (STANDALONE_EVOSDATA_HOSTS.has(u.hostname.toLowerCase())) {
      const path = u.pathname === '/' ? '' : u.pathname
      return { href: `/evosdata${path}${u.search}${u.hash}`, external: false }
    }
  } catch { /* not a parsable URL: fall through, leave as-is */ }
  return { href: rawUrl, external: true }
}

// An admin-curated link can describe an app that already has a built-in tile (EVOS GPT, XERA, ...), which then
// showed up twice. This returns a checker: call it with each curated link and skip the link when it says true.
// A link counts as a duplicate when its name matches a tile already in the grid (ignoring case, spaces and
// punctuation, so "EVOS GPT" = "EVOSGPT") or it points at the same in-app page. Duplicates among the curated
// links themselves are dropped too.
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
function pathKey(href) {
  try {
    const u = new URL(href, window.location.origin)
    if (u.origin !== window.location.origin) return ''
    const p = u.pathname.toLowerCase().replace(/\/+$/, '')
    return p || ''
  } catch { return '' }
}

export function makeEcosystemDeduper(grid, nameSelector) {
  const names = new Set()
  const paths = new Set()
  if (grid) {
    grid.querySelectorAll(nameSelector).forEach((el) => { const k = nameKey(el.textContent); if (k) names.add(k) })
    grid.querySelectorAll('a[href]').forEach((a) => { const k = pathKey(a.getAttribute('href')); if (k) paths.add(k) })
  }
  return (link, dest) => {
    const n = nameKey(link && link.name)
    const p = pathKey(dest && dest.href)
    if ((n && names.has(n)) || (p && paths.has(p))) return true
    if (n) names.add(n)
    if (p) paths.add(p)
    return false
  }
}

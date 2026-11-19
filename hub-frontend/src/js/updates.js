// /updates — public read-only feed of admin announcements. Anyone can read; nothing here writes.
import './theme.js'
import { fetchUpdates, getSeen, setSeen, renderPost, startAutoRefresh } from './updates-core.js'

const $ = (id) => document.getElementById(id)
const feed = $('feed')
const seenAtLoad = getSeen()           // "New" marks are decided once per visit, then the seen mark moves on
let oldest = null
let newest = 0                          // highest post id on screen, so a refresh can mark only truly new posts
let busy = false

function state(msg, retry) {
  feed.querySelectorAll('.up-state').forEach((n) => n.remove())
  const d = document.createElement('div'); d.className = 'up-state'
  d.textContent = msg
  if (retry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'up-btn'; b.textContent = 'Try again'; b.addEventListener('click', retry); d.appendChild(b) }
  feed.appendChild(d)
}

async function load(first) {
  if (busy) return
  busy = true
  $('moreBtn').hidden = true
  try {
    const { updates, hasMore } = await fetchUpdates({ limit: 15, before: first ? undefined : oldest })
    feed.querySelectorAll('.up-state').forEach((n) => n.remove())
    if (first && !updates.length) { state('No updates yet. Check back soon.'); return }
    if (first) { setSeen(updates[0].id); newest = updates[0].id }
    for (const u of updates) feed.appendChild(renderPost(u, { isNew: u.id > seenAtLoad }).el)
    if (updates.length) oldest = updates[updates.length - 1].id
    $('moreBtn').hidden = !hasMore
    if (first && location.hash.startsWith('#u-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  } catch (e) {
    state('Could not load updates right now.', () => { busy = false; load(first) })
  } finally { busy = false }
}

$('moreBtn').addEventListener('click', () => load(false))
state('Loading…')
load(true)

// Every 5 minutes: re-fetch the newest page and swap it in, so new, edited and deleted posts all show up
// without a manual reload. Posts further down (loaded with "Load more") are left alone.
async function refreshTop() {
  if (busy || document.querySelector('.up-lb') || !feed.querySelector('.up-card')) return
  const { updates } = await fetchUpdates({ limit: 15 })
  if (!updates.length) return
  const lowest = updates[updates.length - 1].id
  const prevNewest = newest
  feed.querySelectorAll('.up-card').forEach((n) => { if (Number(n.id.slice(2)) >= lowest) n.remove() })
  const anchor = feed.querySelector('.up-card')            // first card older than the refreshed page, if any
  for (const u of updates) feed.insertBefore(renderPost(u, { isNew: u.id > prevNewest }).el, anchor)
  newest = Math.max(newest, updates[0].id)
  setSeen(newest)
}
startAutoRefresh(refreshTop)

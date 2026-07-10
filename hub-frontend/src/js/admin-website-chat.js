// EVOSHUB — Admin/agent inbox for the Website Creation product.
//
// Every read/write here still goes through the same RLS policies as the
// visitor side — this file has no special privilege of its own. It works
// only because the signed-in user's row exists in admin_agents, which
// is_website_admin() checks server-side. There is nothing a browser devtools
// session could do here that the database wouldn't independently re-check.
import { supabase, isCurrentUserAdmin } from './supabase-client.js'

const whoamiEl    = document.getElementById('admin-whoami')
const signoutBtn  = document.getElementById('admin-signout')
const listEl      = document.getElementById('thread-list')
const headerEl    = document.getElementById('chat-header')
const logEl       = document.getElementById('admin-chat-log')
const statusSel   = document.getElementById('status-select')
const inputEl     = document.getElementById('admin-chat-input')
const sendBtn     = document.getElementById('admin-chat-send')

let requests = []
let activeRequestId = null
let chatChannel = null
let requestsChannel = null

// --- Gate the whole page behind a real server-side admin check -------------------
async function guard() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return redirectToLogin()

  const admin = await isCurrentUserAdmin()
  if (!admin) return redirectToLogin()

  whoamiEl.textContent = session.user.email || 'Agent'
  return session
}
function redirectToLogin() {
  window.location.href = '/admin-login.html'
}

signoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut()
  redirectToLogin()
})

// --- Thread list ------------------------------------------------------------------
function renderThreadList() {
  if (!requests.length) {
    listEl.innerHTML = '<div class="empty-state">No requests yet</div>'
    return
  }
  listEl.innerHTML = ''
  requests.forEach((r) => {
    const item = document.createElement('div')
    item.className = 'thread-item' + (r.id === activeRequestId ? ' active' : '')
    const name = document.createElement('h4')
    name.textContent = r.full_name + '  ·  ' + r.package
    const meta = document.createElement('p')
    meta.textContent = `${r.email} — ${r.status}`
    item.appendChild(name)
    item.appendChild(meta)
    item.addEventListener('click', () => openRequest(r.id))
    listEl.appendChild(item)
  })
}

async function loadRequests() {
  const { data, error } = await supabase
    .from('website_requests')
    .select('id, full_name, email, package, status, project_brief, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin-inbox] failed to load requests', error)
    return
  }
  requests = data
  renderThreadList()
}

function subscribeToRequestChanges() {
  if (requestsChannel) supabase.removeChannel(requestsChannel)
  requestsChannel = supabase
    .channel('admin_website_requests')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'website_requests' }, () => {
      loadRequests()
    })
    .subscribe()
}

// --- Chat panel ---------------------------------------------------------------------
function renderMessage(msg) {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex; flex-direction:column; align-items:' +
    (msg.sender_role === 'admin' ? 'flex-end' : 'flex-start') + ';'
  const bubble = document.createElement('div')
  bubble.style.cssText = 'max-width:70%; padding:9px 13px; border-radius:12px; font-size:13.5px; line-height:1.5;' +
    (msg.sender_role === 'admin'
      ? 'background:var(--blue); color:#fff;'
      : 'background:var(--surface2); color:var(--text);')
  bubble.textContent = msg.body // textContent only — never innerHTML with chat text
  row.appendChild(bubble)
  logEl.appendChild(row)
  logEl.scrollTop = logEl.scrollHeight
}

async function openRequest(requestId) {
  activeRequestId = requestId
  renderThreadList()

  const req = requests.find((r) => r.id === requestId)
  headerEl.innerHTML = ''
  const h = document.createElement('strong')
  h.textContent = `${req.full_name} — ${req.package}`
  headerEl.appendChild(h)

  statusSel.disabled = false
  statusSel.value = req.status
  inputEl.disabled = false
  sendBtn.disabled = false

  const { data, error } = await supabase
    .from('website_chat_messages')
    .select('id, sender_role, body, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })

  logEl.innerHTML = ''
  if (!error) data.forEach(renderMessage)

  if (chatChannel) supabase.removeChannel(chatChannel)
  chatChannel = supabase
    .channel(`admin_chat_${requestId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'website_chat_messages', filter: `request_id=eq.${requestId}` },
      (payload) => renderMessage(payload.new)
    )
    .subscribe()

  // Mark as in_chat the first time an agent opens it.
  if (req.status === 'new') {
    await supabase.from('website_requests').update({ status: 'in_chat' }).eq('id', requestId)
  }
}

statusSel.addEventListener('change', async () => {
  if (!activeRequestId) return
  await supabase.from('website_requests').update({ status: statusSel.value }).eq('id', activeRequestId)
})

async function sendReply() {
  const body = inputEl.value.trim()
  if (!body || !activeRequestId) return
  const { data: { session } } = await supabase.auth.getSession()

  sendBtn.disabled = true
  const { error } = await supabase.from('website_chat_messages').insert({
    request_id: activeRequestId,
    sender_id: session.user.id,
    sender_role: 'admin',
    body,
  })
  sendBtn.disabled = false
  if (error) {
    console.error('[admin-inbox] send failed', error)
    return
  }
  inputEl.value = ''
}

sendBtn.addEventListener('click', sendReply)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendReply()
})

// --- Boot -----------------------------------------------------------------------
;(async function init() {
  const session = await guard()
  if (!session) return
  await loadRequests()
  subscribeToRequestChanges()
})()

// Authenticated GET/POST against the FastAPI backend (same base URL xera.js uses).
// Unlike evos-session's api(), a 401 here never redirects: home screens simply show
// their signed-out state.
import { XERA_API } from './xera-public.js'
import { getToken } from './evos-session.js'

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${XERA_API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) },
  })
  return res.json()
}

// Shared session helpers for the admin console modules. The token is the same
// sessionStorage entry written by the sign-in form; the server re-checks it
// (and the live admin_agents row) on every request, so this holds no authority.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ||
  ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8000' : 'https://api.evoshub.xyz')
export const TOKEN_KEY = 'evoshub_admin_token'

export const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } }
export const authHeaders = () => (token() ? { Authorization: `Bearer ${token()}` } : {})

let onOut = () => {}
export const setSignedOutHandler = (fn) => { onOut = fn }
export const signedOut = () => { try { sessionStorage.removeItem(TOKEN_KEY) } catch (e) { /* ignore */ } onOut() }

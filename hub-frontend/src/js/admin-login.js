// EVOSHUB — Admin/agent sign-in for the Website Creation product.
// Reuses the shared Supabase auth (same accounts as EVOSDATA). A successful
// password login is NOT enough on its own — every account that logs in here
// is checked against is_website_admin() (a SECURITY DEFINER Postgres
// function), so a regular shared-auth user who logs in but isn't in
// admin_agents gets immediately signed back out and shown a generic error.
import { supabase, isCurrentUserAdmin } from './supabase-client.js'

const form     = document.getElementById('admin-login-form')
const emailEl  = document.getElementById('al-email')
const passEl   = document.getElementById('al-password')
const errorEl  = document.getElementById('al-error')
const submitBtn = document.getElementById('al-submit')

function showError(msg) {
  errorEl.textContent = msg
  errorEl.style.display = 'block'
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  errorEl.style.display = 'none'
  submitBtn.disabled = true
  submitBtn.textContent = 'Signing in…'

  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: emailEl.value.trim(),
      password: passEl.value,
    })

    // Same generic message for "wrong password" and "not found" — don't
    // reveal which emails have accounts.
    if (signInError) throw new Error('generic')

    const isAdmin = await isCurrentUserAdmin()
    if (!isAdmin) {
      await supabase.auth.signOut()
      throw new Error('generic')
    }

    window.location.href = '/admin-website-chat.html'
  } catch {
    showError('Invalid credentials or account is not authorized as an agent.')
    submitBtn.disabled = false
    submitBtn.textContent = 'Sign in'
  }
})

// If already signed in and already an admin, skip straight to the dashboard.
;(async function redirectIfAlreadyAdmin() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  if (await isCurrentUserAdmin()) {
    window.location.href = '/admin-website-chat.html'
  }
})()

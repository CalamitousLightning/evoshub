// Standalone XERA wallet page (/xera-wallet.html).
//
// Same wallet + claim screen as the "Move XERA to your wallet" tab inside the XERA app, but on its own page,
// the way the admin pilot page works. When a phone wallet app (SafePal, Trust, ...) sends the user back, the
// browser reopens THIS page, so the wallet link is picked up and finished here, instead of dropping the user on
// the XERA home screen. The wallet and claim code itself is xera-chain.js (shared); user mode, no relayer.
import './xera-chain.js';

const API = window.XERA_API_BASE || (import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8000' : 'https://api.evoshub.xyz');
const $ = (id) => document.getElementById(id);

const token = () => { try { return localStorage.getItem('xera_evos_token') || ''; } catch (_e) { return ''; } };
function expired(t) {
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !!(p.exp && p.exp * 1000 < Date.now());
  } catch (_e) { return false; }
}

async function init() {
  const t = token();
  if (!t || expired(t)) { location.replace('/xera'); return; }   // sign in on the XERA app first
  let enabled = false;
  try {
    const r = await fetch(API + '/api/xera/chain/config', { cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    enabled = !!(d && d.onchain_enabled === true);
  } catch (_e) { enabled = false; }
  window.__xeraOnchainEnabled = enabled;
  if (!enabled) { $('walletClosed').hidden = false; return; }
  $('walletReadyNote').hidden = false;
  $('openChain').click();   // loads wallets, claimable balance, vesting, and finishes any wallet link in progress
}
init();

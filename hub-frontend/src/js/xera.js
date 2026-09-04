const API = window.XERA_API_BASE || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8000' : 'https://api.evoshub.xyz');
const $ = (id) => document.getElementById(id);
const RING_CIRCUMFERENCE = 339.29; // 2 * PI * 54

let mining = null;
let tickHandle = null;

const token = () => localStorage.getItem('xera_evos_token') || '';
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function req(path, opts = {}) {
    const r = await fetch(API + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'Request failed');
    return d;
}

function showLogin(message) {
    localStorage.removeItem('xera_evos_token');
    $('walletView').hidden = true;
    $('walletView').style.display = 'none';
    $('loginView').hidden = false;
    if (message) $('loginError').textContent = message;
}

async function login(e) {
    e.preventDefault();
    $('loginError').textContent = '';
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
        const d = await req('/api/xera/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier: $('identifier').value, password: $('password').value })
        });
        localStorage.setItem('xera_evos_token', d.token);
        localStorage.setItem('xera_evos_user', JSON.stringify(d.user));
        await load();
    } catch (err) {
        $('loginError').textContent = err.message;
    } finally {
        btn.disabled = false;
    }
}

const TX_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l3 8 4-16 3 8h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderTransactions(list) {
    if (!list.length) {
        $('transactions').innerHTML = `<div class="empty">${EMPTY_ICON}<p>No activity yet — start mining to see it here.</p></div>`;
        return;
    }
    $('transactions').innerHTML = list.map((x) => {
        const isCredit = x.direction === 'CREDIT';
        const label = x.type.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
        const when = new Date(x.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="activity-row">
            <div class="activity-icon">${TX_ICON}</div>
            <div class="activity-mid"><div class="t">${label}</div><div class="d">${when}</div></div>
            <div class="activity-amt ${isCredit ? 'credit' : ''}">${isCredit ? '+' : '-'}${fmt(x.amount)}<span class="st">${x.status.toLowerCase()}</span></div>
        </div>`;
    }).join('');
}

async function load() {
    try {
        const [w, m, t] = await Promise.all([
            req('/api/xera/wallet'),
            req('/api/xera/mining/status'),
            req('/api/xera/transactions?limit=20&offset=0')
        ]);
        $('loginView').hidden = true;
        $('walletView').hidden = false;
        $('walletView').style.display = 'flex';
        $('balance').textContent = fmt(w.balance);
        $('walletStatus').innerHTML = `<span class="dot"></span>${w.wallet_status || 'ACTIVE'}`;
        mining = m.mining;
        renderMining();
        renderTransactions(t.transactions || []);
        if (!tickHandle) tickHandle = setInterval(() => { if (mining) renderMining(); }, 1000);
    } catch (err) {
        showLogin('Please sign in again.');
    }
}

function setRing(fraction, done) {
    const fg = $('ringFg');
    const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
    fg.style.strokeDashoffset = String(offset);
    fg.classList.toggle('done', !!done);
}

function renderMining() {
    const btn = $('miningAction');
    if (!mining) {
        setRing(0, false);
        $('countdown').textContent = '24:00:00';
        $('ringCaption').textContent = 'Ready to start';
        $('rewardText').textContent = 'The server controls the mining timer.';
        btn.textContent = 'Start mining';
        btn.classList.remove('ready');
        btn.disabled = false;
        return;
    }

    const start = new Date(mining.started_at).getTime();
    const end = new Date(mining.expires_at).getTime();
    const now = Date.now();
    const remain = end - now;
    const total = Math.max(end - start, 1);
    const fraction = 1 - Math.max(remain, 0) / total;

    if (remain <= 0) {
        setRing(1, true);
        $('countdown').textContent = '00:00:00';
        $('ringCaption').textContent = 'Session complete';
        $('rewardText').innerHTML = `<b>+${fmt(mining.estimated_reward)} XERA</b> ready to claim`;
        btn.textContent = 'Claim XERA';
        btn.classList.add('ready');
        btn.disabled = false;
    } else {
        setRing(fraction, false);
        const s = Math.floor(remain / 1000);
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = String(s % 60).padStart(2, '0');
        $('countdown').textContent = `${h}:${m}:${sec}`;
        $('ringCaption').textContent = 'Mining in progress';
        $('rewardText').textContent = `+${fmt(mining.estimated_reward)} XERA estimated`;
        btn.textContent = 'Mining active';
        btn.classList.remove('ready');
        btn.disabled = true;
    }
}

$('loginForm').addEventListener('submit', login);

$('logout').onclick = () => {
    clearInterval(tickHandle);
    tickHandle = null;
    mining = null;
    showLogin();
};

$('miningAction').onclick = async () => {
    const btn = $('miningAction');
    $('error').textContent = '';
    btn.disabled = true;
    try {
        if (!mining) {
            const d = await req('/api/xera/mining/start', { method: 'POST', body: '{}' });
            mining = d.mining;
        } else {
            await req('/api/xera/mining/claim', { method: 'POST', body: JSON.stringify({ session_id: mining.id }) });
            mining = null;
            await load();
        }
        renderMining();
    } catch (e) {
        $('error').textContent = e.message;
    } finally {
        if (!(mining && new Date(mining.expires_at) > Date.now())) btn.disabled = false;
    }
};

if (token()) load();

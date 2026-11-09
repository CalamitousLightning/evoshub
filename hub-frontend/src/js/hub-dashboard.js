import { initTheme } from './hub-theme.js';
import './evosdata-gate.js'
import { getUser } from './evos-session.js';
import { apiFetch as api } from './hub-api.js';
import { mountHubShell } from './hub-shell.js';
import { guestGate } from './guest-access.js';
import { resolveEcosystemLink, makeEcosystemDeduper } from './internal-links.js';
import { XERA_API } from './xera-public.js';

initTheme();

if (guestGate('view your dashboard')) {
    const user = getUser();
    const nameEl = document.getElementById('welcomeName');
    if (nameEl) nameEl.textContent = firstName(user);

    mountHubShell('overview');
    wireTileImages(document.getElementById('hubAppGrid'));
    loadXeraCard();
    loadActivity();
    loadEcosystemLinks();
}

function firstName(user) {
    const raw = String(user?.full_name || user?.username || '').trim();
    return raw ? raw.split(/\s+/)[0] : 'there';
}

// ---------------------------------------------------------------
// XERA status card — balance plus mining state, both fetched from
// the same endpoints the XERA app uses. Nothing is fabricated: if a
// call fails the card falls back to "Open XERA". The Hub never runs
// start/claim logic itself; tapping the card opens XERA.
// ---------------------------------------------------------------
let miningEndsAt = null;
let miningTick = null;

async function loadXeraCard() {
    const card = document.getElementById('xeraStatusCard');
    const balanceEl = document.getElementById('xeraCardBalance');
    if (!card || !balanceEl) return;

    const [walletRes, miningRes] = await Promise.allSettled([
        api('/api/xera/wallet'),
        api('/api/xera/mining/status'),
    ]);

    const wallet = walletRes.status === 'fulfilled' ? walletRes.value : null;
    balanceEl.textContent = wallet && wallet.status === 'ok' ? formatXera(wallet.balance) : '—';

    const mining = miningRes.status === 'fulfilled' && miningRes.value && miningRes.value.status === 'ok'
        ? (miningRes.value.mining || null)
        : undefined; // undefined = unknown, null = no session
    if (mining === undefined) {
        setCard('unknown', 'Open XERA');
        return;
    }
    if (!mining) {
        setCard('ready', 'Ready to mine');
        return;
    }
    miningEndsAt = new Date(mining.expires_at).getTime();
    renderMiningState();
    clearInterval(miningTick);
    miningTick = setInterval(renderMiningState, 1000);
}

function setCard(state, text) {
    const card = document.getElementById('xeraStatusCard');
    const pill = document.getElementById('xeraCardPill');
    if (card) card.dataset.state = state;
    if (pill) pill.textContent = text;
}

function renderMiningState() {
    const remain = miningEndsAt - Date.now();
    if (!Number.isFinite(remain)) { setCard('unknown', 'Open XERA'); return; }
    if (remain <= 0) {
        clearInterval(miningTick);
        setCard('claim', 'Claim ready');
        return;
    }
    setCard('mining', `Mining · ${formatClock(remain)} left`);
}

function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function formatXera(n) {
    const num = Number(n) || 0;
    return num.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

// ---------------------------------------------------------------
// Recent activity — the last 3 real XERA transactions only.
// Never fabricate activity.
// ---------------------------------------------------------------
const ACTIVITY_LABELS = {
    MINING_REWARD: 'Mining reward',
    DAILY_CLAIM: 'Daily claim',
    REFERRAL_REWARD: 'Referral reward',
    XERA_PURCHASE: 'XERA purchase',
    BONUS: 'Bonus',
    ADMIN_CREDIT: 'Balance adjustment',
    ADMIN_DEBIT: 'Balance adjustment',
    REVERSAL: 'Reversal',
    MIGRATION: 'Migration',
};
const ACTIVITY_ICON = {
    MINING_REWARD: 'bolt',
    DAILY_CLAIM: 'sun',
    REFERRAL_REWARD: 'gift',
    BONUS: 'gift',
};

async function loadActivity() {
    const list = document.getElementById('activityList');
    if (!list) return;
    try {
        const res = await api('/api/xera/transactions?limit=3');
        const txs = res.status === 'ok' ? (res.transactions || []).slice(0, 3) : [];
        if (!txs.length) {
            list.innerHTML = `<p class="hub-empty">No activity yet — start a XERA mining session to see it here.</p>`;
            return;
        }
        list.innerHTML = txs.map(renderActivityRow).join('');
    } catch (e) {
        list.innerHTML = `<p class="hub-empty">Couldn't load activity right now.</p>`;
    }
}

function renderActivityRow(tx) {
    const type = String(tx.type || '').toUpperCase();
    const label = ACTIVITY_LABELS[type]
        || (type ? type.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Transaction');
    const credit = tx.direction ? tx.direction === 'CREDIT' : Number(tx.amount) > 0;
    const amount = Math.abs(Number(tx.amount) || 0);
    const when = tx.created_at ? timeAgo(tx.created_at) : '';
    return `
        <div class="hub-activity-row">
            <div class="hub-activity-left">
                <span class="hub-activity-icon">${iconSvg(ACTIVITY_ICON[type] || 'clock')}</span>
                <div>
                    <p class="hub-activity-title">${escapeHtml(label)}</p>
                    <p class="hub-activity-time">${escapeHtml(when)}</p>
                </div>
            </div>
            <span class="hub-activity-amount${credit ? ' positive' : ''}">${credit ? '+' : '-'}${formatXera(amount)} XERA</span>
        </div>
    `;
}

function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function iconSvg(name) {
    const paths = {
        bolt:  '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke-linejoin="round"/>',
        sun:   '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke-linecap="round"/>',
        gift:  '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 9h18M12 9v12M12 9c-2-4-7-3-6-.5S9 9 12 9Zm0 0c2-4 7-3 6-.5S15 9 12 9Z"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${paths[name] || paths.clock}</svg>`;
}

// ---------------------------------------------------------------
// Icon grid — the same six icons as the Ecosystem page, plus any
// admin-curated links from xera_ecosystem_links (already live and
// used by the Ecosystem page), appended as extra icons.
// ---------------------------------------------------------------
function wireTileImages(root) {
    if (!root) return;
    root.querySelectorAll('.hh-tile img').forEach((img) => {
        const svg = img.parentElement.querySelector('svg');
        const ok = () => { if (img.naturalWidth > 0 && svg) svg.style.display = 'none'; };
        img.addEventListener('error', () => img.remove(), { once: true });
        if (img.complete) { if (img.naturalWidth > 0) ok(); else img.remove(); }
        else img.addEventListener('load', ok, { once: true });
    });
}

async function loadEcosystemLinks() {
    const grid = document.getElementById('hubAppGrid');
    if (!grid) return;
    try {
        const res = await fetch(`${XERA_API}/api/xera/ecosystem`).then((r) => r.json());
        const links = res.status === 'ok' ? (res.links || []) : [];
        const isDuplicate = makeEcosystemDeduper(grid, '.hh-app-name');
        links.forEach((link) => {
            const dest = resolveEcosystemLink(link.url);
            if (isDuplicate(link, dest)) return;   // already has a built-in tile (e.g. EVOS GPT)
            const a = document.createElement('a');
            a.className = 'hh-app';
            a.href = dest.href;
            if (dest.external) { a.target = '_blank'; a.rel = 'noopener'; }
            const tile = document.createElement('span');
            tile.className = 'hh-tile';
            if (link.image_url) {
                const img = document.createElement('img');
                img.src = link.image_url; img.alt = ''; img.loading = 'lazy';
                tile.appendChild(img);
            }
            const name = document.createElement('span');
            name.className = 'hh-app-name';
            name.textContent = link.name; // textContent only: admin text is never parsed as HTML
            a.append(tile, name);
            grid.appendChild(a);
        });
        wireTileImages(grid);
    } catch (e) { /* curated icons are optional */ }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

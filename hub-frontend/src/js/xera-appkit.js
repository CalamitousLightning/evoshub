// BNB wallet connection layer (Reown AppKit / WalletConnect). Rewritten.
//
// One job: get an EIP-1193 provider + the account the user picked. Ownership is still proven
// by the nonce + personal_sign flow in xera-chain.js; nothing about the backend changes. No
// seed phrase or private key is ever requested.
//
// Why it was rewritten: on a phone the wallet picker closes the moment you tap a wallet, and the
// wallet app (SafePal, Trust, ...) can take several seconds to open and approve. The old code
// treated "picker closed + page still visible" as the user cancelling, stopped listening, and
// then ignored the connection when it finally arrived. This version NEVER decides the user
// cancelled. It waits until a wallet connects, the user taps Cancel, or 15 minutes pass.
//
// Loaded lazily so the large AppKit bundle is not part of the first page load. If
// VITE_REOWN_PROJECT_ID is unset, xera-chain.js falls back to the browser-injected wallet flow.

const PROJECT_ID = (import.meta.env && import.meta.env.VITE_REOWN_PROJECT_ID) || '';
const WAIT_MS = 15 * 60 * 1000;          // how long one connect attempt may wait for the wallet
const PROVIDER_WAIT_MS = 20000;          // account connected but provider not ready yet (slow phones / slow relays)

const say = (m) => { try { window.dispatchEvent(new CustomEvent('xera-link-trace', { detail: m })); } catch (_e) { /* ignore */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;

let modalPromise = null;
let modalRef = null;
let attempt = null;                      // the connect attempt that is currently waiting, if any

export function appKitConfigured() { return Boolean(PROJECT_ID); }

// `expectedChainId`: the chain id the backend expects (56 mainnet / 97 testnet).
async function getModal(expectedChainId) {
    if (modalPromise) return modalPromise;
    modalPromise = (async () => {
        const [{ createAppKit }, { EthersAdapter }, networks] = await Promise.all([
            import('@reown/appkit'),
            import('@reown/appkit-adapter-ethers'),
            import('@reown/appkit/networks'),
        ]);
        const { bsc, bscTestnet } = networks;
        const ordered = Number(expectedChainId) === 56 ? [bsc, bscTestnet] : [bscTestnet, bsc];
        const modal = createAppKit({
            adapters: [new EthersAdapter()],
            networks: ordered,
            defaultNetwork: ordered[0],
            projectId: PROJECT_ID,
            metadata: {
                name: 'XERA',
                description: 'XERA by EVOXERA Technology',
                url: location.origin,
                icons: [`${location.origin}/assets/icons/xera-icon-192.png`],
            },
            // Wallet connection only: no email/social login, on-ramp, swaps or analytics.
            features: { analytics: false, email: false, socials: false, onramp: false, swaps: false, send: false, receive: false, history: false },
            themeMode: 'dark',
            allWallets: 'SHOW',
        });
        modalRef = modal;
        return modal;
    })();
    modalPromise.catch(() => { modalPromise = null; });
    return modalPromise;
}

// The wallet session AppKit currently holds, or null.
function currentSession(modal) {
    try {
        if (!modal.getIsConnectedState()) return null;
        const provider = modal.getWalletProvider();
        const address = modal.getAddress('eip155');
        if (!provider || !address) return null;
        const cid = Number(modal.getChainId());
        return { provider, address, chainId: Number.isFinite(cid) ? cid : null };
    } catch (_e) { return null; }
}

// Waits (up to `ms`) for a session. Used right after a page load / return from the wallet app,
// because AppKit restores the saved WalletConnect session asynchronously.
async function waitForSession(modal, ms) {
    const end = Date.now() + ms;
    for (;;) {
        const s = currentSession(modal);
        if (s) return s;
        if (Date.now() >= end) return null;
        await sleep(250);
    }
}

// Opens the wallet picker and resolves { provider, address, chainId } once a wallet connects.
//
//   currentAddress  the wallet already linked to the account (when changing wallets): if the wallet
//                   app hands that same one back, we say so instead of silently re-linking it.
//   hooks.onPickerClosed({ pageHidden })
//                   called when the picker closes (on a phone this is normal: it closes while the
//                   wallet app opens). The caller shows a "waiting for your wallet" state; we keep waiting.
//
// Rejects with { cancelled: true } only when cancelAppKitConnect() is called or the wait times out.
export async function connectWithAppKit(expectedChainId, currentAddress, hooks = {}) {
    const modal = await getModal(expectedChainId);
    const current = currentAddress ? String(currentAddress).toLowerCase() : '';
    if (attempt) attempt.cancel('replaced');

    // AppKit restores the previous visit's session in the background. When changing wallets, give that restore
    // time to land, then drop it, so the account we sign for is the one picked NOW and not an old session.
    if (current) await waitForSession(modal, 3000);
    try { if (modal.getIsConnectedState()) await modal.disconnect(); } catch (_e) { /* nothing to disconnect */ }

    return new Promise((resolve, reject) => {
        let done = false;
        let unsubAccount = () => {};
        let unsubState = () => {};
        let timer = null;

        const finish = (fn, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { unsubAccount(); } catch (_e) { /* ignore */ }
            try { unsubState(); } catch (_e) { /* ignore */ }
            if (attempt === me) attempt = null;
            fn(value);
        };
        const me = {
            cancel: (why) => {
                try { modal.close(); } catch (_e) { /* already closed */ }
                finish(reject, Object.assign(new Error(why === 'timeout' ? 'The wallet did not answer in time.' : 'Wallet connection was cancelled.'), { cancelled: true, why }));
            },
            reopen: () => { try { modal.open({ view: 'Connect', namespace: 'eip155' }); } catch (_e) { /* ignore */ } },
        };
        attempt = me;
        timer = setTimeout(() => me.cancel('timeout'), WAIT_MS);

        let handling = false;
        unsubAccount = modal.subscribeAccount(async (acct) => {
            if (done || handling || !acct || !acct.isConnected || !acct.address) return;
            handling = true;
            say(`Wallet app reported ${short(acct.address)}`);
            try {
                if (current && String(acct.address).toLowerCase() === current) {
                    // The wallet app handed back the wallet that is already linked.
                    try { await modal.disconnect(); } catch (_e) { /* ignore */ }
                    try { modal.close(); } catch (_e) { /* ignore */ }
                    finish(reject, Object.assign(new Error(`That is the wallet already linked to your account (${short(current)}). In your wallet app, switch to the account you want to link, then tap Change wallet again.`), { userFacing: true }));
                    return;
                }
                // The account can be reported a moment before the provider is usable: wait for it, don't skip it.
                const session = await waitForSession(modal, PROVIDER_WAIT_MS);
                if (done) return;
                if (!session) { handling = false; say('Wallet connected but not ready yet, still waiting'); return; }
                setTimeout(() => { try { modal.close(); } catch (_e) { /* already closed */ } }, 150);
                finish(resolve, session);
            } catch (e) { handling = false; say(`Connect error: ${(e && e.message) || e}`); }
        });

        unsubState = modal.subscribeState((s) => {
            if (done || !s || s.open !== false) return;
            say(`Picker closed (page ${document.visibilityState}); waiting for your wallet`);
            try { if (hooks.onPickerClosed) hooks.onPickerClosed({ pageHidden: document.visibilityState !== 'visible' }); } catch (_e) { /* ignore */ }
        });

        modal.open({ view: 'Connect', namespace: 'eip155' }).catch((e) => finish(reject, e));
    });
}

export function cancelAppKitConnect() { if (attempt) attempt.cancel('user'); }
export function reopenAppKitPicker() { if (attempt) attempt.reopen(); }
export function appKitWaiting() { return Boolean(attempt); }

// A WalletConnect session from earlier (AppKit persists it). Used to finish a link after the wallet app
// sent the user back (the page may have reloaded) and by claim settlement. Waits up to `ms` for the restore.
export async function restoredAppKitProvider(expectedChainId, ms = 6000) {
    if (!PROJECT_ID) return null;
    try {
        const modal = await getModal(expectedChainId);
        return await waitForSession(modal, ms);
    } catch (_e) { return null; }
}

// A phone suspends the page's network connection while the wallet app is in front, so the link to the wallet
// (WalletConnect relay) can be dead when the user comes back. Ask it to reconnect right away instead of waiting
// for it to notice. Best effort: this reaches into the provider, so it is wrapped and never throws.
export function nudgeAppKitConnection() {
    try {
        if (!modalRef) return false;
        const provider = modalRef.getWalletProvider && modalRef.getWalletProvider();
        const relayer = provider && provider.client && provider.client.core && provider.client.core.relayer;
        if (relayer && typeof relayer.restartTransport === 'function') { relayer.restartTransport().catch(() => {}); return true; }
    } catch (_e) { /* not available in this AppKit version */ }
    return false;
}

// One line describing what AppKit can see right now, for the "Wallet link steps" log. Never throws.
export function appKitDiagnostics() {
    try {
        if (!modalRef) return 'wallet module not started';
        const bits = [];
        bits.push('connected=' + (modalRef.getIsConnectedState() ? 'yes' : 'no'));
        const evm = modalRef.getAddress && modalRef.getAddress('eip155');
        bits.push('evm_address=' + (evm ? short(evm) : 'none'));
        let relay = 'unknown';
        try {
            const provider = modalRef.getWalletProvider && modalRef.getWalletProvider();
            const r = provider && provider.client && provider.client.core && provider.client.core.relayer;
            if (r) relay = r.connected ? 'connected' : 'disconnected';
        } catch (_e) { /* ignore */ }
        bits.push('relay=' + relay);
        bits.push('online=' + (navigator.onLine ? 'yes' : 'no'));
        return bits.join(', ');
    } catch (_e) { return 'diagnostics unavailable'; }
}

export async function disconnectAppKit() {
    if (!modalRef) return;
    try { await modalRef.disconnect(); } catch (_e) { /* already gone */ }
}

// Ask the wallet to move to the expected BNB network via AppKit (works for WalletConnect sessions).
export async function switchAppKitNetwork(chainId) {
    if (!modalRef) return false;
    const networks = await import('@reown/appkit/networks');
    const target = Number(chainId) === 56 ? networks.bsc : networks.bscTestnet;
    await modalRef.switchNetwork(target);
    return true;
}

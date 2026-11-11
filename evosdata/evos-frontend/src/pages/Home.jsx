import { useEffect, useState } from "react";
import { asset, IS_HUB_MOUNT } from "../lib/basePath";

// Inside the Hub build EVOSGPT and the website page live on the same origin.
const GPT_HREF = IS_HUB_MOUNT ? "/evosgpt" : "https://evoshub.xyz/evosgpt";
const SITE_HREF = IS_HUB_MOUNT ? "/website-creation.html" : "https://evoshub.xyz/website-creation.html";
const WA = "https://wa.me/233537314125";
const COMMUNITY = "https://whatsapp.com/channel/0029VaTrnsZEgGfFXkIcjt1M";

const NETWORKS = [
  { name: "MTN", label: "MTN", note: "Everyday & non-expiry bundles", image: "images/mtn.png", color: "#ffcc00" },
  { name: "TELECEL", label: "Telecel", note: "Big bundles, fair prices", image: "images/telecel.png", color: "#ff4d4d" },
  { name: "AIRTELTIGO", label: "AirtelTigo", note: "iShare & BigTime bundles", image: "images/airteltigo.png", color: "#3b82f6" },
];

const RULES = [
  "Confirm the phone number before you pay.",
  "No refund when a bundle is delivered to a wrong number entered by the customer.",
  "Refunds apply only to failed or undelivered orders, after review.",
  "During network congestion some orders may be delayed.",
  "If an order is not delivered within 30 minutes, contact support.",
];

const PROMOS = {
  evosgpt: {
    key: "evosgpt",
    title: "EVOSGPT is free to start",
    body: "Ask for CVs, school work, business plans or code. Upgrade to Pro or Core only when you need more.",
    cta: "Open EVOSGPT",
    href: GPT_HREF,
  },
  website: {
    key: "website",
    title: "Need a website or a WhatsApp bot? We build it",
    body: "Websites from GH₵400. Pay online, or talk to us first and we will scope it with you.",
    cta: "See website options",
    href: SITE_HREF,
  },
};

export default function Home({ setPage }) {
  const [modal, setModal] = useState(null); // "support" | "about" | "privacy"
  const [imgErrors, setImgErrors] = useState({});
  const [promo, setPromo] = useState(null);
  const [promoVisible, setPromoVisible] = useState(false);

  // One cross-promo per session, shown after 2s.
  useEffect(() => {
    let dismissed = false;
    try { dismissed = !!sessionStorage.getItem("evosPromoDismissed"); } catch { /* ignore */ }
    if (dismissed) return;
    setPromo(Math.random() < 0.5 ? PROMOS.evosgpt : PROMOS.website);
    const t = setTimeout(() => setPromoVisible(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const dismissPromo = () => {
    setPromoVisible(false);
    try { sessionStorage.setItem("evosPromoDismissed", "1"); } catch { /* ignore */ }
  };

  const pickNetwork = (n) => {
    try { localStorage.setItem("selectedNetwork", n.name); } catch { /* ignore */ }
    setPage("shop");
  };

  const tiles = [
    { icon: "📍", title: "Track order", sub: "Use your reference", onClick: () => setPage("eta-track") },
    { icon: "🎓", title: "Result checkers", sub: "WAEC & BECE", onClick: () => setPage("checkers") },
    { icon: "🤝", title: "Become an agent", sub: "Earn on every sale", onClick: () => window.open(`${WA}?text=${encodeURIComponent("Hi, I'd like to become an EVOS Data Service agent")}`, "_blank") },
    { icon: "💬", title: "Support", sub: "WhatsApp, email", onClick: () => setModal("support") },
  ];

  return (
    <div className="hm">
      <style>{CSS}</style>

      {/* ---------- Promo (one per session) ---------- */}
      {promo && (
        <aside className={`hm-promo ${promoVisible ? "on" : ""}`} role="dialog" aria-label={promo.title}>
          <button className="hm-x" onClick={dismissPromo} aria-label="Close">✕</button>
          <b>{promo.title}</b>
          <p>{promo.body}</p>
          <div className="hm-promo-row">
            <a className="hm-btn gold" href={promo.href} target="_blank" rel="noreferrer" onClick={dismissPromo}>{promo.cta}</a>
            <button className="hm-btn ghost" onClick={dismissPromo}>Not now</button>
          </div>
        </aside>
      )}

      {/* ---------- 1. Buy card: the one thing this page is for ---------- */}
      <section className="hm-buy">
        <h1>Buy data</h1>
        <p className="hm-lead">Pick a network. Pay with Paystack. The bundle lands on the number automatically.</p>
        <div className="hm-nets">
          {NETWORKS.map((n) => (
            <button key={n.name} className="hm-net" onClick={() => pickNetwork(n)} style={{ "--c": n.color }}>
              <span className="hm-logo">
                {!imgErrors[n.name] ? (
                  <img src={asset(n.image)} alt="" onError={() => setImgErrors((p) => ({ ...p, [n.name]: true }))} />
                ) : (
                  <i>{n.label[0]}</i>
                )}
              </span>
              <span className="hm-net-t"><b>{n.label}</b><small>{n.note}</small></span>
              <span className="hm-go" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        <p className="hm-trust">Delivery usually takes under 2 minutes, any hour of the day.</p>
      </section>

      {/* ---------- 2. Quick actions ---------- */}
      <section className="hm-tiles" aria-label="Quick actions">
        {tiles.map((t) => (
          <button key={t.title} className="hm-tile" onClick={t.onClick}>
            <span className="hm-ti">{t.icon}</span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </button>
        ))}
      </section>

      {/* ---------- 3. How it works: a single quiet line ---------- */}
      <section className="hm-flow" aria-label="How it works">
        <span>Pick a bundle</span><i>›</i><span>Pay securely</span><i>›</i><span>Delivered</span>
      </section>

      {/* ---------- 4. Agent: one short strip ---------- */}
      <section className="hm-agent">
        <div>
          <b>Run your own data store</b>
          <p>Set your markup, share your store link and earn GH₵ 0.50 – 5.00 per bundle sold. Withdraw instantly to MoMo.</p>
        </div>
        <button className="hm-btn ghost" onClick={() => window.open(`${WA}?text=${encodeURIComponent("Hi, I'd like to become an EVOS Data Service agent")}`, "_blank")}>Ask on WhatsApp</button>
      </section>

      {/* ---------- 5. Policy, folded away ---------- */}
      <details className="hm-policy">
        <summary>Purchase policy</summary>
        <ul>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </details>

      {/* ---------- Footer ---------- */}
      <footer className="hm-foot">
        <div className="hm-links">
          <button onClick={() => setModal("about")}>About</button>
          <button onClick={() => setModal("privacy")}>Privacy</button>
          <button onClick={() => (window.location.href = GPT_HREF)}>EVOSGPT</button>
          <button onClick={() => window.open("https://evoshub.xyz", "_blank")}>EVOS Business HUB</button>
        </div>
        <p>© 2026 EVOS Data Services · A product of EVOS Business HUB, powered by Evoxera Technology</p>
      </footer>

      {/* ---------- Modals ---------- */}
      {modal && (
        <>
          <div className="hm-overlay" onClick={() => setModal(null)} />
          <div className="hm-modal" role="dialog">
            {modal === "support" && (
              <>
                <h2>Support</h2>
                <button className="hm-row" onClick={() => window.open(WA, "_blank")}>💬 WhatsApp support</button>
                <button className="hm-row" onClick={() => window.open(COMMUNITY, "_blank")}>👥 Community channel</button>
                <button className="hm-row" onClick={() => (window.location.href = "mailto:support@evoshub.xyz")}>📧 support@evoshub.xyz</button>
              </>
            )}
            {modal === "about" && (
              <>
                <h2>About EVOSDATA</h2>
                <p>EVOSDATA is a secure digital platform for automated mobile data purchases in Ghana.</p>
                <p>Powered by EVOS Business HUB infrastructure and built by Evoxera Technology.</p>
              </>
            )}
            {modal === "privacy" && (
              <>
                <h2>Privacy</h2>
                <p>We only collect the data needed to process orders and give support.</p>
                <p>Payments are handled by Paystack. We do not sell or share user data.</p>
              </>
            )}
            <button className="hm-btn ghost wide" onClick={() => setModal(null)}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
.hm { max-width: 640px; margin: 0 auto; padding: 14px 16px 40px; color: var(--text); font-family: var(--font-body); }
.hm button { font-family: inherit; cursor: pointer; }
.hm p { margin: 0; }

.hm-buy { padding: 22px 18px 16px; border-radius: 22px; background: var(--bg-2); border: 1px solid var(--line-strong); }
.hm-buy h1 { font-size: 30px; line-height: 1.1; margin: 0 0 6px; }
.hm-lead { color: var(--muted); font-size: 14.5px; line-height: 1.5; max-width: 46ch; }
.hm-nets { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
.hm-net { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 64px; padding: 10px 14px; text-align: left;
  border-radius: 16px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
.hm-net:hover { border-color: var(--c); }
.hm-logo { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; overflow: hidden; background: #fff1; flex-shrink: 0; }
.hm-logo img { width: 100%; height: 100%; object-fit: cover; }
.hm-logo i { font-style: normal; font-weight: 800; font-size: 18px; color: var(--c); }
.hm-net-t { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.hm-net-t b { font-family: var(--font-display); font-size: 16px; }
.hm-net-t small { color: var(--faint); font-size: 12.5px; }
.hm-go { font-size: 26px; color: var(--c); line-height: 1; }
.hm-trust { margin-top: 12px; font-size: 12.5px; color: var(--faint); }

.hm-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
.hm-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px; text-align: left; min-height: 96px;
  border-radius: 16px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
.hm-tile:hover { background: var(--surface-2); }
.hm-ti { font-size: 22px; margin-bottom: 6px; }
.hm-tile b { font-family: var(--font-display); font-size: 15px; }
.hm-tile small { color: var(--faint); font-size: 12.5px; }

.hm-flow { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; margin: 22px 0 6px; font-size: 13.5px; color: var(--muted); }
.hm-flow i { font-style: normal; color: var(--lime); }

.hm-agent { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 16px; padding: 16px; border-radius: 16px; border: 1px dashed var(--line-strong); }
.hm-agent > div { flex: 1; min-width: 220px; }
.hm-agent b { font-family: var(--font-display); font-size: 16px; }
.hm-agent p { margin-top: 4px; font-size: 13.5px; line-height: 1.5; }

.hm-policy { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }
.hm-policy summary { cursor: pointer; font-weight: 600; font-size: 14px; color: var(--muted); }
.hm-policy ul { margin: 10px 0 0; padding-left: 18px; color: var(--muted); font-size: 13.5px; line-height: 1.6; }

.hm-foot { margin-top: 26px; text-align: center; }
.hm-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; }
.hm-links button { background: none; border: 0; padding: 6px 0; color: var(--muted); font-size: 13px; }
.hm-foot p { margin-top: 8px; font-size: 11.5px; color: var(--faint); }

.hm-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 12px; font-weight: 700; font-size: 14px; text-decoration: none; border: 1px solid transparent; }
.hm-btn.gold { background: var(--lime); color: #0b1017; }
.hm-btn.ghost { background: transparent; color: var(--text); border-color: var(--line-strong); }
.hm-btn.wide { width: 100%; margin-top: 12px; }

.hm-promo { position: fixed; right: 16px; bottom: calc(92px + var(--safe-b)); z-index: 9000; width: min(320px, calc(100vw - 32px));
  padding: 16px; border-radius: 16px; background: var(--bg-2); border: 1px solid var(--line-strong); box-shadow: 0 12px 32px rgba(0,0,0,.45);
  opacity: 0; transform: translateY(12px); pointer-events: none; transition: opacity .25s, transform .25s; }
.hm-promo.on { opacity: 1; transform: none; pointer-events: auto; }
.hm-promo b { display: block; font-family: var(--font-display); font-size: 15px; padding-right: 24px; }
.hm-promo p { margin: 6px 0 12px; font-size: 13px; line-height: 1.5; }
.hm-promo-row { display: flex; gap: 8px; }
.hm-promo-row .hm-btn { flex: 1; padding: 0 10px; }
.hm-x { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--faint); }

.hm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 9990; }
.hm-modal { position: fixed; z-index: 9991; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(380px, calc(100vw - 32px));
  padding: 20px; border-radius: 18px; background: var(--bg-2); border: 1px solid var(--line-strong); }
.hm-modal h2 { font-size: 20px; margin: 0 0 10px; }
.hm-modal p { font-size: 14px; line-height: 1.55; margin-bottom: 8px; }
.hm-row { display: block; width: 100%; text-align: left; min-height: 48px; margin-top: 8px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: 14px; }

.hm-net:focus-visible, .hm-tile:focus-visible, .hm-btn:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }
@media (min-width: 900px) { .hm { padding-top: 28px; } .hm-buy { padding: 28px 26px 20px; } .hm-buy h1 { font-size: 36px; } }
@media (prefers-reduced-motion: reduce) { .hm-promo { transition: none; } }
`;

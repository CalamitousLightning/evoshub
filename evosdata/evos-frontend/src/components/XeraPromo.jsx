import { useEffect, useState } from "react";
import { IS_HUB_MOUNT } from "../lib/basePath";

// Points at the existing XERA page; this component never implements XERA itself.
const XERA_URL = IS_HUB_MOUNT ? "/xera" : "https://evoshub.xyz/xera";
const DISMISS_KEY = "evosXeraPromoDismissedAt";
const BAR_KEY = "evosXeraBarDismissedAt";
const REPEAT_MS = 7 * 24 * 3600 * 1000;           // popup: at most once a week
const BAR_MS = 3 * 24 * 3600 * 1000;              // bar: hidden for 3 days after ✕
const SAFE_PAGES = ["home", "dashboard"];          // never on buy/pay/auth/agent pages

const TITLE = "XERA is live";
const BODY = "Mine and claim XERA every day in the XERA app. Open it to see your balance.";

const hiddenFor = (key, ms) => {
  try { return Date.now() - Number(localStorage.getItem(key) || 0) < ms; } catch { return false; }
};
const recentlyDismissed = () => hiddenFor(DISMISS_KEY, REPEAT_MS);

// Slim notification bar (replaces the old big "Coming Soon" card).
function Card() {
  const [hidden, setHidden] = useState(() => hiddenFor(BAR_KEY, BAR_MS));
  if (hidden) return null;
  const close = () => {
    try { localStorage.setItem(BAR_KEY, String(Date.now())); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <div data-no-community role="status" style={{
      margin: "10px 16px 0", padding: "8px 8px 8px 14px", borderRadius: 12,
      background: "var(--surface)", border: "1px solid var(--line-strong)",
      display: "flex", gap: 10, alignItems: "center",
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--violet)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4 }}>
        <b>{TITLE}.</b> <span style={{ color: "var(--muted)" }}>{BODY}</span>
      </div>
      <a href={XERA_URL} style={{
        padding: "8px 12px", borderRadius: 10, background: "var(--lime)", color: "#0b1017",
        fontWeight: 700, fontSize: 13, textDecoration: "none", whiteSpace: "nowrap",
      }}>Open XERA</a>
      <button onClick={close} aria-label="Dismiss XERA notice" style={{
        width: 32, height: 32, border: 0, borderRadius: 8, background: "transparent", color: "var(--faint)", cursor: "pointer",
      }}>✕</button>
    </div>
  );
}

function Popup({ page }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!SAFE_PAGES.includes(page) || recentlyDismissed()) { setOpen(false); return; }
    // Once per session, a few seconds after arriving, only on safe pages.
    try { if (sessionStorage.getItem("evosXeraPromoShown")) return; } catch { /* ignore */ }
    const t = setTimeout(() => {
      try { sessionStorage.setItem("evosXeraPromoShown", "1"); } catch { /* ignore */ }
      setOpen(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [page]);

  // Leaving a safe page (e.g. to start a purchase) closes it immediately.
  useEffect(() => { if (!SAFE_PAGES.includes(page)) setOpen(false); }, [page]);

  if (!open) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div data-no-community role="dialog" aria-label={TITLE} style={{
      position: "fixed", right: 16, bottom: 96, zIndex: 9000, maxWidth: 320,
      padding: 16, borderRadius: 16, background: "var(--bg-2)", color: "var(--text)",
      border: "1px solid var(--line-strong)", boxShadow: "0 10px 30px rgba(0,0,0,.45)",
    }}>
      <div style={{ fontWeight: 700 }}>{TITLE}</div>
      <div style={{ fontSize: 13, opacity: 0.85, margin: "6px 0 12px" }}>{BODY}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <a href={XERA_URL} onClick={dismiss} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 10, background: "var(--lime)", color: "#0b1017", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>Open XERA</a>
        <button onClick={dismiss} aria-label="Dismiss XERA announcement" style={{ padding: "8px 12px", borderRadius: 10, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.25)", fontSize: 13, cursor: "pointer" }}>Not now</button>
      </div>
    </div>
  );
}

export default { Card, Popup };

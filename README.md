# EVOS Business Hub — evoshub.xyz
Powered by EVOXERA TECHNOLOGY

## Structure
- `hub-frontend/` — Website (HTML · CSS · JS)
- `python/`       — Backend API (FastAPI) — add when needed

## Run frontend
```
cd hub-frontend && npm install && npm run dev
```

## Run backend
```
cd python && pip install -r requirements.txt && uvicorn main:app --reload
```

## Website Creation (chat-with-admin) feature

A new product page, `website-creation.html`, lets a visitor pick a package,
submit a request, and chat live with an EVOXERA agent — no custom backend
required, it's all Supabase (Postgres + Realtime + RLS).

### One-time setup
1. **Run the migrations** (in order) against your shared Supabase project,
   via the SQL Editor or `supabase db push`:
   - `supabase/migrations/20260709_website_creation.sql` — tables, RLS, realtime
   - `supabase/migrations/20260710_website_creation_ratelimits.sql` — abuse/flood protection
2. **Configure and run the backend** (`python/`) — the intake form POSTs to
   `/api/website-requests` rather than inserting directly, so the backend
   must be running. Copy `python/.env.example` to `python/.env` and fill in
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (the
   service_role key lives here only — never in frontend code or a build
   that ships to the browser), plus SMTP settings if you want admin email
   notifications. Then `cd python && pip install -r requirements.txt &&
   uvicorn main:app --reload`.
3. **Set frontend env vars** — copy `hub-frontend/.env.example` to
   `hub-frontend/.env` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   (safe to expose — see the comments in `.env.example`) and
   `VITE_API_BASE_URL` (where the backend above is reachable). Live chat
   itself still talks to Supabase Realtime directly from the browser with
   the anon key; only the initial request submission goes through the
   backend.
4. **Grant agent access** — from the Supabase SQL editor (service_role, not
   the app), promote an existing shared-auth user to an agent for this
   product:
   ```sql
   insert into public.admin_agents (user_id, display_name)
   values ('<existing-auth-user-uuid>', 'Agent Name');
   ```
   That account can then sign in at `/admin-login.html` with its existing
   email/password and reach the inbox at `/admin-website-chat.html`.

### How the security model works
- **Intake form** is submitted to the FastAPI backend (`/api/website-requests`),
  not inserted directly from the browser. The backend independently
  re-verifies the visitor's Supabase access token against Supabase's own
  Auth server (never trusts a client-sent id), re-sanitizes every field with
  `bleach`, checks the honeypot field, and applies a per-IP rate limit
  (`5/hour` via `slowapi`) — a layer a purely client-side insert can't
  provide, since a bot can always mint a fresh anonymous session to dodge a
  per-visitor-id limit. It then inserts with the `service_role` key, so the
  DB-level constraints and triggers below are a second, independent line of
  defense, not the only one.
- **Live chat**, once a request exists, talks to Supabase Realtime directly
  from the browser using the anon key — RLS is the only gate there, which is
  fine because chat rows are small, structurally constrained, and
  rate-limited at the DB level (below).
- **Visitors** never get a real account — the browser calls
  `supabase.auth.signInAnonymously()` on first form interaction, which
  issues a real Supabase-signed session. Every row a visitor creates is
  stamped `visitor_id = auth.uid()` and every RLS policy checks that, so a
  visitor can only ever see their own request/thread.
- **Admins** are existing shared-auth accounts; whether an account is an
  agent is decided by row membership in `admin_agents`, checked via a
  `SECURITY DEFINER` function (`is_website_admin()`) — never by a
  client-supplied flag. The admin dashboard calls that same function before
  showing anything and signs out + redirects if it returns false.
- **DB-level abuse protection**: rate-limit triggers (max 3 requests/hour
  per visitor, max 20 chat messages/minute per sender) and server-side
  HTML-tag stripping on every text field, in addition to the frontend always
  rendering messages via `textContent` (never `innerHTML`) to prevent stored
  XSS.
- **Transport/headers**: `vercel.json` sets `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, and a `Content-Security-Policy`
  that only allows connections to Supabase and same-origin scripts. The
  backend's CORS is restricted to an explicit `ALLOWED_ORIGINS` allowlist.

## XERA Token (Coin) V1
XERA Token (Coin) is hosted by EVOS Business Hub at `/xera`. The active V1 features are XERA login, wallet, 24-hour server-authoritative mining, atomic claiming, ledger and transaction history. Purchases, withdrawals, transfers, referrals and on-chain features remain disabled.

Run `supabase/migrations/20260901_xera_token_v1.sql` against the shared Supabase project only after reviewing the existing `public.users` schema. Configure `python/.env` from `python/.env.example`; never commit secrets.

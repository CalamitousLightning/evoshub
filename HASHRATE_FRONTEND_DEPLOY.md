# XERA Hashrate Frontend Deploy

This build adds a dedicated **Hashrate** tab to the XERA frontend with five visual plan cards, XERA logo treatment, allocation status, 65M warning / 70M closure messaging, active-session display, and Paystack purchase handoff.

## Netlify

The repository already contains `netlify.toml` with:

- Base directory: `hub-frontend`
- Build command: `npm run build`
- Publish directory: `dist`
- Node 20

For an existing Netlify site, deploy the updated project through the site's production deploy flow. Netlify can build a project that still needs its build step when you are logged in. See the official Netlify deployment docs.

## Required backend environment

The frontend expects the existing API to expose:

- `GET /api/xera/hashrate/tiers`
- `GET /api/xera/hashrate/sessions`
- `POST /api/xera/hashrate/purchase`
- `POST /api/xera/hashrate/sessions/{session_id}/claim`

The backend must have the XERA hashrate migration applied before the UI can load real plans.

## Payment note

The frontend only starts a Paystack checkout when the backend explicitly enables XERA hashrate payments. Crypto remains disabled until its backend payment-in verification is configured.

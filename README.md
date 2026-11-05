# EVOS Hub update (2026-11-05): on-chain claim screen + claimable bonus/referral rewards

Copy these folders over the same paths in your repo (they only add/replace the files listed).

| File | What it does |
|---|---|
| `hub-frontend/src/pages/xera/index.html` | Shows the claim screen to users: removes the CSS that hid it, adds a "Move XERA to your wallet" button on the Wallet tab, updates the wallet text. |
| `supabase/migrations/20261105_xera_bonus_referral_claimable.sql` | Early-miner bonus and referral rewards become claimable on-chain. Referral rewards are now taken from the 75M mining allocation when credited. Includes a self-checking one-time catch-up. |
| `supabase/tests/*bonus_referral_claimable*` | Disposable-database tests for the migration (never point at Supabase). |

## Order
1. Push the frontend file (Netlify/Vercel deploys it).
2. In the Supabase SQL Editor, run the migration once. It stops with an error, changing nothing, if `mining_distributed` does not match the ledger; if so run `SELECT xera_launch_reconcile();` and send me the output.
3. Verify: `SELECT xera_launch_reconcile();` must show `"ok": true`.
4. Reload the app twice (service worker), then test a claim with your own account.

Still needed on Render: `XERA_FEE_COLLECTION_ENABLED=true` and `XERA_BNB_CHAIN_ID=56`, then redeploy.

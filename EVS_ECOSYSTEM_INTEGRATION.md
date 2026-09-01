# EVS (EVOS) Token V1 Integration

This package contains only the EVOS Business Hub project with EVS (EVOS) Token integrated at `/evs`.

## Active V1
- EVS-only user login using the shared public `users` table
- Independent EVS wallet and ledger
- Server-authoritative 24-hour mining
- Atomic reward claim
- Transaction history
- EVS admin API

## Disabled V1
- Fiat purchase
- Withdrawal
- Transfer
- Referral rewards
- Exchange/listing integration
- On-chain migration

## Deployment checklist
1. Configure Python environment variables from `python/.env.example`.
2. Install backend dependencies from `python/requirements.txt`.
3. Review and run `supabase/migrations/20260901_evs_evos_token_v1.sql` in the shared Supabase project. Confirm `public.users.id` is BIGINT before applying this migration.
4. Deploy the existing EVOS Hub backend and frontend using their current production configuration.
5. Point `api.evoshub.xyz` to the EVOS Hub backend, or set `window.EVS_API_BASE` before loading the EVS frontend if a different API host is used.
6. Verify `/evs`, login, wallet, mining start and claim in a staging environment before public release.

No EVOS Data Services, EVOSGPT, or standalone EVS project is included in this package.

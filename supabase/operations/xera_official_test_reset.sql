-- XERA OFFICIAL TEST-PHASE RESET
-- MANUAL / ONE-TIME OPERATION. Do NOT place this file in migrations.
-- Run in the Supabase SQL Editor only when ready to reset the test phase.
-- Creates a one-time backup, resets test activity/balances, then grants
-- 100 XERA to each existing XERA wallet exactly once through the ledger.
-- User accounts/auth records are not deleted. On-chain code is untouched.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.xera_reset_backup_wallets_20261020') IS NOT NULL
     OR to_regclass('public.xera_reset_backup_transactions_20261020') IS NOT NULL
     OR to_regclass('public.xera_reset_backup_sessions_20261020') IS NOT NULL
     OR to_regclass('public.xera_reset_backup_daily_claims_20261020') IS NOT NULL
     OR to_regclass('public.xera_reset_backup_allocations_20261020') IS NOT NULL THEN
    RAISE EXCEPTION 'XERA reset backup tables already exist; refusing to run twice.';
  END IF;
END $$;

CREATE TABLE xera_reset_backup_wallets_20261020 AS TABLE xera_wallets;
CREATE TABLE xera_reset_backup_transactions_20261020 AS TABLE xera_transactions;
CREATE TABLE xera_reset_backup_sessions_20261020 AS TABLE xera_mining_sessions;
CREATE TABLE xera_reset_backup_daily_claims_20261020 AS TABLE xera_daily_claims;
CREATE TABLE xera_reset_backup_allocations_20261020 AS TABLE xera_allocations;

-- Clear old test ledger/activity, retaining a snapshot in the backup tables.
DELETE FROM xera_transactions;
DELETE FROM xera_mining_sessions;

UPDATE xera_wallets
SET cached_balance = 0, updated_at = now();

UPDATE xera_daily_claims
SET last_claim_date = NULL, streak = 0, total_claims = 0, updated_at = now();

UPDATE xera_allocations
SET mining_distributed = 0, updated_at = now()
WHERE id = 1;

-- Give each existing XERA wallet one 100-XERA early-participant bonus.
-- Unique references make each grant traceable and protect against duplicates.
WITH bonus_rows AS (
  INSERT INTO xera_transactions
    (wallet_id, user_id, type, amount, direction, status, reference_id, metadata)
  SELECT
    w.id,
    w.user_id,
    'BONUS',
    100,
    'CREDIT',
    'CONFIRMED',
    'xera-early-participant-reset-20261020:' || w.user_id::text,
    jsonb_build_object(
      'reason', 'Early participant bonus after official test-phase reset',
      'reset_date', '2026-10-20',
      'test_data_reset', true
    )
  FROM xera_wallets w
  RETURNING wallet_id, user_id, amount
)
UPDATE xera_wallets w
SET cached_balance = b.amount, updated_at = now()
FROM bonus_rows b
WHERE w.id = b.wallet_id AND w.user_id = b.user_id;

COMMIT;

-- Expected result: every existing XERA wallet starts at 100 XERA after the
-- reset bonus; old sessions, old transaction activity, and daily-claim
-- streak/count statistics are cleared. User accounts remain intact.

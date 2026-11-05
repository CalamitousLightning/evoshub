-- ============================================================
-- XERA - early-miner bonus + referral rewards become claimable on-chain
-- ============================================================
-- WHAT THIS DOES
--   1. xera_claimable_balance now also counts, as claimable:
--        * the early-miner bonus (BONUS rows with reference_id 'early-miner-bonus:%')
--        * referral rewards (REFERRAL_REWARD rows)
--      Mining rewards and daily claims were already claimable. Purchases,
--      other bonuses and admin credits are still NOT claimable.
--
--   2. Referral rewards are now taken out of the 75,000,000 mining allocation
--      WHEN THEY ARE CREDITED, exactly like daily claims and the early bonus
--      (xera_allocations.mining_distributed and the entitlement reservation).
--      Before this migration xera_qualify_referral only credited the wallet
--      and did not touch the allocation, so a claimable referral reward would
--      have competed with miners for the same on-chain pool without being
--      counted. If a referral reward cannot fit in what remains of the
--      allocation it is NOT paid (the referral still qualifies).
--
--   3. xera_launch_reconcile counts referral rewards in the pool total, so
--      reconcile.ok stays true.
--
--   4. One-time catch-up: referral rewards credited BEFORE this migration are
--      added to the allocation. It is self-checking:
--        * allocation already includes them  -> nothing is changed
--        * allocation equals the ledger without them -> they are added once
--        * anything else -> the migration STOPS with an error, changes nothing
--      (fix the difference first: SELECT xera_launch_reconcile();)
--
-- No wallet balance is changed by this file. Safe to re-run.
-- Run it in the Supabase SQL Editor (production). It runs as one transaction
-- and briefly blocks new ledger rows while it applies.
-- ============================================================

BEGIN;

-- Lock order matches the rest of XERA: entitlement state -> allocations -> ledger.
SELECT 1 FROM xera_mining_entitlement_state WHERE id = 1 FOR UPDATE;
SELECT 1 FROM xera_allocations              WHERE id = 1 FOR UPDATE;
LOCK TABLE xera_transactions IN SHARE ROW EXCLUSIVE MODE;

-- ------------------------------------------------------------
-- 1. ONE-TIME CATCH-UP for referral rewards already credited
-- ------------------------------------------------------------
DO $$
DECLARE
    v_alloc  xera_allocations;
    v_state  xera_mining_entitlement_state;
    v_other  NUMERIC;
    v_ref    NUMERIC;
BEGIN
    SELECT * INTO v_alloc FROM xera_allocations WHERE id = 1;
    SELECT * INTO v_state FROM xera_mining_entitlement_state WHERE id = 1;

    SELECT COALESCE(SUM(t.amount), 0) INTO v_other
      FROM xera_transactions t
     WHERE t.direction = 'CREDIT' AND t.status = 'CONFIRMED'
       AND (t.type IN ('MINING_REWARD', 'DAILY_CLAIM')
            OR (t.type = 'BONUS' AND t.reference_id LIKE 'early-miner-bonus:%'));

    SELECT COALESCE(SUM(t.amount), 0) INTO v_ref
      FROM xera_transactions t
     WHERE t.direction = 'CREDIT' AND t.status = 'CONFIRMED' AND t.type = 'REFERRAL_REWARD';

    IF v_ref = 0 THEN
        RAISE NOTICE 'No referral rewards credited yet: nothing to catch up.';
    ELSIF v_alloc.mining_distributed = v_other + v_ref THEN
        RAISE NOTICE 'Referral rewards (%) are already counted in the allocation: nothing to change.', v_ref;
    ELSIF v_alloc.mining_distributed = v_other THEN
        IF v_alloc.mining_distributed + v_ref > v_alloc.mining_allocation
           OR v_state.reserved_amount + v_ref > v_state.cap THEN
            RAISE EXCEPTION 'Cannot count % referral XERA: it would exceed the mining allocation.', v_ref;
        END IF;
        UPDATE xera_allocations SET mining_distributed = mining_distributed + v_ref, updated_at = now() WHERE id = 1;
        UPDATE xera_mining_entitlement_state
           SET reserved_amount = reserved_amount + v_ref,
               free_mining_closed = free_mining_closed OR (reserved_amount + v_ref >= closure_threshold),
               updated_at = now()
         WHERE id = 1;
        RAISE NOTICE 'Counted % referral XERA against the mining allocation (one time).', v_ref;
    ELSE
        RAISE EXCEPTION 'mining_distributed (%) matches neither the ledger without referral rewards (%) nor with them (%). Run SELECT xera_launch_reconcile(); and fix that first.',
            v_alloc.mining_distributed, v_other, v_other + v_ref;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 2. CLAIMABLE BALANCE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION xera_claimable_balance(
    p_user_id BIGINT
) RETURNS TABLE(cached_balance NUMERIC, eligible_total NUMERIC, onchain_total NUMERIC, claimable NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cached  NUMERIC;
    v_elig    NUMERIC;
    v_onchain NUMERIC;
BEGIN
    SELECT w.cached_balance INTO v_cached FROM xera_wallets w WHERE w.user_id = p_user_id;

    SELECT COALESCE(SUM(t.amount), 0) INTO v_elig
        FROM xera_transactions t
        WHERE t.user_id = p_user_id
          AND t.direction = 'CREDIT'
          AND t.status = 'CONFIRMED'
          AND (
                t.type IN ('MINING_REWARD', 'DAILY_CLAIM', 'REFERRAL_REWARD')
                OR (t.type = 'BONUS' AND t.reference_id LIKE 'early-miner-bonus:%')
              );

    SELECT COALESCE(SUM(c.claimed_amount), 0) INTO v_onchain
        FROM xera_onchain_claims c
        WHERE c.user_id = p_user_id;

    cached_balance := COALESCE(v_cached, 0);
    eligible_total := v_elig;
    onchain_total  := v_onchain;
    claimable      := GREATEST(0, LEAST(COALESCE(v_cached, 0), v_elig - v_onchain));
    RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- 3. REFERRAL REWARDS DRAW FROM THE MINING ALLOCATION
--    Same signature and behaviour as before, plus the allocation accounting.
--    Lock order: referral row -> entitlement state -> allocations -> wallet.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION xera_qualify_referral(p_referred_user_id BIGINT)
RETURNS TABLE(qualified BOOLEAN, referrer_paid NUMERIC, referee_paid NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ref      xera_referrals;
    v_cfg      xera_referral_config;
    v_enabled  BOOLEAN;
    v_wallet   xera_wallets;
    v_state    xera_mining_entitlement_state;
    v_alloc    xera_allocations;
BEGIN
    qualified := false; referrer_paid := 0; referee_paid := 0;

    SELECT * INTO v_ref FROM xera_referrals
     WHERE referred_user_id = p_referred_user_id FOR UPDATE;
    IF NOT FOUND OR v_ref.qualified_at IS NOT NULL THEN RETURN NEXT; RETURN; END IF;

    UPDATE xera_referrals SET qualified_at = now(), status = 'qualified' WHERE id = v_ref.id;
    qualified := true;

    SELECT referral_enabled INTO v_enabled FROM xera_config WHERE id = 1;
    SELECT * INTO v_cfg FROM xera_referral_config WHERE id = 1;
    IF NOT COALESCE(v_enabled, false) OR (v_cfg.referrer_reward = 0 AND v_cfg.referee_reward = 0) THEN
        RETURN NEXT; RETURN;
    END IF;

    SELECT * INTO v_state FROM xera_mining_entitlement_state WHERE id = 1 FOR UPDATE;
    SELECT * INTO v_alloc FROM xera_allocations              WHERE id = 1 FOR UPDATE;

    -- Referrer side
    IF v_cfg.referrer_reward > 0
       AND v_state.reserved_amount + v_cfg.referrer_reward <= v_state.cap
       AND v_alloc.mining_distributed + v_cfg.referrer_reward <= v_alloc.mining_allocation THEN
        SELECT * INTO v_wallet FROM xera_wallets WHERE user_id = v_ref.referrer_user_id FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO xera_wallets (user_id) VALUES (v_ref.referrer_user_id) RETURNING * INTO v_wallet;
        END IF;
        IF v_wallet.status = 'ACTIVE' THEN
            INSERT INTO xera_transactions (wallet_id, user_id, type, amount, direction, reference_id, metadata)
            VALUES (v_wallet.id, v_ref.referrer_user_id, 'REFERRAL_REWARD', v_cfg.referrer_reward, 'CREDIT',
                    'ref:' || v_ref.id || ':referrer',
                    jsonb_build_object('referral_id', v_ref.id, 'referred_user_id', p_referred_user_id, 'side', 'referrer'));
            UPDATE xera_wallets SET cached_balance = cached_balance + v_cfg.referrer_reward, updated_at = now()
             WHERE id = v_wallet.id;
            UPDATE xera_allocations SET mining_distributed = mining_distributed + v_cfg.referrer_reward, updated_at = now()
             WHERE id = 1;
            UPDATE xera_mining_entitlement_state
               SET reserved_amount = reserved_amount + v_cfg.referrer_reward,
                   free_mining_closed = free_mining_closed OR (reserved_amount + v_cfg.referrer_reward >= closure_threshold),
                   updated_at = now()
             WHERE id = 1;
            v_alloc.mining_distributed := v_alloc.mining_distributed + v_cfg.referrer_reward;
            v_state.reserved_amount    := v_state.reserved_amount + v_cfg.referrer_reward;
            referrer_paid := v_cfg.referrer_reward;
        END IF;
    END IF;

    -- Referee side
    IF v_cfg.referee_reward > 0
       AND v_state.reserved_amount + v_cfg.referee_reward <= v_state.cap
       AND v_alloc.mining_distributed + v_cfg.referee_reward <= v_alloc.mining_allocation THEN
        SELECT * INTO v_wallet FROM xera_wallets WHERE user_id = p_referred_user_id FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO xera_wallets (user_id) VALUES (p_referred_user_id) RETURNING * INTO v_wallet;
        END IF;
        IF v_wallet.status = 'ACTIVE' THEN
            INSERT INTO xera_transactions (wallet_id, user_id, type, amount, direction, reference_id, metadata)
            VALUES (v_wallet.id, p_referred_user_id, 'REFERRAL_REWARD', v_cfg.referee_reward, 'CREDIT',
                    'ref:' || v_ref.id || ':referee',
                    jsonb_build_object('referral_id', v_ref.id, 'referrer_user_id', v_ref.referrer_user_id, 'side', 'referee'));
            UPDATE xera_wallets SET cached_balance = cached_balance + v_cfg.referee_reward, updated_at = now()
             WHERE id = v_wallet.id;
            UPDATE xera_allocations SET mining_distributed = mining_distributed + v_cfg.referee_reward, updated_at = now()
             WHERE id = 1;
            UPDATE xera_mining_entitlement_state
               SET reserved_amount = reserved_amount + v_cfg.referee_reward,
                   free_mining_closed = free_mining_closed OR (reserved_amount + v_cfg.referee_reward >= closure_threshold),
                   updated_at = now()
             WHERE id = 1;
            referee_paid := v_cfg.referee_reward;
        END IF;
    END IF;

    IF referrer_paid > 0 OR referee_paid > 0 THEN
        UPDATE xera_referrals
           SET rewarded_at = now(), reward_amount = referrer_paid, status = 'rewarded'
         WHERE id = v_ref.id;
    END IF;

    RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- 4. RECONCILE counts referral rewards in the pool total
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION xera_launch_reconcile()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_alloc   xera_allocations;
    v_ent     xera_mining_entitlement_state;
    v_state   xera_launch_state;
    v_ledger_distributed NUMERIC;
    v_bad_wallets        INTEGER;
    v_neg_wallets        INTEGER;
    v_bonus_rows         INTEGER;
    v_bonus_sum          NUMERIC;
    v_bonus_ledger       NUMERIC;
    v_problems JSONB := '[]'::jsonb;
BEGIN
    SELECT * INTO v_alloc FROM xera_allocations WHERE id = 1;
    SELECT * INTO v_ent   FROM xera_mining_entitlement_state WHERE id = 1;
    SELECT * INTO v_state FROM xera_launch_state WHERE id = 1;

    -- Everything paid out of the 75M pool: free/hashrate rewards, daily claims, early bonuses, referral rewards.
    SELECT COALESCE(SUM(t.amount), 0) INTO v_ledger_distributed
      FROM xera_transactions t
     WHERE t.direction = 'CREDIT' AND t.status = 'CONFIRMED'
       AND (t.type IN ('MINING_REWARD', 'DAILY_CLAIM', 'REFERRAL_REWARD')
            OR (t.type = 'BONUS' AND t.reference_id LIKE 'early-miner-bonus:%'));

    SELECT COUNT(*) INTO v_bad_wallets
      FROM xera_wallets w
     WHERE w.cached_balance <> COALESCE((
            SELECT SUM(CASE WHEN t.direction = 'CREDIT' THEN t.amount ELSE -t.amount END)
              FROM xera_transactions t WHERE t.wallet_id = w.id AND t.status = 'CONFIRMED'), 0);

    SELECT COUNT(*) INTO v_neg_wallets FROM xera_wallets WHERE cached_balance < 0;
    SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_bonus_rows, v_bonus_sum FROM xera_early_miner_bonuses;
    SELECT COALESCE(SUM(amount), 0) INTO v_bonus_ledger FROM xera_transactions
     WHERE type = 'BONUS' AND reference_id LIKE 'early-miner-bonus:%' AND direction = 'CREDIT';

    IF v_ledger_distributed <> v_alloc.mining_distributed THEN
        v_problems := v_problems || jsonb_build_array('mining_distributed_differs_from_ledger');
    END IF;
    IF v_bad_wallets > 0 THEN v_problems := v_problems || jsonb_build_array('wallet_cache_differs_from_ledger'); END IF;
    IF v_neg_wallets > 0 THEN v_problems := v_problems || jsonb_build_array('negative_wallet_balance'); END IF;
    IF v_bonus_rows <> v_state.bonus_slots_used THEN v_problems := v_problems || jsonb_build_array('bonus_slots_used_differs_from_rows'); END IF;
    IF v_bonus_sum <> v_state.bonus_distributed OR v_bonus_sum <> v_bonus_ledger THEN
        v_problems := v_problems || jsonb_build_array('bonus_total_differs_from_ledger');
    END IF;
    IF v_bonus_rows > 100 OR v_bonus_sum > 10000 THEN v_problems := v_problems || jsonb_build_array('bonus_limit_exceeded'); END IF;
    IF v_alloc.mining_distributed > v_alloc.mining_allocation THEN v_problems := v_problems || jsonb_build_array('allocation_exceeded'); END IF;
    IF v_ent.reserved_amount < v_alloc.mining_distributed THEN v_problems := v_problems || jsonb_build_array('entitlement_below_distributed'); END IF;
    IF v_alloc.total_target <> 500000000 OR v_alloc.mining_allocation <> 75000000 THEN
        v_problems := v_problems || jsonb_build_array('supply_or_allocation_changed');
    END IF;

    RETURN jsonb_build_object(
        'ok',                      jsonb_array_length(v_problems) = 0,
        'problems',                v_problems,
        'mining_distributed',      v_alloc.mining_distributed,
        'ledger_distributed',      v_ledger_distributed,
        'bonus_distributed',       v_state.bonus_distributed,
        'regular_rewards',         v_alloc.mining_distributed - v_state.bonus_distributed,
        'bonus_recipients',        v_bonus_rows,
        'entitlement_reserved',    v_ent.reserved_amount,
        'mining_allocation',       v_alloc.mining_allocation,
        'remaining_allocation',    v_alloc.mining_allocation - v_alloc.mining_distributed
    );
END;
$$;

-- ------------------------------------------------------------
-- 5. PRIVILEGES (unchanged posture: backend service_role only)
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION xera_claimable_balance(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION xera_claimable_balance(BIGINT) TO service_role;
REVOKE ALL ON FUNCTION xera_qualify_referral(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION xera_qualify_referral(BIGINT) TO service_role;
REVOKE ALL ON FUNCTION xera_launch_reconcile() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION xera_launch_reconcile() TO service_role;

COMMIT;

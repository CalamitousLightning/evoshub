-- Stage 1 (BEFORE the migration): data as it exists on production today.
-- Referral rewards are credited by the OLD xera_qualify_referral, so they are in the
-- ledger but NOT in xera_allocations.mining_distributed. Mining rewards are counted.
DO $$
DECLARE a BIGINT; z BIGINT; w BIGINT; r RECORD;
BEGIN
    INSERT INTO users (username, referral_code) VALUES ('t_ref_a', 'EVOS-TREFA-0001') RETURNING id INTO a;
    INSERT INTO users (username, referral_code) VALUES ('t_ref_z', 'EVOS-TREFZ-0001') RETURNING id INTO z;
    PERFORM xera_link_referral(z, 'EVOS-TREFA-0001', 'xera');
    UPDATE xera_config SET referral_enabled = true WHERE id = 1;
    UPDATE xera_referral_config SET referrer_reward = 50, referee_reward = 20 WHERE id = 1;

    -- a mining reward of 10 for a, counted in the pool the normal way
    INSERT INTO xera_wallets (user_id) VALUES (a) ON CONFLICT DO NOTHING;
    SELECT id INTO w FROM xera_wallets WHERE user_id = a;
    INSERT INTO xera_transactions (wallet_id, user_id, type, amount, direction, reference_id)
    VALUES (w, a, 'MINING_REWARD', 10, 'CREDIT', 'seed-mining-a');
    UPDATE xera_wallets SET cached_balance = cached_balance + 10 WHERE id = w;
    UPDATE xera_allocations SET mining_distributed = mining_distributed + 10 WHERE id = 1;
    UPDATE xera_mining_entitlement_state SET reserved_amount = reserved_amount + 10 WHERE id = 1;

    SELECT * INTO r FROM xera_qualify_referral(z);   -- OLD function: credits 50 + 20
    ASSERT r.referrer_paid = 50 AND r.referee_paid = 20, 'seed: old function pays both sides';
    ASSERT (SELECT mining_distributed FROM xera_allocations WHERE id = 1) = 10, 'seed: old function does NOT touch the allocation';
    ASSERT (xera_launch_reconcile()->>'ok')::boolean, 'seed: reconcile ok before migration';
    -- Before the migration referral rewards are not claimable:
    ASSERT (SELECT claimable FROM xera_claimable_balance(z)) = 0, 'seed: referral reward not claimable before';
    RAISE NOTICE 'SEED OK';
END $$;

-- Stage 2 (AFTER the migration). Everything is rolled back.
BEGIN;
DO $$
DECLARE a BIGINT; z BIGINT; p BIGINT; n BIGINT; b BIGINT; k BIGINT; q BIGINT; w BIGINT; r RECORD; rows xera_onchain_claims; d0 NUMERIC; e0 NUMERIC;
BEGIN
    SELECT id INTO a FROM users WHERE username = 't_ref_a';
    SELECT id INTO z FROM users WHERE username = 't_ref_z';

    -- catch-up counted the 70 referral XERA once
    ASSERT (SELECT mining_distributed FROM xera_allocations WHERE id = 1) = 80, 'catch-up: distributed 10 + 70';
    ASSERT (SELECT reserved_amount FROM xera_mining_entitlement_state WHERE id = 1) = 80, 'catch-up: entitlement 80';
    ASSERT (xera_launch_reconcile()->>'ok')::boolean, 'reconcile ok after migration';

    -- referral rewards are claimable now
    ASSERT (SELECT claimable FROM xera_claimable_balance(a)) = 60, 'a: 10 mining + 50 referral claimable';
    ASSERT (SELECT claimable FROM xera_claimable_balance(z)) = 20, 'z: 20 referral claimable';

    -- NOT claimable: purchase, non-early bonus, admin credit
    INSERT INTO users (username) VALUES ('t_nonpool') RETURNING id INTO n;
    INSERT INTO xera_wallets (user_id, cached_balance) VALUES (n, 30) RETURNING id INTO w;
    INSERT INTO xera_transactions (wallet_id, user_id, type, amount, direction, reference_id) VALUES
        (w, n, 'XERA_PURCHASE', 5, 'CREDIT', 'p1'), (w, n, 'BONUS', 7, 'CREDIT', 'promo-7'), (w, n, 'ADMIN_CREDIT', 18, 'CREDIT', 'adm1');
    ASSERT (SELECT claimable FROM xera_claimable_balance(n)) = 0, 'purchase / other bonus / admin credit stay non-claimable';

    -- a real claim can now be reserved against referral-funded balance (mainnet network)
    rows := xera_reserve_onchain_claim_amount('t-ref-claim-1', z, 'BNB', '0x' || repeat('ab', 20), 20, 5, 15, '0x' || repeat('cd', 20), now() + interval '15 minutes', 'mainnet');
    ASSERT rows.claimed_amount = 20, 'claim of referral balance reserved';
    ASSERT (SELECT cached_balance FROM xera_wallets WHERE user_id = z) = 0, 'balance debited';
    ASSERT (SELECT claimable FROM xera_claimable_balance(z)) = 0, 'nothing left to claim twice';

    -- a NEW referral after the migration is taken out of the allocation
    INSERT INTO users (username, referral_code) VALUES ('t_ref_p', 'EVOS-TREFP-0001') RETURNING id INTO p;
    INSERT INTO users (username, referral_code) VALUES ('t_ref_q', 'EVOS-TREFQ-0001') RETURNING id INTO q;
    PERFORM xera_link_referral(q, 'EVOS-TREFP-0001', 'xera');
    d0 := (SELECT mining_distributed FROM xera_allocations WHERE id = 1);
    e0 := (SELECT reserved_amount FROM xera_mining_entitlement_state WHERE id = 1);
    SELECT * INTO r FROM xera_qualify_referral(q);
    ASSERT r.referrer_paid = 50 AND r.referee_paid = 20, 'new referral pays both';
    ASSERT (SELECT mining_distributed FROM xera_allocations WHERE id = 1) = d0 + 70, 'new referral reduces the allocation by 70';
    ASSERT (SELECT reserved_amount FROM xera_mining_entitlement_state WHERE id = 1) = e0 + 70, 'entitlement reservation +70';
    ASSERT (xera_launch_reconcile()->>'ok')::boolean, 'reconcile ok after new referral';
    ASSERT (SELECT claimable FROM xera_claimable_balance(p)) = 50, 'new referrer can claim 50';

    -- allocation nearly exhausted: referrer (50) fits, referee (20) does not -> only 50 paid
    INSERT INTO users (username, referral_code) VALUES ('t_ref_r', 'EVOS-TREFR-0001') RETURNING id INTO k;
    INSERT INTO users (username, referral_code) VALUES ('t_ref_s', 'EVOS-TREFS-0001') RETURNING id INTO n;
    PERFORM xera_link_referral(n, 'EVOS-TREFR-0001', 'xera');
    UPDATE xera_allocations SET mining_allocation = mining_distributed + 60 WHERE id = 1;
    d0 := (SELECT mining_distributed FROM xera_allocations WHERE id = 1);
    SELECT * INTO r FROM xera_qualify_referral(n);
    ASSERT r.qualified AND r.referrer_paid = 50 AND r.referee_paid = 0, 'only the side that fits is paid';
    ASSERT (SELECT mining_distributed FROM xera_allocations WHERE id = 1) = d0 + 50, 'distributed grew by 50 only';
    ASSERT (SELECT mining_distributed <= mining_allocation FROM xera_allocations WHERE id = 1), 'never above the allocation';

    -- early-miner bonus IS claimable
    INSERT INTO users (username) VALUES ('t_early') RETURNING id INTO b;
    INSERT INTO xera_wallets (user_id, cached_balance) VALUES (b, 100) RETURNING id INTO w;
    INSERT INTO xera_transactions (wallet_id, user_id, type, amount, direction, reference_id)
        VALUES (w, b, 'BONUS', 100, 'CREDIT', 'early-miner-bonus:' || b::text);
    ASSERT (SELECT claimable FROM xera_claimable_balance(b)) = 100, 'early-miner bonus claimable';

    RAISE NOTICE 'ALL AFTER-MIGRATION TESTS PASSED';
END $$;
ROLLBACK;

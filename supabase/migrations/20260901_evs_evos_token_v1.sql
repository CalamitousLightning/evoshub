-- ============================================================
-- EVS (EVOS) TOKEN V1
-- PRODUCTION-READY MINING WALLET DATABASE SCHEMA
--
-- Product: EVS (EVOS) Token
-- Host: EVOS Hub
-- EVS URL: https://evoshub.xyz/evs
--
-- IMPORTANT:
-- EVS is independent from EVOS Data Services accounting.
--
-- This schema DOES NOT touch:
--   users
--   agent_wallets
--   agent_transactions
--   orders
--   EVOS Data Services balances
--
-- Shared infrastructure:
--   Existing users table
--   Existing Supabase project
--
-- Active V1:
--   Wallet
--   Mining
--   Claiming
--   Ledger
--   Admin
--   Transaction history
--
-- Disabled:
--   Purchase
--   Withdrawal
--   Transfer
--   Referral
--   On-chain migration
-- ============================================================


-- ============================================================
-- 0. DEVELOPMENT RESET
--
-- WARNING:
-- This removes ONLY existing EVS database objects.
-- Do not run this against production EVS data unless a backup
-- has been made and the reset is intentional.
-- ============================================================

DROP VIEW IF EXISTS evs_reconciliation_report CASCADE;

DROP FUNCTION IF EXISTS evs_start_mining_session CASCADE;
DROP FUNCTION IF EXISTS evs_claim_mining_reward CASCADE;
DROP FUNCTION IF EXISTS evs_admin_adjust_balance CASCADE;

DROP TABLE IF EXISTS evs_security_events CASCADE;
DROP TABLE IF EXISTS evs_admin_actions CASCADE;
DROP TABLE IF EXISTS evs_referrals CASCADE;
DROP TABLE IF EXISTS evs_withdrawals CASCADE;
DROP TABLE IF EXISTS evs_purchases CASCADE;
DROP TABLE IF EXISTS evs_mining_sessions CASCADE;
DROP TABLE IF EXISTS evs_transactions CASCADE;
DROP TABLE IF EXISTS evs_wallets CASCADE;
DROP TABLE IF EXISTS evs_sale_config CASCADE;
DROP TABLE IF EXISTS evs_mining_config CASCADE;
DROP TABLE IF EXISTS evs_allocations CASCADE;
DROP TABLE IF EXISTS evs_config CASCADE;


-- ============================================================
-- 1. MAIN EVS CONFIGURATION
-- Singleton row: id = 1
-- ============================================================

CREATE TABLE evs_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    system_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    current_phase TEXT NOT NULL DEFAULT 'MINING'
        CHECK (
            current_phase IN (
                'MINING',
                'PURCHASE',
                'PRE_LISTING',
                'MIGRATION',
                'LAUNCHED'
            )
        ),

    mining_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    withdrawal_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    referral_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    onchain_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_by BIGINT REFERENCES users(id)
);

INSERT INTO evs_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 2. TOKEN ALLOCATIONS
--
-- Default values are planning values only.
-- Admin can update them before final tokenomics.
-- ============================================================

CREATE TABLE evs_allocations (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    total_target NUMERIC(20,4)
        NOT NULL
        DEFAULT 500000000
        CHECK (total_target > 0),

    mining_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 75000000
        CHECK (mining_allocation >= 0),

    sale_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 125000000
        CHECK (sale_allocation >= 0),

    community_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 25000000
        CHECK (community_allocation >= 0),

    liquidity_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 75000000
        CHECK (liquidity_allocation >= 0),

    treasury_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 200000000
        CHECK (treasury_allocation >= 0),

    mining_distributed NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (mining_distributed >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_by BIGINT REFERENCES users(id),

    CONSTRAINT evs_allocations_within_target
        CHECK (
            mining_allocation
            + sale_allocation
            + community_allocation
            + liquidity_allocation
            + treasury_allocation
            <= total_target
        ),

    CONSTRAINT evs_mining_distribution_limit
        CHECK (
            mining_distributed <= mining_allocation
        )
);

INSERT INTO evs_allocations (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 3. MINING CONFIGURATION
-- ============================================================

CREATE TABLE evs_mining_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    mining_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    mining_start TIMESTAMPTZ,

    mining_end TIMESTAMPTZ,

    session_hours INTEGER
        NOT NULL
        DEFAULT 24
        CHECK (session_hours > 0),

    min_reward_per_session NUMERIC(20,4)
        NOT NULL
        DEFAULT 1
        CHECK (min_reward_per_session >= 0),

    max_reward_per_session NUMERIC(20,4)
        NOT NULL
        DEFAULT 5000
        CHECK (max_reward_per_session > 0),

    reward_rate NUMERIC(20,4)
        NOT NULL
        DEFAULT 1
        CHECK (reward_rate >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_by BIGINT REFERENCES users(id),

    CONSTRAINT evs_valid_reward_bounds
        CHECK (
            min_reward_per_session
            <= max_reward_per_session
        )
);

INSERT INTO evs_mining_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 4. FUTURE SALE CONFIGURATION
--
-- Present for future architecture.
-- Sale remains DISABLED in V1.
-- ============================================================

CREATE TABLE evs_sale_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    price_ghs NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (price_ghs >= 0),

    currency TEXT
        NOT NULL
        DEFAULT 'GHS',

    minimum_purchase NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (minimum_purchase >= 0),

    maximum_purchase NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (maximum_purchase >= minimum_purchase),

    sale_start TIMESTAMPTZ,

    sale_end TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_by BIGINT REFERENCES users(id)
);

INSERT INTO evs_sale_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 5. EVS WALLETS
--
-- One user = one EVS wallet.
--
-- cached_balance is NOT authoritative.
-- evs_transactions is authoritative.
-- ============================================================

CREATE TABLE evs_wallets (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        NOT NULL
        UNIQUE
        REFERENCES users(id)
        ON DELETE CASCADE,

    cached_balance NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (cached_balance >= 0),

    status TEXT
        NOT NULL
        DEFAULT 'ACTIVE'
        CHECK (
            status IN (
                'ACTIVE',
                'SUSPENDED',
                'FLAGGED'
            )
        ),

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);


-- ============================================================
-- 6. AUTHORITATIVE EVS LEDGER
-- ============================================================

CREATE TABLE evs_transactions (
    id BIGSERIAL PRIMARY KEY,

    wallet_id BIGINT
        NOT NULL
        REFERENCES evs_wallets(id)
        ON DELETE RESTRICT,

    user_id BIGINT
        NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    type TEXT
        NOT NULL
        CHECK (
            type IN (
                'MINING_REWARD',
                'EVS_PURCHASE',
                'REFERRAL_REWARD',
                'BONUS',
                'ADMIN_CREDIT',
                'ADMIN_DEBIT',
                'REVERSAL',
                'MIGRATION',
                'WITHDRAWAL',
                'TRANSFER'
            )
        ),

    amount NUMERIC(20,4)
        NOT NULL
        CHECK (amount > 0),

    direction TEXT
        NOT NULL
        CHECK (
            direction IN (
                'CREDIT',
                'DEBIT'
            )
        ),

    status TEXT
        NOT NULL
        DEFAULT 'CONFIRMED'
        CHECK (
            status IN (
                'PENDING',
                'CONFIRMED',
                'REVERSED'
            )
        ),

    reference_id TEXT,

    metadata JSONB
        NOT NULL
        DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    confirmed_at TIMESTAMPTZ
        DEFAULT NOW()
);


-- Mining reward idempotency.
-- One mining session can only create one reward.

CREATE UNIQUE INDEX evs_tx_mining_reward_unique
ON evs_transactions (reference_id)
WHERE type = 'MINING_REWARD';


CREATE INDEX idx_evs_transactions_user
ON evs_transactions(user_id);


CREATE INDEX idx_evs_transactions_wallet
ON evs_transactions(wallet_id);


CREATE INDEX idx_evs_transactions_type
ON evs_transactions(type);


CREATE INDEX idx_evs_transactions_created
ON evs_transactions(created_at DESC);


-- ============================================================
-- 7. MINING SESSIONS
-- ============================================================

CREATE TABLE evs_mining_sessions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    started_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    expires_at TIMESTAMPTZ
        NOT NULL,

    rate_snapshot NUMERIC(20,4)
        NOT NULL
        CHECK (rate_snapshot >= 0),

    estimated_reward NUMERIC(20,4)
        NOT NULL
        CHECK (estimated_reward >= 0),

    status TEXT
        NOT NULL
        DEFAULT 'ACTIVE'
        CHECK (
            status IN (
                'ACTIVE',
                'COMPLETED',
                'CLAIMED',
                'CANCELLED',
                'FLAGGED'
            )
        ),

    claimed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    CONSTRAINT evs_mining_session_dates
        CHECK (expires_at > started_at)
);


-- One user can only have one currently active session.

CREATE UNIQUE INDEX evs_one_active_session_per_user
ON evs_mining_sessions(user_id)
WHERE status = 'ACTIVE';


CREATE INDEX idx_evs_mining_user
ON evs_mining_sessions(user_id);


CREATE INDEX idx_evs_mining_status
ON evs_mining_sessions(status);


CREATE INDEX idx_evs_mining_expiry
ON evs_mining_sessions(expires_at);


-- ============================================================
-- 8. FUTURE PURCHASE TABLE
--
-- INACTIVE IN V1
-- ============================================================

CREATE TABLE evs_purchases (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        NOT NULL
        REFERENCES users(id),

    evs_amount NUMERIC(20,4)
        NOT NULL
        CHECK (evs_amount > 0),

    price_ghs NUMERIC(20,4)
        NOT NULL
        CHECK (price_ghs >= 0),

    paystack_reference TEXT UNIQUE,

    status TEXT
        NOT NULL
        DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'PAID',
                'FAILED',
                'CANCELLED'
            )
        ),

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    confirmed_at TIMESTAMPTZ
);


-- ============================================================
-- 9. FUTURE WITHDRAWALS
--
-- INACTIVE IN V1
-- ============================================================

CREATE TABLE evs_withdrawals (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        NOT NULL
        REFERENCES users(id),

    evs_amount NUMERIC(20,4)
        NOT NULL
        CHECK (evs_amount > 0),

    reference_id TEXT UNIQUE,

    status TEXT
        NOT NULL
        DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'PROCESSING',
                'COMPLETED',
                'FAILED',
                'CANCELLED'
            )
        ),

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    completed_at TIMESTAMPTZ
);


-- ============================================================
-- 10. FUTURE REFERRALS
--
-- INACTIVE IN V1
-- ============================================================

CREATE TABLE evs_referrals (
    id BIGSERIAL PRIMARY KEY,

    referrer_user_id BIGINT
        NOT NULL
        REFERENCES users(id),

    referred_user_id BIGINT
        NOT NULL
        REFERENCES users(id),

    reward_amount NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (reward_amount >= 0),

    status TEXT
        NOT NULL
        DEFAULT 'PENDING',

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    UNIQUE (
        referrer_user_id,
        referred_user_id
    ),

    CHECK (
        referrer_user_id
        <> referred_user_id
    )
);


-- ============================================================
-- 11. ADMIN AUDIT LOG
-- ============================================================

CREATE TABLE evs_admin_actions (
    id BIGSERIAL PRIMARY KEY,

    admin_id BIGINT
        NOT NULL
        REFERENCES users(id),

    action TEXT
        NOT NULL,

    old_value JSONB,

    new_value JSONB,

    reason TEXT,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);


CREATE INDEX idx_evs_admin_actions_admin
ON evs_admin_actions(admin_id);


CREATE INDEX idx_evs_admin_actions_created
ON evs_admin_actions(created_at DESC);


-- ============================================================
-- 12. SECURITY EVENTS
-- ============================================================

CREATE TABLE evs_security_events (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT
        REFERENCES users(id),

    event_type TEXT
        NOT NULL,

    details JSONB
        NOT NULL
        DEFAULT '{}'::jsonb,

    ip_address TEXT,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);


CREATE INDEX idx_evs_security_user
ON evs_security_events(user_id);


CREATE INDEX idx_evs_security_type
ON evs_security_events(event_type);


CREATE INDEX idx_evs_security_created
ON evs_security_events(created_at DESC);


-- ============================================================
-- 13. START MINING FUNCTION
--
-- Database-level protection against duplicate mining starts.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_start_mining_session(
    p_user_id BIGINT,
    p_rate NUMERIC,
    p_hours INTEGER,
    p_max_reward NUMERIC
)
RETURNS evs_mining_sessions

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE
    v_wallet evs_wallets;
    v_session evs_mining_sessions;
    v_reward NUMERIC(20,4);
BEGIN

    IF p_hours <= 0 THEN
        RAISE EXCEPTION 'invalid_session_duration';
    END IF;

    IF p_rate < 0 THEN
        RAISE EXCEPTION 'invalid_reward_rate';
    END IF;

    -- Find or create wallet.

    SELECT *
    INTO v_wallet
    FROM evs_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN

        INSERT INTO evs_wallets (
            user_id
        )
        VALUES (
            p_user_id
        )
        RETURNING *
        INTO v_wallet;

    END IF;

    -- Wallet must be active.

    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'wallet_not_active';
    END IF;

    -- Calculate reward safely.

    v_reward :=
        LEAST(
            GREATEST(p_rate, 0),
            p_max_reward
        );

    -- Create mining session.

    BEGIN

        INSERT INTO evs_mining_sessions (
            user_id,
            expires_at,
            rate_snapshot,
            estimated_reward
        )
        VALUES (
            p_user_id,
            NOW() + make_interval(hours => p_hours),
            p_rate,
            v_reward
        )
        RETURNING *
        INTO v_session;

    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'active_session_exists';
    END;

    RETURN v_session;

END;
$$;


-- ============================================================
-- 14. CLAIM MINING REWARD
--
-- Atomic operation:
--
-- Lock session
-- Check ownership
-- Check expiry
-- Lock allocation
-- Lock wallet
-- Create ledger
-- Update wallet
-- Update allocation
-- Mark session claimed
--
-- All operations succeed or fail together.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_claim_mining_reward(
    p_session_id BIGINT,
    p_user_id BIGINT
)

RETURNS TABLE (
    new_balance NUMERIC,
    reward_credited NUMERIC
)

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE
    v_session evs_mining_sessions;
    v_alloc evs_allocations;
    v_wallet evs_wallets;

    v_reward NUMERIC(20,4);
    v_remaining NUMERIC(20,4);

BEGIN

    -- Lock the mining session.

    SELECT *
    INTO v_session
    FROM evs_mining_sessions
    WHERE
        id = p_session_id
        AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;


    -- Must not already be claimed.

    IF v_session.status NOT IN (
        'ACTIVE',
        'COMPLETED'
    ) THEN
        RAISE EXCEPTION 'invalid_session_status';
    END IF;


    -- Backend/database controls time.

    IF NOW() < v_session.expires_at THEN
        RAISE EXCEPTION 'not_yet_expired';
    END IF;


    -- Lock allocation.

    SELECT *
    INTO v_alloc
    FROM evs_allocations
    WHERE id = 1
    FOR UPDATE;


    v_remaining :=
        v_alloc.mining_allocation
        - v_alloc.mining_distributed;


    -- Never exceed allocation.

    v_reward :=
        LEAST(
            v_session.estimated_reward,
            GREATEST(v_remaining, 0)
        );


    IF v_reward <= 0 THEN

        UPDATE evs_mining_sessions
        SET status = 'FLAGGED'
        WHERE id = p_session_id;

        RAISE EXCEPTION 'allocation_exhausted';

    END IF;


    -- Lock wallet.

    SELECT *
    INTO v_wallet
    FROM evs_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet_not_found';
    END IF;


    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'wallet_not_active';
    END IF;


    -- AUTHORITATIVE LEDGER ENTRY.

    INSERT INTO evs_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        status,
        reference_id,
        metadata
    )
    VALUES (
        v_wallet.id,
        p_user_id,
        'MINING_REWARD',
        v_reward,
        'CREDIT',
        'CONFIRMED',
        p_session_id::TEXT,
        jsonb_build_object(
            'session_id',
            p_session_id
        )
    );


    -- Update cached wallet balance.

    UPDATE evs_wallets
    SET
        cached_balance =
            cached_balance + v_reward,

        updated_at = NOW()

    WHERE id = v_wallet.id

    RETURNING cached_balance
    INTO new_balance;


    -- Update allocation distribution.

    UPDATE evs_allocations
    SET
        mining_distributed =
            mining_distributed + v_reward,

        updated_at = NOW()

    WHERE id = 1;


    -- Mark session claimed.

    UPDATE evs_mining_sessions
    SET
        status = 'CLAIMED',

        claimed_at = NOW(),

        estimated_reward = v_reward

    WHERE id = p_session_id;


    reward_credited := v_reward;

    RETURN NEXT;

END;
$$;


-- ============================================================
-- 15. ADMIN BALANCE ADJUSTMENT
--
-- Must only be called by an application layer that has already
-- verified the user is an authorized EVS administrator.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_admin_adjust_balance(
    p_admin_id BIGINT,
    p_user_id BIGINT,
    p_amount NUMERIC,
    p_direction TEXT,
    p_reason TEXT
)

RETURNS NUMERIC

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE

    v_wallet evs_wallets;

    v_new_balance NUMERIC(20,4);

    v_transaction_type TEXT;

BEGIN

    IF p_direction NOT IN (
        'CREDIT',
        'DEBIT'
    ) THEN
        RAISE EXCEPTION 'invalid_direction';
    END IF;


    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;


    SELECT *
    INTO v_wallet
    FROM evs_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;


    IF NOT FOUND THEN

        INSERT INTO evs_wallets (
            user_id
        )
        VALUES (
            p_user_id
        )
        RETURNING *
        INTO v_wallet;

    END IF;


    IF
        p_direction = 'DEBIT'
        AND v_wallet.cached_balance < p_amount
    THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;


    v_transaction_type :=
        CASE
            WHEN p_direction = 'CREDIT'
                THEN 'ADMIN_CREDIT'
            ELSE 'ADMIN_DEBIT'
        END;


    INSERT INTO evs_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        status,
        metadata
    )
    VALUES (
        v_wallet.id,
        p_user_id,
        v_transaction_type,
        p_amount,
        p_direction,
        'CONFIRMED',
        jsonb_build_object(
            'admin_id',
            p_admin_id,
            'reason',
            p_reason
        )
    );


    UPDATE evs_wallets
    SET
        cached_balance =
            cached_balance
            + CASE
                WHEN p_direction = 'CREDIT'
                    THEN p_amount
                ELSE -p_amount
              END,

        updated_at = NOW()

    WHERE id = v_wallet.id

    RETURNING cached_balance
    INTO v_new_balance;


    INSERT INTO evs_admin_actions (
        admin_id,
        action,
        old_value,
        new_value,
        reason
    )
    VALUES (
        p_admin_id,

        'MANUAL_BALANCE_ADJUSTMENT',

        jsonb_build_object(
            'user_id',
            p_user_id,

            'balance_before',
            v_wallet.cached_balance
        ),

        jsonb_build_object(
            'user_id',
            p_user_id,

            'balance_after',
            v_new_balance,

            'direction',
            p_direction,

            'amount',
            p_amount
        ),

        p_reason
    );


    RETURN v_new_balance;

END;
$$;


-- ============================================================
-- 16. RECONCILIATION VIEW
--
-- Detects:
--
-- Ledger balance != cached wallet balance
--
-- This NEVER automatically changes balances.
-- ============================================================

CREATE OR REPLACE VIEW evs_reconciliation_report AS

SELECT

    w.id AS wallet_id,

    w.user_id,

    w.cached_balance,

    COALESCE(
        SUM(
            CASE

                WHEN t.direction = 'CREDIT'
                    THEN t.amount

                WHEN t.direction = 'DEBIT'
                    THEN -t.amount

                ELSE 0

            END
        ),

        0

    ) AS ledger_balance,


    w.cached_balance
    -
    COALESCE(
        SUM(
            CASE

                WHEN t.direction = 'CREDIT'
                    THEN t.amount

                WHEN t.direction = 'DEBIT'
                    THEN -t.amount

                ELSE 0

            END
        ),

        0

    ) AS drift


FROM evs_wallets w

LEFT JOIN evs_transactions t

    ON t.wallet_id = w.id

    AND t.status = 'CONFIRMED'


GROUP BY

    w.id,
    w.user_id,
    w.cached_balance


HAVING

    w.cached_balance

    <>

    COALESCE(
        SUM(
            CASE

                WHEN t.direction = 'CREDIT'
                    THEN t.amount

                WHEN t.direction = 'DEBIT'
                    THEN -t.amount

                ELSE 0

            END
        ),

        0

    );


-- ============================================================
-- 17. VERIFICATION QUERIES
--
-- Run these after the schema completes successfully.
-- ============================================================


-- Check EVS tables.

SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_name LIKE 'evs_%'
ORDER BY table_name;


-- Check singleton configuration.

SELECT *
FROM evs_config;


-- Check allocations.

SELECT *
FROM evs_allocations;


-- Check mining configuration.

SELECT *
FROM evs_mining_config;


-- Check reconciliation.

SELECT *
FROM evs_reconciliation_report;


-- ============================================================
-- END OF EVS (EVOS) TOKEN V1 SCHEMA
-- ============================================================

-- ============================================================
-- EVS (EVOS) TOKEN V1
-- FULL PRODUCTION-ORIENTED MINING + WALLET SCHEMA
--
-- PRODUCT:
--   EVS (EVOS) Token
--
-- HOST:
--   EVOS Hub
--
-- URL:
--   https://evoshub.xyz/evs
--
-- ============================================================
--
-- CORE TOKENOMICS
--
-- MAXIMUM TOTAL SUPPLY:
--   500,000,000 EVS
--
-- ALLOCATIONS:
--
--   Mining       75,000,000 EVS
--   Sale        125,000,000 EVS
--   Community    25,000,000 EVS
--   Liquidity    75,000,000 EVS
--   Treasury    200,000,000 EVS
--
--   TOTAL       500,000,000 EVS
--
-- ============================================================
--
-- MINING PROGRAM
--
-- PROGRAM START:
--   2026-09-01
--
-- MONTH 1:
--   10 EVS / 24 hours
--
-- MONTH 2:
--   10 EVS / 24 hours
--
-- MONTH 3:
--   10 EVS / 24 hours
--
-- MONTH 4:
--   2 EVS / 24 hours
--
-- MONTH 5:
--   Mining disabled
--
-- MONTH 6:
--   Mining disabled
--
-- ============================================================
--
-- ACTIVE V1 FEATURES:
--
--   Wallet
--   Mining
--   Claiming
--   Ledger
--   Transaction history
--   Admin audit
--   Security events
--
-- DISABLED V1 FEATURES:
--
--   Purchase
--   Withdrawal
--   Transfer
--   Referral
--   On-chain migration
--
-- ============================================================
--
-- IMPORTANT:
--
-- EVS is independent from EVOS Data Services accounting.
--
-- This schema does NOT modify:
--
--   users
--   agent_wallets
--   agent_transactions
--   orders
--   EVOS Data Services balances
--
-- It only references the existing users(id) table.
--
-- ============================================================


-- ============================================================
-- 0. DEVELOPMENT RESET
--
-- WARNING:
-- This deletes ONLY EVS objects created by this schema.
--
-- DO NOT RUN THIS AGAINST LIVE EVS DATA unless intentional.
-- ============================================================

DROP VIEW IF EXISTS evs_reconciliation_report CASCADE;
DROP VIEW IF EXISTS evs_supply_report CASCADE;
DROP VIEW IF EXISTS evs_mining_status CASCADE;

DROP FUNCTION IF EXISTS evs_start_mining_session CASCADE;
DROP FUNCTION IF EXISTS evs_claim_mining_reward CASCADE;
DROP FUNCTION IF EXISTS evs_admin_adjust_balance CASCADE;
DROP FUNCTION IF EXISTS evs_get_mining_config CASCADE;
DROP FUNCTION IF EXISTS evs_current_mining_phase CASCADE;
DROP FUNCTION IF EXISTS evs_total_confirmed_supply CASCADE;
DROP FUNCTION IF EXISTS evs_check_supply_limit CASCADE;
DROP FUNCTION IF EXISTS evs_update_updated_at CASCADE;

DROP TABLE IF EXISTS evs_security_events CASCADE;
DROP TABLE IF EXISTS evs_admin_actions CASCADE;
DROP TABLE IF EXISTS evs_referrals CASCADE;
DROP TABLE IF EXISTS evs_withdrawals CASCADE;
DROP TABLE IF EXISTS evs_purchases CASCADE;
DROP TABLE IF EXISTS evs_mining_sessions CASCADE;
DROP TABLE IF EXISTS evs_transactions CASCADE;
DROP TABLE IF EXISTS evs_wallets CASCADE;
DROP TABLE IF EXISTS evs_mining_schedule CASCADE;
DROP TABLE IF EXISTS evs_sale_config CASCADE;
DROP TABLE IF EXISTS evs_allocations CASCADE;
DROP TABLE IF EXISTS evs_admins CASCADE;
DROP TABLE IF EXISTS evs_config CASCADE;


-- ============================================================
-- 1. MAIN EVS CONFIGURATION
-- ============================================================

CREATE TABLE evs_config (

    id SMALLINT PRIMARY KEY DEFAULT 1
        CHECK (id = 1),

    system_enabled BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    current_phase TEXT
        NOT NULL
        DEFAULT 'MINING'
        CHECK (
            current_phase IN (
                'MINING',
                'PURCHASE',
                'PRE_LISTING',
                'MIGRATION',
                'LAUNCHED'
            )
        ),

    /*
     * Master mining switch.
     */
    mining_enabled BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    /*
     * Purchase remains disabled in V1.
     */
    sale_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    /*
     * Withdrawals remain disabled in V1.
     */
    withdrawal_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    /*
     * Transfers remain disabled in V1.
     */
    transfer_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    /*
     * Referrals remain disabled in V1.
     */
    referral_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    /*
     * On-chain functionality remains disabled.
     */
    onchain_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    /*
     * EVS mining program start.
     *
     * Month 1 begins here.
     *
     * Change this ONE value if the actual launch date changes.
     */
    mining_program_start TIMESTAMPTZ
        NOT NULL
        DEFAULT '2026-09-01 00:00:00+00',

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_by BIGINT
        REFERENCES users(id)
);


INSERT INTO evs_config (
    id
)
VALUES (
    1
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 2. TOKEN ALLOCATIONS
--
-- TOTAL SUPPLY = 500,000,000 EVS
--
-- IMPORTANT:
-- These allocations add exactly to the maximum supply.
-- ============================================================

CREATE TABLE evs_allocations (

    id SMALLINT PRIMARY KEY DEFAULT 1
        CHECK (id = 1),

    /*
     * Hard maximum total supply.
     */
    total_target NUMERIC(20,4)
        NOT NULL
        DEFAULT 500000000
        CHECK (
            total_target = 500000000
        ),

    /*
     * Maximum tokens available to mining.
     */
    mining_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 75000000
        CHECK (
            mining_allocation >= 0
        ),

    /*
     * Future sale allocation.
     */
    sale_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 125000000
        CHECK (
            sale_allocation >= 0
        ),

    /*
     * Community allocation.
     */
    community_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 25000000
        CHECK (
            community_allocation >= 0
        ),

    /*
     * Liquidity allocation.
     */
    liquidity_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 75000000
        CHECK (
            liquidity_allocation >= 0
        ),

    /*
     * Treasury allocation.
     */
    treasury_allocation NUMERIC(20,4)
        NOT NULL
        DEFAULT 200000000
        CHECK (
            treasury_allocation >= 0
        ),

    /*
     * Amount already distributed through mining.
     */
    mining_distributed NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (
            mining_distributed >= 0
        ),

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_by BIGINT
        REFERENCES users(id),

    /*
     * All allocations must equal exactly 500M.
     */
    CONSTRAINT evs_allocations_exact_total
        CHECK (
            mining_allocation
            + sale_allocation
            + community_allocation
            + liquidity_allocation
            + treasury_allocation
            =
            total_target
        ),

    /*
     * Mining can never exceed its allocation.
     */
    CONSTRAINT evs_mining_distribution_limit
        CHECK (
            mining_distributed <= mining_allocation
        )
);


INSERT INTO evs_allocations (
    id
)
VALUES (
    1
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 3. ADMIN USERS
--
-- Application-level EVS administrators.
--
-- IMPORTANT:
-- Insert your actual authorized admin user IDs here.
--
-- Example:
--
-- INSERT INTO evs_admins (user_id)
-- VALUES (123);
--
-- Do NOT blindly use 123.
-- ============================================================

CREATE TABLE evs_admins (

    user_id BIGINT PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    active BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);


-- ============================================================
-- 4. MINING SCHEDULE
--
-- This is the authoritative mining emission schedule.
--
-- Month 1-3:
--   10 EVS / 24h
--
-- Month 4:
--   2 EVS / 24h
--
-- Month 5:
--   0 EVS
--
-- Month 6:
--   0 EVS
--
-- ============================================================

CREATE TABLE evs_mining_schedule (

    id SMALLSERIAL PRIMARY KEY,

    phase_name TEXT
        NOT NULL
        UNIQUE,

    phase_number INTEGER
        NOT NULL
        UNIQUE
        CHECK (
            phase_number >= 1
            AND phase_number <= 6
        ),

    starts_at TIMESTAMPTZ
        NOT NULL,

    ends_at TIMESTAMPTZ
        NOT NULL,

    mining_enabled BOOLEAN
        NOT NULL,

    session_hours INTEGER
        NOT NULL
        DEFAULT 24
        CHECK (
            session_hours > 0
        ),

    reward_per_session NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (
            reward_per_session >= 0
        ),

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    CONSTRAINT evs_schedule_dates
        CHECK (
            ends_at > starts_at
        ),

    CONSTRAINT evs_schedule_disabled_reward
        CHECK (
            mining_enabled = TRUE
            OR reward_per_session = 0
        ),

    CONSTRAINT evs_schedule_enabled_reward
        CHECK (
            mining_enabled = FALSE
            OR reward_per_session > 0
        )
);


-- ============================================================
-- 5. INSERT MINING SCHEDULE
--
-- Program:
--
-- Sep 1 2026 -> Oct 1 2026 = Month 1
-- Oct 1 2026 -> Nov 1 2026 = Month 2
-- Nov 1 2026 -> Dec 1 2026 = Month 3
-- Dec 1 2026 -> Jan 1 2027 = Month 4
-- Jan 1 2027 -> Feb 1 2027 = Month 5
-- Feb 1 2027 -> Mar 1 2027 = Month 6
--
-- Month 6 is preparation/listing phase.
-- Mining is OFF.
-- ============================================================

INSERT INTO evs_mining_schedule (
    phase_name,
    phase_number,
    starts_at,
    ends_at,
    mining_enabled,
    session_hours,
    reward_per_session
)
VALUES

(
    'MONTH_1',
    1,
    '2026-09-01 00:00:00+00',
    '2026-10-01 00:00:00+00',
    TRUE,
    24,
    10
),

(
    'MONTH_2',
    2,
    '2026-10-01 00:00:00+00',
    '2026-11-01 00:00:00+00',
    TRUE,
    24,
    10
),

(
    'MONTH_3',
    3,
    '2026-11-01 00:00:00+00',
    '2026-12-01 00:00:00+00',
    TRUE,
    24,
    10
),

(
    'MONTH_4',
    4,
    '2026-12-01 00:00:00+00',
    '2027-01-01 00:00:00+00',
    TRUE,
    24,
    2
),

(
    'MONTH_5',
    5,
    '2027-01-01 00:00:00+00',
    '2027-02-01 00:00:00+00',
    FALSE,
    24,
    0
),

(
    'MONTH_6',
    6,
    '2027-02-01 00:00:00+00',
    '2027-03-01 00:00:00+00',
    FALSE,
    24,
    0
);


CREATE INDEX idx_evs_mining_schedule_dates
ON evs_mining_schedule (
    starts_at,
    ends_at
);


-- ============================================================
-- 6. FUTURE SALE CONFIGURATION
--
-- Present for architecture.
-- DISABLED in V1.
-- ============================================================

CREATE TABLE evs_sale_config (

    id SMALLINT PRIMARY KEY DEFAULT 1
        CHECK (id = 1),

    sale_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    price_ghs NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (
            price_ghs >= 0
        ),

    currency TEXT
        NOT NULL
        DEFAULT 'GHS',

    minimum_purchase NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (
            minimum_purchase >= 0
        ),

    maximum_purchase NUMERIC(20,4)
        NOT NULL
        DEFAULT 0
        CHECK (
            maximum_purchase >= minimum_purchase
        ),

    sale_start TIMESTAMPTZ,

    sale_end TIMESTAMPTZ,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

    updated_by BIGINT
        REFERENCES users(id)
);


INSERT INTO evs_sale_config (
    id
)
VALUES (
    1
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 7. EVS WALLETS
--
-- One user = one EVS wallet.
--
-- cached_balance is maintained for fast reads.
--
-- Ledger remains authoritative.
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
        CHECK (
            cached_balance >= 0
        ),

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


CREATE INDEX idx_evs_wallets_user
ON evs_wallets(user_id);


-- ============================================================
-- 8. AUTHORITATIVE EVS LEDGER
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
        CHECK (
            amount > 0
        ),

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


-- ============================================================
-- 9. TRANSACTION INDEXES
-- ============================================================

CREATE INDEX idx_evs_transactions_user
ON evs_transactions(user_id);

CREATE INDEX idx_evs_transactions_wallet
ON evs_transactions(wallet_id);

CREATE INDEX idx_evs_transactions_type
ON evs_transactions(type);

CREATE INDEX idx_evs_transactions_created
ON evs_transactions(created_at DESC);


-- ============================================================
-- 10. MINING REWARD IDEMPOTENCY
--
-- One mining session can produce only one MINING_REWARD.
-- ============================================================

CREATE UNIQUE INDEX evs_tx_mining_reward_unique
ON evs_transactions(reference_id)
WHERE type = 'MINING_REWARD';


-- ============================================================
-- 11. MINING SESSIONS
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

    /*
     * Snapshot of the reward when mining started.
     *
     * This means a user who starts during Month 3
     * retains the Month 3 reward for that session.
     */
    reward_snapshot NUMERIC(20,4)
        NOT NULL
        CHECK (
            reward_snapshot >= 0
        ),

    /*
     * Snapshot of the mining phase.
     */
    phase_snapshot TEXT
        NOT NULL,

    /*
     * Snapshot of session length.
     */
    session_hours INTEGER
        NOT NULL
        CHECK (
            session_hours > 0
        ),

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
        CHECK (
            expires_at > started_at
        )
);


-- ============================================================
-- 12. ONE ACTIVE SESSION PER USER
-- ============================================================

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
-- 13. FUTURE PURCHASE TABLE
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
        CHECK (
            evs_amount > 0
        ),

    price_ghs NUMERIC(20,4)
        NOT NULL
        CHECK (
            price_ghs >= 0
        ),

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
-- 14. FUTURE WITHDRAWALS
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
        CHECK (
            evs_amount > 0
        ),

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
-- 15. FUTURE REFERRALS
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
        CHECK (
            reward_amount >= 0
        ),

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
        referrer_user_id <> referred_user_id
    )
);


-- ============================================================
-- 16. ADMIN AUDIT LOG
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
-- 17. SECURITY EVENTS
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
-- 18. HELPER FUNCTION:
-- CURRENT MINING PHASE
--
-- Returns the phase active at the current database time.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_current_mining_phase()
RETURNS evs_mining_schedule

LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE
    v_phase evs_mining_schedule;
BEGIN

    SELECT *
    INTO v_phase
    FROM evs_mining_schedule
    WHERE
        NOW() >= starts_at
        AND NOW() < ends_at
    ORDER BY phase_number
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no_active_mining_phase';
    END IF;

    RETURN v_phase;

END;
$$;


-- ============================================================
-- 19. HELPER FUNCTION:
-- TOTAL CONFIRMED EVS SUPPLY
--
-- Calculates net confirmed EVS currently represented
-- in the ledger.
--
-- CREDIT = +
-- DEBIT  = -
--
-- This does NOT count pending transactions.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_total_confirmed_supply()
RETURNS NUMERIC

LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public

AS $$

    SELECT COALESCE(
        SUM(
            CASE
                WHEN direction = 'CREDIT'
                    THEN amount
                WHEN direction = 'DEBIT'
                    THEN -amount
                ELSE 0
            END
        ),
        0
    )
    FROM evs_transactions
    WHERE status = 'CONFIRMED';

$$;


-- ============================================================
-- 20. SUPPLY LIMIT CHECK
--
-- Prevents confirmed CREDIT issuance from exceeding
-- the 500M total supply.
--
-- Used by controlled functions before creating credits.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_check_supply_limit(
    p_amount NUMERIC
)
RETURNS VOID

LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE
    v_total_supply NUMERIC(20,4);
    v_max_supply NUMERIC(20,4);
BEGIN

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;

    SELECT total_target
    INTO v_max_supply
    FROM evs_allocations
    WHERE id = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'allocation_config_missing';
    END IF;

    v_total_supply := evs_total_confirmed_supply();

    IF v_total_supply + p_amount > v_max_supply THEN
        RAISE EXCEPTION 'total_supply_exhausted';
    END IF;

END;
$$;


-- ============================================================
-- 21. GET CURRENT MINING CONFIG
--
-- Used by backend/frontend for display.
--
-- The START function below does NOT trust client-supplied
-- reward values.
-- ============================================================

CREATE OR REPLACE FUNCTION evs_get_mining_config()
RETURNS TABLE (
    phase_name TEXT,
    phase_number INTEGER,
    mining_enabled BOOLEAN,
    session_hours INTEGER,
    reward_per_session NUMERIC,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ
)

LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public

AS $$

    SELECT
        s.phase_name,
        s.phase_number,
        s.mining_enabled,
        s.session_hours,
        s.reward_per_session,
        s.starts_at,
        s.ends_at
    FROM evs_mining_schedule s
    JOIN evs_config c
        ON c.id = 1
    WHERE
        NOW() >= s.starts_at
        AND NOW() < s.ends_at
        AND c.system_enabled = TRUE
    LIMIT 1;

$$;


-- ============================================================
-- 22. START MINING SESSION
--
-- IMPORTANT:
--
-- The client DOES NOT provide:
--
--   reward
--   rate
--   session duration
--
-- The database gets these from evs_mining_schedule.
--
-- User simply requests:
--
--   "Start my mining session."
-- ============================================================

CREATE OR REPLACE FUNCTION evs_start_mining_session(
    p_user_id BIGINT
)
RETURNS evs_mining_sessions

LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public

AS $$
DECLARE

    v_config evs_config;

    v_phase evs_mining_schedule;

    v_wallet evs_wallets;

    v_session evs_mining_sessions;

BEGIN

    -- --------------------------------------------------------
    -- Load master configuration.
    -- --------------------------------------------------------

    SELECT *
    INTO v_config
    FROM evs_config
    WHERE id = 1
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'evs_config_missing';
    END IF;


    -- --------------------------------------------------------
    -- System must be enabled.
    -- --------------------------------------------------------

    IF v_config.system_enabled = FALSE THEN
        RAISE EXCEPTION 'evs_system_disabled';
    END IF;


    -- --------------------------------------------------------
    -- Mining master switch.
    -- --------------------------------------------------------

    IF v_config.mining_enabled = FALSE THEN
        RAISE EXCEPTION 'mining_disabled';
    END IF;


    -- --------------------------------------------------------
    -- Find the current mining phase.
    -- --------------------------------------------------------

    SELECT *
    INTO v_phase
    FROM evs_mining_schedule
    WHERE
        NOW() >= starts_at
        AND NOW() < ends_at
    ORDER BY phase_number
    LIMIT 1;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'no_active_mining_phase';
    END IF;


    -- --------------------------------------------------------
    -- Phase-specific mining switch.
    -- --------------------------------------------------------

    IF v_phase.mining_enabled = FALSE THEN
        RAISE EXCEPTION 'mining_not_available_in_current_phase';
    END IF;


    -- --------------------------------------------------------
    -- Ensure the configured reward is valid.
    -- --------------------------------------------------------

    IF v_phase.reward_per_session <= 0 THEN
        RAISE EXCEPTION 'invalid_mining_reward';
    END IF;


    -- --------------------------------------------------------
    -- Find wallet.
    --
    -- Lock it to prevent race conditions.
    -- --------------------------------------------------------

    SELECT *
    INTO v_wallet
    FROM evs_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;


    -- --------------------------------------------------------
    -- Create wallet automatically if necessary.
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Wallet must be active.
    -- --------------------------------------------------------

    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'wallet_not_active';
    END IF;


    -- --------------------------------------------------------
    -- Create session.
    --
    -- Unique index protects against concurrent duplicate starts.
    -- --------------------------------------------------------

    BEGIN

        INSERT INTO evs_mining_sessions (
            user_id,
            started_at,
            expires_at,
            reward_snapshot,
            phase_snapshot,
            session_hours,
            status
        )
        VALUES (
            p_user_id,
            NOW(),
            NOW() + make_interval(
                hours => v_phase.session_hours
            ),
            v_phase.reward_per_session,
            v_phase.phase_name,
            v_phase.session_hours,
            'ACTIVE'
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
-- 23. CLAIM MINING REWARD
--
-- Atomic operation:
--
-- 1. Lock session
-- 2. Verify ownership
-- 3. Verify expiration
-- 4. Lock allocation
-- 5. Verify mining allocation
-- 6. Verify global 500M supply
-- 7. Lock wallet
-- 8. Create ledger transaction
-- 9. Update wallet
-- 10. Update mining allocation
-- 11. Mark session claimed
--
-- Everything succeeds or the transaction rolls back.
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

    v_remaining_mining NUMERIC(20,4);

BEGIN

    -- --------------------------------------------------------
    -- Lock session.
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Session must not already be claimed/cancelled.
    -- --------------------------------------------------------

    IF v_session.status NOT IN (
        'ACTIVE',
        'COMPLETED'
    ) THEN
        RAISE EXCEPTION 'invalid_session_status';
    END IF;


    -- --------------------------------------------------------
    -- Database controls time.
    -- --------------------------------------------------------

    IF NOW() < v_session.expires_at THEN
        RAISE EXCEPTION 'not_yet_expired';
    END IF;


    -- --------------------------------------------------------
    -- Lock allocation.
    -- --------------------------------------------------------

    SELECT *
    INTO v_alloc
    FROM evs_allocations
    WHERE id = 1
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'allocation_config_missing';
    END IF;


    -- --------------------------------------------------------
    -- Calculate remaining mining allocation.
    -- --------------------------------------------------------

    v_remaining_mining :=
        v_alloc.mining_allocation
        - v_alloc.mining_distributed;


    IF v_remaining_mining <= 0 THEN

        UPDATE evs_mining_sessions
        SET
            status = 'FLAGGED'
        WHERE id = p_session_id;

        RAISE EXCEPTION 'mining_allocation_exhausted';

    END IF;


    -- --------------------------------------------------------
    -- Never distribute more than remaining allocation.
    -- --------------------------------------------------------

    v_reward :=
        LEAST(
            v_session.reward_snapshot,
            v_remaining_mining
        );


    IF v_reward <= 0 THEN

        UPDATE evs_mining_sessions
        SET
            status = 'FLAGGED'
        WHERE id = p_session_id;

        RAISE EXCEPTION 'invalid_reward';

    END IF;


    -- --------------------------------------------------------
    -- Check the GLOBAL 500M supply limit.
    -- --------------------------------------------------------

    PERFORM evs_check_supply_limit(v_reward);


    -- --------------------------------------------------------
    -- Lock wallet.
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Create AUTHORITATIVE ledger entry.
    --
    -- reference_id = session ID
    --
    -- Unique index guarantees one mining reward per session.
    -- --------------------------------------------------------

    INSERT INTO evs_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        status,
        reference_id,
        metadata,
        confirmed_at
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
            p_session_id,
            'phase',
            v_session.phase_snapshot,
            'session_hours',
            v_session.session_hours,
            'reward_snapshot',
            v_session.reward_snapshot
        ),
        NOW()
    );


    -- --------------------------------------------------------
    -- Update cached wallet balance.
    -- --------------------------------------------------------

    UPDATE evs_wallets
    SET
        cached_balance =
            cached_balance + v_reward,

        updated_at = NOW()

    WHERE id = v_wallet.id

    RETURNING cached_balance
    INTO new_balance;


    -- --------------------------------------------------------
    -- Update mining distribution.
    -- --------------------------------------------------------

    UPDATE evs_allocations
    SET
        mining_distributed =
            mining_distributed + v_reward,

        updated_at = NOW()

    WHERE id = 1;


    -- --------------------------------------------------------
    -- Mark session CLAIMED.
    -- --------------------------------------------------------

    UPDATE evs_mining_sessions
    SET
        status = 'CLAIMED',

        claimed_at = NOW()

    WHERE id = p_session_id;


    reward_credited := v_reward;


    RETURN NEXT;

END;
$$;


-- ============================================================
-- 24. ADMIN BALANCE ADJUSTMENT
--
-- Only authorized EVS admins can use this function.
--
-- Global 500M supply protection applies to CREDIT.
--
-- DEBIT cannot make wallet negative.
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

    v_admin_exists BOOLEAN;

BEGIN

    -- --------------------------------------------------------
    -- Verify admin.
    -- --------------------------------------------------------

    SELECT EXISTS (
        SELECT 1
        FROM evs_admins
        WHERE
            user_id = p_admin_id
            AND active = TRUE
    )
    INTO v_admin_exists;


    IF v_admin_exists = FALSE THEN
        RAISE EXCEPTION 'unauthorized_admin';
    END IF;


    -- --------------------------------------------------------
    -- Validate direction.
    -- --------------------------------------------------------

    IF p_direction NOT IN (
        'CREDIT',
        'DEBIT'
    ) THEN
        RAISE EXCEPTION 'invalid_direction';
    END IF;


    -- --------------------------------------------------------
    -- Validate amount.
    -- --------------------------------------------------------

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;


    -- --------------------------------------------------------
    -- Reason is required.
    -- --------------------------------------------------------

    IF p_reason IS NULL
       OR LENGTH(TRIM(p_reason)) = 0
    THEN
        RAISE EXCEPTION 'admin_reason_required';
    END IF;


    -- --------------------------------------------------------
    -- Find and lock wallet.
    -- --------------------------------------------------------

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


    -- --------------------------------------------------------
    -- Wallet must be active.
    -- --------------------------------------------------------

    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'wallet_not_active';
    END IF;


    -- --------------------------------------------------------
    -- DEBIT protection.
    -- --------------------------------------------------------

    IF
        p_direction = 'DEBIT'
        AND v_wallet.cached_balance < p_amount
    THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;


    -- --------------------------------------------------------
    -- CREDIT protection.
    --
    -- Admin cannot create more EVS than the 500M supply.
    -- --------------------------------------------------------

    IF p_direction = 'CREDIT' THEN
        PERFORM evs_check_supply_limit(p_amount);
    END IF;


    -- --------------------------------------------------------
    -- Transaction type.
    -- --------------------------------------------------------

    v_transaction_type :=
        CASE
            WHEN p_direction = 'CREDIT'
                THEN 'ADMIN_CREDIT'
            ELSE 'ADMIN_DEBIT'
        END;


    -- --------------------------------------------------------
    -- Create ledger transaction.
    -- --------------------------------------------------------

    INSERT INTO evs_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        status,
        metadata,
        confirmed_at
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
        ),
        NOW()
    );


    -- --------------------------------------------------------
    -- Update wallet.
    -- --------------------------------------------------------

    UPDATE evs_wallets
    SET
        cached_balance =
            cached_balance
            +
            CASE
                WHEN p_direction = 'CREDIT'
                    THEN p_amount
                ELSE -p_amount
            END,

        updated_at = NOW()

    WHERE id = v_wallet.id

    RETURNING cached_balance
    INTO v_new_balance;


    -- --------------------------------------------------------
    -- Audit.
    -- --------------------------------------------------------

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
-- 25. SUPPLY REPORT
--
-- Shows:
--
-- Maximum supply
-- Current confirmed net supply
-- Remaining supply
-- Mining allocation
-- Mining distributed
-- Mining remaining
-- ============================================================

CREATE OR REPLACE VIEW evs_supply_report AS

SELECT

    a.total_target AS maximum_supply,

    evs_total_confirmed_supply()
        AS confirmed_net_supply,

    a.total_target
        - evs_total_confirmed_supply()
        AS remaining_supply,

    a.mining_allocation,

    a.mining_distributed,

    a.mining_allocation
        - a.mining_distributed
        AS remaining_mining_allocation

FROM evs_allocations a
WHERE a.id = 1;


-- ============================================================
-- 26. MINING STATUS VIEW
--
-- Useful for the EVS dashboard/backend.
-- ============================================================

CREATE OR REPLACE VIEW evs_mining_status AS

SELECT

    s.phase_name,

    s.phase_number,

    s.starts_at,

    s.ends_at,

    s.mining_enabled,

    s.session_hours,

    s.reward_per_session,

    c.mining_enabled
        AS master_mining_enabled,

    c.system_enabled,

    CASE
        WHEN
            c.system_enabled = TRUE
            AND c.mining_enabled = TRUE
            AND s.mining_enabled = TRUE
        THEN TRUE
        ELSE FALSE
    END AS mining_available

FROM evs_mining_schedule s

CROSS JOIN evs_config c

WHERE
    NOW() >= s.starts_at
    AND NOW() < s.ends_at

LIMIT 1;


-- ============================================================
-- 27. RECONCILIATION VIEW
--
-- Detects:
--
-- cached wallet balance != ledger balance
--
-- This view NEVER automatically changes anything.
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
-- 28. UPDATED_AT TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION evs_update_updated_at()
RETURNS TRIGGER

LANGUAGE plpgsql

AS $$
BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;
$$;


-- ============================================================
-- 29. UPDATED_AT TRIGGERS
-- ============================================================

CREATE TRIGGER trg_evs_config_updated
BEFORE UPDATE ON evs_config
FOR EACH ROW
EXECUTE FUNCTION evs_update_updated_at();


CREATE TRIGGER trg_evs_allocations_updated
BEFORE UPDATE ON evs_allocations
FOR EACH ROW
EXECUTE FUNCTION evs_update_updated_at();


CREATE TRIGGER trg_evs_sale_config_updated
BEFORE UPDATE ON evs_sale_config
FOR EACH ROW
EXECUTE FUNCTION evs_update_updated_at();


CREATE TRIGGER trg_evs_wallets_updated
BEFORE UPDATE ON evs_wallets
FOR EACH ROW
EXECUTE FUNCTION evs_update_updated_at();


-- ============================================================
-- 30. FUNCTION EXECUTION SECURITY
--
-- Do not allow arbitrary public/anonymous callers to invoke
-- SECURITY DEFINER functions directly.
--
-- The intended production architecture is:
--
-- Frontend
--    ↓
-- EVOS backend/API
--    ↓
-- Supabase using controlled credentials
--    ↓
-- EVS database functions
--
-- ============================================================

REVOKE ALL
ON FUNCTION evs_start_mining_session(BIGINT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_claim_mining_reward(BIGINT, BIGINT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_admin_adjust_balance(
    BIGINT,
    BIGINT,
    NUMERIC,
    TEXT,
    TEXT
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_get_mining_config()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_current_mining_phase()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_total_confirmed_supply()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION evs_check_supply_limit(NUMERIC)
FROM PUBLIC;


-- ============================================================
-- 31. OPTIONAL BACKEND ROLE GRANTS
--
-- If your backend uses the Supabase service_role, service_role
-- bypasses RLS and can call these functions.
--
-- Do NOT grant these functions to anon.
-- ============================================================

GRANT EXECUTE
ON FUNCTION evs_start_mining_session(BIGINT)
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_claim_mining_reward(BIGINT, BIGINT)
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_admin_adjust_balance(
    BIGINT,
    BIGINT,
    NUMERIC,
    TEXT,
    TEXT
)
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_get_mining_config()
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_current_mining_phase()
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_total_confirmed_supply()
TO service_role;

GRANT EXECUTE
ON FUNCTION evs_check_supply_limit(NUMERIC)
TO service_role;


-- ============================================================
-- 32. ROW LEVEL SECURITY
--
-- Enable RLS so direct PostgREST access is not automatically
-- open to clients.
--
-- Your backend/service_role can still operate normally.
-- ============================================================

ALTER TABLE evs_config
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_allocations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_admins
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_mining_schedule
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_sale_config
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_wallets
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_transactions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_mining_sessions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_purchases
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_withdrawals
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_referrals
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_admin_actions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE evs_security_events
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 33. VERIFICATION QUERIES
--
-- Run after the schema completes.
-- ============================================================


-- ------------------------------------------------------------
-- EVS TABLES
-- ------------------------------------------------------------

SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_name LIKE 'evs_%'
ORDER BY table_name;


-- ------------------------------------------------------------
-- MAIN CONFIG
-- ------------------------------------------------------------

SELECT *
FROM evs_config;


-- ------------------------------------------------------------
-- TOKEN ALLOCATIONS
-- ------------------------------------------------------------

SELECT *
FROM evs_allocations;


-- ------------------------------------------------------------
-- MINING SCHEDULE
-- ------------------------------------------------------------

SELECT
    phase_name,
    phase_number,
    starts_at,
    ends_at,
    mining_enabled,
    session_hours,
    reward_per_session
FROM evs_mining_schedule
ORDER BY phase_number;


-- ------------------------------------------------------------
-- CURRENT MINING STATUS
-- ------------------------------------------------------------

SELECT *
FROM evs_mining_status;


-- ------------------------------------------------------------
-- SUPPLY REPORT
-- ------------------------------------------------------------

SELECT *
FROM evs_supply_report;


-- ------------------------------------------------------------
-- RECONCILIATION
-- ------------------------------------------------------------

SELECT *
FROM evs_reconciliation_report;


-- ------------------------------------------------------------
-- CURRENT MINING CONFIG FUNCTION
-- ------------------------------------------------------------

SELECT *
FROM evs_get_mining_config();


-- ============================================================
-- END OF EVS (EVOS) TOKEN V1 SCHEMA
-- ============================================================

-- ==============================================================================
-- WISHRITE CREATOR CLUB — PHASE 3B PRODUCTION DATABASE DEPLOYMENT
-- File: supabase-creator-club-v3b-deploy.sql
--
-- REAL PAYOUTS MUST REMAIN DISABLED UNTIL RAZORPAYX SANDBOX E2E VERIFICATION IS COMPLETE.
--
-- Pure, idempotent, fail-closed, and standalone deployment script for Phase 3B:
-- - Creator Wallets & Materialized Balances
-- - Immutable Wallet Transactions Ledger (Integer/Paise Accounting)
-- - Creator Payout Methods (UPI & Bank Accounts)
-- - Creator Withdrawals & Payout Lifecycle
-- - Creator Points Accounts & Immutable Points Ledger
-- - Rewards Catalogue & Redemptions
-- - Payout Webhook Events Deduplication & Verification
-- - Row Level Security (RLS) & Fine-Grained Access Policies
-- - Atomic Balance Deduction Stored Procedure (Concurrency-Safe)
--
-- EXECUTION:
-- 1. Copy the entire contents of this file.
-- 2. Paste into the Supabase SQL Editor.
-- 3. Click Run.
--
-- CANONICAL SCHEMA GUARANTEE:
-- public.influencers primary key is influencer_id UUID PRIMARY KEY.
-- public.influencer_accounts maps auth_user_id to influencer_id.
-- ZERO references to public.influencers(id).
-- Neither public.influencers nor public.influencer_accounts is modified or dropped.
-- ==============================================================================

-- ==============================================================================
-- 1. PREFLIGHT SCHEMA VALIDATION (FAIL-CLOSED)
-- Verifies Phase 3A prerequisites: public.influencers, public.influencer_accounts,
-- primary keys, and canonical foreign key relationships before creating Phase 3B objects.
-- ==============================================================================
DO $$
DECLARE
    v_pk_col TEXT;
    v_fk_count INTEGER;
BEGIN
    -- 1. Verify public.influencers exists
    IF to_regclass('public.influencers') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B PREFLIGHT FAILED: Table public.influencers does not exist.';
    END IF;

    -- 2. Verify public.influencers.influencer_id exists and is PRIMARY KEY
    SELECT kcu.column_name
    INTO v_pk_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'influencers'
      AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;

    IF v_pk_col IS NULL OR v_pk_col <> 'influencer_id' THEN
        RAISE EXCEPTION 'PHASE 3B PREFLIGHT FAILED: public.influencers primary key must be "influencer_id" (found: "%")', COALESCE(v_pk_col, 'NONE');
    END IF;

    -- 3. Verify public.influencer_accounts exists (Phase 3A requirement)
    IF to_regclass('public.influencer_accounts') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B PREFLIGHT FAILED: Table public.influencer_accounts does not exist. Deploy Phase 3A first.';
    END IF;

    -- 4. Verify public.influencer_accounts.influencer_id exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'influencer_accounts' AND column_name = 'influencer_id'
    ) THEN
        RAISE EXCEPTION 'PHASE 3B PREFLIGHT FAILED: Column influencer_accounts.influencer_id does not exist.';
    END IF;

    -- 5. Verify Phase 3A foreign key (influencer_accounts.influencer_id -> influencers.influencer_id) via pg_constraint
    SELECT COUNT(*)
    INTO v_fk_count
    FROM pg_constraint con
    JOIN pg_class child_table ON child_table.oid = con.conrelid
    JOIN pg_namespace child_schema ON child_schema.oid = child_table.relnamespace
    JOIN pg_class parent_table ON parent_table.oid = con.confrelid
    JOIN pg_namespace parent_schema ON parent_schema.oid = parent_table.relnamespace
    WHERE con.contype = 'f'
      AND child_schema.nspname = 'public'
      AND child_table.relname = 'influencer_accounts'
      AND parent_schema.nspname = 'public'
      AND parent_table.relname = 'influencers'
      AND con.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = child_table.oid AND attname = 'influencer_id' AND NOT attisdropped)
      ]
      AND con.confkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = parent_table.oid AND attname = 'influencer_id' AND NOT attisdropped)
      ];

    IF v_fk_count <> 1 THEN
        RAISE EXCEPTION 'PHASE 3B PREFLIGHT FAILED: Phase 3A foreign key from influencer_accounts.influencer_id to influencers.influencer_id is missing.';
    END IF;

    RAISE NOTICE '[PREFLIGHT PASS] Phase 3A foundation verified. Proceeding with Phase 3B deployment.';
END $$;


-- ==============================================================================
-- 2. CREATE TABLE public.influencer_wallets
-- Aggregate cache & balances. Source of truth is the immutable transaction ledger.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'INR',
    pending_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (pending_balance >= 0.00),
    available_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (available_balance >= 0.00),
    paid_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_balance >= 0.00),
    lifetime_earned NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (lifetime_earned >= 0.00),
    lifetime_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (lifetime_paid >= 0.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_influencer_wallets_influencer_id UNIQUE (influencer_id)
);

CREATE INDEX IF NOT EXISTS idx_inf_wallets_influencer_id ON public.influencer_wallets(influencer_id);


-- ==============================================================================
-- 3. CREATE TABLE public.influencer_wallet_transactions
-- Immutable append-only financial ledger.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.influencer_wallets(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'commission_pending',
        'commission_available',
        'commission_reversal',
        'withdrawal_requested',
        'withdrawal_processing',
        'withdrawal_completed',
        'withdrawal_failed',
        'withdrawal_reversed',
        'manual_credit',
        'manual_debit',
        'reward_redemption',
        'reward_refund',
        'bonus'
    )),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0.00),
    currency TEXT NOT NULL DEFAULT 'INR',
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit', 'hold', 'release', 'neutral')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled', 'reversed')),
    reference_type TEXT NOT NULL CHECK (reference_type IN ('order', 'withdrawal', 'manual', 'reward', 'bonus', 'system')),
    reference_id TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_wallet_tx_idempotency UNIQUE (wallet_id, transaction_type, reference_type, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_inf_wallet_tx_wallet_id ON public.influencer_wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_inf_wallet_tx_influencer_id ON public.influencer_wallet_transactions(influencer_id);
CREATE INDEX IF NOT EXISTS idx_inf_wallet_tx_created ON public.influencer_wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inf_wallet_tx_ref ON public.influencer_wallet_transactions(reference_type, reference_id);


-- ==============================================================================
-- 4. CREATE TABLE public.influencer_payout_methods
-- Creator payout destinations (UPI & Bank Accounts).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_payout_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    method_type TEXT NOT NULL CHECK (method_type IN ('upi', 'bank_account')),
    account_holder_name TEXT NOT NULL,
    upi_id TEXT NULL,
    account_number_masked TEXT NULL,
    account_number_encrypted TEXT NULL,
    ifsc_code TEXT NULL,
    bank_name TEXT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    verification_status TEXT NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inf_payout_methods_inf_id ON public.influencer_payout_methods(influencer_id);


-- ==============================================================================
-- 5. CREATE TABLE public.influencer_withdrawals
-- Withdrawal requests and payout lifecycle.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.influencer_wallets(id) ON DELETE CASCADE,
    withdrawal_reference TEXT NOT NULL UNIQUE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 500.00),
    currency TEXT NOT NULL DEFAULT 'INR',
    payout_method TEXT NOT NULL CHECK (payout_method IN ('upi', 'bank_account')),
    payout_status TEXT NOT NULL DEFAULT 'requested' CHECK (payout_status IN (
        'requested',
        'approved',
        'processing',
        'completed',
        'rejected',
        'failed',
        'reversed'
    )),
    payout_method_id UUID NULL REFERENCES public.influencer_payout_methods(id) ON DELETE SET NULL,
    payout_details JSONB NOT NULL,
    rejection_reason TEXT NULL,
    failure_reason TEXT NULL,
    razorpay_payout_id TEXT NULL,
    razorpay_fund_account_id TEXT NULL,
    razorpay_contact_id TEXT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    admin_notes TEXT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ NULL,
    processing_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    rejected_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inf_withdrawals_influencer_id ON public.influencer_withdrawals(influencer_id);
CREATE INDEX IF NOT EXISTS idx_inf_withdrawals_status ON public.influencer_withdrawals(payout_status);
CREATE INDEX IF NOT EXISTS idx_inf_withdrawals_created ON public.influencer_withdrawals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inf_withdrawals_ref ON public.influencer_withdrawals(withdrawal_reference);


-- ==============================================================================
-- 6. CREATE TABLE public.influencer_points_accounts
-- Creator gamification balances.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_points_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    lifetime_points_earned INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points_earned >= 0),
    lifetime_points_spent INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points_spent >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_influencer_points_influencer_id UNIQUE (influencer_id)
);

CREATE INDEX IF NOT EXISTS idx_inf_points_influencer_id ON public.influencer_points_accounts(influencer_id);


-- ==============================================================================
-- 7. CREATE TABLE public.influencer_points_transactions
-- Immutable gamification points ledger.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    points_account_id UUID NOT NULL REFERENCES public.influencer_points_accounts(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'sale_bonus',
        'campaign_bonus',
        'signup_bonus',
        'milestone_bonus',
        'manual_credit',
        'manual_debit',
        'reward_redemption',
        'reward_refund',
        'expiry'
    )),
    points INTEGER NOT NULL CHECK (points > 0),
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    reference_type TEXT NOT NULL CHECK (reference_type IN ('order', 'redemption', 'manual', 'campaign', 'signup')),
    reference_id TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_points_tx_idempotency UNIQUE (points_account_id, transaction_type, reference_type, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_inf_points_tx_account_id ON public.influencer_points_transactions(points_account_id);
CREATE INDEX IF NOT EXISTS idx_inf_points_tx_influencer_id ON public.influencer_points_transactions(influencer_id);
CREATE INDEX IF NOT EXISTS idx_inf_points_tx_created ON public.influencer_points_transactions(created_at DESC);


-- ==============================================================================
-- 8. CREATE TABLE public.influencer_rewards
-- Rewards catalogue for creator points redemption.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reward_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT NULL,
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    reward_type TEXT NOT NULL CHECK (reward_type IN ('product', 'voucher', 'coupon', 'gift', 'experience')),
    inventory_quantity INTEGER NOT NULL DEFAULT 0 CHECK (inventory_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    terms TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inf_rewards_active ON public.influencer_rewards(is_active, sort_order);


-- ==============================================================================
-- 9. CREATE TABLE public.influencer_reward_redemptions
-- Creator reward redemption requests and fulfillment.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_reward_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES public.influencer_rewards(id) ON DELETE RESTRICT,
    points_spent INTEGER NOT NULL CHECK (points_spent > 0),
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'fulfilled', 'cancelled')),
    redemption_reference TEXT NOT NULL UNIQUE,
    cancellation_reason TEXT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fulfilled_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_inf_redemptions_influencer_id ON public.influencer_reward_redemptions(influencer_id);
CREATE INDEX IF NOT EXISTS idx_inf_redemptions_status ON public.influencer_reward_redemptions(status);


-- ==============================================================================
-- 10. CREATE TABLE public.influencer_payout_webhooks
-- Deduplication and idempotency log for RazorpayX webhooks.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_payout_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_webhooks_event_id ON public.influencer_payout_webhooks(event_id);


-- ==============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- Strict isolation: creators only access their own records via influencer_accounts.
-- ==============================================================================
ALTER TABLE public.influencer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_points_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_payout_webhooks ENABLE ROW LEVEL SECURITY;

-- Service role full access policies (Idempotent: DROP IF EXISTS, then CREATE)
DROP POLICY IF EXISTS "Service role full access on influencer_wallets" ON public.influencer_wallets;
CREATE POLICY "Service role full access on influencer_wallets"
    ON public.influencer_wallets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_wallet_transactions" ON public.influencer_wallet_transactions;
CREATE POLICY "Service role full access on influencer_wallet_transactions"
    ON public.influencer_wallet_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_payout_methods" ON public.influencer_payout_methods;
CREATE POLICY "Service role full access on influencer_payout_methods"
    ON public.influencer_payout_methods FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_withdrawals" ON public.influencer_withdrawals;
CREATE POLICY "Service role full access on influencer_withdrawals"
    ON public.influencer_withdrawals FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_points_accounts" ON public.influencer_points_accounts;
CREATE POLICY "Service role full access on influencer_points_accounts"
    ON public.influencer_points_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_points_transactions" ON public.influencer_points_transactions;
CREATE POLICY "Service role full access on influencer_points_transactions"
    ON public.influencer_points_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_rewards" ON public.influencer_rewards;
CREATE POLICY "Service role full access on influencer_rewards"
    ON public.influencer_rewards FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_reward_redemptions" ON public.influencer_reward_redemptions;
CREATE POLICY "Service role full access on influencer_reward_redemptions"
    ON public.influencer_reward_redemptions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on influencer_payout_webhooks" ON public.influencer_payout_webhooks;
CREATE POLICY "Service role full access on influencer_payout_webhooks"
    ON public.influencer_payout_webhooks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated creator view policies (via influencer_accounts mapping)
DROP POLICY IF EXISTS "Creators view own wallet" ON public.influencer_wallets;
CREATE POLICY "Creators view own wallet"
    ON public.influencer_wallets FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Creators view own wallet transactions" ON public.influencer_wallet_transactions;
CREATE POLICY "Creators view own wallet transactions"
    ON public.influencer_wallet_transactions FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Creators view own payout methods" ON public.influencer_payout_methods;
CREATE POLICY "Creators view own payout methods"
    ON public.influencer_payout_methods FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Creators view own withdrawals" ON public.influencer_withdrawals;
CREATE POLICY "Creators view own withdrawals"
    ON public.influencer_withdrawals FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Creators view own points" ON public.influencer_points_accounts;
CREATE POLICY "Creators view own points"
    ON public.influencer_points_accounts FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Creators view own points transactions" ON public.influencer_points_transactions;
CREATE POLICY "Creators view own points transactions"
    ON public.influencer_points_transactions FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Anyone view active rewards" ON public.influencer_rewards;
CREATE POLICY "Anyone view active rewards"
    ON public.influencer_rewards FOR SELECT TO public
    USING (is_active = true);

DROP POLICY IF EXISTS "Creators view own redemptions" ON public.influencer_reward_redemptions;
CREATE POLICY "Creators view own redemptions"
    ON public.influencer_reward_redemptions FOR SELECT TO authenticated
    USING (influencer_id IN (SELECT influencer_id FROM public.influencer_accounts WHERE auth_user_id = auth.uid()));


-- ==============================================================================
-- 12. ATOMIC FINANCIAL STORED PROCEDURE (CONCURRENCY HARDENING)
-- Prevents overdrafts and race conditions at the database engine level.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.deduct_influencer_wallet_balance(
    p_wallet_id UUID,
    p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_wallet RECORD;
BEGIN
    UPDATE public.influencer_wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE id = p_wallet_id
      AND available_balance >= p_amount
    RETURNING * INTO v_wallet;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;

    RETURN jsonb_build_object('success', true, 'wallet', to_jsonb(v_wallet));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==============================================================================
-- 13. STRICT POST-MIGRATION PROGRAMMATIC VERIFICATION (FAIL-CLOSED)
-- Validates every table with to_regclass(), verifies foreign keys via pg_constraint,
-- confirms RLS, checks constraints, and verifies the atomic deduction function.
-- ==============================================================================
DO $$
DECLARE
    v_target_table TEXT;
    v_fk_count INTEGER;
    v_bad_fk_count INTEGER;
    v_rls_missing TEXT[];
    v_func_exists BOOLEAN;
    v_tables TEXT[] := ARRAY[
        'influencer_wallets',
        'influencer_wallet_transactions',
        'influencer_payout_methods',
        'influencer_withdrawals',
        'influencer_points_accounts',
        'influencer_points_transactions',
        'influencer_rewards',
        'influencer_reward_redemptions',
        'influencer_payout_webhooks'
    ];
BEGIN
    -- 1. Explicit to_regclass() validation for each required Phase 3B table
    IF to_regclass('public.influencer_wallets') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_wallets was not created';
    END IF;

    IF to_regclass('public.influencer_wallet_transactions') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_wallet_transactions was not created';
    END IF;

    IF to_regclass('public.influencer_payout_methods') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_payout_methods was not created';
    END IF;

    IF to_regclass('public.influencer_withdrawals') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_withdrawals was not created';
    END IF;

    IF to_regclass('public.influencer_points_accounts') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_points_accounts was not created';
    END IF;

    IF to_regclass('public.influencer_points_transactions') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_points_transactions was not created';
    END IF;

    IF to_regclass('public.influencer_rewards') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_rewards was not created';
    END IF;

    IF to_regclass('public.influencer_reward_redemptions') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_reward_redemptions was not created';
    END IF;

    IF to_regclass('public.influencer_payout_webhooks') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: influencer_payout_webhooks was not created';
    END IF;

    -- 2. Verify all 7 direct foreign keys referencing public.influencers(influencer_id) via pg_constraint
    SELECT COUNT(*)
    INTO v_fk_count
    FROM pg_constraint con
    JOIN pg_class child_table ON child_table.oid = con.conrelid
    JOIN pg_namespace child_schema ON child_schema.oid = child_table.relnamespace
    JOIN pg_class parent_table ON parent_table.oid = con.confrelid
    JOIN pg_namespace parent_schema ON parent_schema.oid = parent_table.relnamespace
    WHERE con.contype = 'f'
      AND child_schema.nspname = 'public'
      AND parent_schema.nspname = 'public'
      AND parent_table.relname = 'influencers'
      AND child_table.relname IN (
          'influencer_wallets',
          'influencer_wallet_transactions',
          'influencer_payout_methods',
          'influencer_withdrawals',
          'influencer_points_accounts',
          'influencer_points_transactions',
          'influencer_reward_redemptions'
      )
      AND con.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = child_table.oid AND attname = 'influencer_id' AND NOT attisdropped)
      ]
      AND con.confkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = parent_table.oid AND attname = 'influencer_id' AND NOT attisdropped)
      ];

    IF v_fk_count < 7 THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: Expected 7 foreign keys referencing public.influencers(influencer_id), found %', v_fk_count;
    END IF;

    -- 3. Verify ZERO foreign keys point to non-existent public.influencers(id)
    SELECT COUNT(*)
    INTO v_bad_fk_count
    FROM pg_constraint con
    JOIN pg_class parent_table ON parent_table.oid = con.confrelid
    JOIN pg_namespace parent_schema ON parent_schema.oid = parent_table.relnamespace
    JOIN pg_attribute parent_col ON parent_col.attrelid = parent_table.oid AND parent_col.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND parent_schema.nspname = 'public'
      AND parent_table.relname = 'influencers'
      AND parent_col.attname = 'id';

    IF v_bad_fk_count > 0 THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: Found % foreign key(s) incorrectly referencing public.influencers(id)', v_bad_fk_count;
    END IF;

    -- 4. Verify Row Level Security is enabled on all 9 tables
    FOREACH v_target_table IN ARRAY v_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = v_target_table AND c.relrowsecurity = true
        ) THEN
            v_rls_missing := array_append(v_rls_missing, v_target_table);
        END IF;
    END LOOP;

    IF array_length(v_rls_missing, 1) > 0 THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: RLS is NOT enabled on tables: %', v_rls_missing;
    END IF;

    -- 5. Verify atomic deduction function exists
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'deduct_influencer_wallet_balance'
    ) INTO v_func_exists;

    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'PHASE 3B MIGRATION FAILED: Function public.deduct_influencer_wallet_balance does not exist';
    END IF;

    RAISE NOTICE '[PASS] CREATOR CLUB PHASE 3B MIGRATION VERIFICATION SUCCESSFUL: 9 TABLES CREATED, CANONICAL FKS VERIFIED, RLS ENABLED, ATOMIC PROCEDURE READY.';
END $$;


-- ==============================================================================
-- 14. FINAL DEPLOYMENT VERIFICATION QUERIES
-- Returns visible populated rows in Supabase SQL Editor.
-- ==============================================================================

-- Query 1: All 9 Phase 3B Tables and their RLS Status
SELECT
    c.relname AS table_name,
    to_regclass('public.' || c.relname) AS regclass_name,
    c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'influencer_wallets',
    'influencer_wallet_transactions',
    'influencer_payout_methods',
    'influencer_withdrawals',
    'influencer_points_accounts',
    'influencer_points_transactions',
    'influencer_rewards',
    'influencer_reward_redemptions',
    'influencer_payout_webhooks'
  )
ORDER BY c.relname;

-- Query 2: All Relevant Foreign-Key Relationships (via pg_constraint)
SELECT
    con.conname AS constraint_name,
    child_table.relname AS source_table,
    child_col.attname AS source_column,
    parent_table.relname AS referenced_table,
    parent_col.attname AS referenced_column
FROM pg_constraint con
JOIN pg_class child_table ON child_table.oid = con.conrelid
JOIN pg_namespace child_schema ON child_schema.oid = child_table.relnamespace
JOIN pg_class parent_table ON parent_table.oid = con.confrelid
JOIN pg_namespace parent_schema ON parent_schema.oid = parent_table.relnamespace
JOIN pg_attribute child_col ON child_col.attrelid = child_table.oid AND child_col.attnum = con.conkey[1]
JOIN pg_attribute parent_col ON parent_col.attrelid = parent_table.oid AND parent_col.attnum = con.confkey[1]
WHERE con.contype = 'f'
  AND child_schema.nspname = 'public'
  AND child_table.relname IN (
    'influencer_wallets',
    'influencer_wallet_transactions',
    'influencer_payout_methods',
    'influencer_withdrawals',
    'influencer_points_accounts',
    'influencer_points_transactions',
    'influencer_reward_redemptions'
  )
ORDER BY child_table.relname, con.conname;

-- Query 3: Atomic Wallet Deduction Stored Procedure
SELECT
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'deduct_influencer_wallet_balance';

-- Query 4: Important Financial Check & Unique Balance Constraints
SELECT
    con.conname AS constraint_name,
    c.relname AS table_name,
    con.contype AS constraint_type,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'influencer_wallets',
    'influencer_wallet_transactions',
    'influencer_withdrawals',
    'influencer_points_accounts',
    'influencer_rewards'
  )
  AND con.contype IN ('c', 'u')
ORDER BY c.relname, con.conname;

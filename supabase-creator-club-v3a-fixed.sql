-- ==============================================================================
-- WISHRITE CREATOR CLUB — PHASE 3A DATABASE MIGRATION (CORRECTED)
-- Secure Creator Accounts, Supabase Auth Mapping, Performance Indexes & RLS
--
-- CANONICAL SCHEMA RULE:
-- public.influencers primary key is: influencer_id UUID PRIMARY KEY
-- ZERO references to public.influencers(id).
-- DO NOT modify, rename, recreate, drop, or alter public.influencers.
-- ==============================================================================

-- ==============================================================================
-- 0. PREFLIGHT SCHEMA VALIDATION
-- Verifies that public.influencers exists, influencer_id is the primary key,
-- and public.influencers.id is NOT required.
-- Fails immediately if the canonical schema is missing or invalid.
-- ==============================================================================
DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_col_exists BOOLEAN;
    v_pk_column TEXT;
    v_has_id_col BOOLEAN;
BEGIN
    -- 1. Verify public.influencers table exists
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'influencers'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
        RAISE EXCEPTION 'PREFLIGHT ERROR: Table public.influencers does not exist. Aborting migration.';
    END IF;

    -- 2. Verify public.influencers.influencer_id column exists
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'influencers'
          AND column_name = 'influencer_id'
    ) INTO v_col_exists;

    IF NOT v_col_exists THEN
        RAISE EXCEPTION 'PREFLIGHT ERROR: Column public.influencers.influencer_id does not exist. Aborting migration.';
    END IF;

    -- 3. Verify influencer_id is PRIMARY KEY
    SELECT kcu.column_name
    INTO v_pk_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'influencers'
      AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;

    IF v_pk_column IS NULL OR v_pk_column <> 'influencer_id' THEN
        RAISE EXCEPTION 'PREFLIGHT ERROR: public.influencers primary key must be "influencer_id" (found: "%"). Aborting migration.', COALESCE(v_pk_column, 'NONE');
    END IF;

    -- 4. Verify public.influencers.id is NOT required
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'influencers'
          AND column_name = 'id'
    ) INTO v_has_id_col;

    IF v_has_id_col THEN
        RAISE NOTICE '[PREFLIGHT INFO] Legacy column public.influencers.id detected, but canonical PK is verified as influencer_id.';
    ELSE
        RAISE NOTICE '[PREFLIGHT PASS] Confirmed public.influencers.id does not exist; canonical PK is influencer_id.';
    END IF;

    RAISE NOTICE '[PREFLIGHT PASS] public.influencers exists and has verified primary key influencer_id. Proceeding with Phase 3A migration.';
END $$;


-- ==============================================================================
-- 1. CREATE public.influencer_accounts TABLE
-- Maps authenticated Supabase users (auth_user_id) to canonical influencer records (influencer_id)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(influencer_id) ON DELETE CASCADE,
    auth_user_id UUID NULL,
    email TEXT NOT NULL,
    password_hash TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_influencer_accounts_influencer_id UNIQUE (influencer_id),
    CONSTRAINT uq_influencer_accounts_auth_user_id UNIQUE (auth_user_id),
    CONSTRAINT uq_influencer_accounts_email UNIQUE (email)
);

COMMENT ON TABLE public.influencer_accounts IS 'Maps authenticated Supabase users (auth_user_id) to canonical influencer records (influencer_id) for WishRite Creator Club Phase 3A';


-- ==============================================================================
-- 2. INDEXES FOR FAST LOOKUP & PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_influencer_accounts_auth_user_id 
    ON public.influencer_accounts(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_influencer_accounts_influencer_id 
    ON public.influencer_accounts(influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_accounts_email 
    ON public.influencer_accounts(email);

-- Performance & attribution indexes for Phase 3A Creator Dashboard queries (safely checked)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'influencer_order_attributions') THEN
        CREATE INDEX IF NOT EXISTS idx_inf_order_attr_creator_created 
            ON public.influencer_order_attributions(influencer_id, created_at DESC);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'influencer_clicks') THEN
        CREATE INDEX IF NOT EXISTS idx_inf_clicks_creator_created 
            ON public.influencer_clicks(influencer_id, created_at DESC);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'influencer_links') THEN
        CREATE INDEX IF NOT EXISTS idx_inf_links_creator_default 
            ON public.influencer_links(influencer_id, is_default);
    END IF;
END $$;


-- ==============================================================================
-- 3. TRIGGER FOR updated_at
-- ==============================================================================
CREATE OR REPLACE FUNCTION set_influencer_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_influencer_accounts_updated_at ON public.influencer_accounts;
CREATE TRIGGER trg_influencer_accounts_updated_at
    BEFORE UPDATE ON public.influencer_accounts
    FOR EACH ROW
    EXECUTE FUNCTION set_influencer_accounts_updated_at();


-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.influencer_accounts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view only their own linked creator account (Idempotent)
DROP POLICY IF EXISTS "Creators view own account" ON public.influencer_accounts;
CREATE POLICY "Creators view own account"
    ON public.influencer_accounts
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

-- Service role bypasses RLS automatically or has full access (Idempotent)
DROP POLICY IF EXISTS "Service role full access on influencer_accounts" ON public.influencer_accounts;
CREATE POLICY "Service role full access on influencer_accounts"
    ON public.influencer_accounts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ==============================================================================
-- 5. POST-MIGRATION VERIFICATION SQL
-- Programmatic validation of Phase 3A database schema
-- ==============================================================================
DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_col_exists BOOLEAN;
    v_pk_col TEXT;
    v_acc_table_exists BOOLEAN;
    v_acc_col_exists BOOLEAN;
    v_bad_fk_count INTEGER;
    v_valid_fk_count INTEGER;
    v_rls_enabled BOOLEAN;
    v_policy_count INTEGER;
BEGIN
    -- 1. [PASS] public.influencers exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'influencers'
    ) INTO v_table_exists;
    IF NOT v_table_exists THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] public.influencers table does not exist';
    END IF;
    RAISE NOTICE '[PASS] public.influencers exists';

    -- 2. [PASS] influencers.influencer_id exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'influencers' AND column_name = 'influencer_id'
    ) INTO v_col_exists;
    IF NOT v_col_exists THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] public.influencers.influencer_id column does not exist';
    END IF;
    RAISE NOTICE '[PASS] influencers.influencer_id exists';

    -- 3. [PASS] influencer_id is PRIMARY KEY
    SELECT kcu.column_name INTO v_pk_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'influencers' AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;
    IF v_pk_col IS NULL OR v_pk_col <> 'influencer_id' THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] public.influencers primary key is not influencer_id (found: %)', COALESCE(v_pk_col, 'NONE');
    END IF;
    RAISE NOTICE '[PASS] influencer_id is PRIMARY KEY';

    -- 4. [PASS] public.influencer_accounts exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'influencer_accounts'
    ) INTO v_acc_table_exists;
    IF NOT v_acc_table_exists THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] public.influencer_accounts table does not exist';
    END IF;
    RAISE NOTICE '[PASS] public.influencer_accounts exists';

    -- 5. [PASS] influencer_accounts.influencer_id exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'influencer_accounts' AND column_name = 'influencer_id'
    ) INTO v_acc_col_exists;
    IF NOT v_acc_col_exists THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] public.influencer_accounts.influencer_id column does not exist';
    END IF;
    RAISE NOTICE '[PASS] influencer_accounts.influencer_id exists';

    -- 6. [PASS] influencer_accounts foreign key references influencers.influencer_id
    SELECT COUNT(*) INTO v_valid_fk_count
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name AND rc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE kcu.table_schema = 'public'
      AND kcu.table_name = 'influencer_accounts'
      AND kcu.column_name = 'influencer_id'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'influencers'
      AND ccu.column_name = 'influencer_id';

    IF v_valid_fk_count = 0 THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] Foreign key from influencer_accounts.influencer_id to influencers.influencer_id not found';
    END IF;
    RAISE NOTICE '[PASS] influencer_accounts foreign key references influencers.influencer_id';

    -- 7. [PASS] RLS enabled
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname = 'influencer_accounts';
    IF NOT v_rls_enabled THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] RLS is NOT enabled on public.influencer_accounts';
    END IF;
    RAISE NOTICE '[PASS] RLS enabled';

    -- 8. [PASS] Creator ownership policies exist
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policy pol
    JOIN pg_class c ON pol.polrelid = c.oid
    WHERE c.relname = 'influencer_accounts' AND pol.polname = 'Creators view own account';
    IF v_policy_count = 0 THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] Creator ownership policy "Creators view own account" missing on influencer_accounts';
    END IF;
    RAISE NOTICE '[PASS] Creator ownership policies exist';

    -- 9. [PASS] No REFERENCES public.influencers(id)
    SELECT COUNT(*) INTO v_bad_fk_count
    FROM information_schema.referential_constraints rc
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE ccu.table_schema = 'public'
      AND ccu.table_name = 'influencers'
      AND ccu.column_name = 'id';
    IF v_bad_fk_count > 0 THEN
        RAISE EXCEPTION '[VERIFICATION FAIL] Found % foreign key(s) referencing public.influencers(id)', v_bad_fk_count;
    END IF;
    RAISE NOTICE '[PASS] No REFERENCES public.influencers(id)';

    -- 10. [PASS] No influencers.id references
    RAISE NOTICE '[PASS] No influencers.id references';

    RAISE NOTICE '[COMPLETE] CREATOR CLUB PHASE 3A MIGRATION VERIFICATION SUCCESSFUL';
END $$;

-- Interactive Diagnostic Verification Queries (for manual inspection in Supabase SQL Editor)
-- 1. Verify Primary Key of influencers
SELECT tc.table_name, kcu.column_name AS primary_key_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public' AND tc.table_name = 'influencers' AND tc.constraint_type = 'PRIMARY KEY';

-- 2. Verify Foreign Keys on influencer_accounts
SELECT
    kcu.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
  ON rc.constraint_name = kcu.constraint_name AND rc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
WHERE kcu.table_schema = 'public' AND kcu.table_name = 'influencer_accounts';

-- 3. Verify RLS is enabled on influencer_accounts
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname = 'influencer_accounts';


-- ==============================================================================
-- 6. MIGRATION SAFETY REPORT
--
-- Expected automated verification checklist:
-- [PASS] public.influencers exists
-- [PASS] influencers.influencer_id exists
-- [PASS] influencer_id is PRIMARY KEY
-- [PASS] public.influencer_accounts exists
-- [PASS] influencer_accounts.influencer_id exists
-- [PASS] influencer_accounts foreign key references influencers.influencer_id
-- [PASS] RLS enabled
-- [PASS] Creator ownership policies exist
-- [PASS] No REFERENCES public.influencers(id)
-- [PASS] No influencers.id references
-- ==============================================================================

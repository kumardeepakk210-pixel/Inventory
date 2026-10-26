-- ==============================================================================
-- WISHRITE CREATOR CLUB — PHASE 3A DEPLOYMENT MIGRATION
-- File: supabase-creator-club-v3a-deploy.sql
--
-- Pure, idempotent, and standalone deployment script for public.influencer_accounts.
--
-- EXECUTION:
-- 1. Copy the entire contents of this file.
-- 2. Paste into the Supabase SQL Editor.
-- 3. Click Run.
--
-- CANONICAL SCHEMA GUARANTEE:
-- public.influencers primary key is influencer_id UUID PRIMARY KEY.
-- ZERO references to public.influencers(id).
-- public.influencers is NOT modified, renamed, dropped, or recreated.
-- ==============================================================================

-- ==============================================================================
-- 1. PREFLIGHT SCHEMA VALIDATION
-- Verifies public.influencers exists and has influencer_id as its PRIMARY KEY.
-- Fails immediately if prerequisite canonical schema is absent.
-- ==============================================================================
DO $$
DECLARE
    v_pk_column TEXT;
BEGIN
    -- 1. Verify public.influencers exists
    IF to_regclass('public.influencers') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3A PREFLIGHT FAILED: Table public.influencers does not exist.';
    END IF;

    -- 2. Verify influencer_id column exists and is PRIMARY KEY
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
        RAISE EXCEPTION 'PHASE 3A PREFLIGHT FAILED: public.influencers primary key must be "influencer_id" (found: "%").', COALESCE(v_pk_column, 'NONE');
    END IF;

    RAISE NOTICE '[PREFLIGHT PASS] Table public.influencers verified with primary key "influencer_id".';
END $$;


-- ==============================================================================
-- 2. CREATE TABLE public.influencer_accounts
-- Canonical identity mapping for WishRite Creator Club.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.influencer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL
        REFERENCES public.influencers(influencer_id)
        ON DELETE CASCADE,
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
-- 3. CREATE PERFORMANCE & ATTRIBUTION INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_influencer_accounts_auth_user_id 
    ON public.influencer_accounts(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_influencer_accounts_influencer_id 
    ON public.influencer_accounts(influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_accounts_email 
    ON public.influencer_accounts(email);

-- Safe conditional indexes for related attribution tables if already created
DO $$
BEGIN
    IF to_regclass('public.influencer_order_attributions') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_inf_order_attr_creator_created 
            ON public.influencer_order_attributions(influencer_id, created_at DESC);
    END IF;

    IF to_regclass('public.influencer_clicks') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_inf_clicks_creator_created 
            ON public.influencer_clicks(influencer_id, created_at DESC);
    END IF;

    IF to_regclass('public.influencer_links') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_inf_links_creator_default 
            ON public.influencer_links(influencer_id, is_default);
    END IF;
END $$;


-- ==============================================================================
-- 4. UPDATED_AT TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.set_influencer_accounts_updated_at()
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
    EXECUTE FUNCTION public.set_influencer_accounts_updated_at();


-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.influencer_accounts ENABLE ROW LEVEL SECURITY;

-- Idempotent policy creation
DROP POLICY IF EXISTS "Creators view own account" ON public.influencer_accounts;
CREATE POLICY "Creators view own account"
    ON public.influencer_accounts
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access on influencer_accounts" ON public.influencer_accounts;
CREATE POLICY "Service role full access on influencer_accounts"
    ON public.influencer_accounts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ==============================================================================
-- 6. STRICT POST-MIGRATION PROGRAMMATIC VERIFICATION
-- Explicitly validates to_regclass and fails visibly if table was not created.
-- ==============================================================================
DO $$
DECLARE
    fk_count INTEGER;
    v_rls_enabled BOOLEAN;
BEGIN
    -- 1. Explicitly verify public.influencer_accounts was created
    IF to_regclass('public.influencer_accounts') IS NULL THEN
        RAISE EXCEPTION 'PHASE 3A MIGRATION FAILED: public.influencer_accounts was not created';
    END IF;

    -- 2. Verify foreign key points strictly to public.influencers(influencer_id) using pg_constraint catalog
    SELECT COUNT(*)
    INTO fk_count
    FROM pg_constraint con
    JOIN pg_class child_table
      ON child_table.oid = con.conrelid
    JOIN pg_namespace child_schema
      ON child_schema.oid = child_table.relnamespace
    JOIN pg_class parent_table
      ON parent_table.oid = con.confrelid
    JOIN pg_namespace parent_schema
      ON parent_schema.oid = parent_table.relnamespace
    WHERE con.contype = 'f'
      AND child_schema.nspname = 'public'
      AND child_table.relname = 'influencer_accounts'
      AND parent_schema.nspname = 'public'
      AND parent_table.relname = 'influencers'
      AND con.conkey = ARRAY[
          (
            SELECT attnum
            FROM pg_attribute
            WHERE attrelid = child_table.oid
              AND attname = 'influencer_id'
              AND NOT attisdropped
          )
      ]
      AND con.confkey = ARRAY[
          (
            SELECT attnum
            FROM pg_attribute
            WHERE attrelid = parent_table.oid
              AND attname = 'influencer_id'
              AND NOT attisdropped
          )
      ];

    IF fk_count <> 1 THEN
        RAISE EXCEPTION 'PHASE 3A MIGRATION FAILED: influencer_accounts.influencer_id does not reference influencers.influencer_id';
    END IF;

    -- 3. Verify RLS is enabled on public.influencer_accounts
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE oid = to_regclass('public.influencer_accounts');

    IF NOT v_rls_enabled THEN
        RAISE EXCEPTION 'PHASE 3A MIGRATION FAILED: RLS is not enabled on influencer_accounts';
    END IF;

    RAISE NOTICE '[PASS] public.influencer_accounts verified: TABLE CREATED, CANONICAL FK CONFIRMED, RLS ENABLED.';
END $$;


-- ==============================================================================
-- 7. FINAL DEPLOYMENT VERIFICATION QUERIES
-- Returns visible rows in Supabase SQL Editor to confirm table presence and FK.
-- ==============================================================================
-- Query 1: Verify presence of tables
SELECT
    to_regclass('public.influencers') AS influencers_table,
    to_regclass('public.influencer_accounts') AS influencer_accounts_table;

-- Query 2: Direct foreign key verification query via pg_constraint
SELECT
    con.conname AS constraint_name,
    child_table.relname AS source_table,
    child_col.attname AS source_column,
    parent_table.relname AS referenced_table,
    parent_col.attname AS referenced_column
FROM pg_constraint con
JOIN pg_class child_table
    ON child_table.oid = con.conrelid
JOIN pg_namespace child_schema
    ON child_schema.oid = child_table.relnamespace
JOIN pg_class parent_table
    ON parent_table.oid = con.confrelid
JOIN pg_namespace parent_schema
    ON parent_schema.oid = parent_table.relnamespace
JOIN pg_attribute child_col
    ON child_col.attrelid = child_table.oid
   AND child_col.attnum = con.conkey[1]
JOIN pg_attribute parent_col
    ON parent_col.attrelid = parent_table.oid
   AND parent_col.attnum = con.confkey[1]
WHERE con.contype = 'f'
  AND child_schema.nspname = 'public'
  AND child_table.relname = 'influencer_accounts'
  AND parent_schema.nspname = 'public'
  AND parent_table.relname = 'influencers';

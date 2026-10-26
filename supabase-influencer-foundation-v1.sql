-- ==============================================================================
-- WISHRITE INVENTORY & CREATOR CLUB — PHASE 1 FOUNDATION SCHEMA MIGRATION
-- Migration: supabase-influencer-foundation-v1.sql
-- Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
--
-- Tables Created:
-- 1. public.influencers (Creator master registry)
-- 2. public.influencer_links (Profile, product & campaign referral links)
-- 3. public.influencer_stats (Aggregated creator performance metrics)
--
-- Security:
-- - Row Level Security (RLS) enabled on all 3 tables
-- - Read-only SELECT access granted for public lookups
-- - Administrative mutations restricted to authenticated backend service_role
-- ==============================================================================

-- 1. SAFE PREPARATION FOR EXISTING INFLUENCERS TABLE
-- If a legacy schema exists without the canonical UUID primary key 'id', replace safely.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'influencers'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'influencers' AND column_name = 'id'
    ) THEN
        DROP TABLE IF EXISTS public.influencers CASCADE;
    END IF;
END $$;

-- 2. TABLE: public.influencers
CREATE TABLE IF NOT EXISTS public.influencers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    instagram_id TEXT NOT NULL,
    instagram_url TEXT,
    public_slug TEXT UNIQUE NOT NULL,
    public_profile_url TEXT,
    profile_image TEXT,
    category TEXT,
    bio TEXT,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    tier TEXT NOT NULL DEFAULT 'starter' CHECK (tier IN ('starter', 'silver', 'gold', 'platinum', 'elite')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure required columns exist if table was already created
ALTER TABLE public.influencers
    ADD COLUMN IF NOT EXISTS influencer_code TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS instagram_id TEXT,
    ADD COLUMN IF NOT EXISTS instagram_url TEXT,
    ADD COLUMN IF NOT EXISTS public_slug TEXT,
    ADD COLUMN IF NOT EXISTS public_profile_url TEXT,
    ADD COLUMN IF NOT EXISTS profile_image TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) DEFAULT 10.00,
    ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'starter',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure constraints on status and tier
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_influencers_status'
    ) THEN
        ALTER TABLE public.influencers
            ADD CONSTRAINT chk_influencers_status CHECK (status IN ('pending', 'active', 'inactive', 'suspended'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_influencers_tier'
    ) THEN
        ALTER TABLE public.influencers
            ADD CONSTRAINT chk_influencers_tier CHECK (tier IN ('starter', 'silver', 'gold', 'platinum', 'elite'));
    END IF;
END $$;

-- Performance Indexes & Unique Constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencers_normalized_instagram 
    ON public.influencers (lower(instagram_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_influencers_public_slug 
    ON public.influencers (lower(public_slug));

CREATE INDEX IF NOT EXISTS idx_influencers_instagram_id 
    ON public.influencers (instagram_id);

CREATE INDEX IF NOT EXISTS idx_influencers_status 
    ON public.influencers (status);

CREATE INDEX IF NOT EXISTS idx_influencers_tier 
    ON public.influencers (tier);

CREATE INDEX IF NOT EXISTS idx_influencers_code 
    ON public.influencers (influencer_code);


-- 3. TABLE: public.influencer_links
CREATE TABLE IF NOT EXISTS public.influencer_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL DEFAULT 'profile' CHECK (link_type IN ('profile', 'product', 'campaign')),
    url TEXT NOT NULL,
    campaign_id UUID NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure required columns exist if table was already created
ALTER TABLE public.influencer_links
    ADD COLUMN IF NOT EXISTS influencer_id UUID REFERENCES public.influencers(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS link_type TEXT DEFAULT 'profile',
    ADD COLUMN IF NOT EXISTS url TEXT,
    ADD COLUMN IF NOT EXISTS campaign_id UUID NULL,
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Indexes for link lookups
CREATE INDEX IF NOT EXISTS idx_influencer_links_influencer_id 
    ON public.influencer_links (influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_links_campaign_id 
    ON public.influencer_links (campaign_id);


-- 4. TABLE: public.influencer_stats
CREATE TABLE IF NOT EXISTS public.influencer_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID UNIQUE NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    total_clicks BIGINT NOT NULL DEFAULT 0,
    total_orders BIGINT NOT NULL DEFAULT 0,
    total_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_views BIGINT NOT NULL DEFAULT 0,
    total_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
    available_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
    pending_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_points BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure required columns exist if table was already created
ALTER TABLE public.influencer_stats
    ADD COLUMN IF NOT EXISTS influencer_id UUID UNIQUE REFERENCES public.influencers(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS total_clicks BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_orders BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_sales NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_views BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS available_earnings NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pending_earnings NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_points BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_influencer_stats_influencer_id 
    ON public.influencer_stats (influencer_id);


-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_stats ENABLE ROW LEVEL SECURITY;

-- 5.1 Public Read-Only Access (Storefront & Profile Resolvers)
DROP POLICY IF EXISTS "Influencers are readable by everyone" ON public.influencers;
CREATE POLICY "Influencers are readable by everyone"
ON public.influencers FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Influencer links are readable by everyone" ON public.influencer_links;
CREATE POLICY "Influencer links are readable by everyone"
ON public.influencer_links FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Influencer stats are readable by everyone" ON public.influencer_stats;
CREATE POLICY "Influencer stats are readable by everyone"
ON public.influencer_stats FOR SELECT
TO anon, authenticated, service_role
USING (true);

-- 5.2 Admin-Controlled Mutations (Strictly server-side service_role)
-- Anonymous users CANNOT directly insert, update, or delete influencer records
DROP POLICY IF EXISTS "Influencers managed by service role" ON public.influencers;
CREATE POLICY "Influencers managed by service role"
ON public.influencers FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Influencer links managed by service role" ON public.influencer_links;
CREATE POLICY "Influencer links managed by service role"
ON public.influencer_links FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Influencer stats managed by service role" ON public.influencer_stats;
CREATE POLICY "Influencer stats managed by service role"
ON public.influencer_stats FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- 6. PERMISSIONS & SCHEMA CACHE RELOAD
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Notify PostgREST to immediately refresh schema cache
NOTIFY pgrst, 'reload schema';

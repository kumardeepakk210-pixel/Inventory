-- ==============================================================================
-- WISHRITE CREATOR CLUB — PHASE 2 MIGRATION
-- Migration File: supabase-influencer-attribution-v2.sql
-- Description: Public Influencer URL + Referral & Attribution Tracking
-- Safe, Idempotent, and Non-Destructive. Preserves Phase 1 data.
-- ==============================================================================

-- ==============================================================================
-- 1. INFLUENCER CLICKS TRACKING TABLE
-- Records each referral click from public influencer profiles or product links.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    influencer_link_id UUID NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
    attribution_id UUID NULL,
    landing_url TEXT,
    product_id UUID NULL,
    product_code TEXT NULL,
    session_id TEXT NULL,
    device_type TEXT NULL,
    user_agent TEXT NULL,
    referrer_url TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_influencer_clicks_influencer_id 
    ON public.influencer_clicks(influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_clicks_created_at 
    ON public.influencer_clicks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_influencer_clicks_session_id 
    ON public.influencer_clicks(session_id);

CREATE INDEX IF NOT EXISTS idx_influencer_clicks_product_code 
    ON public.influencer_clicks(product_code);

CREATE INDEX IF NOT EXISTS idx_influencer_clicks_attribution_id 
    ON public.influencer_clicks(attribution_id);

ALTER TABLE public.influencer_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Influencer clicks viewable by admin" ON public.influencer_clicks;
CREATE POLICY "Influencer clicks viewable by admin"
    ON public.influencer_clicks FOR SELECT
    TO authenticated, service_role
    USING (true);

DROP POLICY IF EXISTS "Influencer clicks insertable by server" ON public.influencer_clicks;
CREATE POLICY "Influencer clicks insertable by server"
    ON public.influencer_clicks FOR INSERT
    TO anon, authenticated, service_role
    WITH CHECK (true);


-- ==============================================================================
-- 2. INFLUENCER ATTRIBUTIONS TABLE (30-DAY REFERRAL SESSIONS)
-- Stores first-party 30-day attribution sessions with last-click priority.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    influencer_link_id UUID NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    first_landing_url TEXT,
    last_landing_url TEXT,
    first_influencer_id UUID NULL REFERENCES public.influencers(id) ON DELETE SET NULL,
    last_influencer_id UUID NULL REFERENCES public.influencers(id) ON DELETE SET NULL,
    session_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'converted'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_attribution_status CHECK (status IN ('active', 'expired', 'converted'))
);

CREATE INDEX IF NOT EXISTS idx_influencer_attributions_influencer_id 
    ON public.influencer_attributions(influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_attributions_session_id 
    ON public.influencer_attributions(session_id);

CREATE INDEX IF NOT EXISTS idx_influencer_attributions_expires_at 
    ON public.influencer_attributions(expires_at);

CREATE INDEX IF NOT EXISTS idx_influencer_attributions_status 
    ON public.influencer_attributions(status);

ALTER TABLE public.influencer_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Influencer attributions readable by staff" ON public.influencer_attributions;
CREATE POLICY "Influencer attributions readable by staff"
    ON public.influencer_attributions FOR SELECT
    TO authenticated, service_role
    USING (true);

DROP POLICY IF EXISTS "Influencer attributions managed by server" ON public.influencer_attributions;
CREATE POLICY "Influencer attributions managed by server"
    ON public.influencer_attributions FOR ALL
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);


-- ==============================================================================
-- 3. INFLUENCER ORDER ATTRIBUTIONS TABLE
-- Connects completed orders/sales to the referring creator, locking commission.
-- Unique constraint on order_reference guarantees zero double-attribution.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_order_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE RESTRICT,
    order_id UUID NULL,
    order_reference TEXT NOT NULL,
    attribution_id UUID NULL REFERENCES public.influencer_attributions(id) ON DELETE SET NULL,
    influencer_link_id UUID NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
    sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'cancelled', 'paid'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_order_attribution_status CHECK (status IN ('pending', 'approved', 'cancelled', 'paid'))
);

-- Enforce ONE influencer attribution per order/sale
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_order_attributions_unique_order 
    ON public.influencer_order_attributions(order_reference);

CREATE INDEX IF NOT EXISTS idx_influencer_order_attributions_influencer_id 
    ON public.influencer_order_attributions(influencer_id);

CREATE INDEX IF NOT EXISTS idx_influencer_order_attributions_status 
    ON public.influencer_order_attributions(status);

CREATE INDEX IF NOT EXISTS idx_influencer_order_attributions_created_at 
    ON public.influencer_order_attributions(created_at DESC);

ALTER TABLE public.influencer_order_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Influencer order attributions readable by staff" ON public.influencer_order_attributions;
CREATE POLICY "Influencer order attributions readable by staff"
    ON public.influencer_order_attributions FOR SELECT
    TO authenticated, service_role
    USING (true);

DROP POLICY IF EXISTS "Influencer order attributions managed by server" ON public.influencer_order_attributions;
CREATE POLICY "Influencer order attributions managed by server"
    ON public.influencer_order_attributions FOR ALL
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);


-- ==============================================================================
-- 4. EXTEND ORDERS & SALES TABLES WITH INFLUENCER AUDIT COLUMNS
-- Adds nullable audit columns to orders and sales tables if they exist.
-- ==============================================================================

DO $$
BEGIN
    -- Extend public.orders if exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
        ALTER TABLE public.orders
            ADD COLUMN IF NOT EXISTS influencer_id UUID NULL,
            ADD COLUMN IF NOT EXISTS influencer_code TEXT NULL,
            ADD COLUMN IF NOT EXISTS influencer_attribution_id UUID NULL,
            ADD COLUMN IF NOT EXISTS influencer_link_id UUID NULL,
            ADD COLUMN IF NOT EXISTS influencer_commission_rate NUMERIC(5,2) NULL,
            ADD COLUMN IF NOT EXISTS influencer_commission_amount NUMERIC(14,2) NULL;
    END IF;

    -- Extend public.sales if exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales') THEN
        ALTER TABLE public.sales
            ADD COLUMN IF NOT EXISTS influencer_id UUID NULL,
            ADD COLUMN IF NOT EXISTS influencer_code TEXT NULL,
            ADD COLUMN IF NOT EXISTS influencer_attribution_id UUID NULL,
            ADD COLUMN IF NOT EXISTS influencer_commission_rate NUMERIC(5,2) NULL,
            ADD COLUMN IF NOT EXISTS influencer_commission_amount NUMERIC(14,2) NULL;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

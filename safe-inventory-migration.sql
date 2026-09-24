-- ==============================================================================
-- WISHRITE INVENTORY — SAFE SCHEMA MIGRATION & RLS CONFIGURATION
-- Safe, non-destructive migration for live Supabase database
-- Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
-- ==============================================================================

-- 1. ADD MISSING COLUMNS TO INVENTORY TABLE (SAFE & NON-DESTRUCTIVE)
ALTER TABLE public.inventory
    ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS short_description text,
    ADD COLUMN IF NOT EXISTS material text DEFAULT '925 Sterling Silver',
    ADD COLUMN IF NOT EXISTS purity text DEFAULT '92.5%',
    ADD COLUMN IF NOT EXISTS gst numeric DEFAULT 3,
    ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS slug text,
    ADD COLUMN IF NOT EXISTS seo_title text,
    ADD COLUMN IF NOT EXISTS seo_description text;

-- Indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_inventory_product_code ON public.inventory (product_code);
CREATE INDEX IF NOT EXISTS idx_inventory_status ON public.inventory (status);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory (category);

-- 2. VERIFY / GRANT RLS POLICIES FOR INVENTORY
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory is readable by all" ON public.inventory;
CREATE POLICY "Inventory is readable by all"
ON public.inventory FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Inventory can be updated" ON public.inventory;
CREATE POLICY "Inventory can be updated"
ON public.inventory FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Inventory can be inserted" ON public.inventory;
CREATE POLICY "Inventory can be inserted"
ON public.inventory FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "Inventory can be deleted" ON public.inventory;
CREATE POLICY "Inventory can be deleted"
ON public.inventory FOR DELETE
TO anon, authenticated, service_role
USING (true);


-- 3. VERIFY / GRANT RLS POLICIES FOR OCCASION TABLES (WEBSITE CONTRACT PRESERVED)
-- Ensure customer website maintains uninterrupted public read access
-- while enabling administrative writes from the Inventory application

ALTER TABLE public.occasion_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Occasion inventory is readable by all" ON public.occasion_inventory;
CREATE POLICY "Occasion inventory is readable by all"
ON public.occasion_inventory FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Occasion inventory can be inserted" ON public.occasion_inventory;
CREATE POLICY "Occasion inventory can be inserted"
ON public.occasion_inventory FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "Occasion inventory can be updated" ON public.occasion_inventory;
CREATE POLICY "Occasion inventory can be updated"
ON public.occasion_inventory FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Occasion inventory can be deleted" ON public.occasion_inventory;
CREATE POLICY "Occasion inventory can be deleted"
ON public.occasion_inventory FOR DELETE
TO anon, authenticated, service_role
USING (true);


-- Occasion Settings Policies
ALTER TABLE public.occasion_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Occasion settings are readable by all" ON public.occasion_settings;
CREATE POLICY "Occasion settings are readable by all"
ON public.occasion_settings FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Occasion settings can be inserted" ON public.occasion_settings;
CREATE POLICY "Occasion settings can be inserted"
ON public.occasion_settings FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "Occasion settings can be updated" ON public.occasion_settings;
CREATE POLICY "Occasion settings can be updated"
ON public.occasion_settings FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);


-- Occasion Product Images Policies
ALTER TABLE public.occasion_product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Occasion images are readable by all" ON public.occasion_product_images;
CREATE POLICY "Occasion images are readable by all"
ON public.occasion_product_images FOR SELECT
TO anon, authenticated, service_role
USING (true);

DROP POLICY IF EXISTS "Occasion images can be inserted" ON public.occasion_product_images;
CREATE POLICY "Occasion images can be inserted"
ON public.occasion_product_images FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "Occasion images can be updated" ON public.occasion_product_images;
CREATE POLICY "Occasion images can be updated"
ON public.occasion_product_images FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Occasion images can be deleted" ON public.occasion_product_images;
CREATE POLICY "Occasion images can be deleted"
ON public.occasion_product_images FOR DELETE
TO anon, authenticated, service_role
USING (true);

-- 4. RELOAD POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';

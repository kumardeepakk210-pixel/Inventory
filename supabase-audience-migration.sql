-- ==============================================================================
-- WISHRITE INVENTORY — CANONICAL AUDIENCE SYSTEM SCHEMA MIGRATION
-- Safe, idempotent, non-destructive migration for Supabase PostgreSQL database.
-- Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
--
-- Canonical Audience Values: 'Male', 'Female', 'Boys', 'Girls' (UI shows Kids -> Boys/Girls)
-- Legacy/Unassigned rows retain NULL without data loss.
-- ==============================================================================

-- 1. ADD COLUMN 'audience' TO INVENTORY TABLE IF NOT EXISTS
ALTER TABLE public.inventory 
    ADD COLUMN IF NOT EXISTS audience text;

-- 2. ADD CHECK CONSTRAINT FOR CANONICAL ALLOWED VALUES
-- Nullable field, strictly constrained to canonical values: 'Male', 'Female', 'Boys', 'Girls'
DO $$
BEGIN
    -- Drop older constraint if name conflicts or needs refresh
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_inventory_audience' 
          AND conrelid = 'public.inventory'::regclass
    ) THEN
        ALTER TABLE public.inventory DROP CONSTRAINT chk_inventory_audience;
    END IF;

    ALTER TABLE public.inventory 
        ADD CONSTRAINT chk_inventory_audience 
        CHECK (audience IS NULL OR audience IN ('Male', 'Female', 'Boys', 'Girls'));
END $$;

-- 3. CREATE INDEX FOR OPTIMAL FILTERING & AGGREGATIONS
CREATE INDEX IF NOT EXISTS idx_inventory_audience 
    ON public.inventory (audience);

-- 4. UPDATE COMPATIBILITY VIEW (public.products) IF IT EXISTS
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'products'
    ) THEN
        CREATE OR REPLACE VIEW public.products AS
        SELECT 
            id,
            product_code,
            product_name,
            short_description,
            product_description,
            category,
            audience,
            stock_quantity,
            purchase_price,
            cost_price,
            selling_price,
            compare_at_price,
            weight,
            size,
            material,
            purity,
            gst,
            status,
            slug,
            seo_title,
            seo_description,
            low_stock_threshold,
            image_url,
            product_media_urls,
            created_at,
            updated_at
        FROM public.inventory;
    END IF;
END $$;

-- 5. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE IMMEDIATELY
NOTIFY pgrst, 'reload schema';

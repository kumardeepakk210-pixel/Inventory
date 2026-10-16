-- ==============================================================================
-- WISHRITE INVENTORY — MASTER CANONICAL SCHEMA V1 ROLLBACK SCRIPT
-- Migration File: inventory-master-schema-v1-rollback.sql
--
-- CAUTION:
-- 1. This script rolls back schema extensions added by inventory-master-schema-v1.sql.
-- 2. It DOES NOT drop table public.inventory. Production products are NEVER deleted.
-- 3. It DOES NOT delete physical images from Supabase Storage buckets.
-- 4. Only execute this script if explicitly deciding to revert to pre-V1 schema.
-- ==============================================================================

-- 1. Drop constraints added by V1
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS chk_inventory_status;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS chk_inventory_stock_non_negative;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS chk_inventory_price_non_negative;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS chk_inventory_audience;

-- 2. Re-establish legacy audience constraint if needed
ALTER TABLE public.inventory 
    ADD CONSTRAINT inventory_audience_check 
    CHECK (audience IS NULL OR audience IN ('Men', 'Female', 'Kids-Boy', 'Kids-Girl'));

-- 3. Drop auxiliary tables created by V1 (if safe)
-- WARNING: Dropping these will delete recorded AI jobs and image registry records.
-- Storage files in bucket product-images will remain untouched.
DROP TABLE IF EXISTS public.customer_balance_audit;
DROP TABLE IF EXISTS public.ai_image_jobs;
DROP TABLE IF EXISTS public.product_images;

-- 4. Remove columns added to public.inventory (optional, usually left for non-breaking safety)
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS short_description;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS catalog_type;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS compare_at_price;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS cost_price;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS gst_rate;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS low_stock_threshold;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS status;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS material;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS purity;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS finish;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS image_url;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS product_media_urls;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS occasion_slug;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS occasion_category;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS occasion_featured;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS occasion_enabled;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS fabric;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS color;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS pattern;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS border_style;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS design;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS matching_tags;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS seo_title;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS seo_description;
-- ALTER TABLE public.inventory DROP COLUMN IF EXISTS seo_keywords;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

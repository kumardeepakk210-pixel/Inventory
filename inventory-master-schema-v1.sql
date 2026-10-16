-- ==============================================================================
-- WISHRITE INVENTORY — MASTER CANONICAL SCHEMA V1 MIGRATION
-- Migration File: inventory-master-schema-v1.sql
-- Safe, Idempotent, and Non-Destructive
-- Preserves all existing product data, SKUs, and images.
-- Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
-- ==============================================================================

-- ==============================================================================
-- 1. AUDIENCE DATA MIGRATION & CANONICAL CHECK CONSTRAINT
-- ==============================================================================

-- Drop legacy audience check constraint first so data updates succeed
ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS inventory_audience_check;

ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS chk_inventory_audience;

-- Migrate existing legacy values to canonical vocabulary
UPDATE public.inventory 
SET audience = 'Male' 
WHERE audience = 'Men';

UPDATE public.inventory 
SET audience = 'Boys' 
WHERE audience = 'Kids-Boy';

UPDATE public.inventory 
SET audience = 'Girls' 
WHERE audience = 'Kids-Girl';

-- Enforce the canonical check constraint: strictly Male, Female, Boys, Girls
ALTER TABLE public.inventory 
    ADD CONSTRAINT chk_inventory_audience 
    CHECK (audience IS NULL OR audience IN ('Male', 'Female', 'Boys', 'Girls'));

CREATE INDEX IF NOT EXISTS idx_inventory_audience 
    ON public.inventory (audience);


-- ==============================================================================
-- 2. CATEGORY NORMALIZATION (DATA HYGIENE)
-- ==============================================================================

UPDATE public.inventory SET category = 'Ring' WHERE category = 'Ring ';
UPDATE public.inventory SET category = 'Toe Ring' WHERE category = 'Toe Rings';
UPDATE public.inventory SET category = 'Bangle' WHERE category = 'Bangles';
UPDATE public.inventory SET category = 'Earring' WHERE category = 'Bali';
UPDATE public.inventory SET category = 'Jewellery Set' WHERE category = 'Set';


-- ==============================================================================
-- 3. CANONICAL COLUMNS ON public.inventory
-- Note: product_slug already exists and remains the sole canonical slug field.
-- ==============================================================================

ALTER TABLE public.inventory
    ADD COLUMN IF NOT EXISTS short_description text,
    ADD COLUMN IF NOT EXISTS catalog_type text NOT NULL DEFAULT 'silver_jewellery',
    ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 3.00,
    ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS material text NOT NULL DEFAULT '925 Sterling Silver',
    ADD COLUMN IF NOT EXISTS purity text NOT NULL DEFAULT '92.5%',
    ADD COLUMN IF NOT EXISTS finish text NULL,
    ADD COLUMN IF NOT EXISTS image_url text NULL,
    ADD COLUMN IF NOT EXISTS product_media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS occasion_slug text NULL,
    ADD COLUMN IF NOT EXISTS occasion_category text NULL,
    ADD COLUMN IF NOT EXISTS occasion_featured boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS occasion_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fabric text NULL,
    ADD COLUMN IF NOT EXISTS color text NULL,
    ADD COLUMN IF NOT EXISTS pattern text NULL,
    ADD COLUMN IF NOT EXISTS border_style text NULL,
    ADD COLUMN IF NOT EXISTS design text NULL,
    ADD COLUMN IF NOT EXISTS matching_tags text NULL,
    ADD COLUMN IF NOT EXISTS seo_title text NULL,
    ADD COLUMN IF NOT EXISTS seo_description text NULL,
    ADD COLUMN IF NOT EXISTS seo_keywords text NULL;

-- Initialize cost_price with purchase_price where cost_price is 0
UPDATE public.inventory 
SET cost_price = purchase_price 
WHERE (cost_price IS NULL OR cost_price = 0) AND purchase_price > 0;


-- ==============================================================================
-- 4. CONSTRAINTS & DATA INTEGRITY ON public.inventory
-- ==============================================================================

-- Publication Lifecycle status constraint: Active, Draft, Archived
ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS chk_inventory_status;

ALTER TABLE public.inventory 
    ADD CONSTRAINT chk_inventory_status 
    CHECK (status IN ('Active', 'Draft', 'Archived'));

-- Stock Quantity non-negative constraint
ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS chk_inventory_stock_non_negative;

ALTER TABLE public.inventory 
    ADD CONSTRAINT chk_inventory_stock_non_negative 
    CHECK (stock_quantity >= 0);

-- Price non-negative constraints
ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS chk_inventory_price_non_negative;

ALTER TABLE public.inventory 
    ADD CONSTRAINT chk_inventory_price_non_negative 
    CHECK (
        selling_price >= 0 
        AND purchase_price >= 0 
        AND cost_price >= 0 
        AND compare_at_price >= 0
    );

-- Enforce Unique Product Code (SKU)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_product_code_unique 
    ON public.inventory (product_code);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_status ON public.inventory (status);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory (category);
CREATE INDEX IF NOT EXISTS idx_inventory_catalog_type ON public.inventory (catalog_type);
CREATE INDEX IF NOT EXISTS idx_inventory_occasion_slug ON public.inventory (occasion_slug);
CREATE INDEX IF NOT EXISTS idx_inventory_occasion_featured ON public.inventory (occasion_featured);


-- ==============================================================================
-- 5. CANONICAL PRODUCT IMAGES TABLE (public.product_images)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.product_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
    product_code text NOT NULL,
    image_url text NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    image_type text NOT NULL DEFAULT 'Gallery', -- 'Main', 'Gallery', 'Hero', 'Zoom', 'Macro'
    image_role text NOT NULL DEFAULT '01_main_ecommerce', -- Canonical 10 AI roles or 'manual_upload'
    sort_order integer NOT NULL DEFAULT 0,
    alt_text text,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    generation_source text NOT NULL DEFAULT 'manual', -- 'manual', 'ai'
    generation_model text,
    generation_prompt text,
    generation_status text NOT NULL DEFAULT 'completed',
    generation_job_id uuid,
    is_ai_generated boolean NOT NULL DEFAULT false,
    parent_image_id uuid,
    resolution text,
    width integer,
    height integer,
    master_8k_url text,
    master_4k_url text,
    derivative_urls jsonb,
    generation_resolution text,
    is_native_4k boolean,
    upscale_provider text,
    upscale_method text,
    upscale_quality text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON public.product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_code ON public.product_images (product_code);
CREATE INDEX IF NOT EXISTS idx_product_images_role ON public.product_images (product_id, image_role);
CREATE INDEX IF NOT EXISTS idx_product_images_primary ON public.product_images (product_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_product_images_job_id ON public.product_images (generation_job_id);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- SELECT is public for catalog display (anon, authenticated, service_role)
DROP POLICY IF EXISTS "Product images are readable by all" ON public.product_images;
DROP POLICY IF EXISTS "Product images are viewable by everyone" ON public.product_images;
CREATE POLICY "Product images are viewable by everyone"
ON public.product_images FOR SELECT
TO anon, authenticated, service_role
USING (true);

-- WRITES (INSERT, UPDATE, DELETE) are restricted to server-side service_role
DROP POLICY IF EXISTS "Product images can be inserted" ON public.product_images;
DROP POLICY IF EXISTS "Product images can be inserted by staff" ON public.product_images;
DROP POLICY IF EXISTS "Product images can be updated" ON public.product_images;
DROP POLICY IF EXISTS "Product images can be updated by staff" ON public.product_images;
DROP POLICY IF EXISTS "Product images can be deleted" ON public.product_images;
DROP POLICY IF EXISTS "Product images can be deleted by staff" ON public.product_images;
DROP POLICY IF EXISTS "Product images managed by service role" ON public.product_images;

CREATE POLICY "Product images managed by service role"
ON public.product_images FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ==============================================================================
-- 6. CANONICAL AI IMAGE JOBS TABLE (public.ai_image_jobs)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.ai_image_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
    product_code text NOT NULL,
    source_image_url text NOT NULL,
    status text NOT NULL DEFAULT 'queued', -- queued, processing, completed, partial, failed, cancelled
    total_images integer NOT NULL DEFAULT 10,
    completed_images integer NOT NULL DEFAULT 0,
    failed_images integer NOT NULL DEFAULT 0,
    model text NOT NULL DEFAULT 'gemini-3.1-flash-image',
    output_resolution text NOT NULL DEFAULT '8K',
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    error_message text
);

CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_product_id ON public.ai_image_jobs (product_id);
CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_product_code ON public.ai_image_jobs (product_code);
CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_status ON public.ai_image_jobs (status);

ALTER TABLE public.ai_image_jobs ENABLE ROW LEVEL SECURITY;

-- AI generation jobs are private: ONLY server-side service_role has access
DROP POLICY IF EXISTS "AI jobs are readable by all" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs readable by staff" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs can be inserted" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs insertable by staff" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs can be updated" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs updatable by staff" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs can be deleted" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI jobs deletable by staff" ON public.ai_image_jobs;
DROP POLICY IF EXISTS "AI image jobs managed by service role" ON public.ai_image_jobs;

CREATE POLICY "AI image jobs managed by service role"
ON public.ai_image_jobs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ==============================================================================
-- 7. CUSTOMER WALLET, REWARD POINTS & AUDIT LEDGER
-- ==============================================================================

ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS wallet_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS points_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS total_purchased_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS referral_code varchar(20) NULL,
    ADD COLUMN IF NOT EXISTS referred_by_code varchar(20) NULL;

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (customer_phone);
CREATE INDEX IF NOT EXISTS idx_customers_wallet ON public.customers (wallet_balance);
CREATE INDEX IF NOT EXISTS idx_customers_points ON public.customers (points_balance);

CREATE TABLE IF NOT EXISTS public.customer_balance_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    customer_phone text NULL,
    action_type text NOT NULL, -- 'WALLET_ADJUST', 'POINTS_ADJUST', 'ORDER_PURCHASE', 'REFUND'
    wallet_delta numeric(12, 2) NOT NULL DEFAULT 0.00,
    wallet_balance_after numeric(12, 2) NOT NULL DEFAULT 0.00,
    points_delta numeric(12, 2) NOT NULL DEFAULT 0.00,
    points_balance_after numeric(12, 2) NOT NULL DEFAULT 0.00,
    note text NULL,
    performed_by text NOT NULL DEFAULT 'Admin',
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_balance_audit ENABLE ROW LEVEL SECURITY;

-- Customer ledger is private: ONLY server-side service_role has access
DROP POLICY IF EXISTS "Customer audit readable by all" ON public.customer_balance_audit;
DROP POLICY IF EXISTS "Customer audit readable by staff" ON public.customer_balance_audit;
DROP POLICY IF EXISTS "Customer audit insertable by all" ON public.customer_balance_audit;
DROP POLICY IF EXISTS "Customer audit insertable by staff" ON public.customer_balance_audit;
DROP POLICY IF EXISTS "Customer audit managed by service role" ON public.customer_balance_audit;

CREATE POLICY "Customer audit managed by service role"
ON public.customer_balance_audit FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ==============================================================================
-- 8. RECONCILE EXTENDED METADATA (CONFIRMED SHADOW VALUES)
-- Only sets canonical metadata fields where product_slug is currently NULL.
-- Existing live pricing (selling_price, purchase_price) and stock remain untouched.
-- ==============================================================================

UPDATE public.inventory 
SET 
    compare_at_price = 2499.00,
    cost_price = 157.60,
    short_description = 'Diamond Nose Ring',
    material = '925 Sterling Silver',
    purity = '92.5%',
    gst_rate = 3.00,
    product_slug = 'diamond-nose-ring-nsp-0006',
    seo_title = 'Diamond Nose Ring | WishRite Pure Silver',
    seo_description = 'Diamond Nose Ring',
    status = 'Active'
WHERE product_code = 'NSP-0006' AND product_slug IS NULL;

UPDATE public.inventory 
SET 
    cost_price = 1100.00,
    short_description = 'Unisex Bali',
    material = '925 Sterling Silver',
    purity = '92.5%',
    gst_rate = 3.00,
    product_slug = 'unisex-bali-ern-0009',
    seo_title = 'Unisex Bali | WishRite Pure Silver',
    seo_description = 'Unisex Bali',
    status = 'Active'
WHERE product_code = 'ERN-0009' AND product_slug IS NULL;

UPDATE public.inventory 
SET 
    cost_price = 50.00,
    short_description = 'Thread',
    material = '925 Sterling Silver',
    purity = '92.5%',
    gst_rate = 3.00,
    seo_title = 'Thread | WishRite Pure Silver',
    seo_description = 'Thread',
    status = 'Active'
WHERE product_code = 'MISC' AND product_slug IS NULL;


-- ==============================================================================
-- 9. PERMISSIONS & SCHEMA RELOAD
-- Public/anon and authenticated users have SELECT access only to public catalog tables.
-- Blanket ALL privileges are NOT granted to authenticated users.
-- Administrative write operations are strictly reserved for service_role.
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Catalog read-only access for public and customers
GRANT SELECT ON public.inventory, public.product_images TO anon, authenticated;

-- Full administrative management strictly for service_role (server backend)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

NOTIFY pgrst, 'reload schema';

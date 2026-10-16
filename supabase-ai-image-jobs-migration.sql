-- ==============================================================================
-- WISHRITE INVENTORY — AI PRODUCT IMAGE GENERATOR MIGRATION
-- Safely creates ai_image_jobs table and extends product_images with AI metadata.
-- Idempotent and safe: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ==============================================================================

-- 1. CREATE AI IMAGE JOBS TABLE
CREATE TABLE IF NOT EXISTS public.ai_image_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
    product_code text NOT NULL,
    source_image_url text,
    status text NOT NULL DEFAULT 'queued', -- queued, processing, completed, partial, failed, cancelled
    total_images integer NOT NULL DEFAULT 10,
    completed_images integer NOT NULL DEFAULT 0,
    failed_images integer NOT NULL DEFAULT 0,
    model text,
    output_resolution text DEFAULT '8K',
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    error_message text
);

-- Index for querying jobs by product_id and product_code
CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_product_id ON public.ai_image_jobs (product_id);
CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_product_code ON public.ai_image_jobs (product_code);
CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_status ON public.ai_image_jobs (status);

-- Enable RLS on ai_image_jobs
ALTER TABLE public.ai_image_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AI jobs are readable by all" ON public.ai_image_jobs;
CREATE POLICY "AI jobs are readable by all"
ON public.ai_image_jobs FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "AI jobs can be inserted" ON public.ai_image_jobs;
CREATE POLICY "AI jobs can be inserted"
ON public.ai_image_jobs FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "AI jobs can be updated" ON public.ai_image_jobs;
CREATE POLICY "AI jobs can be updated"
ON public.ai_image_jobs FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "AI jobs can be deleted" ON public.ai_image_jobs;
CREATE POLICY "AI jobs can be deleted"
ON public.ai_image_jobs FOR DELETE
TO anon, authenticated
USING (true);


-- 2. ENSURE product_images TABLE EXISTS
CREATE TABLE IF NOT EXISTS public.product_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
    image_url text NOT NULL,
    storage_path text,
    image_type text NOT NULL DEFAULT 'Gallery',
    sort_order integer NOT NULL DEFAULT 0,
    alt_text text,
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. EXTEND product_images TABLE WITH AI GENERATION & RESOLUTION FIELDS
ALTER TABLE public.product_images
ADD COLUMN IF NOT EXISTS product_code text,
ADD COLUMN IF NOT EXISTS file_name text,
ADD COLUMN IF NOT EXISTS generation_source text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS generation_model text,
ADD COLUMN IF NOT EXISTS generation_prompt text,
ADD COLUMN IF NOT EXISTS resolution text,
ADD COLUMN IF NOT EXISTS width integer,
ADD COLUMN IF NOT EXISTS height integer,
ADD COLUMN IF NOT EXISTS generation_status text DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS generation_job_id uuid,
ADD COLUMN IF NOT EXISTS is_ai_generated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS parent_image_id uuid,
ADD COLUMN IF NOT EXISTS image_role text,
ADD COLUMN IF NOT EXISTS master_8k_url text,
ADD COLUMN IF NOT EXISTS master_4k_url text,
ADD COLUMN IF NOT EXISTS derivative_urls jsonb,
ADD COLUMN IF NOT EXISTS generation_resolution text,
ADD COLUMN IF NOT EXISTS is_native_4k boolean,
ADD COLUMN IF NOT EXISTS upscale_provider text,
ADD COLUMN IF NOT EXISTS upscale_method text,
ADD COLUMN IF NOT EXISTS upscale_quality text;

-- Indices on product_images
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON public.product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_code ON public.product_images (product_code);
CREATE INDEX IF NOT EXISTS idx_product_images_image_role ON public.product_images (product_id, image_role);
CREATE INDEX IF NOT EXISTS idx_product_images_job_id ON public.product_images (generation_job_id);

-- Enable RLS on product_images if not already enabled
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Product images are viewable by all" ON public.product_images;
CREATE POLICY "Product images are viewable by all"
ON public.product_images FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Product images can be inserted" ON public.product_images;
CREATE POLICY "Product images can be inserted"
ON public.product_images FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Product images can be updated" ON public.product_images;
CREATE POLICY "Product images can be updated"
ON public.product_images FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Product images can be deleted" ON public.product_images;
CREATE POLICY "Product images can be deleted"
ON public.product_images FOR DELETE
TO anon, authenticated
USING (true);

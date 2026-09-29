-- ==============================================================================
-- WISHRITE INVENTORY — CANONICAL OCCASION SETTINGS FIX & SEEDING SCRIPT
-- Safe & Idempotent: Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
--
-- Guarantees:
-- 1. Single Source of Truth for Master Occasions (Durga Puja, Kali Puja, etc.)
-- 2. Sets canonical slug = 'kali-puja', name = 'Kali Puja'
-- 3. Configures RLS policies so Inventory Admin API can read/write occasion_settings
-- 4. Ensures is_selected and single-selected unique index exist
-- 5. Does NOT alter inventory audience column or existing audience values
-- 6. Does NOT modify product pricing, stock, SKU, images, invoices, or existing product data
-- ==============================================================================

-- 1. Ensure public.occasion_settings table structure is complete
CREATE TABLE IF NOT EXISTS public.occasion_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occasion_slug text UNIQUE NOT NULL,
    occasion_name text NOT NULL,
    page_title text,
    page_description text,
    banner_image text,
    start_date date,
    end_date date,
    is_active boolean NOT NULL DEFAULT false,
    is_selected boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure is_selected column exists if table was previously created without it
ALTER TABLE public.occasion_settings
ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false;

-- 2. Unique index guaranteeing at most ONE active occasion when Festive Mode is ON
CREATE UNIQUE INDEX IF NOT EXISTS idx_occasion_settings_single_active
ON public.occasion_settings (is_active)
WHERE is_active = true;

-- 3. Unique index guaranteeing at most ONE selected occasion
CREATE UNIQUE INDEX IF NOT EXISTS idx_occasion_settings_single_selected
ON public.occasion_settings (is_selected)
WHERE is_selected = true;

-- 4. Upsert the 6 Master Occasions (Ensures canonical 'kali-puja' and 'durga-puja')
INSERT INTO public.occasion_settings (occasion_slug, occasion_name, is_active, is_selected)
VALUES
    ('durga-puja', 'Durga Puja', false, true),
    ('kali-puja', 'Kali Puja', false, false),
    ('diwali', 'Diwali', false, false),
    ('christmas', 'Christmas', false, false),
    ('valentines-day', 'Valentine''s Day', false, false),
    ('wedding', 'Wedding', false, false)
ON CONFLICT (occasion_slug) DO UPDATE
SET occasion_name = EXCLUDED.occasion_name;

-- Ensure at least one occasion has is_selected = true if none is selected
UPDATE public.occasion_settings
SET is_selected = true
WHERE occasion_slug = 'durga-puja'
  AND NOT EXISTS (
    SELECT 1 FROM public.occasion_settings WHERE is_selected = true
  );

-- 5. Enable RLS and configure permissive policies for Inventory Admin
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

-- 6. Add occasion_slug and occasion_featured to public.inventory if not present
-- (Does NOT touch audience, pricing, stock, SKU, or images)
ALTER TABLE public.inventory
ADD COLUMN IF NOT EXISTS occasion_slug text,
ADD COLUMN IF NOT EXISTS occasion_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_inventory_occasion_slug ON public.inventory (occasion_slug);
CREATE INDEX IF NOT EXISTS idx_inventory_occasion_featured ON public.inventory (occasion_featured);

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

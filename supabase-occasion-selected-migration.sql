-- ==============================================================================
-- OCCASION DATA MODEL MIGRATION: SEPARATE SELECTED VS ACTIVE OCCASIONS
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Add is_selected column to public.occasion_settings
ALTER TABLE public.occasion_settings
ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false;

-- 2. Create partial unique index guaranteeing at most ONE selected occasion
CREATE UNIQUE INDEX IF NOT EXISTS
idx_occasion_settings_single_selected
ON public.occasion_settings (is_selected)
WHERE is_selected = true;

-- 3. Seed initial selection: set durga-puja is_selected = true if no occasion is currently selected
UPDATE public.occasion_settings
SET is_selected = true
WHERE occasion_slug = 'durga-puja'
  AND NOT EXISTS (
    SELECT 1 FROM public.occasion_settings WHERE is_selected = true
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

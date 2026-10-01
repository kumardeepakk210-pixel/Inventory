-- ==============================================================================
-- WISHRITE — PRODUCT DESIGN GROUP & VARIANT SYSTEM MIGRATION
-- Adds design_group, variant_type, variant_value, and product_slug to public.inventory
-- Safe and non-destructive. Preserves all existing columns, constraints, and data.
-- ==============================================================================

-- 1. ADD COLUMNS IF NOT ALREADY PRESENT
ALTER TABLE public.inventory
ADD COLUMN IF NOT EXISTS design_group text NULL,
ADD COLUMN IF NOT EXISTS variant_type text NULL,
ADD COLUMN IF NOT EXISTS variant_value text NULL,
ADD COLUMN IF NOT EXISTS product_slug text NULL;

-- 2. CREATE SEARCH INDEX FOR DESIGN GROUP QUERIES
CREATE INDEX IF NOT EXISTS idx_inventory_design_group
ON public.inventory (design_group);

-- 3. CREATE COMPOSITE INDEX FOR VARIANT LOOKUPS
CREATE INDEX IF NOT EXISTS idx_inventory_design_variant
ON public.inventory (design_group, variant_type, variant_value);

-- 4. CREATE PARTIAL UNIQUE INDEX TO PREVENT DUPLICATE VARIANTS IN THE SAME DESIGN GROUP
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique_design_variant
ON public.inventory (design_group, variant_type, variant_value)
WHERE design_group IS NOT NULL
AND variant_type IS NOT NULL
AND variant_value IS NOT NULL;

-- 5. ENFORCE ALPHABET CONSTRAINT (ONE UPPERCASE A-Z LETTER WHEN VARIANT_TYPE IS 'alphabet')
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_alphabet_variant_check'
    ) THEN
        ALTER TABLE public.inventory
        ADD CONSTRAINT inventory_alphabet_variant_check
        CHECK (
            variant_type <> 'alphabet'
            OR variant_value ~ '^[A-Z]$'
        );
    END IF;
END $$;

-- 6. NOTIFY SCHEMA RELOAD
NOTIFY pgrst, 'reload schema';

-- ==============================================================================
-- WISHRITE INVENTORY — SAFE ADDITIVE MIGRATION FOR CREATOR PROFILE SYNC
-- Description: Adds Instagram profile metadata, follower metrics, creator niche,
-- validation status, and connection metadata to public.influencers without dropping
-- or recreating tables.
-- Canonical Primary Key: public.influencers.influencer_id (UUID)
-- Safe: Uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- ==============================================================================

-- 1. Add missing Instagram profile and metrics columns to public.influencers
ALTER TABLE public.influencers
    ADD COLUMN IF NOT EXISTS instagram_followers_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS instagram_following_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS instagram_media_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS instagram_profile_picture TEXT,
    ADD COLUMN IF NOT EXISTS instagram_category TEXT,
    ADD COLUMN IF NOT EXISTS creator_niche TEXT,
    ADD COLUMN IF NOT EXISTS instagram_profile_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS instagram_validation_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS instagram_connection JSONB;

-- 2. Create performance indexes for creator filtering and sync lookups
CREATE INDEX IF NOT EXISTS idx_influencers_creator_niche 
    ON public.influencers (creator_niche);

CREATE INDEX IF NOT EXISTS idx_influencers_ig_validation 
    ON public.influencers (instagram_validation_status);

CREATE INDEX IF NOT EXISTS idx_influencers_ig_followers 
    ON public.influencers (instagram_followers_count);

CREATE INDEX IF NOT EXISTS idx_influencers_ig_id 
    ON public.influencers (instagram_id);

-- 3. Document table columns for schema auditing
COMMENT ON COLUMN public.influencers.influencer_id IS 'Canonical primary key (UUID) linking across Inventory and Creator platform';
COMMENT ON COLUMN public.influencers.creator_niche IS 'Primary content niche curated by WishRite (e.g. Jewellery & Accessories)';
COMMENT ON COLUMN public.influencers.instagram_category IS 'Category returned by Meta Graph API Facebook Page / IG Business node';
COMMENT ON COLUMN public.influencers.instagram_followers_count IS 'Follower count synced from Meta Graph API';
COMMENT ON COLUMN public.influencers.instagram_validation_status IS 'Instagram account validation state: pending, verified, rejected, unlinked';

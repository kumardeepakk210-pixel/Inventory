-- ==============================================================================
-- WISHRITE INVENTORY & OCCASION COLLECTION MIGRATION
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. ADD ALL MISSING COLUMNS TO INVENTORY TABLE (PRESERVING EXISTING DATA)
alter table public.inventory
    add column if not exists compare_at_price numeric default 0,
    add column if not exists cost_price numeric default 0,
    add column if not exists short_description text,
    add column if not exists material text default '925 Sterling Silver',
    add column if not exists purity text default '92.5%',
    add column if not exists gst numeric default 3,
    add column if not exists low_stock_threshold integer not null default 3,
    add column if not exists status text not null default 'Active',
    add column if not exists slug text,
    add column if not exists seo_title text,
    add column if not exists seo_description text,
    add column if not exists image_url text,
    add column if not exists product_media_urls jsonb not null default '[]'::jsonb,
    add column if not exists purchase_attachment_url text,
    -- Occasion Collection & Catalog Classification fields (SINGLE TABLE ARCHITECTURE)
    add column if not exists catalog_type text not null default 'silver_jewellery', -- 'silver_jewellery', 'saree', 'artificial_jewellery', 'occasion_wear', 'other'
    add column if not exists occasion_slug text, -- e.g. 'durga-puja', 'diwali', etc.
    add column if not exists occasion_category text, -- 'Festive Sarees', 'Statement Jewellery', 'Silver Pairings', etc.
    add column if not exists occasion_featured boolean not null default false,
    add column if not exists occasion_enabled boolean not null default false,
    add column if not exists color text,
    add column if not exists fabric text,
    add column if not exists design text,
    add column if not exists pattern text,
    add column if not exists border_style text,
    add column if not exists matching_tags text;

-- Helpful Indexes for Fast Catalog & Occasion Querying
create index if not exists idx_inventory_product_code on public.inventory (product_code);
create index if not exists idx_inventory_status on public.inventory (status);
create index if not exists idx_inventory_category on public.inventory (category);
create index if not exists idx_inventory_catalog_type on public.inventory (catalog_type);
create index if not exists idx_inventory_occasion_slug on public.inventory (occasion_slug);
create index if not exists idx_inventory_occasion_featured on public.inventory (occasion_featured);

-- 2. CENTRAL OCCASION SETTINGS TABLE (public.occasion_settings - Single Source of Truth)
create table if not exists public.occasion_settings (
    id uuid primary key default gen_random_uuid(),
    occasion_slug text unique not null,
    occasion_name text not null,
    page_title text,
    page_description text,
    banner_image text,
    start_date date,
    end_date date,
    is_active boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Unique index to guarantee at most ONE active festive occasion at any time (REQUIRED FIX 4)
create unique index if not exists idx_occasion_settings_single_active
on public.occasion_settings (is_active)
where is_active = true;

-- Seed the 6 Master Occasions (REQUIRED FIX 6)
insert into public.occasion_settings (occasion_slug, occasion_name, is_active)
values
    ('durga-puja', 'Durga Puja', false),
    ('kali-puja', 'Kali Puja', false),
    ('diwali', 'Diwali', false),
    ('christmas', 'Christmas', false),
    ('valentines-day', 'Valentine''s Day', false),
    ('wedding', 'Wedding', false)
on conflict (occasion_slug) do update
set occasion_name = excluded.occasion_name;

-- Enable RLS for occasion_settings
alter table public.occasion_settings enable row level security;

drop policy if exists "Occasion settings are readable by all" on public.occasion_settings;
create policy "Occasion settings are readable by all"
on public.occasion_settings for select
to anon, authenticated, service_role
using (true);

drop policy if exists "Occasion settings can be updated" on public.occasion_settings;
create policy "Occasion settings can be updated"
on public.occasion_settings for update
to anon, authenticated, service_role
using (true)
with check (true);

drop policy if exists "Occasion settings can be inserted" on public.occasion_settings;
create policy "Occasion settings can be inserted"
on public.occasion_settings for insert
to anon, authenticated, service_role
with check (true);


-- 3. OCCASIONS CONFIGURATION TABLE
create table if not exists public.occasions (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null,
    description text,
    is_enabled boolean not null default true,
    sort_order integer not null default 0,
    -- Header & Hero configuration
    header_subtitle text default 'FESTIVE COLLECTION',
    hero_eyebrow text,
    hero_heading text,
    hero_english_heading text,
    hero_description text,
    hero_cta_text text default 'Explore Festive Collection',
    hero_image_url text,
    -- Background artwork configuration
    bg_artwork_url text,
    bg_artwork_opacity numeric default 0.15,
    bg_artwork_position text default 'center',
    bg_artwork_size text default 'cover',
    -- Countdown configuration
    countdown_enabled boolean not null default false,
    countdown_target timestamptz,
    -- Collection Labels
    collection_label_all text default 'All Festive',
    collection_label_sarees text default 'Festive Sarees',
    collection_label_jewellery text default 'Statement Jewellery',
    collection_label_silver text default 'Silver Pairings',
    -- SEO
    seo_title text,
    seo_description text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Seed Standard Occasions
insert into public.occasions (slug, name, description, sort_order, header_subtitle, hero_eyebrow, hero_heading, hero_english_heading, hero_description, collection_label_all, collection_label_sarees, collection_label_jewellery, collection_label_silver)
values 
    ('durga-puja', 'Durga Puja', 'Celebrate the grandeur of Sharodotsav with timeless silver, festive sarees & regal jewellery.', 1, 'DURGA PUJA COLLECTION', 'SHARODOTSAV 2026', 'শারদীয় সম্ভার', 'Durga Puja Festive Curation', 'Handcrafted silver jewellery paired with curated festive sarees for every day of the puja.', 'All Festive', 'Festive Sarees', 'Statement Jewellery', 'Silver Pairings'),
    ('kali-puja', 'Kali Puja', 'Luminous silver jewellery and festive wear for Diwali and Shyama Puja nights.', 2, 'KALI PUJA SPECIAL', 'DIWALI & KALI PUJA', 'আলোর উৎসব', 'Festive Lights & Sparkle', 'Dazzling pieces crafted to light up your celebrations.', 'All Festive', 'Festive Sarees', 'Statement Jewellery', 'Silver Pairings'),
    ('diwali', 'Diwali', 'Festival of lights curated with precious 925 sterling silver and celebratory attire.', 3, 'DIWALI FESTIVE CURATION', 'FESTIVAL OF LIGHTS', 'दीपावली विशेष', 'Auspicious Silver & Glamour', 'Auspicious silver coins, statement rings and ethnic elegance.', 'All Festive', 'Festive Sarees', 'Statement Jewellery', 'Silver Pairings'),
    ('christmas', 'Christmas', 'Sparkling silver gifts and winter celebration highlights.', 4, 'CHRISTMAS & NEW YEAR', 'HOLIDAY SEASON', 'Joy of Gifting', 'Sparkling Winter Collection', 'Thoughtful 925 silver gifts and accessories to welcome the new year.', 'All Festive', 'Holiday Wear', 'Silver Accessories', 'Gift Specials'),
    ('valentines-day', 'Valentine''s Day', 'Romantic silver keepsakes and love tokens.', 5, 'VALENTINE''S DAY CURATION', 'SEASON OF LOVE', 'Tokens of Affection', 'Romantic Silver Keepsakes', 'Timeless expressions of love in pure silver.', 'All Festive', 'Romantic Wear', 'Couple Rings', 'Silver Charms'),
    ('wedding', 'Wedding', 'Bridal and wedding guest collections in traditional and contemporary styles.', 6, 'WEDDING & BRIDAL', 'THE ROYAL WEDDING', 'शुभ विवाह', 'Bridal & Occasion Royalty', 'Intricate silver craftsmanship, wedding sarees, and statement ornaments.', 'All Festive', 'Bridal Sarees', 'Bridal Sets', 'Silver Essentials'),
    ('holi', 'Holi', 'Vibrant pieces for festival of colors.', 7, 'HOLI CELEBRATION', 'FESTIVAL OF COLORS', 'রঙিন উৎসব', 'Vibrant Festive Edit', 'Lightweight festive jewelry and vibrant wear.', 'All Festive', 'Festive Wear', 'Silver Jewellery', 'Accessories'),
    ('eid', 'Eid', 'Festive celebrations, moonlit silver and rich ethnic fashion.', 8, 'EID COLLECTION', 'EID CELEBRATIONS', 'Eid Mubarak Edit', 'Timeless Grandeur', 'Exquisite silver jewellery and celebration wear.', 'All Festive', 'Ethnic Wear', 'Statement Jewellery', 'Silver Pairings'),
    ('other', 'Other Occasion', 'Special seasonal campaigns and limited edition festive drops.', 9, 'SEASONAL SPECIAL', 'LIMITED EDITION', 'Curated Specials', 'Curated Seasonal Drop', 'Handpicked specials for the season.', 'All Festive', 'Occasion Wear', 'Statement Jewellery', 'Silver Pairings')
on conflict (slug) do nothing;

-- Enable RLS on occasions
alter table public.occasions enable row level security;

drop policy if exists "Occasions are readable by all" on public.occasions;
create policy "Occasions are readable by all"
on public.occasions for select
to anon, authenticated
using (true);

drop policy if exists "Occasions can be updated" on public.occasions;
create policy "Occasions can be updated"
on public.occasions for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Occasions can be inserted" on public.occasions;
create policy "Occasions can be inserted"
on public.occasions for insert
to anon, authenticated
with check (true);

drop policy if exists "Occasions can be deleted" on public.occasions;
create policy "Occasions can be deleted"
on public.occasions for delete
to anon, authenticated
using (true);


-- 4. OCCASION OFFERS / CAMPAIGNS TABLE (EMPTY BY DEFAULT — NO FAKE OFFERS)
create table if not exists public.occasion_offers (
    id uuid primary key default gen_random_uuid(),
    occasion_slug text not null,
    offer_name text not null,
    description text,
    discount_type text not null default 'percentage', -- 'percentage', 'fixed'
    discount_value numeric not null default 0,
    min_order numeric not null default 0,
    max_discount numeric,
    start_date timestamptz,
    end_date timestamptz,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_occasion_offers_slug on public.occasion_offers (occasion_slug);

-- Enable RLS on occasion_offers
alter table public.occasion_offers enable row level security;

drop policy if exists "Occasion offers are readable by all" on public.occasion_offers;
create policy "Occasion offers are readable by all"
on public.occasion_offers for select
to anon, authenticated
using (true);

drop policy if exists "Occasion offers can be inserted" on public.occasion_offers;
create policy "Occasion offers can be inserted"
on public.occasion_offers for insert
to anon, authenticated
with check (true);

drop policy if exists "Occasion offers can be updated" on public.occasion_offers;
create policy "Occasion offers can be updated"
on public.occasion_offers for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Occasion offers can be deleted" on public.occasion_offers;
create policy "Occasion offers can be deleted"
on public.occasion_offers for delete
to anon, authenticated
using (true);


-- 5. RELOAD POSTGREST SCHEMA CACHE
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- ==============================================================================
-- WISHRITE INVENTORY & PRODUCT MANAGEMENT SYSTEM
-- Supabase Database Schema & Storage Configuration Setup
-- Run once in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. STORAGE BUCKETS CONFIGURATION
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-images',
    'product-images',
    true,
    52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']::text[]
)
on conflict (id) do update set
    public = true,
    file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']::text[];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'purchase-invoices',
    'purchase-invoices',
    true,
    52428800,
    array['image/*', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/plain']::text[]
)
on conflict (id) do update set
    public = true,
    file_size_limit = 52428800;

-- 2. STORAGE RLS POLICIES FOR 'product-images'
drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "Product images can be uploaded" on storage.objects;
create policy "Product images can be uploaded"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'product-images');

drop policy if exists "Product images can be updated" on storage.objects;
create policy "Product images can be updated"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');

drop policy if exists "Product images can be deleted" on storage.objects;
create policy "Product images can be deleted"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'product-images');

-- 3. STORAGE RLS POLICIES FOR 'purchase-invoices'
drop policy if exists "Purchase invoices are publicly readable" on storage.objects;
create policy "Purchase invoices are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'purchase-invoices');

drop policy if exists "Purchase invoices can be uploaded" on storage.objects;
create policy "Purchase invoices can be uploaded"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'purchase-invoices');

drop policy if exists "Purchase invoices can be updated" on storage.objects;
create policy "Purchase invoices can be updated"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'purchase-invoices')
with check (bucket_id = 'purchase-invoices');

drop policy if exists "Purchase invoices can be deleted" on storage.objects;
create policy "Purchase invoices can be deleted"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'purchase-invoices');


-- 4. EXTEND INVENTORY / PRODUCT TABLE WITH METADATA FIELDS
alter table public.inventory
    add column if not exists purchase_attachment_url text,
    add column if not exists product_media_urls jsonb not null default '[]'::jsonb,
    add column if not exists image_url text,
    add column if not exists compare_at_price numeric default 0,
    add column if not exists cost_price numeric default 0,
    add column if not exists short_description text,
    add column if not exists material text default '925 Sterling Silver',
    add column if not exists purity text default '92.5%',
    add column if not exists gst numeric default 3,
    add column if not exists status text not null default 'Active',
    add column if not exists slug text,
    add column if not exists seo_title text,
    add column if not exists seo_description text,
    add column if not exists low_stock_threshold integer not null default 3;

-- Index for fast lookup on product_code and status
create index if not exists idx_inventory_product_code on public.inventory (product_code);
create index if not exists idx_inventory_status on public.inventory (status);
create index if not exists idx_inventory_category on public.inventory (category);


-- 5. CREATE PRODUCT IMAGES TABLE
create table if not exists public.product_images (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.inventory(id) on delete cascade,
    image_url text not null,
    storage_path text,
    image_type text not null default 'Gallery', -- Main, Gallery, Thumbnail, Lifestyle, Model, Zoom
    sort_order integer not null default 0,
    alt_text text,
    is_primary boolean not null default false,
    created_at timestamptz not null default now()
);

-- Index for quick lookup of images by product_id
create index if not exists idx_product_images_product_id on public.product_images (product_id);
create index if not exists idx_product_images_sort on public.product_images (product_id, sort_order);

-- Enable RLS on product_images
alter table public.product_images enable row level security;

drop policy if exists "Product images are viewable by all" on public.product_images;
create policy "Product images are viewable by all"
on public.product_images for select
to anon, authenticated
using (true);

drop policy if exists "Product images can be inserted" on public.product_images;
create policy "Product images can be inserted"
on public.product_images for insert
to anon, authenticated
with check (true);

drop policy if exists "Product images can be updated" on public.product_images;
create policy "Product images can be updated"
on public.product_images for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Product images can be deleted" on public.product_images;
create policy "Product images can be deleted"
on public.product_images for delete
to anon, authenticated
using (true);


-- 6. BUSINESS CONFIGURATION TABLE
create table if not exists public.business_config (
    id bigint primary key default 1 check (id = 1),
    business_type text not null default 'Jewelry Retail and Wholesale',
    product_fields jsonb not null default '{"product_name":true,"product_code":true,"category":true,"size":true,"weight":true,"description":true,"purchase_price":true,"selling_price":true,"stock_quantity":true}'::jsonb,
    categories jsonb not null default '[{"name":"Chain","prefix":"CHN"},{"name":"Ring","prefix":"RNG"},{"name":"Earring","prefix":"ERN"},{"name":"Pendant","prefix":"PDT"},{"name":"Bracelet","prefix":"BRL"},{"name":"Necklace","prefix":"NKC"},{"name":"Toe Rings","prefix":"TRN"},{"name":"Anklet","prefix":"ANC"},{"name":"Rakhi","prefix":"RKH"},{"name":"Nose Pin","prefix":"NSP"},{"name":"Bali","prefix":"BLI"},{"name":"Set","prefix":"SET"},{"name":"Silver Jewellery","prefix":"SLV"},{"name":"Fashion Jewellery","prefix":"FSH"},{"name":"Other","prefix":"MISC"}]'::jsonb,
    workflows jsonb not null default '{"inventory":true,"purchases":true,"stock_adjustments":true,"sales":true,"invoices":true,"revenue":true,"influencers":true}'::jsonb,
    updated_at timestamptz not null default now()
);

insert into public.business_config (id)
values (1)
on conflict (id) do nothing;

alter table public.business_config enable row level security;

drop policy if exists "Business configuration is readable" on public.business_config;
create policy "Business configuration is readable"
on public.business_config for select
to anon, authenticated
using (true);

drop policy if exists "Business configuration can be managed" on public.business_config;
create policy "Business configuration can be managed"
on public.business_config for all
to anon, authenticated
using (true)
with check (true);


-- 7. SALES TABLE
create table if not exists public.sales (
    id uuid primary key default gen_random_uuid(),
    product_code text,
    product_name text,
    product_description text,
    category text,
    quantity integer not null default 1,
    selling_price numeric not null default 0,
    discount numeric not null default 0,
    tax numeric not null default 0,
    weight numeric,
    size text,
    customer_name text not null,
    customer_phone text,
    customer_email text,
    customer_address text,
    customer_city text,
    customer_state text,
    customer_pin text,
    customer_country text,
    invoice_total numeric not null default 0,
    paid_amount numeric not null default 0,
    due_amount numeric not null default 0,
    payment_status text not null default 'Pending',
    created_at timestamptz not null default now()
);

alter table public.sales enable row level security;

drop policy if exists "Sales are readable" on public.sales;
create policy "Sales are readable"
on public.sales for select
to anon, authenticated
using (true);

drop policy if exists "Sales can be recorded" on public.sales;
create policy "Sales can be recorded"
on public.sales for insert
to anon, authenticated
with check (true);

drop policy if exists "Sales can be updated" on public.sales;
create policy "Sales can be updated"
on public.sales for update
to anon, authenticated
using (true)
with check (true);


-- 8. CUSTOMERS TABLE & RLS
create table if not exists public.customers (
    id uuid primary key default gen_random_uuid(),
    customer_name text not null,
    customer_phone text,
    customer_email text,
    customer_address text,
    customer_city text,
    customer_state text,
    customer_country text,
    customer_pin text,
    created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

drop policy if exists "Customers are readable" on public.customers;
create policy "Customers are readable"
on public.customers for select
to anon, authenticated
using (true);

drop policy if exists "Customers can be inserted" on public.customers;
create policy "Customers can be inserted"
on public.customers for insert
to anon, authenticated
with check (true);

drop policy if exists "Customers can be updated" on public.customers;
create policy "Customers can be updated"
on public.customers for update
to anon, authenticated
using (true)
with check (true);


-- 9. INVENTORY TABLE RLS POLICIES
alter table public.inventory enable row level security;

drop policy if exists "Inventory is readable by all" on public.inventory;
create policy "Inventory is readable by all"
on public.inventory for select
to anon, authenticated
using (true);

drop policy if exists "Inventory can be inserted" on public.inventory;
create policy "Inventory can be inserted"
on public.inventory for insert
to anon, authenticated
with check (true);

drop policy if exists "Inventory can be updated" on public.inventory;
create policy "Inventory can be updated"
on public.inventory for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Inventory can be deleted" on public.inventory;
create policy "Inventory can be deleted"
on public.inventory for delete
to anon, authenticated
using (true);


-- 10. EMPLOYEES TABLE RLS POLICIES
alter table public.employees enable row level security;

drop policy if exists "Employees are readable" on public.employees;
create policy "Employees are readable"
on public.employees for select
to anon, authenticated
using (true);

drop policy if exists "Employees can be created" on public.employees;
create policy "Employees can be created"
on public.employees for insert
to anon, authenticated
with check (true);

drop policy if exists "Employees can be updated" on public.employees;
create policy "Employees can be updated"
on public.employees for update
to anon, authenticated
using (true)
with check (true);


-- 11. CONVENIENCE VIEWS FOR COMPATIBILITY (PRODUCTS & CATEGORIES)
create or replace view public.products as
select 
    id,
    product_code,
    product_name,
    short_description,
    product_description,
    category,
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
from public.inventory;

create or replace view public.categories as
select distinct
    category as name,
    split_part(product_code, '-', 1) as prefix,
    count(*)::integer as product_count
from public.inventory
where category is not null and category != ''
group by category, split_part(product_code, '-', 1);


-- 12. PERMISSIONS GRANTS & SCHEMA CACHE RELOAD
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- Signal PostgREST to immediately refresh its schema cache
notify pgrst, 'reload schema';
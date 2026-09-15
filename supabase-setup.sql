-- Run once in the Supabase SQL editor before using invoice/product attachments.

insert into storage.buckets (id, name, public)
values ('purchase-invoices', 'purchase-invoices', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/*', 'video/*']::text[]
where id = 'product-images';

drop policy if exists "Purchase invoices are publicly readable" on storage.objects;
create policy "Purchase invoices are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'purchase-invoices');

drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "Purchase invoices can be uploaded" on storage.objects;
create policy "Purchase invoices can be uploaded"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'purchase-invoices');

drop policy if exists "Product images can be uploaded" on storage.objects;
create policy "Product images can be uploaded"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'product-images');

alter table public.inventory
    add column if not exists purchase_attachment_url text,
    add column if not exists product_media_urls jsonb not null default '[]'::jsonb;

create table if not exists public.business_config (
    id bigint primary key default 1 check (id = 1),
    business_type text not null default 'Jewelry Retail and Wholesale',
    product_fields jsonb not null default '{"product_name":true,"product_code":true,"category":true,"size":true,"weight":true,"description":true,"purchase_price":true,"selling_price":true,"stock_quantity":true}'::jsonb,
    categories jsonb not null default '[{"name":"Chain","prefix":"CHN"},{"name":"Ring","prefix":"RNG"},{"name":"Earring","prefix":"ERN"},{"name":"Pendant","prefix":"PDT"},{"name":"Bracelet","prefix":"BRL"},{"name":"Necklace","prefix":"NKC"},{"name":"Toe Rings","prefix":"TRN"},{"name":"Anklet","prefix":"ANC"},{"name":"Rakhi","prefix":"RKH"},{"name":"Nose Pin","prefix":"NSP"},{"name":"Bali","prefix":"BLI"},{"name":"Set","prefix":"SET"},{"name":"Other","prefix":"MISC"}]'::jsonb,
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
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
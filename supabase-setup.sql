-- Run once in the Supabase SQL editor before using Stock In attachments.
-- Storage folders are represented by the path prefixes below.

insert into storage.buckets (id, name, public)
values ('inventory-files', 'inventory-files', true)
on conflict (id) do update set public = true;

drop policy if exists "Inventory files are publicly readable" on storage.objects;
create policy "Inventory files are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'inventory-files');

drop policy if exists "Inventory files can be uploaded" on storage.objects;
create policy "Inventory files can be uploaded"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'inventory-files');

alter table public.inventory
    add column if not exists purchase_attachment_url text,
    add column if not exists product_media_urls jsonb not null default '[]'::jsonb;
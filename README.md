# Inventory

## Attachment storage setup

Run [`supabase-setup.sql`](supabase-setup.sql) once in the Supabase SQL editor. It creates the public `purchase-invoices` and `product-images` buckets, allows the browser client to upload/read files, and adds the attachment URL columns to `inventory`.

Purchase invoices are stored under `purchase-invoice/<timestamp>/`. Product media is stored under `product-image/<product-name>/image/` or `product-image/<product-name>/video/`.
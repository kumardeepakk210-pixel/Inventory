# Inventory

## Attachment storage setup

Run [`supabase-setup.sql`](supabase-setup.sql) once in the Supabase SQL editor. It creates the public `purchase-invoices` and `product-images` buckets, allows the browser client to upload/read files, and adds the attachment URL columns to `inventory`.

The same setup creates `business_config`, which stores the active Business Type, Product Fields, Categories/prefixes, and enabled Workflows. The app merges categories already present in `inventory` so existing products remain visible.

Purchase invoices are stored under `purchase-invoice/<timestamp>/`. Product media is stored under `product-image/<product-name>/image/` or `product-image/<product-name>/video/`.
# Inventory

## Attachment storage setup

Run [`supabase-setup.sql`](supabase-setup.sql) once in the Supabase SQL editor. It creates the public `inventory-files` bucket, allows the browser client to upload/read files, and adds the attachment URL columns to `inventory`.

Stock In stores purchase attachments under `purchases/<date>-<shop>-<product-code>/` and product images/videos under `products/<product-name>/`.
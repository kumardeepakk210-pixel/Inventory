// ==============================================================================
// WISHRITE INVENTORY — IMAGES API CONTROLLER
// Manages product image uploads and metadata using Supabase Storage server-side.
// Credentials and storage policies remain strictly isolated on the server.
// ==============================================================================

import multer from 'multer';
import { storageUpload, storageDelete, storageList, getStoragePublicUrl, dbQuery, dbInsert, dbDelete } from './supabase-client.js';

// Configure in-memory upload (files are immediately streamed to Supabase Storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
        }
    }
});

export const uploadMiddleware = upload.single('image');

const BUCKET = 'product-images';

/**
 * GET /api/products/:sku/images
 */
export async function handleGetProductImages(req, res) {
    try {
        const { sku } = req.params;
        if (!sku) {
            return res.status(400).json({ success: false, error: { message: 'SKU is required' } });
        }

        const cleanSku = sku.toUpperCase().trim();

        // 1. Check product_images table
        let dbImages = [];
        try {
            dbImages = await dbQuery('product_images', `product_code=eq.${encodeURIComponent(cleanSku)}&order=sort_order.asc`);
        } catch (e) {
            // If product_images table is not yet migrated, fallback to storage folder
        }

        if (dbImages && dbImages.length > 0) {
            return res.json({ success: true, count: dbImages.length, data: dbImages });
        }

        // 2. Fallback: inspect Supabase Storage folder directly
        try {
            const files = await storageList(BUCKET, cleanSku);
            const mapped = (files || []).map((f, idx) => ({
                id: f.id || `${cleanSku}_${idx}`,
                product_code: cleanSku,
                image_url: getStoragePublicUrl(BUCKET, `${cleanSku}/${f.name}`),
                is_primary: idx === 0,
                sort_order: idx
            }));

            return res.json({ success: true, count: mapped.length, data: mapped });
        } catch (storageErr) {
            return res.json({ success: true, count: 0, data: [] });
        }
    } catch (err) {
        console.error('[Product Images GET Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'IMAGES_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/products/:sku/images
 */
export async function handleUploadProductImage(req, res) {
    try {
        const { sku } = req.params;
        const file = req.file;

        if (!sku) {
            return res.status(400).json({ success: false, error: { message: 'SKU is required' } });
        }
        if (!file) {
            return res.status(400).json({ success: false, error: { message: 'No image file provided' } });
        }

        const cleanSku = sku.toUpperCase().trim();
        const ext = file.originalname.split('.').pop() || 'jpg';
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const storagePath = `${cleanSku}/${fileName}`;

        // Upload to Supabase Storage
        const publicUrl = await storageUpload(BUCKET, storagePath, file.buffer, file.mimetype);

        // Record metadata in product_images table if available
        let newRecord = {
            id: 'IMG-' + Date.now(),
            product_code: cleanSku,
            image_url: publicUrl,
            file_name: fileName,
            storage_path: storagePath,
            is_primary: req.body.is_primary === 'true' || false,
            created_at: new Date().toISOString()
        };

        try {
            const inserted = await dbInsert('product_images', newRecord);
            if (inserted.data) newRecord = inserted.data;
        } catch (dbErr) {
            console.warn('[Images API] Metadata insert to product_images skipped:', dbErr.message);
        }

        return res.status(201).json({
            success: true,
            message: 'Image uploaded successfully.',
            data: {
                ...newRecord,
                image_url: publicUrl
            }
        });
    } catch (err) {
        console.error('[Upload Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'IMAGE_UPLOAD_FAILED', message: err.message || 'Image upload failed' }
        });
    }
}

/**
 * DELETE /api/products/:sku/images/:fileName
 */
export async function handleDeleteProductImage(req, res) {
    try {
        const { sku, fileName } = req.params;
        if (!sku || !fileName) {
            return res.status(400).json({ success: false, error: { message: 'SKU and file name are required' } });
        }

        const cleanSku = sku.toUpperCase().trim();
        const storagePath = `${cleanSku}/${fileName}`;

        try {
            await storageDelete(BUCKET, storagePath);
        } catch (e) {
            console.warn('[Images API] Storage deletion note:', e.message);
        }

        try {
            await dbDelete('product_images', 'file_name', fileName);
        } catch (e) {}

        return res.json({
            success: true,
            message: 'Image deleted successfully.'
        });
    } catch (err) {
        console.error('[Delete Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'IMAGE_DELETE_FAILED', message: err.message }
        });
    }
}

// Vercel Serverless Function entry point (dynamic import prevents circular ESM dependencies)
export default async function handler(req, res) {
    const { app } = await import('../server.js');
    return app(req, res);
}

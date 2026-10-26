// ==============================================================================
// WISHRITE INVENTORY — IMAGES API CONTROLLER
// Manages product image uploads, 8K enhancement pipeline, and metadata using Supabase.
// Credentials and storage policies remain strictly isolated on the server.
// ==============================================================================

import multer from 'multer';
import crypto from 'crypto';
import {
    storageUpload,
    storageDelete,
    storageList,
    getStoragePublicUrl,
    dbQuery,
    dbInsert,
    dbUpdate,
    dbDelete
} from './supabase-client.js';
import {
    enhanceImageTo8K,
    getEnhancementStatus,
    fetchImageBuffer
} from '../services/imageUpscaleService.js';

// Configure in-memory upload (files are immediately streamed to Supabase Storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
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
            const validFiles = (files || []).filter(f =>
                f && f.name &&
                !f.name.startsWith('.') &&
                /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(f.name)
            );
            const mapped = validFiles.map((f, idx) => ({
                id: f.id || `${cleanSku}_${idx}`,
                product_code: cleanSku,
                image_url: getStoragePublicUrl(BUCKET, `${cleanSku}/${f.name}`),
                public_url: getStoragePublicUrl(BUCKET, `${cleanSku}/${f.name}`),
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
 * NORMAL UPLOAD WORKFLOW:
 * 1. Preserves source image in Supabase storage & DB (generation_source = 'upload')
 * 2. Automatically routes to COMMON 8K ENHANCEMENT PIPELINE
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

        // 1. Upload source image to Supabase Storage (Preserving exact original)
        const publicUrl = await storageUpload(BUCKET, storagePath, file.buffer, file.mimetype);

        const isPrimary = req.body.is_primary === 'true' || req.body.is_primary === true;
        const imageRole = req.body.image_role || '01_main_ecommerce';

        // 2. Look up product_id and sync image to public.inventory table
        let productId = null;
        try {
            const list = await dbQuery('inventory', `product_code=eq.${encodeURIComponent(cleanSku)}&limit=1`);
            if (list && list[0]) {
                productId = list[0].id;
                const shouldUpdatePrimary = isPrimary || !list[0].image_url;
                const existingMedia = Array.isArray(list[0].product_media_urls) ? list[0].product_media_urls : [];
                const updatedMedia = existingMedia.includes(publicUrl) ? existingMedia : [...existingMedia, publicUrl];
                const updatePayload = { product_media_urls: updatedMedia };
                if (shouldUpdatePrimary) {
                    updatePayload.image_url = publicUrl;
                }
                await dbUpdate('inventory', 'product_code', cleanSku, updatePayload, { useAdmin: true });
            }
        } catch (e) {
            console.warn('[Images API] Failed to update inventory record with uploaded image:', e.message);
        }

        // 3. Record source image in canonical public.product_images
        const sourceImageId = crypto.randomUUID();
        let newRecord = {
            id: sourceImageId,
            product_id: productId,
            product_code: cleanSku,
            image_url: publicUrl,
            public_url: publicUrl,
            publicUrl: publicUrl,
            file_name: fileName,
            storage_path: storagePath,
            image_type: isPrimary ? 'Main' : 'Gallery',
            image_role: imageRole,
            sort_order: parseInt(req.body.sort_order, 10) || 0,
            alt_text: req.body.alt_text || `${cleanSku} jewellery photograph`,
            is_primary: isPrimary,
            generation_source: 'upload', // Section 12 Lineage
            generation_status: 'completed',
            is_ai_generated: false,
            parent_image_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            const inserted = await dbInsert('product_images', newRecord, { useAdmin: true });
            if (inserted.data) newRecord = inserted.data;
        } catch (dbErr) {
            console.warn('[Images API] Metadata insert to product_images skipped:', dbErr.message);
        }

        // 4. COMMON 8K ENHANCEMENT PIPELINE EXECUTION
        // Supports synchronous execution if requested (?sync=true) or async execution for non-blocking UI
        const isSync = req.query.sync === 'true' || req.body.sync === 'true';
        const enhancementMetadata = {
            productId,
            productCode: cleanSku,
            sourceImageId: newRecord.id,
            sourceImageUrl: publicUrl,
            fileName,
            imageRole,
            imageType: newRecord.image_type,
            sortOrder: newRecord.sort_order,
            altText: newRecord.alt_text,
            isPrimary,
            sourceType: 'upload',
            isAiGenerated: false
        };

        if (isSync) {
            // Await enhancement synchronously
            const enhancement = await enhanceImageTo8K(file.buffer, enhancementMetadata);
            return res.status(201).json({
                success: true,
                message: 'Image uploaded and 8K enhancement completed successfully.',
                data: {
                    ...newRecord,
                    image_url: publicUrl,
                    master_8k_url: enhancement.master_8k_url,
                    derivative_urls: enhancement.derivative_urls,
                    enhancement_status: enhancement.success ? 'completed' : 'failed',
                    enhancement
                }
            });
        } else {
            // Asynchronous non-blocking background enhancement execution
            setImmediate(async () => {
                try {
                    await enhanceImageTo8K(file.buffer, enhancementMetadata);
                } catch (e) {
                    console.error(`[Images API] Background 8K enhancement error for ${cleanSku}:`, e.message);
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Image uploaded successfully. 8K enhancement queued in background.',
                data: {
                    ...newRecord,
                    image_url: publicUrl,
                    enhancement_status: 'processing'
                }
            });
        }

    } catch (err) {
        console.error('[Upload Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'IMAGE_UPLOAD_FAILED', message: err.message || 'Image upload failed' }
        });
    }
}

/**
 * GET /api/products/:sku/images/:imageId/enhancement-status
 * Polls status of 8K enhancement for a specific image
 */
export async function handleGetImageEnhancementStatus(req, res) {
    try {
        const { sku, imageId } = req.params;
        if (!sku || !imageId) {
            return res.status(400).json({ success: false, error: { message: 'SKU and image ID are required' } });
        }

        const status = await getEnhancementStatus(imageId);
        if (status) {
            return res.json({ success: true, data: status });
        }

        return res.json({
            success: true,
            data: {
                id: imageId,
                status: 'completed',
                message: 'Status resolved or ready'
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'ENHANCEMENT_STATUS_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/products/:sku/images/:imageId/retry-enhancement
 * Retries 8K enhancement for an existing source image WITHOUT regenerating/re-uploading
 */
export async function handleRetryImageEnhancement(req, res) {
    try {
        const { sku, imageId } = req.params;
        if (!sku || !imageId) {
            return res.status(400).json({ success: false, error: { message: 'SKU and image ID are required' } });
        }

        const cleanSku = sku.toUpperCase().trim();

        // 1. Locate source image record in product_images
        let sourceImage = null;
        try {
            const rows = await dbQuery('product_images', `id=eq.${encodeURIComponent(imageId)}&limit=1`);
            if (rows && rows.length > 0) sourceImage = rows[0];
        } catch (e) {}

        if (!sourceImage) {
            return res.status(404).json({ success: false, error: { message: `Image record '${imageId}' not found` } });
        }

        if (!sourceImage.image_url) {
            return res.status(400).json({ success: false, error: { message: 'Source image has no accessible image URL to enhance' } });
        }

        console.log(`[8K PIPELINE] Retrying 8K enhancement for ${cleanSku} (Image: ${imageId})`);

        // 2. Download preserved source image
        const { buffer } = await fetchImageBuffer(sourceImage.image_url);

        // 3. Dispatch to COMMON 8K ENHANCEMENT PIPELINE with forceRetry = true
        const enhancement = await enhanceImageTo8K(buffer, {
            productId: sourceImage.product_id,
            productCode: cleanSku,
            sourceImageId: sourceImage.id,
            sourceImageUrl: sourceImage.image_url,
            fileName: sourceImage.file_name || `source_${Date.now()}`,
            imageRole: sourceImage.image_role || '01_main_ecommerce',
            imageType: sourceImage.image_type || 'Gallery',
            sortOrder: sourceImage.sort_order || 0,
            altText: sourceImage.alt_text,
            isPrimary: sourceImage.is_primary,
            sourceType: sourceImage.generation_source || 'upload',
            isAiGenerated: sourceImage.is_ai_generated || false,
            forceRetry: true
        });

        if (!enhancement.success) {
            return res.status(500).json({
                success: false,
                error: { message: enhancement.error || '8K enhancement retry failed' },
                can_retry: true
            });
        }

        return res.json({
            success: true,
            message: '8K enhancement completed successfully.',
            data: enhancement
        });

    } catch (err) {
        console.error('[Retry Enhancement Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'RETRY_ENHANCEMENT_FAILED', message: err.message },
            can_retry: true
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

        // Keep public.inventory in sync with remaining images
        try {
            const list = await dbQuery('inventory', `product_code=eq.${encodeURIComponent(cleanSku)}&limit=1`);
            if (list && list[0]) {
                const existingMedia = Array.isArray(list[0].product_media_urls) ? list[0].product_media_urls : [];
                const updatedMedia = existingMedia.filter(u => typeof u === 'string' && !u.includes(fileName));
                const payload = { product_media_urls: updatedMedia };
                if (list[0].image_url && typeof list[0].image_url === 'string' && list[0].image_url.includes(fileName)) {
                    payload.image_url = updatedMedia[0] || null;
                }
                await dbUpdate('inventory', 'product_code', cleanSku, payload, { useAdmin: true });
            }
        } catch (syncErr) {
            console.warn('[Images API] Sync deletion note:', syncErr.message);
        }

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

// Vercel Serverless Function entry point
export default async function handler(req, res) {
    const { app } = await import('../server.js');
    return app(req, res);
}

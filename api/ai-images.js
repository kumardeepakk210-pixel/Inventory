// ==============================================================================
// WISHRITE INVENTORY — AI IMAGES API CONTROLLER
// REST API endpoints for starting generation jobs, polling status,
// uploading 50MB uncompressed original reference images, and individual regeneration.
// ==============================================================================

import multer from 'multer';
import { 
    startGenerationJob, 
    getProductAiStatus, 
    regenerateSingleImage,
    findProduct 
} from '../services/aiImageService.js';
import { 
    storageUpload, 
    storageDelete,
    dbInsert, 
    dbUpdate, 
    dbDelete,
    dbQuery 
} from './supabase-client.js';

// Multer memory storage configured with 50 MB limit for raw uncompressed reference images
const uploadRaw = multer({
    storage: multer.memoryStorage(),
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

export const uploadOriginalMiddleware = uploadRaw.single('image');

const BUCKET = 'product-images';

/**
 * POST /api/products/:productId/original-image
 * Uploads uncompressed reference image (up to 50MB) without client-side downsizing
 */
export async function handleUploadOriginalImage(req, res) {
    try {
        const { productId } = req.params;
        const file = req.file;

        if (!productId) {
            return res.status(400).json({ success: false, error: { message: 'Product ID or SKU is required' } });
        }
        if (!file) {
            return res.status(400).json({ success: false, error: { message: 'No image file uploaded' } });
        }

        const product = await findProduct(productId);
        if (!product) {
            return res.status(404).json({ success: false, error: { message: `Product '${productId}' not found` } });
        }

        const cleanSku = (product.product_code || productId).toUpperCase().trim();
        const ext = file.originalname.split('.').pop() || 'jpg';
        const storagePath = `${cleanSku}/original/source.${ext}`;

        console.log(`[AI IMAGE] Uploading raw reference image for ${cleanSku} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

        // Upload to Supabase Storage: product-images/<sku>/original/source.<ext>
        const publicUrl = await storageUpload(BUCKET, storagePath, file.buffer, file.mimetype);

        // Update product record / metadata
        try {
            await dbUpdate('inventory', 'id', product.id, {
                original_source_image_url: publicUrl,
                storage_folder: cleanSku
            });
        } catch (dbErr) {
            console.warn('[AI Images API] Failed to update inventory original_source_image_url:', dbErr.message);
        }

        return res.status(201).json({
            success: true,
            message: 'Original high-resolution reference image uploaded successfully without compression.',
            data: {
                product_code: cleanSku,
                source_image_url: publicUrl,
                storage_path: storagePath,
                size_bytes: file.size
            }
        });

    } catch (err) {
        console.error('[Upload Original Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'ORIGINAL_UPLOAD_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/products/:productId/ai-images/generate
 * Trigger creation of 10 AI images
 */
export async function handleGenerateAiImages(req, res) {
    try {
        const { productId } = req.params;
        const { source_image_url } = req.body || {};

        if (!productId) {
            return res.status(400).json({ success: false, error: { message: 'Product ID is required' } });
        }

        const result = await startGenerationJob(productId, { source_image_url });
        return res.status(202).json(result);

    } catch (err) {
        console.error('[Generate AI Images Error]:', err);
        const status = err.statusCode || 500;
        return res.status(status).json({
            success: false,
            error: {
                code: status === 409 ? 'GENERATION_IN_PROGRESS' : 'AI_GENERATION_FAILED',
                message: err.message
            }
        });
    }
}

/**
 * GET /api/products/:productId/ai-images/status
 * Get the current job status and all 10 image states
 */
export async function handleGetAiImagesStatus(req, res) {
    try {
        const { productId } = req.params;
        if (!productId) {
            return res.status(400).json({ success: false, error: { message: 'Product ID is required' } });
        }

        const status = await getProductAiStatus(productId);
        return res.json({
            success: true,
            data: status
        });

    } catch (err) {
        console.error('[Get AI Status Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'STATUS_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/products/:productId/ai-images/:imageId/regenerate
 * Regenerate an individual image role
 */
export async function handleRegenerateAiImage(req, res) {
    try {
        const { productId, imageId } = req.params;
        if (!productId || !imageId) {
            return res.status(400).json({ success: false, error: { message: 'Product ID and image ID/role are required' } });
        }

        const updated = await regenerateSingleImage(productId, imageId);
        return res.json({
            success: true,
            message: 'Image regenerated successfully.',
            data: updated
        });

    } catch (err) {
        console.error('[Regenerate AI Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'REGENERATION_FAILED', message: err.message }
        });
    }
}

/**
 * DELETE /api/products/:productId/ai-images/:imageId
 * Safely delete an AI image
 */
export async function handleDeleteAiImage(req, res) {
    try {
        const { productId, imageId } = req.params;
        if (!productId || !imageId) {
            return res.status(400).json({ success: false, error: { message: 'Product ID and image ID are required' } });
        }

        try {
            await dbDelete('product_images', 'id', imageId);
        } catch (e) {
            // Also attempt deletion by role or file_name
            await dbDelete('product_images', 'image_role', imageId).catch(() => {});
        }

        return res.json({
            success: true,
            message: 'AI image record removed.'
        });

    } catch (err) {
        console.error('[Delete AI Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'IMAGE_DELETE_FAILED', message: err.message }
        });
    }
}

// Vercel serverless function entrypoint
export default async function handler(req, res) {
    const { app } = await import('../server.js');
    return app(req, res);
}

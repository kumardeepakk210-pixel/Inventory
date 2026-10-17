// ==============================================================================
// WISHRITE INVENTORY — AI PRODUCT CONTENT & SEO CONTROLLER
// Exposes POST /api/generate-product-content endpoint.
// Isolates Gemini API calls and credentials strictly on the server side.
// ==============================================================================

import multer from 'multer';
import { generateProductContent } from '../services/productContentService.js';

// In-memory upload middleware for raw image files
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are supported for AI analysis.'));
        }
    }
});

export const productContentUploadMiddleware = upload.single('image');

/**
 * POST /api/generate-product-content
 * Handles AI SEO & product copy auto-generation from uploaded image or existing image URL.
 */
export async function handleGenerateProductContent(req, res) {
    try {
        const file = req.file;
        const body = req.body || {};

        const imageUrl = body.imageUrl || body.image_url;
        const imageBase64 = body.imageBase64 || body.image_base64;
        const mimeType = file ? file.mimetype : (body.mimeType || body.mime_type || 'image/jpeg');

        const productContext = {
            product_code: body.product_code || body.code,
            category: body.category,
            audience: body.audience,
            material: body.material,
            purity: body.purity,
            finish: body.finish,
            weight: body.weight,
            size: body.size,
            design: body.design,
            occasion_slug: body.occasion_slug
        };

        if (!file && !imageUrl && !imageBase64) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'IMAGE_REQUIRED',
                    message: 'Please provide a product image (file upload, image URL, or image base64 data) for AI analysis.'
                }
            });
        }

        const result = await generateProductContent({
            imageBuffer: file ? file.buffer : null,
            imageUrl: imageUrl || null,
            imageBase64: imageBase64 || null,
            mimeType: mimeType,
            productContext: productContext
        });

        return res.json({
            success: true,
            message: '✓ AI content generated successfully.',
            model: result.model,
            data: result.data
        });
    } catch (err) {
        console.error('[Generate Product Content Error]:', err.message);
        const statusCode = err.status || 500;
        return res.status(statusCode).json({
            success: false,
            error: {
                code: err.code || 'AI_GENERATION_FAILED',
                message: err.message || 'AI generation failed. Please try again.'
            }
        });
    }
}

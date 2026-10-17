// ==============================================================================
// WISHRITE INVENTORY — AI IMAGE JOB COORDINATOR SERVICE
// Manages AI image jobs, 10-role pipeline, 8K upscaling, website derivatives,
// Supabase storage hierarchies, individual regeneration, and status polling.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { 
    AI_IMAGE_ROLES, 
    getRoleConfig, 
    generateGeminiProductImage,
    buildCompositePrompt
} from './geminiImageService.js';
import { upscaleImageTo8K } from './imageUpscaleService.js';
import { generateWebsiteDerivatives, getImageMetadata } from '../utils/imageProcessing.js';
import { 
    storageUpload, 
    storageDelete,
    dbQuery, 
    dbInsert, 
    dbUpdate, 
    dbDelete,
    SUPABASE_URL,
    SUPABASE_KEY
} from '../backend/supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOBS_FILE_PATH = path.join(__dirname, '../data/ai_jobs.json');
const BUCKET = 'product-images';

// In-memory active jobs registry for real-time responsiveness
const activeJobs = new Map();

/**
 * Helper to safely read fallback local jobs cache
 */
function loadLocalJobs() {
    try {
        if (fs.existsSync(JOBS_FILE_PATH)) {
            return JSON.parse(fs.readFileSync(JOBS_FILE_PATH, 'utf-8'));
        }
    } catch (e) {
        console.warn('[AI Image Service] Local jobs cache read error:', e.message);
    }
    return {};
}

/**
 * Helper to safely save fallback local jobs cache
 */
function saveLocalJob(job) {
    if (!job || !job.id) return;
    try {
        const dir = path.dirname(JOBS_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const all = loadLocalJobs();
        all[job.id] = job;
        fs.writeFileSync(JOBS_FILE_PATH, JSON.stringify(all, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[AI Image Service] Local jobs cache write error:', e.message);
    }
}

/**
 * Find product by id or product_code from database / product_meta
 */
export async function findProduct(idOrSku) {
    if (!idOrSku) return null;
    const clean = String(idOrSku).trim();

    // 1. Try querying inventory by product_code
    try {
        const byCode = await dbQuery('inventory', `product_code=eq.${encodeURIComponent(clean)}&limit=1`);
        if (byCode && byCode.length > 0) return byCode[0];
    } catch (e) {}

    // 2. Try querying inventory by UUID id
    try {
        const byId = await dbQuery('inventory', `id=eq.${encodeURIComponent(clean)}&limit=1`);
        if (byId && byId.length > 0) return byId[0];
    } catch (e) {}

    // 3. Fallback: check product_meta.json
    try {
        const metaPath = path.join(__dirname, '../data/product_meta.json');
        if (fs.existsSync(metaPath)) {
            const allMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (allMeta[clean]) {
                return {
                    id: clean,
                    product_code: clean,
                    product_name: allMeta[clean].product_name || clean,
                    ...allMeta[clean]
                };
            }
        }
    } catch (e) {}

    return null;
}

/**
 * Fetch image buffer from a public URL or data URI
 */
export async function fetchImageBuffer(imageUrl) {
    if (!imageUrl) throw new Error('No image URL provided');

    if (imageUrl.startsWith('data:')) {
        const parts = imageUrl.split(',');
        const base64 = parts[1];
        const mimeMatch = parts[0].match(/:(.*?);/);
        return {
            buffer: Buffer.from(base64, 'base64'),
            mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg'
        };
    }

    const res = await fetch(imageUrl);
    if (!res.ok) {
        throw new Error(`Failed to download source image from URL (status ${res.status})`);
    }
    const arrayBuf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    return {
        buffer: Buffer.from(arrayBuf),
        mimeType: contentType
    };
}

/**
 * Section 20: Check if a generation job is already active for this product
 */
export function isJobActiveForProduct(productId, productCode) {
    for (const job of activeJobs.values()) {
        if ((job.product_id === productId || job.product_code === productCode) && 
            (job.status === 'queued' || job.status === 'processing')) {
            return job;
        }
    }
    return null;
}

/**
 * Section 6 & 14: Start a new 10-image AI generation job
 */
export async function startGenerationJob(productIdOrSku, options = {}) {
    const product = options.product || await findProduct(productIdOrSku);
    if (!product) {
        throw new Error(`Product '${productIdOrSku}' was not found in inventory.`);
    }

    const productCode = (product.product_code || 'SKU').toUpperCase().trim();
    const productId = product.id || productCode;

    // Duplicate Generation Protection
    const existingActive = isJobActiveForProduct(productId, productCode);
    if (existingActive) {
        const err = new Error(`Generation already in progress for ${productCode} (${existingActive.completed_images}/${existingActive.total_images} complete).`);
        err.statusCode = 409;
        throw err;
    }

    // Determine reference source image
    let sourceImageUrl = options.source_image_url || product.original_source_image_url || product.image_url;

    // Check if an original master image exists in storage
    if (!sourceImageUrl) {
        throw new Error(`Product ${productCode} does not have a reference image. Please upload an original reference image first.`);
    }

    const jobId = crypto.randomUUID();
    const model = (process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image').trim();

    const job = {
        id: jobId,
        product_id: productId,
        product_code: productCode,
        source_image_url: sourceImageUrl,
        status: 'queued',
        total_images: 10,
        completed_images: 0,
        failed_images: 0,
        model: model,
        output_resolution: '8K',
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        error_message: null,
        images: []
    };

    // Pre-initialize the 10 role records
    for (const role of AI_IMAGE_ROLES) {
        const imgId = crypto.randomUUID();
        const roleRecord = {
            id: imgId,
            product_id: productId,
            product_code: productCode,
            image_role: role.role,
            role_name: role.name,
            sort_order: role.sort_order,
            generation_status: 'queued',
            is_ai_generated: true,
            generation_job_id: jobId,
            generation_model: model,
            generation_prompt: role.prompt,
            resolution: '8192x8192 (8K)',
            image_url: null,
            master_8k_url: null,
            master_4k_url: null,
            derivative_urls: null,
            error_message: null,
            created_at: new Date().toISOString()
        };
        job.images.push(roleRecord);
    }

    // Persist job locally and in active registry
    activeJobs.set(jobId, job);
    saveLocalJob(job);

    // Attempt to persist in Supabase ai_image_jobs table if it exists
    try {
        await dbInsert('ai_image_jobs', {
            id: job.id,
            product_id: job.product_id,
            product_code: job.product_code,
            source_image_url: job.source_image_url,
            status: job.status,
            total_images: job.total_images,
            completed_images: job.completed_images,
            failed_images: job.failed_images,
            model: job.model,
            output_resolution: job.output_resolution,
            created_at: job.created_at
        });
    } catch (dbErr) {
        console.warn('[AI Image Service] ai_image_jobs table insert skipped:', dbErr.message);
    }

    // Trigger non-blocking asynchronous generation execution
    setImmediate(() => {
        executeJobPipeline(jobId, product, sourceImageUrl).catch(err => {
            console.error(`[AI Image Service] Pipeline failure on job ${jobId}:`, err);
        });
    });

    console.log(`[AI IMAGE] Job created: ${jobId} for product ${productCode}`);

    return {
        success: true,
        job_id: jobId,
        product_code: productCode,
        status: job.status,
        total_images: job.total_images,
        message: 'AI image generation job queued successfully.'
    };
}

/**
 * Execute the background generation pipeline across all 10 roles
 */
async function executeJobPipeline(jobId, product, sourceImageUrl) {
    const job = activeJobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    job.started_at = new Date().toISOString();
    saveLocalJob(job);

    try {
        await dbUpdate('ai_image_jobs', 'id', jobId, {
            status: 'processing',
            started_at: job.started_at
        });
    } catch (e) {}

    console.log(`[AI IMAGE] Starting generation pipeline for ${job.product_code} (Job: ${jobId})`);

    // Download original reference image buffer once
    let referenceBuffer, mimeType;
    try {
        const fetched = await fetchImageBuffer(sourceImageUrl);
        referenceBuffer = fetched.buffer;
        mimeType = fetched.mimeType;
        console.log(`[AI IMAGE] Original reference image loaded (${(referenceBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (fetchErr) {
        job.status = 'failed';
        job.error_message = `Failed to download reference image: ${fetchErr.message}`;
        job.completed_at = new Date().toISOString();
        saveLocalJob(job);
        try {
            await dbUpdate('ai_image_jobs', 'id', jobId, {
                status: 'failed',
                error_message: job.error_message,
                completed_at: job.completed_at
            });
        } catch (e) {}
        return;
    }

    // Process each of the 10 roles sequentially with failure isolation
    for (const imageRecord of job.images) {
        const roleConfig = getRoleConfig(imageRecord.image_role);
        if (!roleConfig) continue;

        imageRecord.generation_status = 'processing';
        saveLocalJob(job);

        console.log(`[AI IMAGE] Generating role: ${roleConfig.role} (${roleConfig.name})`);

        try {
            // STEP 1: Gemini High-Resolution Generation
            const geminiResult = await generateGeminiProductImage({
                referenceImageBuffer: referenceBuffer,
                mimeType,
                roleConfig,
                product
            });
            console.log(`[AI IMAGE] Gemini completed: ${roleConfig.role} (${geminiResult.nativeResolution})`);

            // STEP 2: 8K Upscaling / Enhancement
            const upscaleResult = await upscaleImageTo8K(geminiResult.imageBuffer, {
                provider: process.env.UPSCALE_PROVIDER
            });
            console.log(`[AI IMAGE] Upscaling completed: ${upscaleResult.targetResolution}`);

            // STEP 3: Generate Website Derivatives (2400px, 1200px, 600px, 4096px)
            const derivatives = await generateWebsiteDerivatives(upscaleResult.buffer);

            // STEP 4: Store in Supabase Storage with clean hierarchy
            // product-images/<sku>/ai/<role>/...
            const roleSlug = roleConfig.role;
            const basePath = `${job.product_code}/ai/${roleSlug}`;

            // Upload 8K Master
            const master8kPath = `${basePath}/master_8k.webp`;
            const master8kUrl = await storageUpload(BUCKET, master8kPath, upscaleResult.buffer, 'image/webp');

            // Upload Native 4K Master
            const master4kPath = `${basePath}/master_4k.webp`;
            const master4kUrl = await storageUpload(BUCKET, master4kPath, geminiResult.imageBuffer, 'image/webp');

            // Upload Website Derivatives
            const derivativeUrls = {};
            for (const [key, d] of Object.entries(derivatives)) {
                const dPath = `${basePath}/${d.fileName}`;
                derivativeUrls[key] = await storageUpload(BUCKET, dPath, d.buffer, 'image/webp');
            }

            // Standard website image URL defaults to desktop 2400px derivative
            const websiteImageUrl = derivativeUrls.desktop || master8kUrl;

            // STEP 5: Record in product_images
            imageRecord.generation_status = 'completed';
            imageRecord.image_url = websiteImageUrl;
            imageRecord.master_8k_url = master8kUrl;
            imageRecord.master_4k_url = master4kUrl;
            imageRecord.derivative_urls = derivativeUrls;
            imageRecord.storage_path = master8kPath;
            imageRecord.width = upscaleResult.width;
            imageRecord.height = upscaleResult.height;
            imageRecord.resolution = `${upscaleResult.width}x${upscaleResult.height} (8K)`;
            imageRecord.generation_resolution = geminiResult.generationResolution || 'native_4k';
            imageRecord.is_native_4k = geminiResult.isNative4K ?? true;
            imageRecord.upscale_provider = upscaleResult.upscale_provider || 'sharp';
            imageRecord.upscale_method = upscaleResult.upscale_method || 'lanczos3_unsharp';
            imageRecord.upscale_quality = upscaleResult.upscale_quality || 'resampled_lanczos_8k';
            imageRecord.final_resolution = upscaleResult.final_resolution || '8K';
            imageRecord.is_primary = (roleConfig.sort_order === 1);

            job.completed_images += 1;
            saveLocalJob(job);

            // Persist to Supabase product_images table
            try {
                await dbInsert('product_images', {
                    id: imageRecord.id,
                    product_id: job.product_id,
                    product_code: job.product_code,
                    image_url: websiteImageUrl,
                    storage_path: master8kPath,
                    image_type: roleConfig.sort_order === 1 ? 'Main' : 'Gallery',
                    sort_order: roleConfig.sort_order,
                    alt_text: `${product.product_name || 'WishRite'} - ${roleConfig.name} - 8K AI Generated`,
                    is_primary: imageRecord.is_primary,
                    generation_source: 'gemini-ai',
                    generation_model: geminiResult.model,
                    generation_prompt: roleConfig.prompt,
                    resolution: imageRecord.resolution,
                    width: imageRecord.width,
                    height: imageRecord.height,
                    generation_resolution: imageRecord.generation_resolution,
                    is_native_4k: imageRecord.is_native_4k,
                    upscale_provider: imageRecord.upscale_provider,
                    upscale_method: imageRecord.upscale_method,
                    upscale_quality: imageRecord.upscale_quality,
                    generation_status: 'completed',
                    generation_job_id: jobId,
                    is_ai_generated: true,
                    image_role: roleConfig.role,
                    master_8k_url: master8kUrl,
                    master_4k_url: master4kUrl,
                    derivative_urls: derivativeUrls,
                    created_at: new Date().toISOString()
                });
            } catch (dbErr) {
                console.warn(`[AI Image Service] product_images insert skipped for ${roleConfig.role}:`, dbErr.message);
            }

            console.log(`[AI IMAGE] Image completed: ${roleConfig.role} (${job.completed_images}/${job.total_images})`);

        } catch (imgErr) {
            console.error(`[AI IMAGE] Failed generating ${roleConfig.role}:`, imgErr.message);
            imageRecord.generation_status = 'failed';
            imageRecord.error_message = imgErr.message;
            job.failed_images += 1;
            saveLocalJob(job);
        }

        // Update job progress in database
        try {
            await dbUpdate('ai_image_jobs', 'id', jobId, {
                completed_images: job.completed_images,
                failed_images: job.failed_images
            });
        } catch (e) {}
    }

    // Finalize overall job status
    job.completed_at = new Date().toISOString();
    if (job.failed_images === 0) {
        job.status = 'completed';
    } else if (job.completed_images > 0) {
        job.status = 'partial';
    } else {
        job.status = 'failed';
        job.error_message = 'All 10 AI image generations encountered errors.';
    }

    saveLocalJob(job);

    try {
        await dbUpdate('ai_image_jobs', 'id', jobId, {
            status: job.status,
            completed_images: job.completed_images,
            failed_images: job.failed_images,
            completed_at: job.completed_at,
            error_message: job.error_message
        });
    } catch (e) {}

    // Auto-update inventory primary image if product had no image
    if (job.completed_images > 0 && (!product.image_url || product.image_url.includes('placeholder'))) {
        const firstCompleted = job.images.find(img => img.generation_status === 'completed');
        if (firstCompleted && firstCompleted.image_url) {
            try {
                await dbUpdate('inventory', 'id', product.id, {
                    image_url: firstCompleted.image_url
                });
            } catch (e) {}
        }
    }

    console.log(`[AI IMAGE] Pipeline finalized for ${job.product_code}. Status: ${job.status} (${job.completed_images} completed, ${job.failed_images} failed)`);
}

/**
 * Section 16: Regenerate a single specific image role
 */
export async function regenerateSingleImage(productIdOrSku, imageIdOrRole, options = {}) {
    const roleConfig = getRoleConfig(imageIdOrRole);
    if (!roleConfig) {
        throw new Error(`Invalid image role or identifier '${imageIdOrRole}'.`);
    }

    const product = options.product || await findProduct(productIdOrSku);
    if (!product) {
        throw new Error(`Product '${productIdOrSku}' was not found.`);
    }

    const productCode = (product.product_code || 'SKU').toUpperCase().trim();

    // Locate source reference image
    const sourceImageUrl = product.original_source_image_url || product.image_url;
    if (!sourceImageUrl) {
        throw new Error(`Product ${productCode} has no original reference image to regenerate from.`);
    }

    console.log(`[AI IMAGE] Regenerating single image: ${roleConfig.role} for ${productCode}`);

    const { buffer: referenceBuffer, mimeType } = await fetchImageBuffer(sourceImageUrl);

    // Step 1: Gemini generation
    const geminiResult = await generateGeminiProductImage({
        referenceImageBuffer: referenceBuffer,
        mimeType,
        roleConfig,
        product
    });

    // Step 2: 8K Upscaling
    const upscaleResult = await upscaleImageTo8K(geminiResult.imageBuffer, {
        provider: process.env.UPSCALE_PROVIDER
    });

    // Step 3: Derivatives
    const derivatives = await generateWebsiteDerivatives(upscaleResult.buffer);

    // Step 4: Storage
    const basePath = `${productCode}/ai/${roleConfig.role}`;
    const master8kPath = `${basePath}/master_8k.webp`;
    const master8kUrl = await storageUpload(BUCKET, master8kPath, upscaleResult.buffer, 'image/webp');
    const master4kPath = `${basePath}/master_4k.webp`;
    const master4kUrl = await storageUpload(BUCKET, master4kPath, geminiResult.imageBuffer, 'image/webp');

    const derivativeUrls = {};
    for (const [key, d] of Object.entries(derivatives)) {
        const dPath = `${basePath}/${d.fileName}`;
        derivativeUrls[key] = await storageUpload(BUCKET, dPath, d.buffer, 'image/webp');
    }

    const websiteImageUrl = derivativeUrls.desktop || master8kUrl;

    const updatedImage = {
        product_id: product.id || productCode,
        product_code: productCode,
        image_role: roleConfig.role,
        role_name: roleConfig.name,
        sort_order: roleConfig.sort_order,
        image_url: websiteImageUrl,
        master_8k_url: master8kUrl,
        master_4k_url: master4kUrl,
        derivative_urls: derivativeUrls,
        storage_path: master8kPath,
        width: upscaleResult.width,
        height: upscaleResult.height,
        resolution: `${upscaleResult.width}x${upscaleResult.height} (8K)`,
        generation_resolution: geminiResult.generationResolution || 'native_4k',
        is_native_4k: geminiResult.isNative4K ?? true,
        upscale_provider: upscaleResult.upscale_provider || 'sharp',
        upscale_method: upscaleResult.upscale_method || 'lanczos3_unsharp',
        upscale_quality: upscaleResult.upscale_quality || 'resampled_lanczos_8k',
        generation_status: 'completed',
        generation_model: geminiResult.model,
        generation_prompt: roleConfig.prompt,
        generation_source: 'gemini-ai',
        is_ai_generated: true,
        updated_at: new Date().toISOString()
    };

    // Update in Supabase product_images table
    try {
        await dbUpdate('product_images', 'image_role', roleConfig.role, updatedImage);
    } catch (dbErr) {
        console.warn(`[AI Image Service] Regeneration dbUpdate skipped:`, dbErr.message);
    }

    // Also update any active cached job
    for (const job of activeJobs.values()) {
        if (job.product_code === productCode) {
            const found = job.images.find(img => img.image_role === roleConfig.role);
            if (found) {
                Object.assign(found, updatedImage);
                saveLocalJob(job);
            }
        }
    }

    return updatedImage;
}

/**
 * Get job status and images for a product
 */
export async function getProductAiStatus(productIdOrSku) {
    const product = await findProduct(productIdOrSku);
    const productCode = product ? product.product_code.toUpperCase().trim() : String(productIdOrSku).toUpperCase().trim();
    const productId = product ? product.id : productCode;

    // 1. Check in-memory active jobs
    for (const job of activeJobs.values()) {
        if (job.product_code === productCode || job.product_id === productId) {
            const pct = job.total_images > 0 ? Math.round((job.completed_images / job.total_images) * 100) : 0;
            return {
                has_job: true,
                job: {
                    ...job,
                    progress_percentage: pct
                }
            };
        }
    }

    // 2. Check local jobs file cache
    const localJobs = loadLocalJobs();
    for (const job of Object.values(localJobs)) {
        if (job.product_code === productCode || job.product_id === productId) {
            const pct = job.total_images > 0 ? Math.round((job.completed_images / job.total_images) * 100) : 0;
            return {
                has_job: true,
                job: {
                    ...job,
                    progress_percentage: pct
                }
            };
        }
    }

    // 3. Check Supabase product_images table for existing AI images
    try {
        const rows = await dbQuery('product_images', `product_code=eq.${encodeURIComponent(productCode)}&is_ai_generated=eq.true&order=sort_order.asc`);
        if (rows && rows.length > 0) {
            return {
                has_job: true,
                job: {
                    id: rows[0].generation_job_id || 'historical',
                    product_id: productId,
                    product_code: productCode,
                    status: 'completed',
                    total_images: rows.length,
                    completed_images: rows.filter(r => r.generation_status === 'completed').length,
                    failed_images: rows.filter(r => r.generation_status === 'failed').length,
                    progress_percentage: 100,
                    images: rows
                }
            };
        }
    } catch (e) {}

    return {
        has_job: false,
        job: null
    };
}

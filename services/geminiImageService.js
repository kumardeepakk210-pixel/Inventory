// ==============================================================================
// WISHRITE INVENTORY — GEMINI AI PRODUCT IMAGE SERVICE
// Formulates consistency-preserving prompts and calls Gemini API for high-resolution
// jewellery product photography generation.
// ==============================================================================

import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

/**
 * Section 9: Master Consistency Prompt for Jewellery
 * STRICT rule: AI MUST NOT redesign, reshape, or re-render jewellery geometry or stones.
 */
export const MASTER_PRODUCT_CONSISTENCY_PROMPT = `Use the uploaded reference image as the exact product reference.

Preserve the jewellery exactly as shown.

Do not redesign, reshape, modify, simplify, stylize, replace or reinterpret the product.

Preserve the exact:
- metal
- 925 sterling silver appearance
- stones
- stone count
- stone size
- stone placement
- setting
- chain
- clasp
- proportions
- dimensions
- engraving
- pattern
- geometry

The jewellery must remain visually identical to the reference.

Only change the photography environment, lighting, background, composition, camera angle, model or surrounding props where specifically requested.

The jewellery is always the hero subject.`;

/**
 * Section 8: Ten Standardized Image Roles with detailed, luxury photographic instructions
 */
/**
 * Section 8: Ten Standardized Image Roles with detailed, luxury photographic instructions
 */
export const AI_IMAGE_ROLES = [
    {
        role: '01_main_ecommerce',
        name: 'Main E-Commerce',
        sort_order: 1,
        aspect_ratio: '1:1',
        description: 'Clean pure white #FFFFFF background, soft studio lighting, commercial luxury look',
        prompt: 'Create a premium e-commerce product photograph on a clean pure white #FFFFFF background. Center the exact jewellery product. Show the complete product clearly. No unnecessary props. Soft professional studio lighting. Accurate silver appearance. Sharp edges and realistic material detail. Commercial luxury jewellery photography.'
    },
    {
        role: '02_premium_hero',
        name: 'Premium Hero',
        sort_order: 2,
        aspect_ratio: '1:1',
        description: 'Luxury WishRite campaign photograph, elegant deep maroon/emerald luxury setting',
        prompt: 'Create a high-end luxury WishRite jewellery campaign photograph. Use an elegant deep maroon/emerald luxury environment with subtle premium fabric texture. Keep the exact jewellery as the hero. Dramatic but controlled lighting. Sophisticated premium Indian luxury aesthetic.'
    },
    {
        role: '03_angle_45',
        name: '45° View',
        sort_order: 3,
        aspect_ratio: '1:1',
        description: 'Professional 45-degree product photography view showing depth, dimensions and construction',
        prompt: 'Create a professional 45-degree product photography view. Preserve the exact jewellery. Show depth, dimensions and construction clearly. Luxury studio lighting. Clean premium background.'
    },
    {
        role: '04_detail_closeup',
        name: 'Detail Close-Up',
        sort_order: 4,
        aspect_ratio: '1:1',
        description: 'Extreme high-detail close-up highlighting craftsmanship, silver finish and stones',
        prompt: 'Create an extreme high-detail close-up of the exact jewellery. Highlight craftsmanship, silver finish, stones and setting. Do not alter any product detail. Premium macro jewellery photography.'
    },
    {
        role: '05_luxury_lifestyle',
        name: 'Luxury Lifestyle',
        sort_order: 5,
        aspect_ratio: '1:1',
        description: 'Elegant luxury lifestyle setting with maroon, burgundy, emerald or ivory styling',
        prompt: 'Place the exact jewellery in an elegant luxury lifestyle setting. Use refined maroon, burgundy, emerald or ivory styling. Keep the product clearly visible and dominant. Avoid clutter.'
    },
    {
        role: '06_model_wearing',
        name: 'Model Wearing',
        sort_order: 6,
        aspect_ratio: '1:1',
        description: 'Naturally worn by an elegant adult Indian model in anatomically correct position',
        prompt: 'Show the exact jewellery naturally worn by an elegant adult Indian model. The exact uploaded jewellery must remain completely unchanged with zero redesign or simplification. The product must remain clearly visible, unobstructed and sharp. No additional jewellery replacing or competing with the hero product. High-end editorial styling and premium controlled lighting.'
    },
    {
        role: '07_gift_presentation',
        name: 'Gift Presentation',
        sort_order: 7,
        aspect_ratio: '1:1',
        description: 'WishRite luxury gift presentation with jewellery box and premium velvet fabric',
        prompt: 'Show the exact jewellery in a premium WishRite-inspired luxury gift presentation. Use elegant jewellery box, premium fabric and refined luxury styling. Product must remain clearly visible and unchanged.'
    },
    {
        role: '08_extreme_macro',
        name: 'Extreme Macro',
        sort_order: 8,
        aspect_ratio: '1:1',
        description: 'Extreme macro showing precise texture, silver finish and stone facets',
        prompt: 'Create an extreme macro photography image of the exact product. Show precise craftsmanship, texture, silver finish and stone details. Extremely sharp and premium.'
    },
    {
        role: '09_reverse_view',
        name: 'Reverse View',
        sort_order: 9,
        aspect_ratio: '1:1',
        description: 'Professional reverse/side view showing rear construction, hallmark and clasp/setting',
        prompt: 'Create a professional reverse/side product view. Show the construction and back/side details of the exact jewellery (e.g. hallmark, post, clasp, under-gallery) without modifying the design.'
    },
    {
        role: '10_size_reference',
        name: 'Size Reference',
        sort_order: 10,
        aspect_ratio: '1:1',
        description: 'Scale and dimension reference in an elegant neutral luxury setting',
        prompt: 'Create a premium product size-reference photograph showing the exact jewellery clearly and realistically. Use an elegant neutral setting and a tasteful scale reference where appropriate. Do not alter the actual dimensions of the product.'
    }
];

export function getRoleConfig(roleIdOrName) {
    if (!roleIdOrName) return null;
    const clean = String(roleIdOrName).trim().toLowerCase();
    return AI_IMAGE_ROLES.find(r => 
        r.role.toLowerCase() === clean || 
        r.name.toLowerCase() === clean ||
        r.role.toLowerCase().includes(clean)
    ) || null;
}

/**
 * Detect product category from inventory metadata, category string, product name, or SKU prefix.
 * Guarantees correct anatomical placement (never placing a bangle around a neck or necklace on a wrist).
 */
export function detectProductCategory(product = {}) {
    const rawCategory = (product.category || '').toLowerCase();
    const rawName = (product.product_name || '').toLowerCase();
    const rawSku = (product.product_code || '').toUpperCase();

    if (rawCategory.includes('earring') || rawCategory.includes('jhumka') || rawCategory.includes('stud') || 
        rawCategory.includes('bali') || rawName.includes('earring') || rawName.includes('jhumka') || 
        rawName.includes('stud') || rawSku.startsWith('ERN')) {
        return 'earring';
    }
    if (rawCategory.includes('necklace') || rawCategory.includes('choker') || rawCategory.includes('haar') || 
        rawCategory.includes('chain') || rawName.includes('necklace') || rawName.includes('choker') || 
        rawSku.startsWith('NKC')) {
        return 'necklace';
    }
    if (rawCategory.includes('pendant') || rawCategory.includes('locket') || rawName.includes('pendant') || 
        rawSku.startsWith('PDT')) {
        return 'pendant';
    }
    if (rawCategory.includes('ring') || rawCategory.includes('band') || rawName.includes('ring') || 
        rawName.includes('band') || rawSku.startsWith('RNG')) {
        return 'ring';
    }
    if (rawCategory.includes('bangle') || rawCategory.includes('kada') || rawCategory.includes('kangan') || 
        rawName.includes('bangle') || rawName.includes('kada') || rawSku.startsWith('BAN')) {
        return 'bangle';
    }
    if (rawCategory.includes('bracelet') || rawName.includes('bracelet') || rawSku.startsWith('BRL')) {
        return 'bracelet';
    }
    if (rawCategory.includes('mangalsutra') || rawName.includes('mangalsutra') || rawSku.startsWith('MNG')) {
        return 'mangalsutra';
    }
    if (rawCategory.includes('anklet') || rawCategory.includes('payal') || rawName.includes('anklet') || 
        rawName.includes('payal') || rawSku.startsWith('ANK')) {
        return 'anklet';
    }
    if (rawCategory.includes('nose') || rawName.includes('nose') || rawSku.startsWith('NOS')) {
        return 'nose_pin';
    }
    return 'jewellery';
}

/**
 * Returns category-specific anatomical and placement instructions for the Model Wearing role
 */
export function getCategoryAnatomicalGuidance(categoryKey) {
    switch (categoryKey) {
        case 'earring':
            return 'ANATOMICAL POSITIONING (EARRING): Worn naturally on the earlobe of an adult Indian model. The model\'s hair must be softly swept back or tucked behind the ear so the complete earring, drop, stones, and silver setting are 100% visible and unobstructed. Do NOT place earrings around the neck, wrist, or hand.';
        case 'necklace':
            return 'ANATOMICAL POSITIONING (NECKLACE): Worn gracefully around the neck and collarbone of an adult Indian model. Center the necklace perfectly on the neckline. Must be fully visible and unobstructed by fabric or hair. Do NOT place a necklace on the wrist or ear.';
        case 'pendant':
            return 'ANATOMICAL POSITIONING (PENDANT): Worn on a delicate silver chain around the neck, resting gracefully in the center of the upper chest/collarbone area of an adult Indian model. The pendant motif, bail, and stones must be sharply in focus and unobstructed. Do NOT place on wrists or fingers.';
        case 'ring':
            return 'ANATOMICAL POSITIONING (RING): Worn on the ring finger or middle finger of an adult Indian model\'s hand. Natural, elegant hand posture with clean, manicured nails. The ring face, band, and stone setting must be sharply in focus and completely unobstructed. Do NOT place a ring on neck or wrist.';
        case 'bangle':
            return 'ANATOMICAL POSITIONING (BANGLE): Worn naturally around the wrist / lower forearm of an adult Indian model. The bangle must maintain its exact circular diameter, silhouette, and finish. Resting naturally above the wrist joint. Do NOT place a bangle around the neck.';
        case 'bracelet':
            return 'ANATOMICAL POSITIONING (BRACELET): Worn comfortably clasped around the wrist of an adult Indian model. The chain, clasp, and motifs must remain completely unchanged, resting naturally on the wrist in an elegant relaxed arm pose.';
        case 'mangalsutra':
            return 'ANATOMICAL POSITIONING (MANGALSUTRA): Worn gracefully around the neck and collarbone of an adult Indian woman in contemporary luxury attire. The sacred black beads, silver pendant, and chain details must remain completely unchanged and prominent along the neckline.';
        case 'anklet':
            return 'ANATOMICAL POSITIONING (ANKLET): Worn delicately around the ankle of an adult Indian model, positioned just above the ankle bone. Bare foot in an elegant luxury lifestyle setting.';
        case 'nose_pin':
            return 'ANATOMICAL POSITIONING (NOSE PIN): Worn naturally on the nostril of an adult Indian model in an elegant profile portrait. Unobstructed and sharp.';
        default:
            return 'ANATOMICAL POSITIONING: Worn in its proper anatomically correct position on an adult Indian model according to the product type, fully visible and unobstructed.';
    }
}

/**
 * Builds the composite prompt combining Master Consistency + Product Context + Category Adaptation + Role Prompt
 */
export function buildCompositePrompt(roleConfig, product = {}) {
    const productName = product.product_name || 'Jewellery piece';
    const categoryKey = detectProductCategory(product);
    const category = product.category || categoryKey.toUpperCase();
    const material = product.material || '925 Sterling Silver';
    const audience = product.audience || 'Unisex';
    const sku = product.product_code || '';

    const productContext = `PRODUCT INFORMATION:
- Product Name: ${productName}
- Detected Category: ${categoryKey} (${category})
- Metal / Material: ${material}
- Audience: ${audience}
- SKU: ${sku}`;

    let roleTaskPrompt = roleConfig.prompt;

    // Adapt role 06 (model_wearing) with category-specific anatomical positioning
    if (roleConfig.role === '06_model_wearing') {
        const anatomicalGuidance = getCategoryAnatomicalGuidance(categoryKey);
        roleTaskPrompt = `${roleConfig.prompt}\n${anatomicalGuidance}\nSTRICT REQUIREMENT: Adult Indian model. The uploaded jewellery must remain 100% identical without any redesign, shape change, or stone replacement. Do NOT add competing jewellery.`;
    }

    // Adapt role 09 (reverse_view) with category-specific construction hints
    if (roleConfig.role === '09_reverse_view') {
        let reverseGuidance = '';
        if (categoryKey === 'earring') reverseGuidance = 'Show the post, scroll/butterfly back, and hallmark clearly.';
        else if (categoryKey === 'necklace' || categoryKey === 'bracelet') reverseGuidance = 'Show the clasp, extension links, and 925 silver stamp.';
        else if (categoryKey === 'ring') reverseGuidance = 'Show the inner shank, 925 hallmark, and under-gallery of the stone setting.';
        else if (categoryKey === 'bangle') reverseGuidance = 'Show the hinge, closure mechanism, or inner smooth polished surface.';
        if (reverseGuidance) roleTaskPrompt += ` ${reverseGuidance}`;
    }

    return `${MASTER_PRODUCT_CONSISTENCY_PROMPT}

${productContext}

IMAGE SPECIFIC TASK (${roleConfig.name.toUpperCase()}):
${roleTaskPrompt}

FINAL QUALITY REQUIREMENTS:
- 4K native output with pristine jewellery detail
- Pure 925 sterling silver natural brilliance and accurate specular reflection
- Zero distortion of jewellery facets, stones, setting or structure`;
}

/**
 * Calls Gemini Image Generation with the reference image
 * @param {Object} params
 * @param {Buffer} params.referenceImageBuffer - Raw high-resolution original image buffer
 * @param {string} params.mimeType - e.g. 'image/jpeg', 'image/png'
 * @param {Object} params.roleConfig - The target image role configuration
 * @param {Object} params.product - Product metadata
 * @returns {Promise<{imageBuffer: Buffer, width: number, height: number, model: string, nativeResolution: string, generationResolution: string, isNative4K: boolean, mimeType: string, sizeBytes: number, format: string}>}
 */
// ==============================================================================
// RATE LIMITING, QUEUE & RETRY LOGIC (CONCURRENCY: 1)
// ==============================================================================

let queueChain = Promise.resolve();
let inFlightTasks = 0;
let lastRequestEndTime = 0;

export function getQueueStatus() {
    return {
        concurrency: 1,
        inFlight: inFlightTasks,
        defaultDelayMs: Number(process.env.GEMINI_REQUEST_DELAY_MS ?? 10000),
        maxRetries: 3,
        retryDelaysMs: [10000, 30000, 60000]
    };
}

export function isRateLimitError(err) {
    if (!err) return false;
    const status = err.status || err.statusCode || err.code;
    const msg = String(err.message || '');
    return status === 429 || 
           msg.includes('429') || 
           msg.includes('RESOURCE_EXHAUSTED') || 
           msg.toLowerCase().includes('rate limit') || 
           msg.toLowerCase().includes('quota exceeded') ||
           msg.toLowerCase().includes('too many requests');
}

export function isUnavailableError(err) {
    if (!err) return false;
    const status = err.status || err.statusCode || err.code;
    const msg = String(err.message || '');
    return status === 503 || 
           msg.includes('503') || 
           msg.includes('UNAVAILABLE') || 
           msg.toLowerCase().includes('service unavailable');
}

export function isAuthError(err) {
    if (!err) return false;
    const status = err.status || err.statusCode || err.code;
    const msg = String(err.message || '');
    return status === 401 || 
           status === 403 || 
           msg.includes('401') || 
           msg.includes('403') || 
           msg.toLowerCase().includes('api key not valid') ||
           msg.toLowerCase().includes('unauthenticated') ||
           msg.toLowerCase().includes('permission_denied');
}

export function isClientError(err) {
    if (!err) return false;
    const status = err.status || err.statusCode || err.code;
    const msg = String(err.message || '');
    return status === 400 || 
           (msg.includes('400') && !msg.includes('429')) || 
           msg.includes('INVALID_ARGUMENT') ||
           msg.toLowerCase().includes('bad request');
}

export function extractRetryAfterMs(err) {
    if (!err) return null;
    if (err.response?.headers?.get) {
        const ra = err.response.headers.get('retry-after');
        if (ra) {
            const parsed = Number(ra);
            if (!isNaN(parsed) && parsed > 0) return parsed * 1000;
        }
    }
    const match = String(err.message || '').match(/retry\s+after\s+(\d+)\s*(s|sec|seconds)?/i);
    if (match && match[1]) {
        return Number(match[1]) * 1000;
    }
    return null;
}

/**
 * Enqueue a task to be executed strictly sequentially (concurrency: 1) with inter-request delay
 */
export function enqueueGeminiTask(taskFn, roleName = 'gemini-task') {
    const executeTask = async () => {
        inFlightTasks++;
        try {
            // Check and enforce inter-request delay
            const now = Date.now();
            const timeSinceLast = now - lastRequestEndTime;
            const configuredDelay = Number(process.env.GEMINI_REQUEST_DELAY_MS ?? 10000);
            const isTest = process.env.GEMINI_MOCK_MODE === 'true';
            const effectiveDelay = isTest ? Number(process.env.GEMINI_MOCK_DELAY_MS || 0) : configuredDelay;

            if (lastRequestEndTime > 0 && timeSinceLast < effectiveDelay) {
                const waitMs = effectiveDelay - timeSinceLast;
                const waitSec = Math.round(waitMs / 1000);
                console.log(`[AI Queue] Waiting ${waitSec > 0 ? waitSec : 1}s before next request`);
                await new Promise(r => setTimeout(r, waitMs));
            }

            console.log(`[AI Queue] Starting ${roleName}`);
            const result = await taskFn();
            console.log(`[AI Queue] Completed ${roleName}`);
            return result;
        } finally {
            lastRequestEndTime = Date.now();
            inFlightTasks--;
        }
    };

    // Chain to previous queue task, ensuring FIFO order and concurrency: 1
    const taskPromise = queueChain.then(executeTask, executeTask);
    queueChain = taskPromise.catch(() => {});
    return taskPromise;
}

/**
 * Calls Gemini Image Generation with the reference image
 * Wrapped in sequential queue with 429/503 exponential backoff retries.
 * @param {Object} params
 * @param {Buffer} params.referenceImageBuffer - Raw high-resolution original image buffer
 * @param {string} params.mimeType - e.g. 'image/jpeg', 'image/png'
 * @param {Object} params.roleConfig - The target image role configuration
 * @param {Object} params.product - Product metadata
 * @returns {Promise<{imageBuffer: Buffer, width: number, height: number, model: string, nativeResolution: string, generationResolution: string, isNative4K: boolean, mimeType: string, sizeBytes: number, format: string}>}
 */
export async function generateGeminiProductImage({ referenceImageBuffer, mimeType = 'image/jpeg', roleConfig, product = {} }) {
    const roleSlug = roleConfig?.role || 'gemini-image';

    return enqueueGeminiTask(async () => {
        const apiKey = (process.env.GEMINI_API_KEY || '').trim();
        const model = (process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image').trim();
        const isMockMode = process.env.GEMINI_MOCK_MODE === 'true' || apiKey === 'mock';

        // 1. Validation of API credentials
        if (!apiKey && !isMockMode) {
            throw new Error('GEMINI_API_KEY is not configured in server environment. Please set GEMINI_API_KEY in your .env file to generate live AI images.');
        }

        if (!referenceImageBuffer || !Buffer.isBuffer(referenceImageBuffer)) {
            throw new Error('Reference image buffer is required for consistent product generation');
        }

        const fullPrompt = buildCompositePrompt(roleConfig, product);

        // 2. Safe Mock Mode for local tests / offline dev verification
        if (isMockMode) {
            return await generateMockGeminiImage(referenceImageBuffer, roleConfig);
        }

        // 3. Live Google Gemini API execution with exponential backoff for 429 & 503
        console.log(`[AI IMAGE] Calling Gemini model '${model}' for role '${roleConfig.role}' requesting 4K`);

        const REQUEST_TIMEOUT_MS = 90000; // 90 seconds timeout
        const RETRY_DELAYS_MS = [10000, 30000, 60000]; // 10s, 30s, 60s
        const MAX_RETRIES = 3;

        let lastError = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const client = new GoogleGenAI({ apiKey });

                const base64Reference = referenceImageBuffer.toString('base64');
                const cleanMime = mimeType.includes('png') ? 'image/png' : 'image/jpeg';

                // Official Gemini Interactions API call for 4K Image Generation
                const apiCallPromise = client.interactions.create({
                    model: model,
                    input: [
                        {
                            type: 'image',
                            mime_type: cleanMime,
                            data: base64Reference
                        },
                        {
                            type: 'text',
                            text: fullPrompt
                        }
                    ],
                    response_format: {
                        type: 'image',
                        mime_type: 'image/jpeg',
                        aspect_ratio: roleConfig.aspect_ratio || '1:1',
                        image_size: '4K' // Must be uppercase '4K' per official API documentation
                    }
                });

                // Timeout race to prevent hanging requests
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Gemini API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)), REQUEST_TIMEOUT_MS)
                );

                const response = await Promise.race([apiCallPromise, timeoutPromise]);

                // Multi-strategy response image extraction
                let generatedBase64 = null;

                if (response?.output_image?.data) {
                    generatedBase64 = response.output_image.data;
                } else if (response?.output_image?.image_bytes) {
                    generatedBase64 = response.output_image.image_bytes;
                } else if (Array.isArray(response?.steps)) {
                    for (const step of response.steps) {
                        if (step.type === 'model_output' && Array.isArray(step.content)) {
                            const imgPart = step.content.find(c => (c.type === 'image' || c.image) && (c.data || c.image_bytes));
                            if (imgPart) {
                                generatedBase64 = imgPart.data || imgPart.image_bytes;
                                break;
                            }
                        }
                    }
                } else if (Array.isArray(response?.candidates)) {
                    const parts = response.candidates[0]?.content?.parts;
                    if (Array.isArray(parts)) {
                        const imgPart = parts.find(p => p.inlineData?.data || p.inline_data?.data);
                        if (imgPart) {
                            generatedBase64 = imgPart.inlineData?.data || imgPart.inline_data?.data;
                        }
                    }
                }

                if (!generatedBase64) {
                    const errorSummary = response?.output_text || response?.error?.message || 'No image data returned in API response';
                    throw new Error(`Gemini model '${model}' did not return an image: ${errorSummary}`);
                }

                const generatedBuffer = Buffer.from(generatedBase64, 'base64');
                
                // Inspect actual received image dimensions and byte size
                const meta = await sharp(generatedBuffer).metadata();
                const actualWidth = meta.width || 0;
                const actualHeight = meta.height || 0;
                const actualMime = meta.format ? `image/${meta.format}` : 'image/jpeg';
                const actualSize = generatedBuffer.length;

                // Verify if the output is genuinely 4K (4096x4096 for 1:1, or >= 3840 on primary axis)
                const isNative4K = actualWidth >= 3840 && actualHeight >= 3840;
                const generationResolution = isNative4K ? 'native_4k' : `${actualWidth}x${actualHeight}`;

                if (!isNative4K) {
                    console.warn(`[AI IMAGE] Notice: Gemini returned ${actualWidth}x${actualHeight} (requested 4K). Not labeled as native 4K.`);
                } else {
                    console.log(`[AI IMAGE] Verified Gemini native 4K output: ${actualWidth}x${actualHeight} (${(actualSize / 1024).toFixed(1)} KB)`);
                }

                return {
                    imageBuffer: generatedBuffer,
                    width: actualWidth,
                    height: actualHeight,
                    model: model,
                    nativeResolution: `${actualWidth}x${actualHeight}`,
                    generationResolution: generationResolution,
                    isNative4K: isNative4K,
                    mimeType: actualMime,
                    sizeBytes: actualSize,
                    format: meta.format || 'jpeg'
                };

            } catch (err) {
                lastError = err;
                const safeMsg = (err.message || 'Unknown error').replace(/key=[A-Za-z0-9_-]+/g, 'key=[REDACTED]');

                // Check error classifications
                const isAuth = isAuthError(err);
                const isClient = isClientError(err);
                const isRateLimit = isRateLimitError(err);
                const isUnavailable = isUnavailableError(err);

                // Do not retry 401, 403, 400
                if (isAuth || isClient) {
                    console.error(`[AI Queue] Non-retryable error for ${roleSlug}:`, safeMsg);
                    throw new Error(`Gemini image generation failed: ${safeMsg}`);
                }

                // If 429 or 503 and retries remain
                if ((isRateLimit || isUnavailable) && attempt < MAX_RETRIES) {
                    const suggestedDelay = RETRY_DELAYS_MS[attempt] || 60000;
                    const retryAfter = extractRetryAfterMs(err);
                    const waitMs = retryAfter ? Math.max(suggestedDelay, retryAfter) : suggestedDelay;
                    const waitSec = Math.round(waitMs / 1000);

                    const errName = isRateLimit ? '429' : '503';
                    console.log(`[AI Queue] Gemini ${errName} - retrying in ${waitSec}s`);

                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }

                // Exhausted retries or unhandled error
                console.error(`[AI Queue] Gemini generation failed for ${roleSlug}:`, safeMsg);
                throw new Error(`Gemini image generation failed: ${safeMsg}`);
            }
        }

        const finalMsg = (lastError?.message || 'Unknown error').replace(/key=[A-Za-z0-9_-]+/g, 'key=[REDACTED]');
        throw new Error(`Gemini image generation failed: ${finalMsg}`);
    }, roleSlug);
}

/**
 * Generate high-resolution mock image for offline test suites
 */
async function generateMockGeminiImage(referenceImageBuffer, roleConfig) {
    // Produce a clean 4K mock composite from reference
    const base = await sharp(referenceImageBuffer)
        .resize({ width: 4096, height: 4096, fit: 'inside' })
        .toBuffer();

    const composite = await sharp({
        create: {
            width: 4096,
            height: 4096,
            channels: 4,
            background: roleConfig.role === '01_main_ecommerce' 
                ? { r: 255, g: 255, b: 255, alpha: 1 }
                : { r: 94, g: 52, b: 53, alpha: 1 }
        }
    })
    .composite([{ input: base, gravity: 'center' }])
    .webp({ quality: 95 })
    .toBuffer();

    return {
        imageBuffer: composite,
        width: 4096,
        height: 4096,
        model: 'gemini-mock-test',
        nativeResolution: '4096x4096',
        generationResolution: 'native_4k',
        isNative4K: true,
        mimeType: 'image/webp',
        sizeBytes: composite.length,
        format: 'webp'
    };
}

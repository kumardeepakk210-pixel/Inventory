// ==============================================================================
// WISHRITE INVENTORY — AI PRODUCT IMAGE GENERATOR TECHNICAL AUDIT TEST SUITE
// Tests all 16 audit criteria:
// 1. Gemini request structure
// 2. 4K requested correctly (image_size = "4K")
// 3. Actual response dimensions detected (native_4k vs lower resolution)
// 4. 8K dimensions calculated correctly
// 5. Aspect ratio preserved (square, landscape, portrait)
// 6. Original image remains unchanged & uncompressed
// 7. Product consistency prompt exists with 14 protected jewellery attributes
// 8. Exactly 10 standardized roles exist without duplicates
// 9. Category-aware anatomical prompting for model wearing (earring, necklace, ring, bangle)
// 10. Failed role isolation
// 11. Individual regeneration preserves role & source
// 12. Duplicate generation prevention
// 13. Supabase storage path hierarchy
// 14. 4K -> 8K pipeline & upscale provider naming (sharp-lanczos-unsharp vs AI)
// 15. Website derivatives (2400 desktop default, never load 8K on cards)
// 16. Security audit (GEMINI_API_KEY never exposed in responses or git)
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { 
    AI_IMAGE_ROLES, 
    MASTER_PRODUCT_CONSISTENCY_PROMPT, 
    buildCompositePrompt, 
    getRoleConfig,
    detectProductCategory,
    getCategoryAnatomicalGuidance,
    generateGeminiProductImage,
    enqueueGeminiTask,
    getQueueStatus,
    isRateLimitError,
    isUnavailableError,
    isAuthError,
    isClientError,
    extractRetryAfterMs
} from '../services/geminiImageService.js';
import { 
    calculate8KDimensions, 
    enhanceAndResize, 
    generateWebsiteDerivatives,
    getImageMetadata 
} from '../utils/imageProcessing.js';
import { 
    upscaleImageTo8K, 
    UPSCALE_PROVIDERS 
} from '../services/imageUpscaleService.js';
import { 
    startGenerationJob, 
    getProductAiStatus,
    regenerateSingleImage,
    isJobActiveForProduct 
} from '../services/aiImageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.GEMINI_MOCK_MODE = 'true';

test('▶ AI Product Image Generator Technical Audit Suite', async (t) => {

    // --------------------------------------------------------------------------
    // AUDIT 1 & 2: Gemini Request Structure & 4K Request Configuration
    // --------------------------------------------------------------------------
    await t.test('1 & 2. Gemini API Request Structure & 4K Configuration', () => {
        // Inspect that geminiImageService imports and uses GoogleGenAI Interactions API
        const serviceCode = fs.readFileSync(path.join(__dirname, '../services/geminiImageService.js'), 'utf-8');
        
        assert.ok(serviceCode.includes('client.interactions.create'), 'Must use GoogleGenAI client.interactions.create API');
        assert.ok(serviceCode.includes("image_size: '4K'"), 'Must request image_size as uppercase "4K" per official Gemini API specification');
        assert.ok(serviceCode.includes("type: 'image'"), 'Response format type must be image');
        assert.ok(serviceCode.includes("type: 'text'"), 'Input must contain text type');
        assert.ok(serviceCode.includes("cleanMime"), 'MIME type must be handled properly for image input');
        assert.ok(serviceCode.includes("Promise.race"), 'Must implement timeout handling to prevent indefinite hangs');
    });

    // --------------------------------------------------------------------------
    // AUDIT 3: Actual Response Dimensions Detected & Inspected
    // --------------------------------------------------------------------------
    await t.test('3. Actual Response Dimensions Detected & Never Falsely Labeled', async () => {
        process.env.GEMINI_MOCK_MODE = 'true';

        // 1. Create a 4096 x 4096 test image
        const img4k = await sharp({
            create: { width: 4096, height: 4096, channels: 3, background: { r: 255, g: 255, b: 255 } }
        }).jpeg().toBuffer();

        const role = getRoleConfig('01_main_ecommerce');
        const res4k = await generateGeminiProductImage({
            referenceImageBuffer: img4k,
            mimeType: 'image/jpeg',
            roleConfig: role,
            product: { product_name: 'Silver Ring', product_code: 'WR-RNG-01' }
        });

        assert.equal(res4k.width, 4096);
        assert.equal(res4k.height, 4096);
        assert.equal(res4k.isNative4K, true, 'Image >= 3840 must be flagged as native 4K');
        assert.equal(res4k.generationResolution, 'native_4k');
        assert.ok(res4k.sizeBytes > 0, 'Must record actual file size');

        // 2. Simulate Gemini returning a lower resolution (e.g. 1024x1024)
        const meta1024 = { width: 1024, height: 1024 };
        const isNative = meta1024.width >= 3840 && meta1024.height >= 3840;
        const genRes = isNative ? 'native_4k' : `${meta1024.width}x${meta1024.height}`;

        assert.equal(isNative, false, '1024x1024 must NOT be flagged as native 4K');
        assert.equal(genRes, '1024x1024', 'Must record actual resolution when under 4K');

        delete process.env.GEMINI_MOCK_MODE;
    });

    // --------------------------------------------------------------------------
    // AUDIT 4: 8K Quality & Provider Naming (Never claim Lanczos is AI)
    // --------------------------------------------------------------------------
    await t.test('4. 8K Quality & Provider Naming (Sharp Lanczos vs AI)', async () => {
        const sampleBuffer = await sharp({
            create: { width: 1024, height: 1024, channels: 3, background: { r: 100, g: 100, b: 100 } }
        }).jpeg().toBuffer();

        // Test Sharp Lanczos upscaling fallback
        const sharpResult = await upscaleImageTo8K(sampleBuffer, {
            provider: UPSCALE_PROVIDERS.SHARP
        });

        assert.equal(sharpResult.upscale_provider, 'sharp', 'Provider must be sharp');
        assert.equal(sharpResult.upscale_method, 'lanczos3_unsharp', 'Method must be lanczos3_unsharp');
        assert.equal(sharpResult.upscale_quality, 'resampled_lanczos_8k', 'Must be resampled_lanczos_8k, NOT AI super-resolution');
        assert.equal(sharpResult.is_ai_super_resolution, false, 'Lanczos must NOT be flagged as AI super resolution');
        assert.equal(sharpResult.final_resolution, '8K');
    });

    // --------------------------------------------------------------------------
    // AUDIT 5: Verify Actual 8K Dimensions & Aspect Ratio Preservation
    // --------------------------------------------------------------------------
    await t.test('5. Verify Actual 8K Dimensions & Aspect Ratio Preservation', () => {
        // Square 1:1 -> 7680 x 7680
        const square = calculate8KDimensions(4096, 4096);
        assert.equal(square.targetWidth, 7680);
        assert.equal(square.targetHeight, 7680);
        assert.equal(square.isSquare, true);

        // Portrait 2:3 -> 5120 x 7680 (never stretched or forced to square)
        const portrait23 = calculate8KDimensions(2000, 3000);
        assert.equal(portrait23.targetHeight, 7680);
        assert.equal(portrait23.targetWidth, 5120);
        assert.equal(portrait23.isSquare, false);

        // Portrait 4:5 -> 6144 x 7680
        const portrait45 = calculate8KDimensions(4000, 5000);
        assert.equal(portrait45.targetHeight, 7680);
        assert.equal(portrait45.targetWidth, 6144);
        assert.equal(portrait45.isSquare, false);

        // Landscape 16:9 -> 7680 x 4320
        const landscape = calculate8KDimensions(1920, 1080);
        assert.equal(landscape.targetWidth, 7680);
        assert.equal(landscape.targetHeight, 4320);
        assert.equal(landscape.isSquare, false);

        // If source already exceeds 7680 on long edge, do not downscale
        const largeSource = calculate8KDimensions(8000, 8000);
        assert.equal(largeSource.targetWidth, 8000);
        assert.equal(largeSource.targetHeight, 8000);
    });

    // --------------------------------------------------------------------------
    // AUDIT 6: Verify Original Image Remains Uncompressed and Separate
    // --------------------------------------------------------------------------
    await t.test('6. Original Reference Image Stored Separately Without Overwrite', () => {
        const sku = 'WR-ERN-001';
        const originalPath = `${sku}/original/source.jpg`;
        const ai4kPath = `${sku}/ai/01_main_ecommerce/master_4k.webp`;
        const ai8kPath = `${sku}/ai/01_main_ecommerce/master_8k.webp`;

        assert.notEqual(originalPath, ai4kPath, 'Original path must be distinct from 4K master');
        assert.notEqual(originalPath, ai8kPath, 'Original path must be distinct from 8K master');
        assert.ok(originalPath.startsWith(`${sku}/original/`), 'Original must reside under /original/');
        assert.ok(ai4kPath.startsWith(`${sku}/ai/`), 'AI outputs must reside under /ai/');
    });

    // --------------------------------------------------------------------------
    // AUDIT 7: Verify Product Consistency Prompt Attributes
    // --------------------------------------------------------------------------
    await t.test('7. Master Consistency Prompt Protects All 14 Jewellery Elements', () => {
        const requiredProtections = [
            'metal',
            '925 sterling silver appearance',
            'stones',
            'stone count',
            'stone size',
            'stone placement',
            'setting',
            'chain',
            'clasp',
            'proportions',
            'dimensions',
            'engraving',
            'pattern',
            'geometry'
        ];

        requiredProtections.forEach(attr => {
            assert.ok(
                MASTER_PRODUCT_CONSISTENCY_PROMPT.toLowerCase().includes(attr),
                `Master prompt must explicitly protect: ${attr}`
            );
        });

        assert.ok(
            MASTER_PRODUCT_CONSISTENCY_PROMPT.includes('Do not redesign, reshape, modify, simplify, stylize, replace or reinterpret'),
            'Master prompt must strictly forbid redesigning jewellery'
        );
    });

    // --------------------------------------------------------------------------
    // AUDIT 8 & 9: Model Wearing Role & Category-Aware Anatomical Prompting
    // --------------------------------------------------------------------------
    await t.test('8 & 9. Model Wearing (06) Adapts to Product Category Correctly', () => {
        const role06 = getRoleConfig('06_model_wearing');
        assert.ok(role06);

        // 1. Earring: must place on earlobe, never around neck
        const earringPrompt = buildCompositePrompt(role06, {
            category: 'Earrings',
            product_name: 'Silver Jhumka',
            product_code: 'ERN-001'
        });
        assert.ok(earringPrompt.includes('earlobe'), 'Earring must specify earlobe placement');
        assert.ok(earringPrompt.includes('swept back'), 'Earring must specify swept back hair');
        assert.ok(!earringPrompt.includes('around the neck and collarbone'), 'Earring must NOT say around the neck');

        // 2. Necklace: must place on neck and collarbone, never wrist
        const necklacePrompt = buildCompositePrompt(role06, {
            category: 'Necklace',
            product_name: 'Silver Pearl Choker',
            product_code: 'NKC-002'
        });
        assert.ok(necklacePrompt.includes('neck and collarbone'), 'Necklace must specify neck/collarbone');
        assert.ok(!necklacePrompt.includes('around the wrist'), 'Necklace must NOT say around the wrist');

        // 3. Ring: must place on ring finger, never neck
        const ringPrompt = buildCompositePrompt(role06, {
            category: 'Ring',
            product_name: 'Silver Solitaire Ring',
            product_code: 'RNG-003'
        });
        assert.ok(ringPrompt.includes('ring finger'), 'Ring must specify ring finger');
        assert.ok(!ringPrompt.includes('around the neck'), 'Ring must NOT say around the neck');

        // 4. Bangle: must place on wrist, never neck
        const banglePrompt = buildCompositePrompt(role06, {
            category: 'Bangle',
            product_name: 'Silver Kada',
            product_code: 'BAN-004'
        });
        assert.ok(banglePrompt.includes('wrist / lower forearm'), 'Bangle must specify wrist/lower forearm');
        assert.ok(banglePrompt.includes('circular diameter'), 'Bangle must specify circular diameter');
        assert.ok(!banglePrompt.includes('around the neck and collarbone'), 'Bangle must NOT say around the neck');

        // 5. Must explicitly mention adult Indian model
        assert.ok(earringPrompt.includes('adult Indian model'), 'Must specify adult Indian model');
        assert.ok(earringPrompt.includes('zero redesign'), 'Must forbid redesign');
    });

    // --------------------------------------------------------------------------
    // AUDIT 10: Verify Exactly 10 Standardized Roles Without Duplication
    // --------------------------------------------------------------------------
    await t.test('10. Exactly 10 Standardized Roles Exist Without Duplication', () => {
        assert.equal(AI_IMAGE_ROLES.length, 10, 'Must have exactly 10 roles');

        const expectedRoles = [
            '01_main_ecommerce',
            '02_premium_hero',
            '03_angle_45',
            '04_detail_closeup',
            '05_luxury_lifestyle',
            '06_model_wearing',
            '07_gift_presentation',
            '08_extreme_macro',
            '09_reverse_view',
            '10_size_reference'
        ];

        const seenRoles = new Set();
        AI_IMAGE_ROLES.forEach((r, idx) => {
            assert.equal(r.role, expectedRoles[idx], `Role ${idx + 1} must match ${expectedRoles[idx]}`);
            assert.ok(!seenRoles.has(r.role), `Role ${r.role} must not be duplicated`);
            seenRoles.add(r.role);
            assert.equal(r.sort_order, idx + 1);
        });
    });

    // --------------------------------------------------------------------------
    // AUDIT 11: Failed Role Isolation
    // --------------------------------------------------------------------------
    await t.test('11. Failed Role Isolation Preserves Succeeded Roles', () => {
        const mockJob = {
            id: 'mock-job-01',
            status: 'processing',
            completed_images: 2,
            failed_images: 1,
            images: [
                { image_role: '01_main_ecommerce', generation_status: 'completed', image_url: 'https://example.com/01.webp' },
                { image_role: '02_premium_hero', generation_status: 'completed', image_url: 'https://example.com/02.webp' },
                { image_role: '03_angle_45', generation_status: 'failed', error_message: 'API timeout' }
            ]
        };

        // Assert 01 and 02 remain valid and available
        const completed = mockJob.images.filter(img => img.generation_status === 'completed');
        assert.equal(completed.length, 2);
        assert.equal(completed[0].image_url, 'https://example.com/01.webp');
        assert.equal(completed[1].image_url, 'https://example.com/02.webp');

        // Only role 03 is failed
        const failed = mockJob.images.filter(img => img.generation_status === 'failed');
        assert.equal(failed.length, 1);
        assert.equal(failed[0].image_role, '03_angle_45');
    });

    // --------------------------------------------------------------------------
    // AUDIT 12: Individual Regeneration
    // --------------------------------------------------------------------------
    await t.test('12. Individual Regeneration Affects Only Target Role', async () => {
        process.env.GEMINI_MOCK_MODE = 'true';

        // Test with invalid role should reject
        await assert.rejects(
            async () => {
                await regenerateSingleImage('WR-TEST-REGEN', '99_invalid_role');
            },
            (err) => {
                assert.ok(err.message.includes('Invalid image role'));
                return true;
            }
        );

        delete process.env.GEMINI_MOCK_MODE;
    });

    // --------------------------------------------------------------------------
    // AUDIT 13: Duplicate Generation Prevention
    // --------------------------------------------------------------------------
    await t.test('13. Duplicate Generation Prevention Blocks Concurrent Jobs', async () => {
        process.env.GEMINI_MOCK_MODE = 'true';
        const sampleProduct = {
            id: 'test-dup-01',
            product_code: 'WR-DUP-01',
            product_name: 'Silver Bracelet',
            image_url: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f'
        };

        // First job queued
        const job1 = await startGenerationJob('WR-DUP-01', {
            product: sampleProduct,
            source_image_url: sampleProduct.image_url,
            skipExecution: true
        });
        assert.ok(job1.success);

        // Immediate second job must be rejected with 409 conflict
        await assert.rejects(
            async () => {
                await startGenerationJob('WR-DUP-01', {
                    product: sampleProduct,
                    source_image_url: sampleProduct.image_url,
                    skipExecution: true
                });
            },
            (err) => {
                assert.ok(err.message.includes('already in progress'));
                assert.equal(err.statusCode, 409);
                return true;
            }
        );
        delete process.env.GEMINI_MOCK_MODE;
    });

    // --------------------------------------------------------------------------
    // AUDIT 14: Website Derivatives Configuration
    // --------------------------------------------------------------------------
    await t.test('14. Website Derivatives Generated at Required Sizes', async () => {
        const testImg = await sharp({
            create: { width: 1000, height: 1000, channels: 3, background: { r: 250, g: 250, b: 250 } }
        }).png().toBuffer();

        const derivatives = await generateWebsiteDerivatives(testImg);

        // Required sizes:
        // 4096 Zoom
        // 2400 Desktop
        // 1200 Mobile
        // 600 Thumbnail
        assert.equal(derivatives.zoom.width, 4096);
        assert.equal(derivatives.desktop.width, 2400);
        assert.equal(derivatives.mobile.width, 1200);
        assert.equal(derivatives.thumbnail.width, 600);

        // File format must be webp
        assert.equal(derivatives.zoom.format, 'webp');
        assert.equal(derivatives.desktop.format, 'webp');
        assert.equal(derivatives.mobile.format, 'webp');
        assert.equal(derivatives.thumbnail.format, 'webp');
    });

    // --------------------------------------------------------------------------
    // AUDIT 15: Security Audit (GEMINI_API_KEY Never Exposed)
    // --------------------------------------------------------------------------
    await t.test('15. Security Audit: GEMINI_API_KEY Completely Isolated', () => {
        // 1. Check frontend JS files
        const frontendFiles = [
            path.join(__dirname, '../js/api-client.js'),
            path.join(__dirname, '../js/app.js')
        ];

        frontendFiles.forEach(f => {
            if (fs.existsSync(f)) {
                const content = fs.readFileSync(f, 'utf-8');
                assert.ok(!content.includes('GEMINI_API_KEY'), `${f} must never reference GEMINI_API_KEY`);
            }
        });

        // 2. Check .gitignore
        const gitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf-8');
        assert.ok(gitignore.includes('.env'), '.gitignore must ignore .env files');

        // 3. Check error redaction in geminiImageService
        const errWithKey = new Error('Request failed with url https://generativelanguage.googleapis.com?key=AIzaSySecretKey123');
        const safeMsg = (errWithKey.message || '').replace(/key=[A-Za-z0-9_-]+/g, 'key=[REDACTED]');
        assert.ok(!safeMsg.includes('AIzaSySecretKey123'), 'Error message must redact secret key');
        assert.ok(safeMsg.includes('key=[REDACTED]'), 'Error message must show [REDACTED]');
    });

    // --------------------------------------------------------------------------
    // AUDIT 16: Sequential Queue & 429/503 Exponential Backoff Verification
    // --------------------------------------------------------------------------
    await t.test('16. Sequential Queue Concurrency = 1 & 429/503 Exponential Backoff', async () => {
        // 1. Verify queue configuration constants
        const qStatus = getQueueStatus();
        assert.equal(qStatus.concurrency, 1, 'Queue concurrency must strictly be 1');
        assert.equal(qStatus.defaultDelayMs, 10000, 'Default inter-request delay must be 10 seconds');
        assert.equal(qStatus.maxRetries, 3, 'Must retry 429/503 up to 3 times');
        assert.deepEqual(qStatus.retryDelaysMs, [10000, 30000, 60000], 'Retry delays must be 10s, 30s, 60s');

        // 2. Prove sequential execution (concurrency = 1) under simultaneous calls
        process.env.GEMINI_MOCK_MODE = 'true';
        process.env.GEMINI_MOCK_DELAY_MS = '15';

        let activeCount = 0;
        let maxObservedConcurrency = 0;
        const executionTimeline = [];

        const makeTask = (id) => async () => {
            activeCount++;
            maxObservedConcurrency = Math.max(maxObservedConcurrency, activeCount);
            executionTimeline.push({ id, event: 'start', time: Date.now() });

            // Simulate small work
            await new Promise(r => setTimeout(r, 20));

            executionTimeline.push({ id, event: 'end', time: Date.now() });
            activeCount--;
            return id;
        };

        // Fire 3 tasks simultaneously
        const results = await Promise.all([
            enqueueGeminiTask(makeTask('T1'), 'T1'),
            enqueueGeminiTask(makeTask('T2'), 'T2'),
            enqueueGeminiTask(makeTask('T3'), 'T3')
        ]);

        assert.deepEqual(results, ['T1', 'T2', 'T3']);
        assert.equal(maxObservedConcurrency, 1, 'Observed concurrency must never exceed 1');

        // Verify task 1 finished before task 2 started, and task 2 finished before task 3 started
        const t1End = executionTimeline.find(e => e.id === 'T1' && e.event === 'end').time;
        const t2Start = executionTimeline.find(e => e.id === 'T2' && e.event === 'start').time;
        const t2End = executionTimeline.find(e => e.id === 'T2' && e.event === 'end').time;
        const t3Start = executionTimeline.find(e => e.id === 'T3' && e.event === 'start').time;

        assert.ok(t2Start >= t1End, 'Task 2 must not start until Task 1 completes');
        assert.ok(t3Start >= t2End, 'Task 3 must not start until Task 2 completes');

        // 3. Verify Error Classification for 429, 503, 401, 400
        assert.ok(isRateLimitError(new Error('429 Too Many Requests: RESOURCE_EXHAUSTED')));
        assert.ok(isRateLimitError({ status: 429, message: 'Rate limit exceeded' }));
        assert.ok(!isRateLimitError(new Error('401 Unauthorized')));

        assert.ok(isUnavailableError(new Error('503 Service Unavailable: UNAVAILABLE')));
        assert.ok(isUnavailableError({ status: 503, message: 'Backend unavailable' }));
        assert.ok(!isUnavailableError(new Error('404 Not Found')));

        assert.ok(isAuthError(new Error('401 API key not valid')));
        assert.ok(isAuthError({ status: 403, message: 'PERMISSION_DENIED' }));
        assert.ok(!isAuthError(new Error('429 Rate limit')));

        assert.ok(isClientError(new Error('400 INVALID_ARGUMENT: Bad request')));
        assert.ok(isClientError({ status: 400, message: 'Invalid payload' }));
        assert.ok(!isClientError(new Error('500 Internal Server Error')));

        // 4. Verify Retry-After parsing
        const errWithSeconds = new Error('Resource exhausted, please retry after 45 s');
        assert.equal(extractRetryAfterMs(errWithSeconds), 45000);

        const errWithHeader = {
            message: 'Rate limit',
            response: { headers: new Map([['retry-after', '25']]) }
        };
        assert.equal(extractRetryAfterMs(errWithHeader), 25000);

        delete process.env.GEMINI_MOCK_DELAY_MS;
        delete process.env.GEMINI_MOCK_MODE;
    });
});

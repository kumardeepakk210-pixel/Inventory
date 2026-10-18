// ==============================================================================
// WISHRITE INVENTORY — UNIFIED 8K IMAGE ENHANCEMENT PIPELINE TEST SUITE
// Tests all required specifications:
// - Section 3 & 8: Single common enhanceImageTo8K implementation
// - Section 4 & 5: Exact jewellery preservation (no redesign / regeneration)
// - Section 6: 8K definition (7680px on long edge, aspect ratio preserved)
// - Section 7: Source image preserved (Upload + AI source)
// - Section 11 & 12: Canonical product_images metadata & lineage
// - Section 16: Failure behavior (source remains, retry available)
// - Section 17 & 26: Duplicate / Cost protection
// - Section 10 & 28: Server-side security audit (no keys client-side)
// - Section 23: TEST A — Normal upload
// - Section 24: TEST B — AI generation
// - Section 25: TEST C — Failure handling
// - Section 26: TEST D — Duplicate protection
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { 
    calculate8KDimensions, 
    enhanceAndResize, 
    generateWebsiteDerivatives,
    getImageMetadata 
} from '../utils/imageProcessing.js';
import { 
    enhanceImageTo8K, 
    upscaleImageTo8K, 
    getEnhancementStatus, 
    activeEnhancementJobs,
    UPSCALE_PROVIDERS 
} from '../services/imageUpscaleService.js';
import { 
    generateGeminiProductImage,
    getRoleConfig,
    MASTER_PRODUCT_CONSISTENCY_PROMPT
} from '../services/geminiImageService.js';
import { 
    startGenerationJob,
    getProductAiStatus,
    regenerateSingleImage
} from '../services/aiImageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('▶ UNIFIED 8K IMAGE ENHANCEMENT PIPELINE VERIFICATION SUITE', async (t) => {

    // --------------------------------------------------------------------------
    // TEST 1: Section 6 — 8K Definition: 7680px on LONG EDGE & Aspect Ratio
    // --------------------------------------------------------------------------
    await t.test('1. 8K Definition: 7680px on Long Edge, Preserving Aspect Ratio', () => {
        // 1:1 Square -> 7680 x 7680
        const square = calculate8KDimensions(1024, 1024);
        assert.equal(square.targetWidth, 7680);
        assert.equal(square.targetHeight, 7680);
        assert.equal(square.isSquare, true);

        // 2:3 Portrait -> 5120 x 7680
        const portrait23 = calculate8KDimensions(2000, 3000);
        assert.equal(portrait23.targetHeight, 7680);
        assert.equal(portrait23.targetWidth, 5120);
        assert.equal(portrait23.isSquare, false);

        // 4:5 Portrait -> 6144 x 7680
        const portrait45 = calculate8KDimensions(4000, 5000);
        assert.equal(portrait45.targetHeight, 7680);
        assert.equal(portrait45.targetWidth, 6144);
        assert.equal(portrait45.isSquare, false);

        // 16:9 Landscape -> 7680 x 4320
        const landscape169 = calculate8KDimensions(1920, 1080);
        assert.equal(landscape169.targetWidth, 7680);
        assert.equal(landscape169.targetHeight, 4320);
        assert.equal(landscape169.isSquare, false);

        // If source already exceeds 7680 on long edge, do not downscale
        const larger = calculate8KDimensions(8500, 8500);
        assert.equal(larger.targetWidth, 8500);
        assert.equal(larger.targetHeight, 8500);
    });

    // --------------------------------------------------------------------------
    // TEST 2: Section 23 — TEST A: NORMAL UPLOAD TO 8K MASTER PIPELINE
    // --------------------------------------------------------------------------
    await t.test('2. TEST A — Normal Upload Flow passes through Common 8K Pipeline', async () => {
        // Create realistic test jewellery image buffer (1024x1024 JPEG)
        const sourceBuffer = await sharp({
            create: {
                width: 1024,
                height: 1024,
                channels: 3,
                background: { r: 240, g: 240, b: 240 }
            }
        }).jpeg().toBuffer();

        const testSku = 'TEST-UPL-01';
        const testImageId = crypto.randomUUID();

        // Run common 8K enhancement pipeline
        const result = await enhanceImageTo8K(sourceBuffer, {
            productId: crypto.randomUUID(),
            productCode: testSku,
            sourceImageId: testImageId,
            sourceImageUrl: `https://example.com/${testSku}/source.jpg`,
            fileName: 'source.jpg',
            imageRole: '01_main_ecommerce',
            imageType: 'Main',
            isPrimary: true,
            sourceType: 'upload'
        });

        assert.equal(result.success, true, '8K enhancement must succeed');
        assert.ok(result.master_8k_url, 'Must generate master_8k_url');
        assert.equal(result.width, 7680, 'Long edge must be 7680px');
        assert.equal(result.height, 7680, 'Height must be 7680px for 1:1');
        assert.equal(result.resolution, '7680x7680 (8K)');
        assert.ok(result.derivative_urls, 'Must generate website derivatives');
        assert.ok(result.derivative_urls.desktop, 'Must generate desktop 2400px derivative');
        assert.ok(result.derivative_urls.mobile, 'Must generate mobile 1200px derivative');
        assert.ok(result.derivative_urls.thumbnail, 'Must generate thumbnail 600px derivative');
        assert.ok(result.derivative_urls.zoom, 'Must generate zoom 4096px derivative');

        // Verify enhanced record lineage
        assert.equal(result.enhanced_record.generation_source, 'enhancement', 'Lineage must be enhancement');
        assert.equal(result.enhanced_record.parent_image_id, testImageId, 'Must reference source image');
        assert.equal(result.enhanced_record.image_role, '01_main_ecommerce', 'Must preserve source image role');
    });

    // --------------------------------------------------------------------------
    // TEST 3: Section 24 — TEST B: AI GENERATION TO 8K MASTER PIPELINE
    // --------------------------------------------------------------------------
    await t.test('3. TEST B — AI Generation passes through the SAME Common 8K Pipeline', async () => {
        process.env.GEMINI_MOCK_MODE = 'true';

        // 1. Generate AI image (Gemini native 4K)
        const mockRef = await sharp({
            create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } }
        }).jpeg().toBuffer();

        const roleConfig = getRoleConfig('03_angle_45');
        const geminiResult = await generateGeminiProductImage({
            referenceImageBuffer: mockRef,
            mimeType: 'image/jpeg',
            roleConfig,
            product: { product_name: 'Silver Bracelet', product_code: 'TEST-AI-01' }
        });

        assert.ok(geminiResult.imageBuffer, 'Gemini must produce image buffer');

        const aiSourceId = crypto.randomUUID();
        const testSku = 'TEST-AI-01';

        // 2. Pass into the EXACT SAME common 8K enhancement pipeline
        const enhancement = await enhanceImageTo8K(geminiResult.imageBuffer, {
            productId: crypto.randomUUID(),
            productCode: testSku,
            sourceImageId: aiSourceId,
            sourceImageUrl: `https://example.com/${testSku}/ai/03_angle_45/master_4k.webp`,
            master4kUrl: `https://example.com/${testSku}/ai/03_angle_45/master_4k.webp`,
            imageRole: roleConfig.role,
            imageType: 'Gallery',
            isPrimary: false,
            sourceType: 'gemini',
            isAiGenerated: true
        });

        assert.equal(enhancement.success, true);
        assert.ok(enhancement.master_8k_url, 'Must generate master_8k_url');
        assert.equal(enhancement.width, 7680, 'Long edge must be 7680px');
        assert.equal(enhancement.height, 7680);
        assert.equal(enhancement.enhanced_record.parent_image_id, aiSourceId, 'Enhanced image references AI source image');
        assert.equal(enhancement.enhanced_record.image_role, '03_angle_45', 'Enhanced image preserves role');
        assert.equal(enhancement.enhanced_record.generation_source, 'enhancement', 'Enhanced lineage is enhancement');

        delete process.env.GEMINI_MOCK_MODE;
    });

    // --------------------------------------------------------------------------
    // TEST 4: Section 25 — TEST C: FAILURE SIMULATION & SOURCE PRESERVATION
    // --------------------------------------------------------------------------
    await t.test('4. TEST C — Enhancement Failure Preserves Source Image & Offers Retry', async () => {
        const sourceImageId = crypto.randomUUID();
        const testSku = 'TEST-FAIL-01';

        // Pass invalid buffer that causes enhancement failure
        const failedResult = await enhanceImageTo8K(Buffer.from('not-a-valid-image-bytes'), {
            productId: crypto.randomUUID(),
            productCode: testSku,
            sourceImageId,
            sourceImageUrl: `https://example.com/${testSku}/source.jpg`,
            imageRole: '01_main_ecommerce',
            sourceType: 'upload'
        });

        assert.equal(failedResult.success, false, 'Enhancement must report failure without unhandled crash');
        assert.equal(failedResult.can_retry, true, 'Retry must be available');
        assert.ok(failedResult.error, 'Must provide clear failure message');

        // Check active jobs registry records failed status
        const status = await getEnhancementStatus(sourceImageId);
        assert.ok(status, 'Status must exist in registry');
        assert.equal(status.status, 'failed', 'Status must be failed');
    });

    // --------------------------------------------------------------------------
    // TEST 5: Section 26 — TEST D: DUPLICATE & COST PROTECTION
    // --------------------------------------------------------------------------
    await t.test('5. TEST D — Duplicate / Cost Protection Prevents Redundant Processing', async () => {
        const sourceBuffer = await sharp({
            create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 200, b: 200 } }
        }).jpeg().toBuffer();

        const sourceImageId = crypto.randomUUID();
        const testSku = 'TEST-DUP-01';

        // First run: executes enhancement
        const firstRun = await enhanceImageTo8K(sourceBuffer, {
            productId: crypto.randomUUID(),
            productCode: testSku,
            sourceImageId,
            imageRole: '01_main_ecommerce',
            sourceType: 'upload'
        });

        assert.equal(firstRun.success, true);
        assert.equal(firstRun.is_duplicate_prevented, undefined, 'First run is not duplicate');

        // Second run with unchanged source: duplicate protection MUST kick in
        const secondRun = await enhanceImageTo8K(sourceBuffer, {
            productId: crypto.randomUUID(),
            productCode: testSku,
            sourceImageId,
            imageRole: '01_main_ecommerce',
            sourceType: 'upload'
        });

        assert.equal(secondRun.success, true);
        assert.equal(secondRun.is_duplicate_prevented, true, 'Second run must be intercepted by cost protection');
        assert.equal(secondRun.master_8k_url, firstRun.master_8k_url, 'Must reuse identical 8K master');
    });

    // --------------------------------------------------------------------------
    // TEST 6: Section 28 — SECURITY AUDIT: NO PRIVILEGED KEYS CLIENT-SIDE
    // --------------------------------------------------------------------------
    await t.test('6. Security Audit: Server Credentials Completely Isolated', () => {
        const frontendFiles = [
            path.join(__dirname, '../index.html'),
            path.join(__dirname, '../config.js'),
            path.join(__dirname, '../js/api-client.js')
        ];

        const forbiddenPatterns = [
            /GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/,
            /IMAGE_UPSCALE_API_KEY\s*=\s*['"][^'"]+['"]/,
            /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/,
            /sb_secret_[a-zA-Z0-9_-]+/
        ];

        for (const file of frontendFiles) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf-8');
                for (const pattern of forbiddenPatterns) {
                    assert.equal(pattern.test(content), false, `Forbidden secret matched in ${path.basename(file)}`);
                }
            }
        }
    });

    // --------------------------------------------------------------------------
    // TEST 7: Section 4 & 5 — Product Fidelity Rule: No Redesign Prompting
    // --------------------------------------------------------------------------
    await t.test('7. Product Fidelity: Master consistency prompt preserves all 14 attributes', () => {
        const prompt = MASTER_PRODUCT_CONSISTENCY_PROMPT.toLowerCase();
        const requiredTerms = [
            'preserve', 'metal', 'silver', 'stones', 'stone count', 'setting',
            'chain', 'clasp', 'proportions', 'dimensions', 'engraving', 'geometry'
        ];
        for (const term of requiredTerms) {
            assert.ok(prompt.includes(term), `Consistency prompt must strictly enforce '${term}'`);
        }
    });

});

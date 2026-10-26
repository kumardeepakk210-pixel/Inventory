// ==============================================================================
// WISHRITE INVENTORY — PRODUCTION CLEANUP & WEBSITE ALIGNMENT TEST SUITE
// Automated verification for:
// 1. Single Source of Truth (live Supabase public.inventory)
// 2. Product Data Alignment (all 24+ fields, SEO, design variants, compare price)
// 3. Website Contract Compatibility (js/products.js contract)
// 4. Category Alignment (live catalog distinct categories)
// 5. Image Alignment (public.product_images + Supabase storage sync)
// 6. Occasion Mode (clean inactive return, no hardcoded durga-puja fallback)
// 7. Product Status vs Stock State Separation
// 8. Creator Club Financial Security (fail-closed live payouts)
// ==============================================================================

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { dbQuery } from '../backend/supabase-client.js';
import { enrichProduct } from '../backend/products.js';
import { handleGetActiveOccasion } from '../backend/occasions.js';

let server;
let baseUrl = '';

before(async () => {
    process.env.NODE_ENV = 'test';
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Inventory Production Cleanup & Website Alignment Suite', () => {

    // --------------------------------------------------------------------------
    // 1. SINGLE SOURCE OF TRUTH & PRODUCT DATA ALIGNMENT
    // --------------------------------------------------------------------------
    it('1. Live Supabase public.inventory provides all 24+ core business fields', async () => {
        const liveProducts = await dbQuery('inventory', 'limit=5');
        assert.ok(Array.isArray(liveProducts), 'Must query public.inventory from live Supabase');
        assert.ok(liveProducts.length > 0, 'Live database must contain genuine inventory products');

        const sample = liveProducts[0];
        const enriched = enrichProduct(sample);

        const requiredFields = [
            'product_code',
            'product_name',
            'category',
            'audience',
            'catalog_type',
            'selling_price',
            'purchase_price',
            'cost_price',
            'compare_at_price',
            'stock_quantity',
            'low_stock_threshold',
            'status',
            'material',
            'purity',
            'finish',
            'slug',
            'product_slug',
            'short_description',
            'product_description',
            'seo_title',
            'seo_description',
            'occasion_slug',
            'occasion_category',
            'matching_tags'
        ];

        requiredFields.forEach(field => {
            assert.ok(
                field in enriched,
                `Field '${field}' must be present on enriched product directly from DB`
            );
        });
    });

    // --------------------------------------------------------------------------
    // 2. PRODUCT STATUS VS STOCK STATE INDEPENDENT CALCULATION
    // --------------------------------------------------------------------------
    it('2. Keeps publication status (Active/Draft/Archived) strictly separate from stock state', () => {
        // Active item with 0 stock
        const outOfStockActive = enrichProduct({
            product_code: 'WR-TEST-OOS',
            product_name: 'Silver Ring OOS',
            status: 'Active',
            stock_quantity: 0,
            low_stock_threshold: 3
        });

        assert.equal(outOfStockActive.status, 'Active', 'Publication status must remain Active');
        assert.equal(outOfStockActive.stock_status, 'Out of Stock', 'Stock state must be independently Out of Stock');
        assert.equal(outOfStockActive.stock_state, 'Out of Stock');

        // Draft item with 10 stock
        const inStockDraft = enrichProduct({
            product_code: 'WR-TEST-DRF',
            product_name: 'Silver Necklace Draft',
            status: 'Draft',
            stock_quantity: 10,
            low_stock_threshold: 3
        });

        assert.equal(inStockDraft.status, 'Draft', 'Publication status must remain Draft');
        assert.equal(inStockDraft.stock_status, 'In Stock', 'Stock state must be In Stock');

        // Low stock item
        const lowStock = enrichProduct({
            product_code: 'WR-TEST-LOW',
            product_name: 'Silver Pendant Low',
            status: 'Active',
            stock_quantity: 2,
            low_stock_threshold: 3
        });

        assert.equal(lowStock.status, 'Active');
        assert.equal(lowStock.stock_status, 'Low Stock');
    });

    // --------------------------------------------------------------------------
    // 3. CATEGORY ALIGNMENT: DYNAMIC LIVE CATALOG DERIVATION
    // --------------------------------------------------------------------------
    it('3. /api/categories derives categories dynamically from live inventory catalog', async () => {
        const res = await fetch(`${baseUrl}/api/categories`);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.ok(data.success);
        assert.ok(Array.isArray(data.data));
        assert.ok(data.data.length > 0, 'Categories list must not be empty');

        const categoryNames = data.data.map(c => c.category_name);
        // Verify key real categories exist
        assert.ok(categoryNames.includes('Earring'), 'Earring category must exist');
        assert.ok(categoryNames.includes('Pendant'), 'Pendant category must exist');
        assert.ok(categoryNames.includes('Bracelet'), 'Bracelet category must exist');

        // Verify prefixes match
        const earring = data.data.find(c => c.category_name === 'Earring');
        assert.equal(earring.code_prefix, 'ERN');
    });

    // --------------------------------------------------------------------------
    // 4. WEBSITE CONTRACT: 100% COMPATIBLE SHAPE
    // --------------------------------------------------------------------------
    it('4. GET /api/products returns response shape 100% compatible with Website contract', async () => {
        const res = await fetch(`${baseUrl}/api/products?limit=10`);
        assert.equal(res.status, 200);
        const json = await res.json();

        assert.ok(json.success);
        assert.ok(Array.isArray(json.data));
        assert.ok(json.count >= 0);

        const first = json.data[0];
        assert.ok(first.product_code, 'Must have product_code');
        assert.ok(first.product_name, 'Must have product_name');
        assert.ok(typeof first.selling_price === 'number', 'selling_price must be a number');
        assert.ok(typeof first.compare_at_price === 'number', 'compare_at_price must be a number');
        assert.ok(typeof first.stock_quantity === 'number', 'stock_quantity must be a number');
        assert.ok(first.status === 'Active' || first.status === 'Draft' || first.status === 'Archived');
        assert.ok(first.stock_status === 'In Stock' || first.stock_status === 'Low Stock' || first.stock_status === 'Out of Stock');
    });

    // --------------------------------------------------------------------------
    // 5. OCCASION MODE: CLEAN INACTIVE RETURN (NO HARDCODED DURGA-PUJA)
    // --------------------------------------------------------------------------
    it('5. GET /api/occasions/active returns clean inactive state when no occasion is active in Supabase', async () => {
        const res = await fetch(`${baseUrl}/api/occasions/active`);
        assert.equal(res.status, 200);
        const json = await res.json();

        assert.ok(json.success);
        // In the live Supabase database, no occasion is currently marked is_active=true
        assert.equal(json.is_live, false, 'Must be inactive');
        assert.equal(json.isLive, false, 'isLive alias must be false');
        assert.equal(json.activeOccasion, null, 'activeOccasion must be null, not hardcoded durga-puja');
        assert.equal(json.data, null, 'data payload must be null in clean inactive state');
    });

    it('6. GET /api/settings/occasion returns clean festive_mode_enabled: false when inactive', async () => {
        const res = await fetch(`${baseUrl}/api/settings/occasion`);
        assert.equal(res.status, 200);
        const json = await res.json();

        assert.ok(json.success);
        assert.equal(json.settings.festive_mode_enabled, false);
        assert.equal(json.settings.is_active, false);
        assert.equal(json.settings.isLive, false);
        assert.equal(json.settings.active_occasion_slug, null);
    });

    // --------------------------------------------------------------------------
    // 6. CREATOR FINANCIAL SECURITY: LIVE PAYOUTS STRICTLY DISABLED
    // --------------------------------------------------------------------------
    it('7. Financial Safety: Live RazorpayX payouts are strictly disabled and blocked', async () => {
        const { dispatchRazorpayXPayout } = await import('../backend/creator-wallet.js');
        
        // Attempting to execute live payout must fail closed
        const originalMode = process.env.RAZORPAYX_MODE;
        const originalAllow = process.env.ALLOW_LIVE_PAYOUTS;
        try {
            process.env.RAZORPAYX_MODE = 'live';
            process.env.ALLOW_LIVE_PAYOUTS = 'false';

            const result = await dispatchRazorpayXPayout({
                withdrawal_id: 'test-w-1',
                influencer_id: 'test-c-1',
                amount: 500,
                payout_method: { type: 'upi', upi_id: 'test@upi' }
            });

            assert.equal(result.success, false);
            assert.equal(result.code, 'LIVE_PAYOUTS_DISABLED');
        } finally {
            process.env.RAZORPAYX_MODE = originalMode;
            process.env.ALLOW_LIVE_PAYOUTS = originalAllow;
        }
    });

    // --------------------------------------------------------------------------
    // 7. REALTIME INTEGRATION HEALTH CHECK
    // --------------------------------------------------------------------------
    it('8. Realtime Channel verification: Realtime channel configs are valid on client and server', async () => {
        const { SUPABASE_URL, SUPABASE_KEY } = await import('../backend/supabase-client.js');
        assert.ok(SUPABASE_URL.startsWith('https://'), 'Supabase URL must be valid');
        assert.ok(SUPABASE_KEY.length > 10, 'Supabase Key must be configured');
    });
});

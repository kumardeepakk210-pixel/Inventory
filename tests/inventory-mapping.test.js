import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableColumnsCache } from '../api/supabase-client.js';
import { validateProductData, enrichProduct } from '../api/products.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Inventory Database Schema Mapping Tests', async (t) => {
    const expectedColumns = [
        'id',
        'product_code',
        'product_name',
        'product_description',
        'category',
        'stock_quantity',
        'purchase_price',
        'selling_price',
        'weight',
        'purchase_date',
        'shop_name',
        'shop_address',
        'created_at',
        'updated_at',
        'size',
        'storage_folder',
        'audience',
        'design_group',
        'variant_type',
        'variant_value',
        'product_slug'
    ];

    await t.test('1. Supabase client tableColumnsCache.inventory contains all 21 schema columns', () => {
        assert.ok(tableColumnsCache.inventory, 'tableColumnsCache.inventory should exist');
        for (const col of expectedColumns) {
            assert.ok(
                tableColumnsCache.inventory.has(col),
                `tableColumnsCache.inventory must include column '${col}'`
            );
        }
        assert.equal(tableColumnsCache.inventory.size, expectedColumns.length, 'Inventory cache should exactly match 21 columns');
    });

    await t.test('2. Product data validation enforces alphabet variant constraint', () => {
        // Valid alphabet variant (A-Z)
        const validAlphabet = {
            product_code: 'WR-TEST-001',
            product_name: 'Alphabet Pendant A',
            category: 'Pendants',
            audience: 'Female',
            selling_price: 1500,
            variant_type: 'alphabet',
            variant_value: 'A'
        };
        const errorsValid = validateProductData(validAlphabet, true);
        assert.deepEqual(errorsValid, []);

        // Invalid alphabet variant (lowercase, multi-char, numbers)
        const invalidAlphabet1 = {
            product_code: 'WR-TEST-002',
            product_name: 'Alphabet Pendant B',
            category: 'Pendants',
            audience: 'Female',
            selling_price: 1500,
            variant_type: 'alphabet',
            variant_value: 'ab'
        };
        const errors1 = validateProductData(invalidAlphabet1, true);
        assert.ok(errors1.some(e => e.includes('single uppercase letter (A-Z)')), 'Should reject multi-char alphabet');

        const invalidAlphabet2 = {
            product_code: 'WR-TEST-003',
            product_name: 'Alphabet Pendant 1',
            category: 'Pendants',
            audience: 'Female',
            selling_price: 1500,
            variant_type: 'alphabet',
            variant_value: '1'
        };
        const errors2 = validateProductData(invalidAlphabet2, true);
        assert.ok(errors2.some(e => e.includes('single uppercase letter (A-Z)')), 'Should reject digit alphabet');
    });

    await t.test('3. Product data validation enforces weight constraint', () => {
        const negativeWeight = {
            product_code: 'WR-TEST-004',
            product_name: 'Silver Ring',
            category: 'Rings',
            audience: 'Female',
            selling_price: 999,
            weight: -2.5
        };
        const errors = validateProductData(negativeWeight, true);
        assert.ok(errors.some(e => e.includes('Weight must be a non-negative number')), 'Should reject negative weight');

        const validWeight = {
            product_code: 'WR-TEST-005',
            product_name: 'Silver Ring',
            category: 'Rings',
            audience: 'Female',
            selling_price: 999,
            weight: 3.456
        };
        assert.deepEqual(validateProductData(validWeight, true), []);
    });

    await t.test('4. enrichProduct maps all 21 schema fields including design_group, variants, and product_slug', () => {
        const dbRow = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            product_code: 'WR-SLV-001',
            product_name: 'Classic Snake Silver Chain',
            product_description: 'Fine sterling silver chain',
            category: 'Chains',
            stock_quantity: 10,
            purchase_price: 1200.00,
            selling_price: 1999.00,
            weight: 12.500,
            purchase_date: '2026-01-15',
            shop_name: 'WishRite',
            shop_address: 'Main Store',
            created_at: '2026-01-15T00:00:00Z',
            updated_at: '2026-01-15T00:00:00Z',
            size: '18 inch',
            storage_folder: 'products/classic-snake-silver-chain-wr-slv-001',
            audience: 'Female',
            design_group: 'SNAKE-CHAIN',
            variant_type: 'size',
            variant_value: '18-inch',
            product_slug: 'classic-snake-silver-chain-wr-slv-001'
        };

        const enriched = enrichProduct(dbRow);
        assert.equal(enriched.design_group, 'SNAKE-CHAIN');
        assert.equal(enriched.variant_type, 'size');
        assert.equal(enriched.variant_value, '18-inch');
        assert.equal(enriched.product_slug, 'classic-snake-silver-chain-wr-slv-001');
        assert.equal(enriched.slug, 'classic-snake-silver-chain-wr-slv-001');
        assert.equal(enriched.storage_folder, 'products/classic-snake-silver-chain-wr-slv-001');
    });

    await t.test('5. Frontend index.html contains UI inputs, preview elements, and handlers for new schema columns', () => {
        const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

        // Inputs in Product Form Modal
        assert.ok(indexHtml.includes('id="pf-design-group"'), 'Should have pf-design-group input');
        assert.ok(indexHtml.includes('id="pf-variant-type"'), 'Should have pf-variant-type select');
        assert.ok(indexHtml.includes('id="pf-variant-value"'), 'Should have pf-variant-value input');
        assert.ok(indexHtml.includes('id="pf-storage-folder"'), 'Should have pf-storage-folder input');

        // Quick View Modal
        assert.ok(indexHtml.includes('id="pv-design-group"'), 'Should have pv-design-group display element');
        assert.ok(indexHtml.includes('id="pv-variant"'), 'Should have pv-variant display element');
        assert.ok(indexHtml.includes('id="pv-storage-folder"'), 'Should have pv-storage-folder display element');

        // JS event handlers
        assert.ok(indexHtml.includes('function onVariantTypeChanged()'), 'Should define onVariantTypeChanged');
        assert.ok(indexHtml.includes('function onVariantValueInput('), 'Should define onVariantValueInput');
        assert.ok(indexHtml.includes('openProductFormModal'), 'Should have openProductFormModal');
        assert.ok(indexHtml.includes('handleProductFormSubmit'), 'Should have handleProductFormSubmit');
    });

    await t.test('6. handleUpdateProduct safely handles null variant_type, variant_value, and product_slug', async () => {
        const { handleUpdateProduct } = await import('../api/products.js');
        const req = {
            params: { id: 'MISC' },
            body: {
                product_code: 'MISC',
                product_name: 'Thread',
                variant_type: null,
                variant_value: null,
                product_slug: null
            }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseJson = data;
                return this;
            }
        };

        await handleUpdateProduct(req, res);
        if (responseJson && responseJson.error) {
            assert.notEqual(
                responseJson.error.message,
                "Cannot read properties of null (reading 'toLowerCase')",
                "Must not fail with null toLowerCase"
            );
        }
    });
});


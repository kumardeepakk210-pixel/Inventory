import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_AUDIENCES, AUDIENCE_VALUES, normalizeAudience } from '../backend/products.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Canonical Audience System Tests', () => {

    it('1. Canonical values list contains only Female, Male, Boys, Girls and NEVER Kids', () => {
        assert.equal(CANONICAL_AUDIENCES.length, 4);
        assert.deepEqual(CANONICAL_AUDIENCES, ['Female', 'Male', 'Boys', 'Girls']);
        assert.equal(CANONICAL_AUDIENCES.includes('Kids'), false, "CANONICAL_AUDIENCES must NEVER contain 'Kids'");
        assert.equal(CANONICAL_AUDIENCES.includes('Unassigned'), false, "CANONICAL_AUDIENCES must not contain 'Unassigned' as a persisted value");
    });

    it('2. Audience normalization handles case variations and rejects invalid values including "Kids"', () => {
        // Valid mappings to database constraint
        assert.equal(normalizeAudience('Male'), 'Male');
        assert.equal(normalizeAudience('male'), 'Male');
        assert.equal(normalizeAudience('MEN'), 'Male');
        assert.equal(normalizeAudience('mens'), 'Male');

        assert.equal(normalizeAudience('Female'), 'Female');
        assert.equal(normalizeAudience('female'), 'Female');
        assert.equal(normalizeAudience('WOMEN'), 'Female');
        assert.equal(normalizeAudience('womens'), 'Female');

        assert.equal(normalizeAudience('Boys'), 'Boys');
        assert.equal(normalizeAudience('boy'), 'Boys');
        assert.equal(normalizeAudience('BOYS'), 'Boys');
        assert.equal(normalizeAudience('Kids-Boy'), 'Boys');

        assert.equal(normalizeAudience('Girls'), 'Girls');
        assert.equal(normalizeAudience('girl'), 'Girls');
        assert.equal(normalizeAudience('GIRLS'), 'Girls');
        assert.equal(normalizeAudience('Kids-Girl'), 'Girls');

        // Rejections (Must return null)
        assert.equal(normalizeAudience('Kids'), null, "'Kids' must normalize to null (never persisted directly)");
        assert.equal(normalizeAudience('children'), null);
        assert.equal(normalizeAudience('unisex'), null);
        assert.equal(normalizeAudience('Unassigned'), null);
        assert.equal(normalizeAudience(''), null);
        assert.equal(normalizeAudience(null), null);
        assert.equal(normalizeAudience(undefined), null);
    });

    it('3. Dashboard audience metrics calculate Kids as Boys + Girls without double counting', () => {
        const sampleInventory = [
            { product_code: 'P1', audience: 'Female', stock_quantity: 5, selling_price: 1000 },
            { product_code: 'P2', audience: 'Female', stock_quantity: 3, selling_price: 1500 },
            { product_code: 'P3', audience: 'Male', stock_quantity: 2, selling_price: 2000 },
            { product_code: 'P4', audience: 'Boys', stock_quantity: 4, selling_price: 800 },
            { product_code: 'P5', audience: 'Girls', stock_quantity: 6, selling_price: 900 },
            { product_code: 'P6', audience: null, stock_quantity: 1, selling_price: 500 }, // legacy unassigned
            { product_code: 'P7', audience: '', stock_quantity: 2, selling_price: 600 }     // empty unassigned
        ];

        let femaleCount = 0, maleCount = 0, boysCount = 0, girlsCount = 0, unassignedCount = 0;
        let femaleStock = 0, maleStock = 0, boysStock = 0, girlsStock = 0, unassignedStock = 0;

        sampleInventory.forEach(item => {
            const aud = item.audience;
            const stock = Number(item.stock_quantity) || 0;
            if (aud === 'Female') {
                femaleCount++;
                femaleStock += stock;
            } else if (aud === 'Male') {
                maleCount++;
                maleStock += stock;
            } else if (aud === 'Boys') {
                boysCount++;
                boysStock += stock;
            } else if (aud === 'Girls') {
                girlsCount++;
                girlsStock += stock;
            } else {
                unassignedCount++;
                unassignedStock += stock;
            }
        });

        const kidsCount = boysCount + girlsCount;
        const kidsStock = boysStock + girlsStock;

        assert.equal(femaleCount, 2);
        assert.equal(maleCount, 1);
        assert.equal(boysCount, 1);
        assert.equal(girlsCount, 1);
        assert.equal(kidsCount, 2, "Kids count must exactly equal Boys + Girls");
        assert.equal(unassignedCount, 2, "Unassigned must account for null/empty records");

        // Total check
        const totalCount = femaleCount + maleCount + boysCount + girlsCount + unassignedCount;
        assert.equal(totalCount, sampleInventory.length, "Total must equal sum of all subsets without double counting");

        assert.equal(femaleStock, 8);
        assert.equal(maleStock, 2);
        assert.equal(boysStock, 4);
        assert.equal(girlsStock, 6);
        assert.equal(kidsStock, 10, "Kids stock must equal Boys stock + Girls stock");
        assert.equal(unassignedStock, 3);
    });

    it('4. Supabase client tableColumnsCache includes audience column', async () => {
        const clientFile = fs.readFileSync(path.join(rootDir, 'backend', 'supabase-client.js'), 'utf-8');
        assert.match(clientFile, /'audience'/, "backend/supabase-client.js must include 'audience' in tableColumnsCache");
    });

    it('5. Database migration script contains strict CHECK constraint and index', () => {
        const sqlFile = fs.readFileSync(path.join(rootDir, 'supabase-audience-migration.sql'), 'utf-8');
        assert.match(sqlFile, /ADD COLUMN IF NOT EXISTS audience text/i, "Migration must add audience column");
        assert.match(sqlFile, /chk_inventory_audience/i, "Migration must define chk_inventory_audience constraint");
        assert.match(sqlFile, /'Male',\s*'Female',\s*'Boys',\s*'Girls'/i, "Migration check constraint must contain Male, Female, Boys, Girls");
        assert.doesNotMatch(sqlFile, /'Kids'/i, "Migration check constraint must NOT permit 'Kids'");
        assert.match(sqlFile, /idx_inventory_audience/i, "Migration must create idx_inventory_audience index");
    });

    it('6. Products API endpoint validates audience and handles backfill', async () => {
        const productsApiFile = fs.readFileSync(path.join(rootDir, 'backend', 'products.js'), 'utf-8');
        assert.match(productsApiFile, /CANONICAL_AUDIENCES/, "backend/products.js must declare CANONICAL_AUDIENCES");
        assert.match(productsApiFile, /handleBatchBackfillAudience/, "backend/products.js must export handleBatchBackfillAudience");
        assert.match(productsApiFile, /normalizeAudience/, "backend/products.js must normalize audience inputs");
    });

    it('7. Frontend index.html implements audience selector, badges, and backfill controller', () => {
        const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
        assert.match(indexHtml, /getAudienceBadgeHtml/, "index.html must implement getAudienceBadgeHtml");
        assert.match(indexHtml, /setProductAudiencePrimary/, "index.html must implement setProductAudiencePrimary");
        assert.match(indexHtml, /setProductAudienceSub/, "index.html must implement setProductAudienceSub");
        assert.match(indexHtml, /exportProductsToExcel/, "index.html must implement exportProductsToExcel");
        assert.match(indexHtml, /openAudienceBackfillModal/, "index.html must implement openAudienceBackfillModal");
        assert.match(indexHtml, /submitAudienceBackfill/, "index.html must implement submitAudienceBackfill");
        assert.match(indexHtml, /id="audience-backfill-modal"/, "index.html must contain audience-backfill-modal dialog");
    });
});

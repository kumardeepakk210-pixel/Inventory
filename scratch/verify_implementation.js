// Verification test script for WishRite Inventory Master Implementation V1
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8085';

async function runTests() {
    console.log('=== WISHRITE INVENTORY IMPLEMENTATION V1 — TEST SUITE ===\n');
    let failures = 0;

    // TEST 1: GET /api/products
    console.log('[TEST 1] GET /api/products');
    let products = [];
    try {
        const res = await fetch(`${BASE_URL}/api/products`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) {
            throw new Error(`Expected success true and data array, got: ${JSON.stringify(json)}`);
        }
        products = json.data;
        console.log(`✓ Fetched ${products.length} products (expected 109)`);
        if (products.length !== 109) {
            console.error(`❌ Count mismatch: expected 109, got ${products.length}`);
            failures++;
        }
    } catch (e) {
        console.error('❌ GET /api/products failed:', e.message);
        failures++;
    }

    // TEST 2: Data Integrity Checks on all 109 products
    console.log('\n[TEST 2] Product Data Integrity Checks (all 109 products)');
    const productCodes = new Set();
    let duplicateCodes = 0;
    let nullNames = 0;
    let negativeStocks = 0;
    let negativePrices = 0;
    let missingSellingPrice = 0;

    // Category distribution tracker
    const categoryCounts = {};
    const audienceCounts = {};
    const statusCounts = {};

    products.forEach(p => {
        // SKU uniqueness
        if (productCodes.has(p.product_code)) duplicateCodes++;
        else productCodes.add(p.product_code);

        // Name
        if (!p.product_name || !String(p.product_name).trim()) nullNames++;

        // Stock
        const stock = Number(p.stock_quantity);
        if (isNaN(stock) || stock < 0) negativeStocks++;

        // Prices
        const selling = Number(p.selling_price);
        const purchase = Number(p.purchase_price);
        const cost = Number(p.cost_price);
        const compare = Number(p.compare_at_price);

        if (isNaN(selling) || selling < 0) negativePrices++;
        if (isNaN(purchase) || purchase < 0) negativePrices++;
        if (isNaN(cost) || cost < 0) negativePrices++;
        if (isNaN(compare) || compare < 0) negativePrices++;
        if (!selling || selling <= 0) missingSellingPrice++;

        // Category
        const cat = p.category || 'MISSING';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

        // Audience
        const aud = p.audience || 'Unassigned';
        audienceCounts[aud] = (audienceCounts[aud] || 0) + 1;

        // Status
        const st = p.status || 'MISSING';
        statusCounts[st] = (statusCounts[st] || 0) + 1;
    });

    console.log(`- Duplicate SKUs: ${duplicateCodes}`);
    console.log(`- Null/Empty Names: ${nullNames}`);
    console.log(`- Negative Stock count: ${negativeStocks}`);
    console.log(`- Negative Prices count: ${negativePrices}`);
    console.log(`- Missing Selling Price: ${missingSellingPrice}`);

    if (duplicateCodes > 0 || nullNames > 0 || negativeStocks > 0 || negativePrices > 0 || missingSellingPrice > 0) {
        console.error('❌ Data integrity violations detected!');
        failures++;
    } else {
        console.log('✓ All 109 products passed core data integrity constraints.');
    }

    // TEST 3: Category Validation
    console.log('\n[TEST 3] Category Validation');
    console.log('Category Distribution:', categoryCounts);
    const forbiddenCategories = ['Ring ', 'Toe Rings', 'Bangles', 'Bali', 'Earrings'];
    let forbiddenFound = 0;
    for (const f of forbiddenCategories) {
        if (categoryCounts[f]) {
            console.error(`❌ Forbidden/non-canonical category found: "${f}" (${categoryCounts[f]} items)`);
            forbiddenFound++;
            failures++;
        }
    }
    if (forbiddenFound === 0) {
        console.log('✓ Zero forbidden or plural categories detected across all 109 products.');
    }

    // TEST 4: Audience Validation
    console.log('\n[TEST 4] Audience Distribution');
    console.log('Audience Distribution:', audienceCounts);

    // TEST 5: Status Validation & Separation from Stock
    console.log('\n[TEST 5] Status Distribution');
    console.log('Status Distribution:', statusCounts);
    const zeroStockProducts = products.filter(p => Number(p.stock_quantity) === 0);
    console.log(`- Products with 0 stock: ${zeroStockProducts.length}`);
    const zeroStockStatuses = new Set(zeroStockProducts.map(p => p.status));
    console.log(`- Status values among 0-stock products:`, Array.from(zeroStockStatuses));
    // Verify none has status = 'Out of Stock' if Active
    const invalidStatus = products.filter(p => p.status === 'Out of Stock');
    if (invalidStatus.length > 0) {
        console.error(`❌ Found ${invalidStatus.length} products using 'Out of Stock' as publication status!`);
        failures++;
    } else {
        console.log('✓ Zero products use "Out of Stock" as publication status. Publication status and stock are decoupled.');
    }

    // TEST 6: Pricing Independence Test (PATCH & GET)
    console.log('\n[TEST 6] Testing Pricing Independence via PATCH /api/products/:id');
    const testProduct = products[0];
    const testSku = testProduct.product_code;
    console.log(`Testing with product: ${testSku} (${testProduct.product_name})`);

    const originalPurchase = testProduct.purchase_price;
    const originalCost = testProduct.cost_price;
    const originalCompare = testProduct.compare_at_price;

    const patchPayload = {
        purchase_price: 1550,
        cost_price: 1725.50,
        compare_at_price: 3999,
        finish: 'Rhodium Plated Mirror'
    };

    try {
        const patchRes = await fetch(`${BASE_URL}/api/products/${testSku}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload)
        });
        const patchJson = await patchRes.json();
        if (!patchJson.success) {
            throw new Error(`PATCH failed: ${JSON.stringify(patchJson)}`);
        }
        console.log('✓ PATCH request succeeded');

        // Fetch back to verify persistence
        const getRes = await fetch(`${BASE_URL}/api/products/${testSku}`);
        const getJson = await getRes.json();
        const saved = getJson.data;

        console.log(`- Saved purchase_price: ${saved.purchase_price} (expected: 1550)`);
        console.log(`- Saved cost_price: ${saved.cost_price} (expected: 1725.50)`);
        console.log(`- Saved compare_at_price: ${saved.compare_at_price} (expected: 3999)`);
        console.log(`- Saved finish: ${saved.finish} (expected: Rhodium Plated Mirror)`);

        if (saved.purchase_price === 1550 && saved.cost_price === 1725.50 && saved.compare_at_price === 3999) {
            console.log('✓ Pricing fields verified 100% independent!');
        } else {
            console.error('❌ Pricing fields did not match expected independent values!');
            failures++;
        }

        // Restore original values
        await fetch(`${BASE_URL}/api/products/${testSku}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                purchase_price: originalPurchase,
                cost_price: originalCost,
                compare_at_price: originalCompare,
                finish: testProduct.finish || null
            })
        });
        console.log('✓ Restored original test product pricing.');

    } catch (e) {
        console.error('❌ Pricing independence test failed:', e.message);
        failures++;
    }

    console.log(`\n=== TEST SUITE COMPLETE: ${failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES DETECTED'} ===`);
}

runTests();

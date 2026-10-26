// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3A TEST SUITE
// Tests Secure Creator Authentication, Account Mapping, Role-Based Access Control,
// Data Isolation, Privacy Protection (Zero PII), Performance Metrics, Referral Links,
// Permitted vs Forbidden Profile Updates, and Regression Safety.
// ==============================================================================

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    hashPassword, 
    issueCreatorSession 
} from '../backend/creator.js';
import { 
    trackInfluencerClick, 
    attributeOrderToInfluencer 
} from '../backend/influencers.js';

let server;
let baseUrl = '';

// Test Creators
let creatorA = null;
let creatorB = null;
let inactiveCreator = null;
let tokenA = '';
let tokenB = '';

async function createTestInfluencer(payload) {
    const res = await fetch(`${baseUrl}/api/influencers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    return json.data;
}

before(async () => {
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    const timestamp = Date.now();

    // 1. Create active Creator A
    creatorA = await createTestInfluencer({
        name: 'Aarya Sharma',
        email: `aarya_${timestamp}@example.com`,
        instagram_id: `aarya_${timestamp}`,
        bio: 'Luxury jewelry influencer',
        commission_rate: 12,
        status: 'active'
    });

    // Link account for Creator A
    await getOrLinkInfluencerAccount({
        email: creatorA.email,
        influencer_id: creatorA.id,
        password: 'PasswordA123!'
    });

    // 2. Create active Creator B
    creatorB = await createTestInfluencer({
        name: 'Rohan Verma',
        email: `rohan_${timestamp}@example.com`,
        instagram_id: `rohan_${timestamp}`,
        bio: 'Men silver collection curator',
        commission_rate: 15,
        status: 'active'
    });

    // Link account for Creator B
    await getOrLinkInfluencerAccount({
        email: creatorB.email,
        influencer_id: creatorB.id,
        password: 'PasswordB123!'
    });

    // 3. Create inactive Creator
    inactiveCreator = await createTestInfluencer({
        name: 'Inactive Tester',
        email: `inactive_${timestamp}@example.com`,
        instagram_id: `inactive_${timestamp}`,
        commission_rate: 10,
        status: 'inactive'
    });

    // Explicitly update status to inactive
    await fetch(`${baseUrl}/api/influencers/${inactiveCreator.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive' })
    });
    inactiveCreator.status = 'inactive';

    await getOrLinkInfluencerAccount({
        email: inactiveCreator.email,
        influencer_id: inactiveCreator.id,
        password: 'PasswordInactive123!'
    });

    // Seed test attribution & order for Creator A
    await trackInfluencerClick({
        influencer_id: creatorA.id,
        landing_url: `https://wishrite.in/influencer/${creatorA.public_slug}`,
        session_id: `sess_a_${timestamp}`
    });

    await attributeOrderToInfluencer({
        order_id: `ord_id_a_${timestamp}`,
        order_reference: `WR-ORD-A-${timestamp}`,
        sales_amount: 3000,
        influencer_id: creatorA.id
    });

    // Seed test attribution & order for Creator B
    await trackInfluencerClick({
        influencer_id: creatorB.id,
        landing_url: `https://wishrite.in/influencer/${creatorB.public_slug}`,
        session_id: `sess_b_${timestamp}`
    });

    await attributeOrderToInfluencer({
        order_id: `ord_id_b_${timestamp}`,
        order_reference: `WR-ORD-B-${timestamp}`,
        sales_amount: 5000,
        influencer_id: creatorB.id
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3A: Authentication & Identity Mapping', () => {

    it('1. Valid creator login issues session token and returns sanitized creator profile', async () => {
        const res = await fetch(`${baseUrl}/api/creator/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: creatorA.email,
                password: 'PasswordA123!'
            })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.token);
        assert.ok(data.token.startsWith('crt_'));
        assert.equal(data.creator.id, creatorA.id);
        assert.equal(data.creator.name, 'Aarya Sharma');

        // Store token for subsequent tests
        tokenA = data.token;
    });

    it('2. Invalid login password rejected with 401', async () => {
        const res = await fetch(`${baseUrl}/api/creator/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: creatorA.email,
                password: 'WrongPassword999!'
            })
        });

        assert.equal(res.status, 401);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, 'INVALID_CREDENTIALS');
    });

    it('3. Non-existent / unlinked user rejected with 403 CREATOR_NOT_ACTIVATED', async () => {
        const res = await fetch(`${baseUrl}/api/creator/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'unlinked_user_9999@example.com',
                password: 'SomePassword!'
            })
        });

        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, 'CREATOR_NOT_ACTIVATED');
        assert.match(data.error.message, /not activated/i);
    });

    it('4. Inactive creator account rejected with 403 CREATOR_ACCESS_UNAVAILABLE', async () => {
        const res = await fetch(`${baseUrl}/api/creator/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: inactiveCreator.email,
                password: 'PasswordInactive123!'
            })
        });

        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, 'CREATOR_ACCESS_UNAVAILABLE');
    });

    it('5. Creator B can also authenticate and receive independent token', async () => {
        const res = await fetch(`${baseUrl}/api/creator/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: creatorB.email,
                password: 'PasswordB123!'
            })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.token);
        tokenB = data.token;
        assert.notEqual(tokenA, tokenB);
    });
});

describe('WishRite Creator Club — Phase 3A: Authorization & Session Enforcement', () => {

    it('6. Direct API access without authorization header is rejected with 401', async () => {
        const endpoints = [
            '/api/creator/me',
            '/api/creator/stats',
            '/api/creator/performance',
            '/api/creator/orders',
            '/api/creator/links',
            '/api/creator/profile'
        ];

        for (const ep of endpoints) {
            const res = await fetch(`${baseUrl}${ep}`);
            assert.equal(res.status, 401, `Expected 401 for ${ep}`);
            const data = await res.json();
            assert.equal(data.error.code, 'AUTH_REQUIRED');
        }
    });

    it('7. Malformed or invalid session token is rejected with 403/401', async () => {
        const res = await fetch(`${baseUrl}/api/creator/me`, {
            headers: { 'Authorization': 'Bearer crt_invalid_fake_token_12345' }
        });
        assert.ok(res.status === 401 || res.status === 403);
    });

    it('8. GET /api/creator/me returns authenticated creator information', async () => {
        const res = await fetch(`${baseUrl}/api/creator/me`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.data.creator.id, creatorA.id);
        assert.equal(data.data.creator.name, 'Aarya Sharma');
        assert.ok(data.data.creator.public_profile_url);
    });
});

describe('WishRite Creator Club — Phase 3A: Strict Data Isolation & Anti-Tampering', () => {

    it('9. Manipulated influencer ID parameter (?influencer_id=xxx) is completely ignored', async () => {
        // Creator A attempts to request Creator B's stats by supplying ?influencer_id=creatorB.id
        const res = await fetch(`${baseUrl}/api/creator/stats?influencer_id=${creatorB.id}`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        // Creator A's order total was ₹3,000, Creator B was ₹5,000.
        // Server MUST return Creator A's data!
        assert.equal(data.data.total_sales, 3000);
    });

    it('10. Creator A cannot see Creator B orders (Total Data Isolation)', async () => {
        const resA = await fetch(`${baseUrl}/api/creator/orders`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const resB = await fetch(`${baseUrl}/api/creator/orders`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });

        const ordersA = (await resA.json()).data;
        const ordersB = (await resB.json()).data;

        assert.ok(ordersA.length >= 1);
        assert.ok(ordersB.length >= 1);

        // All orders returned to Creator A must have order_reference WR-ORD-A-...
        for (const o of ordersA) {
            assert.ok(o.order_reference.includes('WR-ORD-A-'));
            assert.ok(!o.order_reference.includes('WR-ORD-B-'));
        }

        // All orders returned to Creator B must have order_reference WR-ORD-B-...
        for (const o of ordersB) {
            assert.ok(o.order_reference.includes('WR-ORD-B-'));
            assert.ok(!o.order_reference.includes('WR-ORD-A-'));
        }
    });
});

describe('WishRite Creator Club — Phase 3A: Privacy & PII Guard', () => {

    it('11. Creator orders API strictly strips customer PII (phone, email, address, notes)', async () => {
        const res = await fetch(`${baseUrl}/api/creator/orders`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.data.length > 0);

        for (const order of json.data) {
            // Permitted fields
            assert.ok(order.order_reference);
            assert.ok(order.created_at);
            assert.ok(typeof order.sales_amount === 'number');
            assert.ok(typeof order.commission_amount === 'number');
            assert.ok(order.commission_status);

            // STRICTLY FORBIDDEN Customer PII fields
            assert.equal(order.customer_name, undefined);
            assert.equal(order.customer_phone, undefined);
            assert.equal(order.customer_email, undefined);
            assert.equal(order.customer_address, undefined);
            assert.equal(order.delivery_address, undefined);
            assert.equal(order.admin_notes, undefined);
            assert.equal(order.internal_notes, undefined);
        }
    });

    it('12. Sensitive credentials and service role keys are NEVER returned in responses', async () => {
        const res = await fetch(`${baseUrl}/api/creator/me`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const bodyStr = await res.text();
        assert.ok(!bodyStr.includes('service_role'));
        assert.ok(!bodyStr.includes('sb_secret_'));
        assert.ok(!bodyStr.includes('password_hash'));
    });
});

describe('WishRite Creator Club — Phase 3A: Dashboard Metrics, Performance & Referral Links', () => {

    it('13. GET /api/creator/stats returns Phase 2 canonical metrics and conversion rate', async () => {
        const res = await fetch(`${baseUrl}/api/creator/stats`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.data.total_clicks >= 1);
        assert.ok(data.data.total_orders >= 1);
        assert.equal(data.data.total_sales, 3000);
        assert.ok(typeof data.data.conversion_rate === 'number');
        // Commission for Creator A: 3000 * 12% = 360
        assert.equal(data.data.pending_earnings, 360);
    });

    it('14. GET /api/creator/performance supports 7d, 30d, 90d, all periods with daily trend', async () => {
        for (const period of ['7d', '30d', '90d', 'all']) {
            const res = await fetch(`${baseUrl}/api/creator/performance?period=${period}`, {
                headers: { 'Authorization': `Bearer ${tokenA}` }
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.equal(data.data.period, period);
            assert.ok(Array.isArray(data.data.trend));
            assert.ok(data.data.trend.length > 0);
            assert.ok(data.data.total_sales >= 3000);
        }
    });

    it('15. GET /api/creator/links returns permanent profile link and product links', async () => {
        const res = await fetch(`${baseUrl}/api/creator/links`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.data.public_slug, creatorA.public_slug);
        assert.equal(data.data.profile_url, `https://wishrite.in/influencer/${creatorA.public_slug}`);
    });

    it('16. POST /api/creator/links creates canonical product referral link', async () => {
        const res = await fetch(`${baseUrl}/api/creator/links`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ product_code: 'WR-RNG-0021' })
        });

        assert.equal(res.status, 201);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.data.url, `https://wishrite.in/influencer/${creatorA.public_slug}/product/WR-RNG-0021`);
    });
});

describe('WishRite Creator Club — Phase 3A: Profile Management & Governance', () => {

    it('17. PATCH /api/creator/profile allows updating display_name, bio, and instagram_url', async () => {
        const res = await fetch(`${baseUrl}/api/creator/profile`, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                display_name: 'Aarya Sharma - Haute Joaillerie',
                bio: 'Stylist & fine jewelry enthusiast',
                instagram_url: 'https://instagram.com/aarya_haute'
            })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.data.name, 'Aarya Sharma - Haute Joaillerie');
        assert.equal(data.data.bio, 'Stylist & fine jewelry enthusiast');
    });

    it('18. ADMIN GOVERNANCE: Creator cannot tamper with commission_rate, tier, status or slug', async () => {
        const res = await fetch(`${baseUrl}/api/creator/profile`, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                commission_rate: 99,
                tier: 'platinum',
                status: 'suspended',
                public_slug: 'hacked_slug'
            })
        });

        // Verify that commission rate remains unchanged at 12% and status remains active
        const verifyRes = await fetch(`${baseUrl}/api/creator/me`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const me = (await verifyRes.json()).data;
        assert.equal(me.creator.public_slug, creatorA.public_slug);

        const statsRes = await fetch(`${baseUrl}/api/creator/stats`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const stats = (await statsRes.json()).data;
        // Commission for 3000 * 12% remains 360, NOT 99%
        assert.equal(stats.pending_earnings, 360);
    });

    it('19. POST /api/creator/logout revokes session token', async () => {
        const res = await fetch(`${baseUrl}/api/creator/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);

        // Next request with tokenA must now be rejected
        const verifyRes = await fetch(`${baseUrl}/api/creator/me`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        assert.equal(verifyRes.status, 401);
    });
});

// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 2 TEST SUITE
// Tests Public Storefront Routing, 30-Day Referral Attribution (Last-Click Model),
// Click Tracking & Debouncing, Order Attribution & Snapshot Commission Calculation,
// Cancellation / Refund Reconciliation, Live Stats Updates & Public Endpoint Security
// ==============================================================================

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import {
    INFLUENCER_ATTRIBUTION_DAYS,
    calculateInfluencerCommission,
    buildInfluencerProductUrl,
    trackInfluencerClick,
    createOrUpdateAttribution,
    getActiveAttribution,
    attributeOrderToInfluencer,
    reconcileOrderCommission
} from '../backend/influencers.js';

let server;
let baseUrl = '';

before(async () => {
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

describe('WishRite Creator Club — Phase 2: Configuration & Commission Engine', () => {

    it('1. Attribution window is centrally configured to 30 days', () => {
        assert.equal(INFLUENCER_ATTRIBUTION_DAYS, 30);
    });

    it('2. Commission Engine calculates exact snapshot commission amount (e.g. ₹2,000 * 10% = ₹200)', () => {
        const testCase1 = calculateInfluencerCommission(2000, 10);
        assert.equal(testCase1.salesAmount, 2000);
        assert.equal(testCase1.commissionRate, 10);
        assert.equal(testCase1.commissionAmount, 200);

        const testCase2 = calculateInfluencerCommission(4999.50, 12.5);
        assert.equal(testCase2.salesAmount, 4999.50);
        assert.equal(testCase2.commissionRate, 12.5);
        // 4999.50 * 0.125 = 624.9375 -> rounded to 624.94
        assert.equal(testCase2.commissionAmount, 624.94);

        const testCaseZero = calculateInfluencerCommission(0, 15);
        assert.equal(testCaseZero.commissionAmount, 0);

        const testCaseNegative = calculateInfluencerCommission(-100, 10);
        assert.equal(testCaseNegative.commissionAmount, 0);
    });

    it('3. Builds product referral URL with /influencer/{slug}/product/{code}', () => {
        const url = buildInfluencerProductUrl('priya.jewels', 'ERN-0021');
        assert.equal(url, 'https://wishrite.in/influencer/priya.jewels/product/ERN-0021');

        const fallback = buildInfluencerProductUrl('priya.jewels', '');
        assert.equal(fallback, 'https://wishrite.in/influencer/priya.jewels');
    });
});

describe('WishRite Creator Club — Phase 2: Public Storefront Routing & Security', () => {

    let activeCreatorId = '';
    let inactiveCreatorId = '';
    let suspendedCreatorId = '';
    const activeSlug = `act_${Date.now()}`;
    const inactiveSlug = `inact_${Date.now()}`;
    const suspendedSlug = `susp_${Date.now()}`;

    before(async () => {
        // Create an active creator
        const resActive = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Active Test Creator',
                instagram_id: activeSlug,
                commission_rate: 10,
                status: 'active',
                tier: 'gold',
                bio: 'Curated 925 silver jewelry selections',
                category: 'Jewelry',
                email: 'secret_active@example.com',
                phone: '9876543210'
            })
        });
        const dataActive = await resActive.json();
        activeCreatorId = dataActive.data?.id;

        // Create an inactive creator
        const resInactive = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Inactive Creator',
                instagram_id: inactiveSlug,
                commission_rate: 8,
                status: 'inactive',
                email: 'secret_inactive@example.com'
            })
        });
        const dataInactive = await resInactive.json();
        inactiveCreatorId = dataInactive.data?.id;

        // Create a suspended creator
        const resSuspended = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Suspended Creator',
                instagram_id: suspendedSlug,
                commission_rate: 5,
                status: 'suspended',
                email: 'secret_suspended@example.com'
            })
        });
        const dataSuspended = await resSuspended.json();
        suspendedCreatorId = dataSuspended.data?.id;
    });

    it('4. Resolves valid active influencer and renders public profile data', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/${activeSlug}`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.data.name, 'Active Test Creator');
        assert.equal(data.data.public_slug, activeSlug);
        assert.equal(data.data.status, 'active');
    });

    it('5. SECURITY: Public API NEVER exposes sensitive fields (email, phone, commission_rate, earnings)', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/${activeSlug}`);
        const data = await res.json();
        const pub = data.data;

        assert.equal(pub.email, undefined, 'email must not be exposed');
        assert.equal(pub.phone, undefined, 'phone must not be exposed');
        assert.equal(pub.commission_rate, undefined, 'commission_rate must not be exposed to frontend');
        assert.equal(pub.total_earnings, undefined, 'total_earnings must not be exposed');
        assert.equal(pub.available_earnings, undefined, 'available_earnings must not be exposed');
        assert.equal(pub.stats, undefined, 'internal stats object must not be exposed');
    });

    it('6. Rejects inactive influencer with 403 Forbidden state', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/${inactiveSlug}`);
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
        const errMsg = data.error?.message || String(data.error);
        assert.match(errMsg, /inactive/i);
    });

    it('7. Rejects suspended influencer with 403 Forbidden state', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/${suspendedSlug}`);
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
        const errMsg = data.error?.message || String(data.error);
        assert.match(errMsg, /suspended/i);
    });

    it('8. Rejects nonexistent influencer with 404 Not Found', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/nonexistent_slug_99999`);
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.equal(data.success, false);
        const errMsg = data.error?.message || String(data.error);
        assert.match(errMsg, /not found/i);
    });

    it('9. Fetches public products collection for creator (with active fallback)', async () => {
        const res = await fetch(`${baseUrl}/api/public/influencers/${activeSlug}/products`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(Array.isArray(data.data), true);
    });
});

describe('WishRite Creator Club — Phase 2: Click Tracking & Debouncing', () => {

    let creatorId = '';
    const slug = `click_test_${Date.now()}`;

    before(async () => {
        const res = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Click Test Creator',
                instagram_id: slug,
                commission_rate: 10,
                status: 'active'
            })
        });
        const data = await res.json();
        creatorId = data.data?.id;
    });

    it('10. Tracks valid influencer click and increments total_clicks in influencer_stats', async () => {
        const sessionId = `test_sess_${Date.now()}`;
        const res = await fetch(`${baseUrl}/api/influencers/${creatorId}/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                landing_url: `https://wishrite.in/influencer/${slug}`,
                session_id: sessionId
            })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.debounced, false);
        assert.ok(data.click?.id);

        // Verify stats reflects increment
        const statsRes = await fetch(`${baseUrl}/api/influencers/${creatorId}/stats`);
        const statsData = await statsRes.json();
        assert.ok(statsData.data?.total_clicks >= 1);
    });

    it('11. Debounce protection prevents duplicate rapid clicks within 10 seconds for same session', async () => {
        const sessionId = `rapid_click_sess_${Date.now()}`;

        // First click
        const res1 = await fetch(`${baseUrl}/api/influencers/${creatorId}/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                landing_url: `https://wishrite.in/influencer/${slug}`,
                session_id: sessionId
            })
        });
        const data1 = await res1.json();
        assert.equal(data1.debounced, false);

        // Immediate second click with same session
        const res2 = await fetch(`${baseUrl}/api/influencers/${creatorId}/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                landing_url: `https://wishrite.in/influencer/${slug}`,
                session_id: sessionId
            })
        });
        const data2 = await res2.json();
        assert.equal(data2.debounced, true);
        assert.match(data2.message, /debounced/i);
    });

    it('12. Rejects click tracking on malformed or nonexistent influencer ID', async () => {
        const res = await fetch(`${baseUrl}/api/influencers/00000000-0000-0000-0000-000000000000/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ landing_url: 'https://wishrite.in' })
        });
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.equal(data.success, false);
    });
});

describe('WishRite Creator Club — Phase 2: 30-Day Attribution Lifecycle & Last-Click Model', () => {

    const infA = 'inf_a_' + Date.now();
    const infB = 'inf_b_' + Date.now();
    const sessionId = 'shared_session_' + Date.now();

    it('13. First attribution is created with 30-day expiration window', async () => {
        const attr = await createOrUpdateAttribution({
            influencer_id: infA,
            session_id: sessionId,
            landing_url: `https://wishrite.in/influencer/creator_a`
        });

        assert.ok(attr.id);
        assert.equal(attr.first_influencer_id, infA);
        assert.equal(attr.last_influencer_id, infA);
        assert.equal(attr.influencer_id, infA);

        const now = Date.now();
        const expiresAt = new Date(attr.expires_at).getTime();
        const diffDays = Math.round((expiresAt - now) / (1000 * 60 * 60 * 24));
        assert.equal(diffDays, 30);
    });

    it('14. Attribution persists across normal browsing sessions', async () => {
        const active = await getActiveAttribution(sessionId);
        assert.ok(active);
        assert.equal(active.influencer_id, infA);
        assert.equal(active.last_influencer_id, infA);
    });

    it('15. Last-Click Model: New influencer referral replaces active attribution while recording first & last', async () => {
        const updatedAttr = await createOrUpdateAttribution({
            influencer_id: infB,
            session_id: sessionId,
            landing_url: `https://wishrite.in/influencer/creator_b`
        });

        assert.equal(updatedAttr.first_influencer_id, infA, 'first_influencer_id preserved');
        assert.equal(updatedAttr.last_influencer_id, infB, 'last_influencer_id updated to Influencer B');
        assert.equal(updatedAttr.influencer_id, infB, 'active influencer_id updated to Influencer B');
    });

    it('16. Attribution expires after 30 days', async () => {
        const expiredSessionId = 'expired_sess_' + Date.now();
        // Create an attribution artificially expired in the past
        await createOrUpdateAttribution({
            influencer_id: infA,
            session_id: expiredSessionId,
            expires_at: new Date(Date.now() - 10000).toISOString()
        });

        const active = await getActiveAttribution(expiredSessionId);
        assert.equal(active, null, 'Expired attribution must return null');
    });
});

describe('WishRite Creator Club — Phase 2: Order Attribution, Commission & Reconciliation', () => {

    let creatorId = '';
    const slug = `order_attr_test_${Date.now()}`;

    before(async () => {
        const res = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Attributed Order Creator',
                instagram_id: slug,
                commission_rate: 10,
                status: 'active'
            })
        });
        const data = await res.json();
        creatorId = data.data?.id;
    });

    it('17. Successful order with referral attribution creates pending commission and updates stats', async () => {
        const orderRef = `ORD-TEST-${Date.now()}`;
        const salesAmount = 2000; // ₹2,000 * 10% = ₹200 pending commission

        const orderRes = await fetch(`${baseUrl}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_number: orderRef,
                customer_name: 'Pooja Sharma',
                customer_phone: '9876543210',
                total_amount: salesAmount,
                subtotal: salesAmount,
                items: [{ product_code: 'WR-RING-01', price: salesAmount, quantity: 1 }],
                referral_attribution: {
                    influencer_id: creatorId,
                    public_slug: slug
                }
            })
        });

        assert.equal(orderRes.status, 201);
        const orderData = await orderRes.json();
        assert.equal(orderData.success, true);
        assert.equal(orderData.attributed_to_influencer, true);

        // Verify order attribution record
        const attrRecord = orderData.attribution;
        assert.equal(attrRecord.influencer_id, creatorId);
        assert.equal(attrRecord.order_reference, orderRef);
        assert.equal(attrRecord.sales_amount, 2000);
        assert.equal(attrRecord.commission_rate, 10);
        assert.equal(attrRecord.commission_amount, 200);
        assert.equal(attrRecord.status, 'pending');

        // Verify influencer_stats updated
        const statsRes = await fetch(`${baseUrl}/api/influencers/${creatorId}/stats`);
        const statsData = await statsRes.json();
        const stats = statsData.data;

        assert.ok(stats.total_orders >= 1);
        assert.ok(stats.total_sales >= 2000);
        assert.ok(stats.pending_earnings >= 200);
        assert.equal(stats.available_earnings, 0, 'pending commission must NOT be in available_earnings');
    });

    it('18. Direct order without referral creates NO influencer commission', async () => {
        const orderRef = `ORD-DIRECT-${Date.now()}`;
        const orderRes = await fetch(`${baseUrl}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_number: orderRef,
                customer_name: 'Direct Customer',
                total_amount: 3500,
                items: [{ product_code: 'WR-CHAIN-01', price: 3500, quantity: 1 }]
            })
        });

        assert.equal(orderRes.status, 201);
        const orderData = await orderRes.json();
        assert.equal(orderData.attributed_to_influencer, false);
        assert.equal(orderData.attribution, null);
    });

    it('19. PREVENT DOUBLE ATTRIBUTION: Same order cannot be attributed twice (Idempotency)', async () => {
        const orderRef = `ORD-IDEMPOTENT-${Date.now()}`;

        // First attribution
        const attr1 = await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 1500,
            referral_attribution: { influencer_id: creatorId }
        });
        assert.ok(attr1);
        assert.equal(attr1.commission_amount, 150);

        // Immediate duplicate attribution call
        const attr2 = await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 1500,
            referral_attribution: { influencer_id: creatorId }
        });
        assert.equal(attr2.already_attributed, true);
        assert.equal(attr2.id, attr1.id);
    });

    it('20. ORDER CANCELLATION / REFUND: Cancelling order revokes pending commission and reconciles stats', async () => {
        const orderRef = `ORD-CANCEL-${Date.now()}`;
        const salesAmount = 1000; // ₹100 commission

        // 1. Create attributed order
        await fetch(`${baseUrl}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_number: orderRef,
                customer_name: 'Cancel Test',
                total_amount: salesAmount,
                referral_attribution: { influencer_id: creatorId }
            })
        });

        // 2. Fetch stats before cancellation
        const statsBefore = (await (await fetch(`${baseUrl}/api/influencers/${creatorId}/stats`)).json()).data;

        // 3. Update order status to 'cancelled'
        const cancelRes = await fetch(`${baseUrl}/api/orders/${orderRef}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_status: 'cancelled' })
        });

        assert.equal(cancelRes.status, 200);
        const cancelData = await cancelRes.json();
        assert.equal(cancelData.reconciliation?.commission_cancelled, true);

        // 4. Verify commission revoked in influencer_stats
        const statsAfter = (await (await fetch(`${baseUrl}/api/influencers/${creatorId}/stats`)).json()).data;
        assert.equal(statsAfter.pending_earnings, statsBefore.pending_earnings - 100);
        assert.equal(statsAfter.total_sales, statsBefore.total_sales - 1000);
        assert.equal(statsAfter.total_orders, statsBefore.total_orders - 1);
    });

    it('21. Referral Link Generation: Admin can create and retrieve product referral links', async () => {
        const linkRes = await fetch(`${baseUrl}/api/influencers/${creatorId}/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                link_type: 'product',
                product_code: 'WR-EAR-001',
                title: 'Earrings Referral Link'
            })
        });

        assert.equal(linkRes.status, 201);
        const linkData = await linkRes.json();
        assert.equal(linkData.success, true);
        assert.equal(linkData.data.link_type, 'product');
        assert.equal(linkData.data.product_code, 'WR-EAR-001');

        const getLinksRes = await fetch(`${baseUrl}/api/influencers/${creatorId}/links`);
        const linksList = await getLinksRes.json();
        assert.ok(linksList.data.length >= 1);
    });

    it('22. Influencer Orders Endpoint: Lists attributed orders with commission details', async () => {
        const res = await fetch(`${baseUrl}/api/influencers/${creatorId}/orders`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(Array.isArray(data.data));
        assert.ok(data.data.length >= 1);
    });
});

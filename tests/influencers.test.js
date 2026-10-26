// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 1 TEST SUITE
// Tests Instagram Normalization, Code Generation, Public URL Resolution,
// Stats & Links Initialization, CRUD Operations, Duplicate Protection & Security
// ==============================================================================

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { 
    normalizeInstagramId, 
    isValidInstagramId, 
    buildInfluencerPublicUrl, 
    buildInstagramUrl,
    generateInfluencerCode,
    ALLOWED_STATUSES,
    ALLOWED_TIERS
} from '../backend/influencers.js';
import { app } from '../server.js';
import http from 'node:http';

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

describe('WishRite Creator Club — Phase 1 Unit Tests', () => {

    it('1. Normalizes Instagram ID: trims, lowercases, removes leading @ and preserves valid characters', () => {
        assert.equal(normalizeInstagramId('@Priya.Jewels'), 'priya.jewels');
        assert.equal(normalizeInstagramId('  @dkuma71  '), 'dkuma71');
        assert.equal(normalizeInstagramId('@Ananya_Crafts_99'), 'ananya_crafts_99');
        assert.equal(normalizeInstagramId('SimpleName'), 'simplename');
        assert.equal(normalizeInstagramId('@test.user_123'), 'test.user_123');
        assert.equal(normalizeInstagramId(''), '');
        assert.equal(normalizeInstagramId(null), '');
    });

    it('2. Validates Instagram ID characters and length', () => {
        assert.equal(isValidInstagramId('priya.jewels'), true);
        assert.equal(isValidInstagramId('dkuma71'), true);
        assert.equal(isValidInstagramId('ananya_crafts_99'), true);

        // Invalid: spaces, symbols, too long
        assert.equal(isValidInstagramId('priya jewels'), false);
        assert.equal(isValidInstagramId('priya@jewels'), false);
        assert.equal(isValidInstagramId('priya/jewels'), false);
        assert.equal(isValidInstagramId('a'.repeat(35)), false);
        assert.equal(isValidInstagramId(''), false);
    });

    it('3. Builds permanent public URL with https://wishrite.in/influencer/{publicSlug}', () => {
        assert.equal(
            buildInfluencerPublicUrl('priya.jewels'), 
            'https://wishrite.in/influencer/priya.jewels'
        );
        assert.equal(
            buildInfluencerPublicUrl('dkuma71'), 
            'https://wishrite.in/influencer/dkuma71'
        );
        assert.equal(
            buildInstagramUrl('priya.jewels'),
            'https://instagram.com/priya.jewels'
        );
        assert.equal(buildInfluencerPublicUrl(''), '');
    });

    it('4. Generates human-readable sequential influencer codes (WR-INF-000001+)', async () => {
        const code1 = await generateInfluencerCode([]);
        assert.match(code1, /^WR-INF-\d{6}$/);
        assert.equal(code1.startsWith('WR-INF-'), true);

        const code2 = await generateInfluencerCode([{ influencer_code: 'WR-INF-000005' }]);
        assert.equal(code2, 'WR-INF-000006');
    });

    it('5. Constraints support all required statuses and tiers', () => {
        assert.deepEqual(ALLOWED_STATUSES, ['pending', 'active', 'inactive', 'suspended']);
        assert.deepEqual(ALLOWED_TIERS, ['starter', 'silver', 'gold', 'platinum', 'elite']);
    });
});

describe('WishRite Creator Club — Phase 1 API Endpoints', () => {

    const testHandle = `test_creator_${Date.now()}`;
    let createdInfluencerId = '';
    let createdInfluencerCode = '';

    it('6. POST /api/influencers creates influencer with stats and default link', async () => {
        const payload = {
            name: 'Priya Jewels Test',
            instagram_id: `@${testHandle}`,
            email: `${testHandle}@example.com`,
            phone: '9876543210',
            category: 'Jewelry & Lifestyle',
            commission_rate: 12.5,
            tier: 'starter',
            status: 'pending',
            bio: 'Test creator for Creator Club Phase 1.'
        };

        const res = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(body.data);
        assert.ok(body.data.id);
        assert.ok(body.data.influencer_code);
        assert.equal(body.data.instagram_id, testHandle.toLowerCase());
        assert.equal(body.data.public_slug, testHandle.toLowerCase());
        assert.equal(body.data.public_profile_url, `https://wishrite.in/influencer/${testHandle.toLowerCase()}`);
        assert.equal(body.data.commission_rate, 12.5);
        assert.equal(body.data.status, 'pending');
        assert.equal(body.data.tier, 'starter');

        // Verify stats row initialization (zero values, never faked)
        assert.ok(body.data.stats);
        assert.equal(body.data.stats.total_clicks, 0);
        assert.equal(body.data.stats.total_orders, 0);
        assert.equal(body.data.stats.total_sales, 0);
        assert.equal(body.data.stats.total_earnings, 0);
        assert.equal(body.data.stats.total_points, 0);

        // Verify default link creation
        assert.ok(body.data.links);
        assert.equal(body.data.links.length, 1);
        assert.equal(body.data.links[0].link_type, 'profile');
        assert.equal(body.data.links[0].url, `https://wishrite.in/influencer/${testHandle.toLowerCase()}`);
        assert.equal(body.data.links[0].is_default, true);

        createdInfluencerId = body.data.id;
        createdInfluencerCode = body.data.influencer_code;
    });

    it('7. POST /api/influencers rejects duplicate Instagram handle with 409', async () => {
        const duplicatePayload = {
            name: 'Another Name',
            instagram_id: `@${testHandle.toUpperCase()}`, // Case-insensitive duplicate
            commission_rate: 10
        };

        const res = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(duplicatePayload)
        });

        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.success, false);
        assert.equal(body.error?.code, 'DUPLICATE_INSTAGRAM_ID');
    });

    it('8. POST /api/influencers validates required name and handle', async () => {
        const noNameRes = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instagram_id: 'sample_handle' })
        });
        assert.equal(noNameRes.status, 400);

        const noHandleRes = await fetch(`${baseUrl}/api/influencers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sample Name' })
        });
        assert.equal(noHandleRes.status, 400);
    });

    it('9. GET /api/influencers returns creators list with live summary statistics', async () => {
        const res = await fetch(`${baseUrl}/api/influencers`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(Array.isArray(body.data));
        assert.ok(body.summary);
        assert.ok(typeof body.summary.total_influencers === 'number');
        assert.ok(typeof body.summary.active_creators === 'number');
        assert.ok(typeof body.summary.pending_creators === 'number');
        assert.ok(typeof body.summary.total_sales === 'number');
        assert.ok(typeof body.summary.total_earnings === 'number');

        // Confirm created influencer is in list
        const found = body.data.find(i => i.id === createdInfluencerId);
        assert.ok(found);
        assert.equal(found.influencer_code, createdInfluencerCode);
    });

    it('10. GET /api/influencers/:id returns single creator by UUID, code, or slug', async () => {
        // By UUID
        const resUuid = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}`);
        assert.equal(resUuid.status, 200);
        const bodyUuid = await resUuid.json();
        assert.equal(bodyUuid.data.id, createdInfluencerId);

        // By Influencer Code
        const resCode = await fetch(`${baseUrl}/api/influencers/${createdInfluencerCode}`);
        assert.equal(resCode.status, 200);
        const bodyCode = await resCode.json();
        assert.equal(bodyCode.data.id, createdInfluencerId);

        // By Public Slug
        const resSlug = await fetch(`${baseUrl}/api/influencers/${testHandle.toLowerCase()}`);
        assert.equal(resSlug.status, 200);
        const bodySlug = await resSlug.json();
        assert.equal(bodySlug.data.id, createdInfluencerId);

        // Unknown identifier returns 404
        const resUnknown = await fetch(`${baseUrl}/api/influencers/non_existent_creator_xyz`);
        assert.equal(resUnknown.status, 404);
    });

    it('11. PUT /api/influencers/:id updates creator fields', async () => {
        const updatePayload = {
            name: 'Priya Sharma Updated',
            commission_rate: 15.0,
            tier: 'silver',
            category: 'Luxury & Bridal',
            bio: 'Updated bio description.'
        };

        const res = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.name, 'Priya Sharma Updated');
        assert.equal(body.data.commission_rate, 15.0);
        assert.equal(body.data.tier, 'silver');
        assert.equal(body.data.category, 'Luxury & Bridal');
    });

    it('12. PATCH /api/influencers/:id/status transitions status safely', async () => {
        // Transition to active
        const resActive = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' })
        });
        assert.equal(resActive.status, 200);
        const bodyActive = await resActive.json();
        assert.equal(bodyActive.data.status, 'active');

        // Invalid status returns 400
        const resInvalid = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'invalid_status_value' })
        });
        assert.equal(resInvalid.status, 400);
    });

    it('13. POST /api/influencers/:id/regenerate-profile-url regenerates canonical URL', async () => {
        const res = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}/regenerate-profile-url`, {
            method: 'POST'
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.public_profile_url, `https://wishrite.in/influencer/${testHandle.toLowerCase()}`);
    });

    it('14. DELETE /api/influencers/:id removes creator', async () => {
        const res = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}`, {
            method: 'DELETE'
        });
        assert.equal(res.status, 200);

        // Verification: subsequent GET returns 404
        const checkRes = await fetch(`${baseUrl}/api/influencers/${createdInfluencerId}`);
        assert.equal(checkRes.status, 404);
    });
});

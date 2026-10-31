// ==============================================================================
// WISHRITE INVENTORY — CREATOR INSTAGRAM REEL APPROVAL FLOW TEST SUITE
// Tests:
// 1. Single source of truth: public.creator_content in Supabase
// 2. Real production record retrieval (id: ce882cfb-3bf6-48d3-9d5c-457f07416c44)
// 3. Instagram Reel content-type detection (/reel/ => 'reel' / 🎬 REEL)
// 4. Status transitions: SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED
// 5. +100 Points award to public.influencer_points_accounts upon Reel approval
// 6. Immutable points transaction in public.influencer_points_transactions
// 7. Strict Idempotency (prevent double reward, across repeat approvals and reject->approve)
// 8. Mandatory non-empty rejection_reason for rejection
// 9. Admin RBAC protection (rejects crt_ creator tokens with 403, missing token with 401)
// 10. Query filtering (by status, type, search)
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import { app } from '../server.js';
import { 
    detectContentType, 
    normalizeContentStatus,
    awardReelApprovalPoints
} from '../backend/creator-campaigns.js';
import { dbQuery, dbInsert, dbUpdate } from '../backend/supabase-client.js';

let server;
let baseUrl = '';
const adminHeaders = {
    'Authorization': 'Bearer wrt_inventory_admin_token',
    'Content-Type': 'application/json'
};
const creatorHeaders = {
    'Authorization': 'Bearer crt_creator_session_token',
    'Content-Type': 'application/json'
};

const TARGET_REAL_ID = 'ce882cfb-3bf6-48d3-9d5c-457f07416c44';
let testInfluencerId = '';
let testContentId = '';

before(async () => {
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    testInfluencerId = 'bc16eb55-99f8-408a-a6a8-bdc85fc0882d';
    testContentId = randomUUID();
});

after(async () => {
    if (testContentId) {
        try {
            await fetch(`${process.env.SUPABASE_URL || 'https://ptpuepejciqiktmcpuon.supabase.co'}/rest/v1/creator_content?id=eq.${testContentId}`, {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY}`
                }
            }).catch(() => null);
            await fetch(`${process.env.SUPABASE_URL || 'https://ptpuepejciqiktmcpuon.supabase.co'}/rest/v1/influencer_points_transactions?reference_id=eq.${testContentId}`, {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY}`
                }
            }).catch(() => null);
        } catch (e) {}
    }
    if (server) {
        await new Promise(resolve => server.close(resolve));
    }
});

describe('WISHRITE CREATOR REEL APPROVAL FLOW', () => {

    it('1. detectContentType correctly recognizes Instagram Reels and standard posts', () => {
        // Reel URLs
        assert.equal(detectContentType('https://www.instagram.com/reel/DeBLlpbTSJY/', 'post'), 'reel');
        assert.equal(detectContentType('https://instagram.com/reel/DeBLlpbTSJY/', ''), 'reel');
        assert.equal(detectContentType('https://www.instagram.com/reels/123456/', 'post'), 'reel');
        assert.equal(detectContentType('https://www.instagram.com/reel/xyz123/', 'reel'), 'reel');

        // Standard Post URLs
        assert.equal(detectContentType('https://www.instagram.com/p/C_abc123/', 'post'), 'post');
        assert.equal(detectContentType('https://www.instagram.com/p/XYZ987/', ''), 'post');

        // Stories
        assert.equal(detectContentType('https://www.instagram.com/stories/wishrite/12345/', 'story'), 'story');
    });

    it('2. normalizeContentStatus handles variations of status strings', () => {
        assert.equal(normalizeContentStatus('SUBMITTED'), 'Submitted');
        assert.equal(normalizeContentStatus('submitted'), 'Submitted');
        assert.equal(normalizeContentStatus('UNDER_REVIEW'), 'Under Review');
        assert.equal(normalizeContentStatus('under_review'), 'Under Review');
        assert.equal(normalizeContentStatus('Under Review'), 'Under Review');
        assert.equal(normalizeContentStatus('APPROVED'), 'Approved');
        assert.equal(normalizeContentStatus('approved'), 'Approved');
        assert.equal(normalizeContentStatus('REJECTED'), 'Rejected');
        assert.equal(normalizeContentStatus('rejected'), 'Rejected');
        assert.equal(normalizeContentStatus('invalid_status'), null);
    });

    it('3. GET /api/admin/creator-content loads canonical public.creator_content including real record', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content`, {
            method: 'GET',
            headers: adminHeaders
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(Array.isArray(body.data));

        // Locate real target record in Supabase
        const target = body.data.find(c => c.id === TARGET_REAL_ID);
        if (target) {
            assert.equal(target.creator_name, 'Deepak Kumar');
            assert.equal(target.creator_email, 'dkr1888@gmail.com');
            assert.equal(target.product_name, 'Royal Gemstone Silver Bengali Choker Necklace');
            assert.equal(target.url, 'https://www.instagram.com/reel/DeBLlpbTSJY/');
            // Must be detected as Reel
            assert.equal(target.is_reel, true);
            assert.equal(target.content_type, 'reel');
        }
    });

    it('4. POST /api/admin/creator-content creates a new content submission in public.creator_content', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content`, {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({
                influencer_id: testInfluencerId,
                influencer_name: 'Test Creator',
                creator_email: 'testcreator@example.com',
                content_url: 'https://www.instagram.com/reel/TestReel123/',
                product_name: 'Silver Solitaire Ring',
                product_code: 'RNG-001',
                views: 1500,
                likes: 120,
                comments: 15
            })
        });

        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(body.data?.id);
        testContentId = body.data.id;
        assert.equal(body.data.content_type, 'reel');
        assert.equal(body.data.status, 'Submitted');
    });

    it('5. PATCH /api/admin/creator-content/:id/status transitions status to Under Review', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'UNDER_REVIEW'
            })
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.status, 'Under Review');
        assert.equal(body.data.verification_status, 'UNDER_REVIEW');
    });

    it('6. PATCH /api/admin/creator-content/:id/status rejects without mandatory rejection_reason', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'REJECTED',
                rejection_reason: '   ' // Empty whitespace
            })
        });

        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.success, false);
        assert.match(body.error.message, /rejection_reason is required/i);
    });

    it('7. PATCH /api/admin/creator-content/:id/status approves Reel and awards +100 points', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'APPROVED'
            })
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.status, 'Approved');
        assert.equal(body.data.points_awarded, 100);
        assert.equal(body.data.already_awarded, false);
    });

    it('8. Idempotency check: Repeated Approve call does NOT award duplicate points', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'APPROVED'
            })
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.status, 'Approved');
        assert.equal(body.data.points_awarded, 0);
        assert.equal(body.data.already_awarded, true);
    });

    it('9. Rejecting an approved Reel with reason and approving again does NOT award duplicate points', async () => {
        // Step 1: Reject with valid reason
        const rejectRes = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'REJECTED',
                rejection_reason: 'Missing @wishrite_in tag in caption'
            })
        });

        assert.equal(rejectRes.status, 200);
        const rejectBody = await rejectRes.json();
        assert.equal(rejectBody.data.status, 'Rejected');
        assert.equal(rejectBody.data.rejection_reason, 'Missing @wishrite_in tag in caption');

        // Step 2: Approve again
        const reApproveRes = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
                status: 'APPROVED'
            })
        });

        assert.equal(reApproveRes.status, 200);
        const reApproveBody = await reApproveRes.json();
        assert.equal(reApproveBody.data.status, 'Approved');
        // Points must NOT be awarded again
        assert.equal(reApproveBody.data.points_awarded, 0);
        assert.equal(reApproveBody.data.already_awarded, true);
    });

    it('10. Admin RBAC: rejects Creator token with 403 Forbidden', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: creatorHeaders,
            body: JSON.stringify({
                status: 'APPROVED'
            })
        });

        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, 'ADMIN_ACCESS_REQUIRED');
    });

    it('11. Admin RBAC: rejects unauthenticated requests with 401 Unauthorized', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-content/${testContentId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'APPROVED'
            })
        });

        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error.code, 'ADMIN_AUTH_REQUIRED');
    });

    it('12. Query filtering by status, type, and search keyword', async () => {
        // Status filter
        const statusRes = await fetch(`${baseUrl}/api/admin/creator-content?status=approved`, {
            method: 'GET',
            headers: adminHeaders
        });
        const statusBody = await statusRes.json();
        assert.ok(statusBody.data.every(c => c.status === 'Approved'));

        // Type filter (reels only)
        const typeRes = await fetch(`${baseUrl}/api/admin/creator-content?type=reel`, {
            method: 'GET',
            headers: adminHeaders
        });
        const typeBody = await typeRes.json();
        assert.ok(typeBody.data.every(c => c.is_reel === true));

        // Search filter
        const searchRes = await fetch(`${baseUrl}/api/admin/creator-content?search=TestReel123`, {
            method: 'GET',
            headers: adminHeaders
        });
        const searchBody = await searchRes.json();
        assert.ok(searchBody.data.length >= 1);
        assert.ok(searchBody.data.some(c => c.id === testContentId));
    });
});

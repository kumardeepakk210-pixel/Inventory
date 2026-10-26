// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: FINANCIAL SECURITY & ISOLATION TEST SUITE
// Tests Complete Creator Isolation, Multi-Tenant Boundary Enforcement,
// Role & Permission Checks, Admin Privilege Guardrails, Razorpay Webhook Security,
// Signature Verification, Duplicate Webhook Idempotency, and Anti-Tampering.
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    resetLoginRateLimits 
} from '../backend/creator.js';
import { 
    attributeOrderToInfluencer
} from '../backend/influencers.js';
import {
    makeCommissionAvailableInWallet
} from '../backend/creator-wallet.js';

let server;
let baseUrl = '';

let creatorA = null;
let creatorB = null;
let tokenA = '';
let tokenB = '';

const adminHeader = { 'Authorization': 'Bearer wrt_inventory_admin_token' };

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
    resetLoginRateLimits();

    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    const ts = Date.now();
    creatorA = await createTestInfluencer({
        name: 'Sec Creator A',
        email: `sec_a_${ts}@example.com`,
        instagram_id: `sec_a_${ts}`,
        bio: 'Security boundary creator A',
        commission_rate: 10,
        status: 'active'
    });
    await getOrLinkInfluencerAccount({
        email: creatorA.email,
        influencer_id: creatorA.id,
        password: 'PasswordSecA1!'
    });
    const loginA = await (await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorA.email, password: 'PasswordSecA1!' })
    })).json();
    tokenA = loginA.token;

    creatorB = await createTestInfluencer({
        name: 'Sec Creator B',
        email: `sec_b_${ts}@example.com`,
        instagram_id: `sec_b_${ts}`,
        bio: 'Security boundary creator B',
        commission_rate: 15,
        status: 'active'
    });
    await getOrLinkInfluencerAccount({
        email: creatorB.email,
        influencer_id: creatorB.id,
        password: 'PasswordSecB1!'
    });
    const loginB = await (await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorB.email, password: 'PasswordSecB1!' })
    })).json();
    tokenB = loginB.token;

    // Fund Creator A wallet
    const orderRef = `SEC-ORD-${Date.now()}`;
    await attributeOrderToInfluencer({
        order_reference: orderRef,
        sales_amount: 50000,
        influencer_id: creatorA.id
    });
    await makeCommissionAvailableInWallet({
        influencer_id: creatorA.id,
        order_reference: orderRef
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B: Financial Security & Authorization', () => {
    it('1. CROSS-CREATOR ISOLATION: Creator B cannot access Creator A wallet', async () => {
        const resA = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const walletA = (await resA.json()).data;
        assert.ok(walletA.available_balance > 0);

        const resB = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const walletB = (await resB.json()).data;
        assert.equal(walletB.available_balance, 0, 'Creator B must have 0 balance, isolated from Creator A');
        assert.notEqual(walletA.wallet_id, walletB.wallet_id);
    });

    it('2. SPOOFING PREVENTION: Injecting another creator ID in parameters does not bypass session identity', async () => {
        // Attempt to pass Creator A ID using Creator B token
        const res = await fetch(`${baseUrl}/api/creator/wallet?influencer_id=${creatorA.id}`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const json = await res.json();
        // Server MUST derive identity strictly from req.creator and return Creator B wallet
        assert.equal(json.data.available_balance, 0);
        assert.notEqual(json.data.available_balance, 5000);
    });

    it('3. ADMIN ROLE ENFORCEMENT: Creator token is strictly rejected on all /api/admin endpoints (403)', async () => {
        const adminEndpoints = [
            { method: 'GET', path: '/api/admin/creator-wallets' },
            { method: 'GET', path: '/api/admin/creator-withdrawals' },
            { method: 'GET', path: '/api/admin/creator-rewards' },
            { method: 'GET', path: '/api/admin/creator-redemptions' }
        ];

        for (const ep of adminEndpoints) {
            const res = await fetch(`${baseUrl}${ep.path}`, {
                method: ep.method,
                headers: { 'Authorization': `Bearer ${tokenA}` }
            });
            assert.equal(res.status, 403, `Endpoint ${ep.path} must return 403 for creator token`);
            const json = await res.json();
            assert.equal(json.error.code, 'ADMIN_ACCESS_REQUIRED');
        }
    });

    it('4. ANTI-TAMPERING: Negative and non-numeric monetary amounts are rejected', async () => {
        const invalidAmounts = [-500, 0, 'NaN', -0.01, 'abc'];

        for (const amt of invalidAmounts) {
            const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenA}`
                },
                body: JSON.stringify({ amount: amt })
            });
            assert.equal(res.status, 400, `Amount ${amt} must be rejected with 400`);
        }
    });

    it('5. ANTI-TAMPERING: PII & Bank credentials are never returned unmasked', async () => {
        // Add bank account for Creator A
        await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenA}`
            },
            body: JSON.stringify({
                method_type: 'bank_account',
                account_holder_name: 'Secured Creator A',
                account_number: '987654321098',
                ifsc_code: 'ICIC0000987',
                bank_name: 'ICICI Bank'
            })
        });

        const listRes = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const listJson = await listRes.json();
        const textResponse = JSON.stringify(listJson);

        // Raw bank account must never appear in payload
        assert.equal(textResponse.includes('987654321098'), false, 'Raw bank account must never be in payload');
        assert.ok(textResponse.includes('XXXXXX1098'), 'Masked bank account must be present');
    });

    it('6. RAZORPAY WEBHOOK SECURITY: Invalid HMAC-SHA256 signature is rejected with 400', async () => {
        const payload = {
            event: 'payout.processed',
            event_id: `evt_test_${Date.now()}`,
            payload: {
                payout: {
                    entity: {
                        id: 'pout_fake_123',
                        amount: 100000,
                        status: 'processed'
                    }
                }
            }
        };

        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': 'invalid_forged_signature_12345'
            },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.ok(json.error.message.includes('signature'));
    });

    it('7. RAZORPAY WEBHOOK SECURITY: Valid signature processed & duplicate event is idempotent', async () => {
        // First create a withdrawal to be confirmed via webhook
        const wthRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenA}`
            },
            body: JSON.stringify({ amount: 1000 })
        });
        const wthData = (await wthRes.json()).data;

        // Admin marks as approved/processing
        const appRes = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wthData.id}/approve`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            }
        });
        const processingWth = (await appRes.json()).data;
        const payoutId = processingWth.razorpay_payout_id;

        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const eventId = `evt_auth_${Date.now()}`;
        const payload = {
            event: 'payout.processed',
            event_id: eventId,
            payload: {
                payout: {
                    entity: {
                        id: payoutId,
                        reference_id: processingWth.withdrawal_reference,
                        amount: 100000,
                        status: 'processed'
                    }
                }
            }
        };

        const rawBody = JSON.stringify(payload);
        const validSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        // First webhook call: must succeed
        const res1 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': validSig
            },
            body: rawBody
        });
        assert.equal(res1.status, 200);

        // Second duplicate webhook call: must be handled idempotently
        const res2 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': validSig
            },
            body: rawBody
        });
        assert.equal(res2.status, 200);
        const json2 = await res2.json();
        assert.ok(json2.message.includes('idempotent'));
    });

    it('8. SECRET LEAK PREVENTION: Internal service-role keys or Razorpay secrets never in responses', async () => {
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const walletJson = await walletRes.json();
        const text = JSON.stringify(walletJson);

        assert.equal(text.includes('service_role'), false);
        assert.equal(text.includes('supabase_service'), false);
        assert.equal(text.includes('RAZORPAY_KEY_SECRET'), false);
        assert.equal(text.includes('rzp_live_secret'), false);
    });
});

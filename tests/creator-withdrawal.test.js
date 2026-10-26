// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: WITHDRAWAL & PAYOUT MANAGEMENT TEST SUITE
// Tests UPI/Bank accounts, Data Masking, Withdrawal Rules (min ₹500, balance check),
// Atomic Balance Deductions, Admin Approval/Rejection/Refund workflows, and Role Isolation.
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

let creator = null;
let token = '';
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
    creator = await createTestInfluencer({
        name: 'Withdrawal Tester',
        email: `wth_tester_${ts}@example.com`,
        instagram_id: `wth_tester_${ts}`,
        bio: 'Testing withdrawals and payout methods',
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creator.email,
        influencer_id: creator.id,
        password: 'PasswordWithdraw1!'
    });

    const loginRes = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: creator.email,
            password: 'PasswordWithdraw1!'
        })
    });
    const loginJson = await loginRes.json();
    token = loginJson.token;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B: Withdrawal & Payout Management', () => {
    let upiMethodId = '';
    let bankMethodId = '';

    it('1. POST /api/creator/payout-methods adds UPI method with masking and default status', async () => {
        const res = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                method_type: 'upi',
                account_holder_name: 'Vikram Sharma',
                upi_id: 'vikram.sharma@okhdfcbank',
                is_default: true
            })
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.method_type, 'upi');
        assert.equal(json.data.is_default, true);
        assert.ok(json.data.upi_id.includes('***'));
        assert.ok(json.data.upi_id.endsWith('@okhdfcbank'));
        upiMethodId = json.data.id;
    });

    it('2. POST /api/creator/payout-methods adds Bank Account with masked account number (never full number)', async () => {
        const res = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                method_type: 'bank_account',
                account_holder_name: 'Vikram Sharma',
                account_number: '123456789012',
                ifsc_code: 'HDFC0001234',
                bank_name: 'HDFC Bank Ltd',
                is_default: false
            })
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.method_type, 'bank_account');
        assert.equal(json.data.account_number_masked, 'XXXXXX9012');
        assert.equal(json.data.account_number, undefined, 'Raw bank account number must never be returned in API response');
        bankMethodId = json.data.id;
    });

    it('3. GET /api/creator/payout-methods returns masked list of creator payout methods', async () => {
        const res = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.length >= 2, true);

        for (const m of json.data) {
            assert.ok(m.id);
            if (m.method_type === 'bank_account') {
                assert.ok(m.account_number_masked.startsWith('XXXXXX'));
                assert.equal(m.account_number, undefined);
            }
        }
    });

    it('4. POST /api/creator/withdrawals enforces minimum limit (₹500)', async () => {
        const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: 350, // Less than ₹500
                payout_method_id: upiMethodId
            })
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.error.code, 'BELOW_MINIMUM');
    });

    it('5. POST /api/creator/withdrawals rejects request if available balance is insufficient', async () => {
        const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: 2000, // Available balance is currently 0
                payout_method_id: upiMethodId
            })
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.error.code, 'INSUFFICIENT_BALANCE');
    });

    let withdrawalRecord = null;
    const testIdempotencyKey = `WTH-IDEMP-${Date.now()}`;

    it('6. POST /api/creator/withdrawals successfully creates request, debits balance atomically, and records ledger entry', async () => {
        // Attribute order and clear commission to provide available balance
        const orderRef = `WTH-ORDER-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 30000, // 10% = ₹3000
            influencer_id: creator.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: creator.id,
            order_reference: orderRef
        });

        const walletBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;
        assert.ok(walletBefore.available_balance >= 3000);

        const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: 1200,
                payout_method_id: upiMethodId,
                idempotency_key: testIdempotencyKey
            })
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.amount, 1200);
        assert.equal(json.data.payout_status, 'requested');
        assert.ok(json.data.withdrawal_reference.startsWith('WR-WTH-'));
        withdrawalRecord = json.data;

        // Verify balance debited atomically
        const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;
        assert.equal(walletAfter.available_balance, walletBefore.available_balance - 1200);

        // Verify immutable ledger entry
        const txsRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const txsJson = await txsRes.json();
        const wthTx = txsJson.data.find(t => t.reference_id === withdrawalRecord.id && t.transaction_type === 'withdrawal_requested');
        assert.ok(wthTx);
        assert.equal(wthTx.direction, 'debit');
        assert.equal(wthTx.amount, 1200);
    });

    it('7. IDEMPOTENCY: Duplicate withdrawal with same idempotency key returns cached response without double-debiting', async () => {
        const walletBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;

        const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: 1200,
                payout_method_id: upiMethodId,
                idempotency_key: testIdempotencyKey
            })
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.id, withdrawalRecord.id);

        const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;
        assert.equal(walletAfter.available_balance, walletBefore.available_balance, 'Balance must not be double debited');
    });

    it('8. DELETE /api/creator/payout-methods prevents deletion if active withdrawal references it', async () => {
        const res = await fetch(`${baseUrl}/api/creator/payout-methods/${upiMethodId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.error.code, 'PAYOUT_METHOD_IN_USE');
    });

    it('9. ROLE ISOLATION: Creator cannot approve own withdrawal via admin endpoint', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${withdrawalRecord.id}/approve`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Creator token
            }
        });

        assert.equal(res.status, 403);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.error.code, 'ADMIN_ACCESS_REQUIRED');
    });

    it('10. PATCH /api/admin/creator-withdrawals/:id/approve initiates processing with Razorpay payout ID', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${withdrawalRecord.id}/approve`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            }
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.payout_status, 'processing');
        assert.ok(json.data.razorpay_payout_id.startsWith('pout_'));
    });

    it('11. PATCH /api/admin/creator-withdrawals/:id/reject refunds balance with compensating ledger entry', async () => {
        // Create another withdrawal to test rejection workflow
        const resWth = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: 800,
                payout_method_id: bankMethodId
            })
        });
        const wthData = (await resWth.json()).data;

        const walletBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;

        // Admin rejects withdrawal
        const resReject = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wthData.id}/reject`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            },
            body: JSON.stringify({
                rejection_reason: 'Bank account name mismatch with KYC.'
            })
        });

        assert.equal(resReject.status, 200);
        const rejectJson = await resReject.json();
        assert.equal(rejectJson.success, true);
        assert.equal(rejectJson.data.payout_status, 'rejected');

        // Verify balance refunded
        const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data;
        assert.equal(walletAfter.available_balance, walletBefore.available_balance + 800);

        // Verify compensating reversal in ledger
        const txsRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const txsJson = await txsRes.json();
        const revTx = txsJson.data.find(t => t.reference_id === wthData.id && t.transaction_type === 'withdrawal_reversed');
        assert.ok(revTx);
        assert.equal(revTx.amount, 800);
        assert.equal(revTx.direction, 'credit');
    });

    it('12. POST /api/admin/creator-withdrawals/:id/retry rejects non-failed withdrawals', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${withdrawalRecord.id}/retry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            }
        });

        // withdrawalRecord is 'processing', not 'failed'
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, 'CANNOT_RETRY');
    });
});

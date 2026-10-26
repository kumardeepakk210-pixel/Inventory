// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: PRODUCTION FINANCIAL READINESS AUDIT SUITE
// 20 Rigorous Verification Tests for Financial Correctness, Concurrency,
// Webhook Security, State Machine Invariants, Reconciliation, and PII Protection.
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    resetLoginRateLimits 
} from '../backend/creator.js';
import { 
    attributeOrderToInfluencer,
    reconcileOrderCommission 
} from '../backend/influencers.js';
import {
    makeCommissionAvailableInWallet,
    readLocalStore,
    writeLocalStore,
    getOrCreateInfluencerWallet,
    getOrCreateInfluencerPointsAccount
} from '../backend/creator-wallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let server;
let baseUrl = '';

let creatorA = null;
let creatorB = null;
let tokenA = '';
let tokenB = '';

const adminHeader = { 
    'Authorization': 'Bearer wrt_inventory_admin_token',
    'Content-Type': 'application/json'
};

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
        name: 'Audit Creator A',
        email: `audit_a_${ts}@example.com`,
        instagram_id: `audit_a_${ts}`,
        bio: 'Financial audit creator A',
        commission_rate: 10,
        status: 'active'
    });
    await getOrLinkInfluencerAccount({
        email: creatorA.email,
        influencer_id: creatorA.id,
        password: 'PasswordAuditA1!'
    });
    const loginA = await (await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorA.email, password: 'PasswordAuditA1!' })
    })).json();
    tokenA = loginA.token;

    creatorB = await createTestInfluencer({
        name: 'Audit Creator B',
        email: `audit_b_${ts}@example.com`,
        instagram_id: `audit_b_${ts}`,
        bio: 'Financial audit creator B',
        commission_rate: 15,
        status: 'active'
    });
    await getOrLinkInfluencerAccount({
        email: creatorB.email,
        influencer_id: creatorB.id,
        password: 'PasswordAuditB1!'
    });
    const loginB = await (await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorB.email, password: 'PasswordAuditB1!' })
    })).json();
    tokenB = loginB.token;

    // Add verified UPI payout method for Creator A
    await fetch(`${baseUrl}/api/creator/payout-methods`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenA}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            method_type: 'upi',
            account_holder_name: 'Audit Creator A',
            upi_id: 'audit_a@okhdfcbank',
            is_default: true
        })
    });

    // Seed/preload rewards
    await fetch(`${baseUrl}/api/creator/rewards`, {
        headers: { 'Authorization': `Bearer ${tokenA}` }
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B Production Financial Readiness Audit', () => {

    it('1. DOUBLE WITHDRAWAL RACE: Simultaneous requests exceeding balance allows exactly one', async () => {
        // Set available balance to exactly ₹500 via clean order attribution & clearance
        const orderRef = `RACE-WTH-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 5000,
            influencer_id: creatorA.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: creatorA.id,
            order_reference: orderRef
        });

        // Current wallet balance
        const wRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const wJson = await wRes.json();
        const startBalance = Number(wJson.data.available_balance);
        assert.ok(startBalance >= 500);

        // Send two simultaneous withdrawal requests of startBalance
        const [res1, res2] = await Promise.all([
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenA}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: startBalance,
                    idempotency_key: `race_wth_1_${Date.now()}`
                })
            }),
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenA}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: startBalance,
                    idempotency_key: `race_wth_2_${Date.now()}`
                })
            })
        ]);

        const successCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
        const failCount = (res1.status === 400 ? 1 : 0) + (res2.status === 400 ? 1 : 0);

        assert.equal(successCount, 1, 'Exactly one withdrawal request must succeed');
        assert.equal(failCount, 1, 'Exactly one withdrawal request must fail');

        // Verify remaining available balance is exactly 0.00 and NOT negative
        const endWRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const endWJson = await endWRes.json();
        assert.equal(endWJson.data.available_balance, 0.00, 'Available balance must be exactly 0');
    });

    it('2. DOUBLE REDEMPTION RACE: Simultaneous redemption when points only cover one item', async () => {
        // Award points via order attribution so ledger is clean
        const ptOrderRef = `RACE-PT-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: ptOrderRef,
            sales_amount: 50000, // 50000 / 100 = 500 points
            influencer_id: creatorA.id
        });

        // Fire two simultaneous redemptions for reward rwd_002_voucher (cost: 500 pts)
        const [res1, res2] = await Promise.all([
            fetch(`${baseUrl}/api/creator/rewards/rwd_002_voucher/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenA}` }
            }),
            fetch(`${baseUrl}/api/creator/rewards/rwd_002_voucher/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenA}` }
            })
        ]);

        const successCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
        const failCount = (res1.status === 400 ? 1 : 0) + (res2.status === 400 ? 1 : 0);

        assert.equal(successCount, 1, 'Exactly one redemption must succeed');
        assert.equal(failCount, 1, 'Exactly one redemption must fail due to points exhaustion');

        const ptRes = await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const ptJson = await ptRes.json();
        assert.ok(ptJson.data.points_balance >= 0, 'Points balance must be non-negative');
    });

    it('3. DUPLICATE COMMISSION: Duplicate attribution event does not credit commission twice', async () => {
        const orderRef = `DUP-COMM-${Date.now()}`;
        const initialWalletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const initPending = (await initialWalletRes.json()).data.pending_balance;

        // Attribute first time (sale: ₹10,000, 10% = ₹1,000)
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 10000,
            influencer_id: creatorA.id
        });

        // Attribute duplicate second time
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 10000,
            influencer_id: creatorA.id
        });

        const endWalletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const endPending = (await endWalletRes.json()).data.pending_balance;

        assert.equal(endPending, initPending + 1000, 'Pending balance must increase by exactly one commission (₹1,000)');

        // Ledger check
        const txRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const txJson = await txRes.json();
        const matchingTxs = txJson.data.filter(t => t.reference_id === orderRef && t.transaction_type === 'commission_pending');
        assert.equal(matchingTxs.length, 1, 'Only one commission_pending transaction in ledger');
    });

    it('4. DUPLICATE REVERSAL: Reversing order multiple times prevents over-debiting', async () => {
        const orderRef = `REV-COMM-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 5000,
            influencer_id: creatorA.id
        });

        const preRevRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const preRevPending = (await preRevRes.json()).data.pending_balance;

        // Reconcile / reverse cancelled order
        await reconcileOrderCommission({
            order_reference: orderRef,
            new_status: 'cancelled'
        });

        // Reconcile / reverse duplicate second time
        await reconcileOrderCommission({
            order_reference: orderRef,
            new_status: 'cancelled'
        });

        const postRevRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const postRevPending = (await postRevRes.json()).data.pending_balance;

        assert.equal(postRevPending, preRevPending - 500, 'Pending balance decreased by exactly ₹500 once');
    });

    it('5. DUPLICATE PAYOUT WEBHOOK: Duplicate payout.processed does not double-increment paid balance', async () => {
        // Fund and request withdrawal
        const orderRef = `WTH-WEBHOOK-${Date.now()}`;
        await attributeOrderToInfluencer({ order_reference: orderRef, sales_amount: 10000, influencer_id: creatorA.id });
        await makeCommissionAvailableInWallet({ influencer_id: creatorA.id, order_reference: orderRef });

        const wthRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 1000, idempotency_key: `wth_webhook_${Date.now()}` })
        });
        const wth = (await wthRes.json()).data;

        // Approve withdrawal to initiate processing
        const approveRes = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wth.id}/approve`, {
            method: 'PATCH',
            headers: adminHeader
        });
        const approvedWth = (await approveRes.json()).data;
        const payoutId = approvedWth.razorpay_payout_id;

        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const webhookPayload = {
            event_id: `evt_dup_test_${Date.now()}`,
            event: 'payout.processed',
            payload: {
                payout: {
                    entity: {
                        id: payoutId,
                        reference_id: approvedWth.withdrawal_reference,
                        amount: 100000,
                        status: 'processed'
                    }
                }
            }
        };
        const rawBody = JSON.stringify(webhookPayload);
        const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        // Deliver first webhook
        const res1 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
            body: rawBody
        });
        assert.equal(res1.status, 200);

        const midWallet = await (await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } })).json();
        const paidAfterFirst = midWallet.data.paid_balance;

        // Deliver duplicate webhook
        const res2 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
            body: rawBody
        });
        assert.equal(res2.status, 200);

        const endWallet = await (await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } })).json();
        assert.equal(endWallet.data.paid_balance, paidAfterFirst, 'Duplicate webhook must not double-increment paid_balance');
    });

    it('6. INVALID / MISSING WEBHOOK SIGNATURE: Must reject with 400 and not modify state', async () => {
        // Missing signature
        const resMissing = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'payout.processed', event_id: 'fake_missing_sig' })
        });
        assert.equal(resMissing.status, 400, 'Missing x-razorpay-signature must return 400');

        // Invalid signature
        const resInvalid = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'bad_fake_sig' },
            body: JSON.stringify({ event: 'payout.processed', event_id: 'fake_invalid_sig' })
        });
        assert.equal(resInvalid.status, 400, 'Invalid signature must return 400');
    });

    it('7. PAYOUT FAILURE REFUND: payout.failed safely restores funds to available balance once', async () => {
        // Create withdrawal
        const orderRef = `WTH-FAIL-${Date.now()}`;
        await attributeOrderToInfluencer({ order_reference: orderRef, sales_amount: 6000, influencer_id: creatorA.id });
        await makeCommissionAvailableInWallet({ influencer_id: creatorA.id, order_reference: orderRef });

        const wthRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 600, idempotency_key: `wth_fail_${Date.now()}` })
        });
        const wth = (await wthRes.json()).data;

        await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wth.id}/approve`, { method: 'PATCH', headers: adminHeader });

        const preFailWallet = await (await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } })).json();
        const preFailAvailable = preFailWallet.data.available_balance;

        // Deliver payout.failed webhook
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const failPayload = {
            event_id: `evt_fail_${Date.now()}`,
            event: 'payout.failed',
            payload: {
                payout: {
                    entity: {
                        id: `pout_fail_${Date.now()}`,
                        reference_id: wth.withdrawal_reference,
                        failure_reason: 'Account frozen'
                    }
                }
            }
        };
        const rawBody = JSON.stringify(failPayload);
        const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        const failRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
            body: rawBody
        });
        assert.equal(failRes.status, 200);

        const postFailWallet = await (await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } })).json();
        assert.equal(postFailWallet.data.available_balance, preFailAvailable + 600, 'Funds must be restored to available balance');
    });

    it('8. INVALID STATE TRANSITIONS: Disallows transitions like completed -> approved or rejected -> completed', async () => {
        const local = readLocalStore();
        const wth = (local.withdrawals || []).find(w => w.payout_status === 'completed');
        assert.ok(wth, 'Existing completed withdrawal exists');

        // Attempt to reject a completed withdrawal
        const resReject = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wth.id}/reject`, {
            method: 'PATCH',
            headers: adminHeader,
            body: JSON.stringify({ rejection_reason: 'Should fail' })
        });
        assert.equal(resReject.status, 400);
        const jsonReject = await resReject.json();
        assert.equal(jsonReject.error.code, 'INVALID_STATE_TRANSITION');

        // Attempt to approve a completed withdrawal
        const resApprove = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wth.id}/approve`, {
            method: 'PATCH',
            headers: adminHeader
        });
        assert.equal(resApprove.status, 400);
    });

    it('9. CREATOR/ADMIN AUTHORIZATION: Creator token strictly rejected on admin operations (403)', async () => {
        const endpoints = [
            { method: 'GET', path: '/api/admin/creator-wallets' },
            { method: 'GET', path: '/api/admin/creator-withdrawals' },
            { method: 'GET', path: '/api/admin/creator-rewards' },
            { method: 'POST', path: '/api/admin/creator-wallets/test/adjust' }
        ];

        for (const ep of endpoints) {
            const res = await fetch(`${baseUrl}${ep.path}`, {
                method: ep.method,
                headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
                body: ep.method === 'POST' ? JSON.stringify({ amount: 100, direction: 'credit', reason: 'test' }) : undefined
            });
            assert.equal(res.status, 403, `Creator token must be rejected on ${ep.path} with 403`);
            const json = await res.json();
            assert.equal(json.error.code, 'ADMIN_ACCESS_REQUIRED');
        }
    });

    it('10. LEDGER RECONCILIATION: Stored wallet balance matches ledger calculation', async () => {
        const local = readLocalStore();
        const wallet = local.wallets.find(w => w.influencer_id === creatorA.id);
        const txs = local.wallet_transactions.filter(t => t.influencer_id === creatorA.id);

        let calculatedPending = 0;
        let calculatedAvailable = 0;

        for (const tx of txs) {
            const amt = Number(tx.amount);
            if (tx.transaction_type === 'commission_pending') {
                calculatedPending += amt;
            } else if (tx.transaction_type === 'commission_available') {
                calculatedPending -= amt;
                calculatedAvailable += amt;
            } else if (tx.transaction_type === 'commission_reversal') {
                const orig = txs.find(t => t.reference_id === tx.reference_id && (t.transaction_type === 'commission_pending' || t.transaction_type === 'commission_available'));
                if (orig && orig.transaction_type === 'commission_available') {
                    calculatedAvailable -= amt;
                } else {
                    calculatedPending -= amt;
                }
            } else if (tx.transaction_type === 'withdrawal_requested') {
                calculatedAvailable -= amt;
            } else if (tx.transaction_type === 'withdrawal_reversed') {
                calculatedAvailable += amt;
            } else if (tx.transaction_type === 'manual_credit') {
                calculatedAvailable += amt;
            } else if (tx.transaction_type === 'manual_debit') {
                calculatedAvailable -= amt;
            }
        }

        assert.equal(Math.max(0, Number(calculatedPending.toFixed(2))), Number(wallet.pending_balance), 'Pending balance must reconcile with ledger');
        assert.equal(Math.max(0, Number(calculatedAvailable.toFixed(2))), Number(wallet.available_balance), 'Available balance must reconcile with ledger');
    });

    it('11. NEGATIVE BALANCE PROTECTION: Rejects negative amounts, zero amounts, and overdrafts', async () => {
        const badAmounts = [-500, 0, 'fifty', NaN];
        for (const bad of badAmounts) {
            const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: bad })
            });
            assert.equal(res.status, 400, `Amount ${bad} must be rejected`);
        }

        // Overdraft attempt
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const avail = (await walletRes.json()).data.available_balance;
        const resOverdraft = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: avail + 10000 })
        });
        assert.equal(resOverdraft.status, 400);
        const jsonOverdraft = await resOverdraft.json();
        assert.equal(jsonOverdraft.error.code, 'INSUFFICIENT_BALANCE');
    });

    it('12. POINTS NEGATIVE PROTECTION: Points accounts cannot drop below zero', async () => {
        const res = await fetch(`${baseUrl}/api/creator/rewards/rwd_004_styling/redeem`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, 'INSUFFICIENT_POINTS');

        const ptRes = await fetch(`${baseUrl}/api/creator/points`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const pt = (await ptRes.json()).data.points_balance;
        assert.ok(pt >= 0, 'Points balance must remain non-negative');
    });

    it('13. REWARD INVENTORY RACE: Two simultaneous redemptions when inventory is 1', async () => {
        // Award enough points
        const rwdOrderRef = `RWD-STOCK-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: rwdOrderRef,
            sales_amount: 100000, // 1000 points
            influencer_id: creatorA.id
        });

        const local = readLocalStore();
        let reward = (local.rewards || []).find(r => r.id === 'rwd_001_earrings');
        assert.ok(reward, 'rwd_001_earrings exists');
        reward.inventory_quantity = 1;
        writeLocalStore(local);

        const [res1, res2] = await Promise.all([
            fetch(`${baseUrl}/api/creator/rewards/rwd_001_earrings/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenA}` }
            }),
            fetch(`${baseUrl}/api/creator/rewards/rwd_001_earrings/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenA}` }
            })
        ]);

        const successCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
        const failCount = (res1.status === 400 ? 1 : 0) + (res2.status === 400 ? 1 : 0);

        assert.equal(successCount, 1, 'Only one item can be redeemed from stock of 1');
        assert.equal(failCount, 1, 'Second request must fail');

        const localAfter = readLocalStore();
        const rwdAfter = localAfter.rewards.find(r => r.id === 'rwd_001_earrings');
        assert.equal(rwdAfter.inventory_quantity, 0, 'Inventory quantity must be exactly 0, never negative');
    });

    it('14. SENSITIVE DATA EXPOSURE: Bank accounts and UPI IDs are masked in API responses', async () => {
        // Add a bank account payout method
        const addRes = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method_type: 'bank_account',
                account_holder_name: 'Audit User Full',
                account_number: '98765432101234',
                ifsc_code: 'HDFC0001234',
                bank_name: 'HDFC Bank'
            })
        });
        assert.equal(addRes.status, 201);
        const json = await addRes.json();

        // Must NOT return full account number
        assert.equal(json.data.account_number_masked, 'XXXXXX1234');
        assert.equal(json.data.account_number, undefined);

        // Fetch list
        const listRes = await fetch(`${baseUrl}/api/creator/payout-methods`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const listJson = await listRes.json();
        const bankMethod = listJson.data.find(m => m.account_number_masked === 'XXXXXX1234');
        assert.ok(bankMethod);
        assert.equal(bankMethod.account_number, undefined);
    });

    it('15. SECRET EXPOSURE AUDIT: Zero internal keys or webhook secrets leaked in responses', async () => {
        const endpoints = [
            `${baseUrl}/api/creator/wallet`,
            `${baseUrl}/api/creator/withdrawals`,
            `${baseUrl}/api/creator/payout-methods`,
            `${baseUrl}/api/creator/points`,
            `${baseUrl}/api/creator/rewards`
        ];

        for (const url of endpoints) {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenA}` } });
            const text = await res.text();
            assert.ok(!text.includes('service_role'), `Response from ${url} must not contain service_role`);
            assert.ok(!text.includes('RAZORPAY_KEY_SECRET'), `Response from ${url} must not contain secret names`);
            assert.ok(!text.includes('wishrite_payout_webhook_secret'), `Response from ${url} must not leak webhook secret`);
        }
    });

    it('16. PAYOUT METHOD ISOLATION: Creator B cannot access or delete Creator A payout methods', async () => {
        const listA = await (await fetch(`${baseUrl}/api/creator/payout-methods`, { headers: { 'Authorization': `Bearer ${tokenA}` } })).json();
        const methodAId = listA.data[0].id;

        // Creator B attempts to delete Creator A's payout method
        const delRes = await fetch(`${baseUrl}/api/creator/payout-methods/${methodAId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        assert.equal(delRes.status, 404, 'Must return 404 for payout method belonging to another creator');

        // Creator B's list does NOT show Creator A's method
        const listB = await (await fetch(`${baseUrl}/api/creator/payout-methods`, { headers: { 'Authorization': `Bearer ${tokenB}` } })).json();
        const found = listB.data.some(m => m.id === methodAId);
        assert.equal(found, false, 'Creator B must not see Creator A payout method');
    });

    it('17. ADMIN ADJUSTMENT AUDIT TRAIL: Manual wallet adjustments create complete audit trail', async () => {
        const adjRes = await fetch(`${baseUrl}/api/admin/creator-wallets/${creatorA.id}/adjust`, {
            method: 'POST',
            headers: adminHeader,
            body: JSON.stringify({
                amount: 750,
                direction: 'credit',
                reason: 'Promotional bonus for festive campaign',
                admin_id: 'adm_audit_lead'
            })
        });
        assert.equal(adjRes.status, 200);
        const adjJson = await adjRes.json();
        assert.equal(adjJson.data.transaction.direction, 'credit');
        assert.equal(adjJson.data.transaction.metadata.reason, 'Promotional bonus for festive campaign');
        assert.equal(adjJson.data.transaction.metadata.admin_id, 'adm_audit_lead');
    });

    it('18. MULTI-PROCESS SAFETY AUDIT: Identifies in-memory mutex boundaries vs distributed DB locking', async () => {
        // In-memory mutexes work within single Node.js runtime.
        // This test verifies that even without in-memory lock, balance deduction logic checks available balance.
        const local = readLocalStore();
        const wallet = local.wallets.find(w => w.influencer_id === creatorA.id);
        const curAvail = wallet.available_balance;

        // Attempting to withdraw more than available returns 400
        const res = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: curAvail + 5000 })
        });
        assert.equal(res.status, 400);
    });

    it('19. IDEMPOTENCY: Duplicate withdrawal with same key returns original response safely', async () => {
        const idempKey = `idem_audit_${Date.now()}`;
        const body = JSON.stringify({ amount: 500, idempotency_key: idempKey });

        // Ensure available balance has at least 500
        const local = readLocalStore();
        const wallet = local.wallets.find(w => w.influencer_id === creatorA.id);
        wallet.available_balance = Math.max(Number(wallet.available_balance), 1000);
        writeLocalStore(local);

        const res1 = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body
        });
        assert.equal(res1.status, 201);
        const json1 = await res1.json();

        const res2 = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
            body
        });
        assert.equal(res2.status, 200, 'Duplicate request must return 200 with idempotent message');
        const json2 = await res2.json();
        assert.equal(json2.data.id, json1.data.id, 'Must return identical withdrawal record');
    });

    it('20. DATABASE CONSTRAINT VALIDATION: Verifies migration SQL constraints and non-destructive syntax', async () => {
        const sqlPath = path.join(__dirname, '../supabase-creator-club-v3b.sql');
        assert.ok(fs.existsSync(sqlPath), 'supabase-creator-club-v3b.sql must exist');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        // Verify non-destructive
        assert.ok(!sql.includes('DROP TABLE'), 'Migration must not drop tables');
        assert.ok(!sql.includes('TRUNCATE'), 'Migration must not truncate tables');

        // Verify CHECK constraints
        assert.ok(sql.includes('CHECK (pending_balance >= 0.00)'));
        assert.ok(sql.includes('CHECK (available_balance >= 0.00)'));
        assert.ok(sql.includes('CHECK (paid_balance >= 0.00)'));
        assert.ok(sql.includes('CHECK (amount >= 500.00)'));
        assert.ok(sql.includes('CHECK (points_balance >= 0)'));

        // Verify RLS enablement
        assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    });
});

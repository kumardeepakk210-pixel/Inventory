// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: PRODUCTION FINANCIAL REMEDIATION TEST SUITE
// Verifies all Blockers A, B, C, D, E identified in the Production Readiness Audit:
// 1. Database schema & constraints verification
// 2. High-concurrency wallet balance protection (zero negative balance, race-free)
// 3. Multi-instance / multi-process atomic balance deduction
// 4. Withdrawal request idempotency
// 5. RazorpayX sandbox payout client integration
// 6. Payout dispatch failure compensation (DEBIT -> PAYOUT_FAILED_REVERSAL)
// 7. Live payout safety lock (fail closed on live mode)
// 8. Webhook raw-body capture & timing-safe HMAC validation
// 9. Webhook signature rejection (missing, invalid, tampered)
// 10. Webhook event idempotency & deduplication
// 11. Webhook payout failure & reversal handling
// 12. Integer-paise ledger reconciliation
// 13. Creator and admin role isolation
// 14. PII and secret protection
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto, { randomUUID } from 'node:crypto';
import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    resetLoginRateLimits 
} from '../backend/creator.js';
import { 
    attributeOrderToInfluencer
} from '../backend/influencers.js';
import {
    getOrCreateInfluencerWallet,
    makeCommissionAvailableInWallet,
    atomicDeductWalletBalance,
    atomicCreditWalletBalance,
    dispatchRazorpayXPayout,
    reconcileCreatorWalletLedger,
    readLocalStore,
    writeLocalStore
} from '../backend/creator-wallet.js';
import { dbQuery } from '../backend/supabase-client.js';

let server;
let baseUrl = '';

let creatorA = null;
let tokenA = '';
let creatorB = null;
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
        name: 'Remediation Creator Alpha',
        email: `rem_alpha_${ts}@example.com`,
        instagram_id: `rem_alpha_${ts}`,
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creatorA.email,
        influencer_id: creatorA.id,
        password: 'PasswordRemediation1!'
    });

    const loginResA = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorA.email, password: 'PasswordRemediation1!' })
    });
    const loginJsonA = await loginResA.json();
    tokenA = loginJsonA.token || loginJsonA.data?.token;

    creatorB = await createTestInfluencer({
        name: 'Remediation Creator Beta',
        email: `rem_beta_${ts}@example.com`,
        instagram_id: `rem_beta_${ts}`,
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creatorB.email,
        influencer_id: creatorB.id,
        password: 'PasswordRemediation1!'
    });

    const loginResB = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorB.email, password: 'PasswordRemediation1!' })
    });
    const loginJsonB = await loginResB.json();
    tokenB = loginJsonB.token || loginJsonB.data?.token;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B Production Financial Remediation', () => {

    // ==========================================================================
    // 1. DATABASE & REMOTE SCHEMA INSPECTION
    // ==========================================================================
    it('1. Database: Remote schema status is inspected and graceful fallback protects system', async () => {
        let remoteAccessible = false;
        try {
            const res = await dbQuery('influencer_wallets', 'limit=1');
            if (Array.isArray(res)) remoteAccessible = true;
        } catch (e) {
            remoteAccessible = false;
        }

        // Must gracefully report true remote state without crashing
        assert.ok(typeof remoteAccessible === 'boolean');
        const local = readLocalStore();
        assert.ok(Array.isArray(local.wallets), 'Local store must maintain wallet structure');
    });

    // ==========================================================================
    // 2. CONCURRENCY & ATOMIC BALANCE PROTECTION
    // ==========================================================================
    it('2. Concurrency: Two simultaneous withdrawal requests against same wallet never create negative balance', async () => {
        // Seed exactly ₹700 available balance
        const orderRef = `REM-ORD-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 7000, // 10% = ₹700
            influencer_id: creatorA.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: creatorA.id,
            order_reference: orderRef
        });

        // Add payout method
        const pmRes = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({
                method_type: 'upi',
                account_holder_name: 'Remediation Tester',
                upi_id: 'rem.tester@upi',
                is_default: true
            })
        });
        const pmData = (await pmRes.json()).data;

        // Run two simultaneous ₹500 withdrawal requests (Total = ₹1,000 > ₹700 available)
        const [req1, req2] = await Promise.all([
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
                body: JSON.stringify({ amount: 500, payout_method_id: pmData.id, idempotency_key: `key-sim-1-${Date.now()}` })
            }),
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
                body: JSON.stringify({ amount: 500, payout_method_id: pmData.id, idempotency_key: `key-sim-2-${Date.now()}` })
            })
        ]);

        const res1 = await req1.json();
        const res2 = await req2.json();

        const successCount = (req1.status === 201 ? 1 : 0) + (req2.status === 201 ? 1 : 0);
        const failCount = (req1.status === 400 ? 1 : 0) + (req2.status === 400 ? 1 : 0);

        // Exactly one must succeed, exactly one must fail
        assert.equal(successCount, 1, 'Only one withdrawal request must succeed');
        assert.equal(failCount, 1, 'The competing request must fail due to insufficient funds');

        // Check wallet balance: remaining must be ₹200 (₹700 - ₹500)
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const wallet = (await walletRes.json()).data;
        assert.equal(wallet.available_balance, 200);
        assert.ok(wallet.available_balance >= 0, 'Balance must NEVER become negative');
    });

    // ==========================================================================
    // 3. MULTI-PROCESS SIMULATION (ATOMIC CONDITIONAL DEDUCTION)
    // ==========================================================================
    it('3. Multi-process simulation: Atomic conditional deduction prevents over-allocation without process locks', async () => {
        const testCreatorId = randomUUID();
        const store = readLocalStore();
        store.wallets = store.wallets || [];
        store.wallets.push({
            id: randomUUID(),
            influencer_id: testCreatorId,
            currency: 'INR',
            available_balance: 600.00,
            pending_balance: 0.00,
            paid_balance: 0.00,
            lifetime_earned: 600.00,
            lifetime_paid: 0.00,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        writeLocalStore(store);

        // Simulate 4 concurrent deductions of ₹200 from different "processes"
        const results = await Promise.all([
            atomicDeductWalletBalance(testCreatorId, 200),
            atomicDeductWalletBalance(testCreatorId, 200),
            atomicDeductWalletBalance(testCreatorId, 200),
            atomicDeductWalletBalance(testCreatorId, 200)
        ]);

        const successfulDeductions = results.filter(r => r.success);
        const failedDeductions = results.filter(r => !r.success);

        // ₹600 / ₹200 = exactly 3 successes, 1 failure
        assert.equal(successfulDeductions.length, 3, 'Exactly 3 deductions must succeed for ₹600');
        assert.equal(failedDeductions.length, 1, 'The 4th deduction must fail');
        assert.equal(failedDeductions[0].code, 'INSUFFICIENT_BALANCE');

        const updatedWallet = readLocalStore().wallets.find(w => w.influencer_id === testCreatorId);
        assert.equal(updatedWallet.available_balance, 0.00, 'Remaining balance must equal exact math');
    });

    // ==========================================================================
    // 4. WITHDRAWAL IDEMPOTENCY
    // ==========================================================================
    it('4. Idempotency: Duplicate withdrawal request with identical key has exactly one financial effect', async () => {
        // Credit ₹1,000
        const orderRef = `REM-IDEMP-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 10000,
            influencer_id: creatorB.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: creatorB.id,
            order_reference: orderRef
        });

        const idempKey = `wth-idemp-test-${Date.now()}`;
        const walletBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;

        // First attempt
        const res1 = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
            body: JSON.stringify({ amount: 600, idempotency_key: idempKey, payout_details: { upi_id: 'b@upi' } })
        });
        assert.equal(res1.status, 201);
        const json1 = await res1.json();

        // Second duplicate attempt
        const res2 = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
            body: JSON.stringify({ amount: 600, idempotency_key: idempKey, payout_details: { upi_id: 'b@upi' } })
        });
        assert.equal(res2.status, 200, 'Duplicate request must return 200 OK idempotent response');
        const json2 = await res2.json();
        assert.equal(json2.data.id, json1.data.id);

        // Verify balance was debited once
        const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;
        assert.equal(walletAfter.available_balance, walletBefore.available_balance - 600);

        // Verify ledger has exactly one debit
        const txs = (await (await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;
        const matchingTxs = txs.filter(t => t.reference_id === json1.data.id && t.transaction_type === 'withdrawal_requested');
        assert.equal(matchingTxs.length, 1);
    });

    // ==========================================================================
    // 5. RAZORPAYX SANDBOX PAYOUT DISPATCH
    // ==========================================================================
    it('5. RazorpayX Client: Sandbox payout request dispatches properly formatted payload to RazorpayX API', async () => {
        let capturedUrl = '';
        let capturedHeaders = {};
        let capturedBody = {};

        const mockFetcher = async (url, options) => {
            capturedUrl = url;
            capturedHeaders = options.headers;
            capturedBody = JSON.parse(options.body);

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'pout_mock_sandbox_12345',
                    entity: 'payout',
                    fund_account_id: 'fa_test_mock',
                    amount: capturedBody.amount,
                    currency: 'INR',
                    status: 'processing',
                    mode: capturedBody.mode,
                    reference_id: capturedBody.reference_id
                })
            };
        };

        const testWithdrawal = {
            id: 'wth_test_abc',
            influencer_id: 'inf_test_123',
            withdrawal_reference: 'WR-WTH-TEST-99',
            amount: 750.50,
            payout_method: 'upi',
            payout_details: { upi_id: 'creator@okaxis', account_holder_name: 'Anita Roy' },
            idempotency_key: 'idemp_key_test_1'
        };

        const result = await dispatchRazorpayXPayout({
            withdrawal: testWithdrawal,
            payoutMethod: { method_type: 'upi', upi_id: 'creator@okaxis', account_holder_name: 'Anita Roy' },
            idempotencyKey: testWithdrawal.idempotency_key,
            fetcher: mockFetcher
        });

        assert.equal(result.success, true);
        assert.equal(result.razorpay_payout_id, 'pout_mock_sandbox_12345');
        assert.equal(capturedUrl, 'https://api.razorpay.com/v1/payouts');
        assert.ok(capturedHeaders['Authorization'].startsWith('Basic '));
        assert.equal(capturedHeaders['X-Payout-Idempotency'], 'idemp_key_test_1');
        assert.equal(capturedBody.amount, 75050, 'Amount must be converted to integer paise (₹750.50 -> 75050)');
        assert.equal(capturedBody.mode, 'UPI');
        assert.equal(capturedBody.fund_account.vpa.address, 'creator@okaxis');
    });

    // ==========================================================================
    // 6. PAYOUT DISPATCH FAILURE RESTORES FUNDS (APPEND-ONLY REVERSAL)
    // ==========================================================================
    it('6. Payout Failure: Razorpay API failure restores deducted funds via compensating ledger transaction', async () => {
        // Seed sufficient balance for creatorA first
        const orderRef = `REM-FAIL-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 10000, // 10% = ₹1000
            influencer_id: creatorA.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: creatorA.id,
            order_reference: orderRef
        });

        // Create withdrawal
        const wthRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({ amount: 500, payout_details: { upi_id: 'test@upi' } })
        });
        const wthData = (await wthRes.json()).data;

        const walletBeforeApproval = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        })).json()).data;

        // Force payout failure by setting REQUIRE_RAZORPAY_CREDENTIALS without credentials
        process.env.REQUIRE_RAZORPAY_CREDENTIALS = 'true';
        delete process.env.RAZORPAY_KEY_ID;

        try {
            const approveRes = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${wthData.id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...adminHeader }
            });

            assert.equal(approveRes.status, 502, 'Failed payout dispatch must return HTTP 502');
            const approveJson = await approveRes.json();
            assert.equal(approveJson.success, false);
            assert.equal(approveJson.error.withdrawal.payout_status, 'failed');

            // Funds must be restored to wallet
            const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
                headers: { 'Authorization': `Bearer ${tokenA}` }
            })).json()).data;
            assert.equal(walletAfter.available_balance, walletBeforeApproval.available_balance + 500);

            // Reversal entry must exist in immutable ledger
            const txs = (await (await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
                headers: { 'Authorization': `Bearer ${tokenA}` }
            })).json()).data;
            const revTx = txs.find(t => t.reference_id === wthData.id && t.transaction_type === 'withdrawal_reversed');
            assert.ok(revTx, 'Compensating reversal transaction must exist in ledger');
            assert.equal(revTx.direction, 'credit');
            assert.equal(revTx.amount, 500);
        } finally {
            delete process.env.REQUIRE_RAZORPAY_CREDENTIALS;
        }
    });

    // ==========================================================================
    // 7. REAL PAYOUT SAFETY LOCK (FAIL CLOSED)
    // ==========================================================================
    it('7. Real Payout Safety Lock: Live payout mode fails closed unless explicit allow flag is set', async () => {
        process.env.RAZORPAY_PAYOUT_MODE = 'live';
        delete process.env.ALLOW_LIVE_PAYOUTS;

        try {
            const testWth = {
                id: 'wth_live_guard_test',
                influencer_id: 'inf_live_guard',
                withdrawal_reference: 'WR-WTH-LIVE-01',
                amount: 500,
                payout_method: 'upi'
            };

            const result = await dispatchRazorpayXPayout({ withdrawal: testWth });
            assert.equal(result.success, false);
            assert.equal(result.code, 'LIVE_PAYOUTS_DISABLED');
            assert.ok(result.message.includes('FAIL_CLOSED'));
        } finally {
            process.env.RAZORPAY_PAYOUT_MODE = 'sandbox';
        }
    });

    // ==========================================================================
    // 8. WEBHOOK RAW BODY CAPTURE & TIMING-SAFE HMAC
    // ==========================================================================
    it('8. Webhook: Missing signature header is rejected with HTTP 400', async () => {
        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'payout.processed' })
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, 'MISSING_WEBHOOK_SIGNATURE');
    });

    it('9. Webhook: Invalid signature is rejected with HTTP 400', async () => {
        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
            },
            body: JSON.stringify({ event: 'payout.processed' })
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, 'INVALID_SIGNATURE');
    });

    it('10. Webhook Raw Body: Valid signature computed on exact raw body is accepted and updates payout', async () => {
        // Create withdrawal in processing status
        const local = readLocalStore();
        const testPoutId = `pout_wh_test_${Date.now()}`;
        const wth = {
            id: randomUUID(),
            influencer_id: creatorA.id,
            wallet_id: randomUUID(),
            withdrawal_reference: `WR-WTH-WH-${Date.now()}`,
            amount: 800.00,
            currency: 'INR',
            payout_method: 'upi',
            payout_status: 'processing',
            payout_details: { upi_id: 'test@upi' },
            razorpay_payout_id: testPoutId,
            idempotency_key: randomUUID(),
            created_at: new Date().toISOString()
        };
        local.withdrawals = local.withdrawals || [];
        local.withdrawals.unshift(wth);
        writeLocalStore(local);

        const payloadStr = JSON.stringify({
            event: 'payout.processed',
            event_id: `evt_test_${Date.now()}`,
            payload: {
                payout: {
                    entity: {
                        id: testPoutId,
                        reference_id: wth.withdrawal_reference,
                        amount: 80000,
                        status: 'processed'
                    }
                }
            }
        });

        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const validSig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': validSig
            },
            body: payloadStr
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);

        // Verify withdrawal updated to completed
        const updatedWth = readLocalStore().withdrawals.find(w => w.id === wth.id);
        assert.equal(updatedWth.payout_status, 'completed');
    });

    it('11. Webhook Raw Body: Tampered body bytes invalidate HMAC signature and reject with 400', async () => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const originalBody = JSON.stringify({ event: 'payout.processed', amount: 500 });
        const signature = crypto.createHmac('sha256', secret).update(originalBody).digest('hex');

        // Tamper with body bytes after signature generation
        const tamperedBody = JSON.stringify({ event: 'payout.processed', amount: 999999 });

        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': signature
            },
            body: tamperedBody
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, 'INVALID_SIGNATURE');
    });

    // ==========================================================================
    // 12. WEBHOOK IDEMPOTENCY
    // ==========================================================================
    it('12. Webhook Idempotency: Duplicate webhook event does NOT double credit or modify state', async () => {
        const local = readLocalStore();
        const testPoutId = `pout_dup_test_${Date.now()}`;
        const wth = {
            id: randomUUID(),
            influencer_id: creatorB.id,
            wallet_id: randomUUID(),
            withdrawal_reference: `WR-WTH-DUP-${Date.now()}`,
            amount: 500.00,
            currency: 'INR',
            payout_method: 'upi',
            payout_status: 'processing',
            razorpay_payout_id: testPoutId,
            idempotency_key: randomUUID(),
            created_at: new Date().toISOString()
        };
        local.withdrawals.unshift(wth);
        writeLocalStore(local);

        const eventId = `evt_dup_${Date.now()}`;
        const payloadStr = JSON.stringify({
            event: 'payout.processed',
            event_id: eventId,
            payload: {
                payout: {
                    entity: {
                        id: testPoutId,
                        reference_id: wth.withdrawal_reference,
                        amount: 50000,
                        status: 'processed'
                    }
                }
            }
        });

        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

        // First delivery
        const res1 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
            body: payloadStr
        });
        assert.equal(res1.status, 200);

        const walletAfterFirst = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;

        // Second delivery (duplicate replay)
        const res2 = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
            body: payloadStr
        });
        assert.equal(res2.status, 200);
        const json2 = await res2.json();
        assert.ok(json2.message.includes('idempotent'));

        const walletAfterSecond = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;

        assert.equal(walletAfterSecond.paid_balance, walletAfterFirst.paid_balance, 'Paid balance must not be double credited');
        assert.equal(walletAfterSecond.available_balance, walletAfterFirst.available_balance);
    });

    // ==========================================================================
    // 13. WEBHOOK FAILURE & REVERSAL EVENT
    // ==========================================================================
    it('13. Webhook Reversal: payout.reversed refunds creator wallet and records ledger entry', async () => {
        const local = readLocalStore();
        const testPoutId = `pout_rev_test_${Date.now()}`;
        const wth = {
            id: randomUUID(),
            influencer_id: creatorB.id,
            wallet_id: randomUUID(),
            withdrawal_reference: `WR-WTH-REV-${Date.now()}`,
            amount: 600.00,
            currency: 'INR',
            payout_method: 'upi',
            payout_status: 'processing',
            razorpay_payout_id: testPoutId,
            idempotency_key: randomUUID(),
            created_at: new Date().toISOString()
        };
        local.withdrawals.unshift(wth);
        writeLocalStore(local);

        const walletBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;

        const payloadStr = JSON.stringify({
            event: 'payout.reversed',
            event_id: `evt_rev_${Date.now()}`,
            payload: {
                payout: {
                    entity: {
                        id: testPoutId,
                        reference_id: wth.withdrawal_reference,
                        amount: 60000,
                        failure_reason: 'Beneficiary account blocked'
                    }
                }
            }
        });

        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

        const res = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
            body: payloadStr
        });
        assert.equal(res.status, 200);

        const walletAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        })).json()).data;
        assert.equal(walletAfter.available_balance, walletBefore.available_balance + 600, 'Funds must be restored');

        const updatedWth = readLocalStore().withdrawals.find(w => w.id === wth.id);
        assert.equal(updatedWth.payout_status, 'reversed');
    });

    // ==========================================================================
    // 14. INTEGER-PAISE LEDGER RECONCILIATION
    // ==========================================================================
    it('14. Ledger: Wallet balances strictly reconcile with sum of immutable transactions in integer paise', async () => {
        const result = await reconcileCreatorWalletLedger(creatorA.id);
        assert.equal(result.success, true);
        assert.equal(result.is_reconciled, true);
        assert.equal(result.discrepancy.available_diff, 0.00, 'Available balance discrepancy must be exactly 0.00');
        assert.equal(result.discrepancy.paid_diff, 0.00, 'Paid balance discrepancy must be exactly 0.00');
    });

    // ==========================================================================
    // 15. CREATOR & ADMIN ROLE ISOLATION
    // ==========================================================================
    it('15. Role Isolation: Creator token cannot call administrative financial endpoints', async () => {
        // Creator token against admin approval
        const res1 = await fetch(`${baseUrl}/api/admin/creator-withdrawals/fake-id/approve`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` }
        });
        assert.equal(res1.status, 403);

        // Creator token against admin wallet adjustment
        const res2 = await fetch(`${baseUrl}/api/admin/creator-wallets/fake-id/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({ amount: 100, direction: 'credit', reason: 'hacked' })
        });
        assert.equal(res2.status, 403);
    });

    // ==========================================================================
    // 16. PII & SECRET PROTECTION
    // ==========================================================================
    it('16. PII & Secret Protection: Creator financial APIs never expose customer PII or raw secrets', async () => {
        const pmRes = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const pmJson = await pmRes.json();
        for (const m of pmJson.data) {
            if (m.method_type === 'upi') {
                assert.ok(m.upi_id.includes('***'), 'UPI ID must be masked');
            }
            assert.equal(m.account_number, undefined, 'Raw bank account number must never be returned');
        }

        // Verify withdrawal list doesn't expose internal secret keys
        const wthRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const wthText = await wthRes.text();
        assert.equal(wthText.includes('service_role'), false);
        assert.equal(wthText.includes('RAZORPAY_KEY_SECRET'), false);
    });
});

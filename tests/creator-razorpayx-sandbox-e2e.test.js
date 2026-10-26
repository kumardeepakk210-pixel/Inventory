// ==============================================================================
// WISHRITE CREATOR CLUB — RAZORPAYX SANDBOX E2E VALIDATION SUITE
// Validates Environment Safety, Creator Onboarding, Commission Ledger (₹500.00),
// Payout Method Configuration, Atomic Wallet Deduction, Sandbox Payout Dispatch,
// Raw Body Webhooks, Compensating Reversals, Integer Paise Reconciliation & Security Isolation.
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto, { randomUUID } from 'crypto';
import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    resetLoginRateLimits 
} from '../backend/creator.js';
import { 
    attributeOrderToInfluencer
} from '../backend/influencers.js';
import {
    makeCommissionAvailableInWallet,
    readLocalStore,
    dispatchRazorpayXPayout,
    atomicDeductWalletBalance
} from '../backend/creator-wallet.js';

let server;
let baseUrl = '';

let testCreatorA = null;
let testCreatorB = null;
let tokenA = '';
let tokenB = '';
let payoutMethodA = null;

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

    // Create Creator A (Primary Sandbox Test Creator)
    testCreatorA = await createTestInfluencer({
        name: 'RazorpayX Sandbox Tester A',
        email: `rzpx_sbx_a_${ts}@wishrite-test.in`,
        instagram_id: `rzpx_tester_a_${ts}`,
        bio: 'Dedicated sandbox E2E test creator',
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: testCreatorA.email,
        influencer_id: testCreatorA.id,
        password: 'PasswordSandbox1!'
    });

    const loginResA = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testCreatorA.email, password: 'PasswordSandbox1!' })
    });
    const loginJsonA = await loginResA.json();
    tokenA = loginJsonA.token || loginJsonA.data?.token;

    // Create Creator B (Security Isolation Test Creator)
    testCreatorB = await createTestInfluencer({
        name: 'RazorpayX Sandbox Tester B',
        email: `rzpx_sbx_b_${ts}@wishrite-test.in`,
        instagram_id: `rzpx_tester_b_${ts}`,
        bio: 'Isolation test creator',
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: testCreatorB.email,
        influencer_id: testCreatorB.id,
        password: 'PasswordSandbox1!'
    });

    const loginResB = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testCreatorB.email, password: 'PasswordSandbox1!' })
    });
    const loginJsonB = await loginResB.json();
    tokenB = loginJsonB.token || loginJsonB.data?.token;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — RazorpayX Sandbox E2E Validation', () => {

    // ==========================================================================
    // PHASE 3: ENVIRONMENT SAFETY
    // ==========================================================================
    it('Phase 3: Environment Safety — RAZORPAYX_MODE=sandbox and ALLOW_LIVE_PAYOUTS=false enforced', async () => {
        const mode = (process.env.RAZORPAYX_MODE || process.env.RAZORPAY_PAYOUT_MODE || 'sandbox').toLowerCase();
        assert.equal(mode, 'sandbox', 'RAZORPAYX_MODE must be set to sandbox');

        const liveAllowed = process.env.ALLOW_LIVE_PAYOUTS === 'true';
        assert.equal(liveAllowed, false, 'ALLOW_LIVE_PAYOUTS must be false');

        // Test fail-closed guard: if live mode is attempted with ALLOW_LIVE_PAYOUTS=false, it must reject
        const fakeWithdrawal = { id: 'wth_test_guard', amount: 500, influencer_id: testCreatorA.id };
        const origMode = process.env.RAZORPAYX_MODE;
        try {
            process.env.RAZORPAYX_MODE = 'live';
            const liveAttempt = await dispatchRazorpayXPayout({ withdrawal: fakeWithdrawal });
            assert.equal(liveAttempt.success, false);
            assert.equal(liveAttempt.code, 'LIVE_PAYOUTS_DISABLED');
        } finally {
            process.env.RAZORPAYX_MODE = origMode;
        }
    });

    // ==========================================================================
    // PHASE 4: TEST CREATOR & WALLET INITIALIZATION
    // ==========================================================================
    it('Phase 4: Test Creator — Account and wallet initialized via legitimate application flow', async () => {
        assert.ok(testCreatorA.id, 'Creator A must possess canonical UUID influencer_id');
        assert.ok(tokenA, 'Creator A must be authenticated with valid JWT');

        // Initialize wallet via standard GET /api/creator/wallet endpoint
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        assert.equal(walletRes.status, 200);
        const walletJson = await walletRes.json();
        assert.equal(walletJson.success, true);
        assert.equal(Number(walletJson.data.available_balance), 0);
        assert.equal(Number(walletJson.data.pending_balance), 0);
        assert.equal(Number(walletJson.data.paid_balance), 0);
    });

    // ==========================================================================
    // PHASE 5: CREDIT TEST COMMISSION (EXACTLY ₹500.00 / 50000 PAISE)
    // ==========================================================================
    it('Phase 5: Credit Test Commission — Controlled ₹500.00 (50,000 paise) credited via ledger', async () => {
        const orderRef = `RZPX-ORD-${Date.now()}`;
        // At 10% commission, sales amount of 5000 yields exactly ₹500.00 commission
        const attrResult = await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 5000,
            influencer_id: testCreatorA.id
        });
        assert.equal(Number(attrResult.commission_amount), 500.00);

        // Transition pending commission to available
        await makeCommissionAvailableInWallet({
            influencer_id: testCreatorA.id,
            order_reference: orderRef
        });

        // Query wallet
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const walletJson = await walletRes.json();
        assert.equal(walletJson.success, true);

        // Strict integer paise reconciliation
        const availablePaise = Math.round(Number(walletJson.data.available_balance) * 100);
        assert.equal(availablePaise, 50000, 'available_balance must equal exactly 50,000 paise (₹500.00)');

        // Verify ledger transactions
        const txRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const txJson = await txRes.json();
        assert.equal(txJson.success, true);
        const creditTx = txJson.data.find(t => t.reference_id === orderRef && t.transaction_type === 'commission_available');
        assert.ok(creditTx, 'Ledger must contain commission_available credit transaction');
        assert.equal(Math.round(Number(creditTx.amount) * 100), 50000, 'Ledger transaction must equal 50,000 paise');
    });

    // ==========================================================================
    // PHASE 6: CONFIGURE TEST PAYOUT METHOD
    // ==========================================================================
    it('Phase 6: Configure Test Payout Method — Configures sandbox beneficiary with data masking', async () => {
        // Add Razorpay official sandbox bank beneficiary
        const pmRes = await fetch(`${baseUrl}/api/creator/payout-methods`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenA}`
            },
            body: JSON.stringify({
                method_type: 'bank_account',
                account_holder_name: 'WishRite Sandbox Beneficiary',
                account_number: '7878780080316316',
                ifsc_code: 'RAZR0000001',
                bank_name: 'Razorpay Sandbox Bank',
                is_default: true
            })
        });

        assert.equal(pmRes.status, 201);
        const pmJson = await pmRes.json();
        assert.equal(pmJson.success, true);
        payoutMethodA = pmJson.data;

        assert.equal(payoutMethodA.method_type, 'bank_account');
        assert.equal(payoutMethodA.is_default, true);
        assert.equal(payoutMethodA.ifsc_code, 'RAZR0000001');

        // Sensitive plain account number must NEVER be exposed in response
        assert.equal(payoutMethodA.account_number, undefined);
        assert.ok(payoutMethodA.account_number_masked.includes('XXXXXX'));
        assert.ok(payoutMethodA.account_number_masked.endsWith('6316'));
    });

    // ==========================================================================
    // PHASE 7: WITHDRAWAL REQUEST & IDEMPOTENCY
    // ==========================================================================
    let withdrawalRecord = null;
    const testIdempotencyKey = `idemp-rzpx-${Date.now()}`;

    it('Phase 7: Withdrawal Request — Submits ₹500.00 withdrawal and verifies atomic deduction & idempotency', async () => {
        const withRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenA}`
            },
            body: JSON.stringify({
                amount: 500.00,
                payout_method_id: payoutMethodA.id,
                idempotency_key: testIdempotencyKey
            })
        });

        assert.equal(withRes.status, 201);
        const withJson = await withRes.json();
        assert.equal(withJson.success, true);
        withdrawalRecord = withJson.data;

        assert.equal(Number(withdrawalRecord.amount), 500.00);
        assert.equal(withdrawalRecord.payout_status, 'requested');
        assert.ok(withdrawalRecord.withdrawal_reference.startsWith('WR-WTH-'));

        // Verify wallet balance is now ₹0.00 (500.00 deducted)
        const walletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const walletJson = await walletRes.json();
        assert.equal(Math.round(Number(walletJson.data.available_balance) * 100), 0, 'Wallet available balance must be ₹0.00 after deduction');

        // IDEMPOTENCY: Repeated request with the SAME idempotency key returns existing record without second debit
        const repeatRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenA}`
            },
            body: JSON.stringify({
                amount: 500.00,
                payout_method_id: payoutMethodA.id,
                idempotency_key: testIdempotencyKey
            })
        });

        assert.equal(repeatRes.status, 200, 'Idempotent request must return HTTP 200 OK');
        const repeatJson = await repeatRes.json();
        assert.equal(repeatJson.data.id, withdrawalRecord.id, 'Idempotent request must return original withdrawal ID');
    });

    // ==========================================================================
    // PHASE 8: ATOMIC WALLET DEDUCTION & CONCURRENCY RACE
    // ==========================================================================
    it('Phase 8: Atomic Deduction Concurrency — Two simultaneous requests for same ₹500 allow exactly one', async () => {
        // Credit another ₹500.00 to test simultaneous race
        const raceOrder = `RACE-ORD-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: raceOrder,
            sales_amount: 5000,
            influencer_id: testCreatorA.id
        });
        await makeCommissionAvailableInWallet({
            influencer_id: testCreatorA.id,
            order_reference: raceOrder
        });

        // Verify balance is ₹500.00
        const wBefore = await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const wBeforeJson = await wBefore.json();
        assert.equal(Number(wBeforeJson.data.available_balance), 500.00);

        // Fire two competing requests simultaneously
        const [res1, res2] = await Promise.all([
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
                body: JSON.stringify({ amount: 500.00, payout_method_id: payoutMethodA.id, idempotency_key: `race-1-${Date.now()}` })
            }),
            fetch(`${baseUrl}/api/creator/withdrawals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
                body: JSON.stringify({ amount: 500.00, payout_method_id: payoutMethodA.id, idempotency_key: `race-2-${Date.now()}` })
            })
        ]);

        const successCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
        const failCount = (res1.status === 400 ? 1 : 0) + (res2.status === 400 ? 1 : 0);

        assert.equal(successCount, 1, 'Exactly one concurrent withdrawal must succeed');
        assert.equal(failCount, 1, 'The competing withdrawal must fail due to insufficient funds');

        // Check wallet balance: must be exactly ₹0.00, NEVER negative
        const wAfter = await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const wAfterJson = await wAfter.json();
        assert.equal(Number(wAfterJson.data.available_balance), 0.00, 'Final balance must be exactly ₹0.00');
    });

    // ==========================================================================
    // PHASE 9: RAZORPAYX SANDBOX PAYOUT DISPATCH EVALUATION
    // ==========================================================================
    it('Phase 9: RazorpayX Sandbox Dispatch — Evaluates real sandbox contract and detects configuration status', async () => {
        const hasCredentials = Boolean(
            (process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID) &&
            (process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET) &&
            (process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_ACCOUNT_NUMBER)
        );

        if (!hasCredentials) {
            // Must strictly report BLOCKED rather than generating fake mock IDs
            const origStrict = process.env.RAZORPAYX_STRICT_E2E;
            process.env.RAZORPAYX_STRICT_E2E = 'true';
            let result;
            try {
                result = await dispatchRazorpayXPayout({
                    withdrawal: withdrawalRecord,
                    payoutMethod: payoutMethodA,
                    idempotencyKey: withdrawalRecord.idempotency_key,
                    fetcher: fetch // Real node fetcher
                });
            } finally {
                if (origStrict !== undefined) {
                    process.env.RAZORPAYX_STRICT_E2E = origStrict;
                } else {
                    delete process.env.RAZORPAYX_STRICT_E2E;
                }
            }

            assert.equal(result.success, false);
            assert.equal(result.blocked, true);
            assert.equal(result.code, 'MISSING_PAYOUT_CREDENTIALS');
            assert.ok(result.message.includes('BLOCKED'));
        } else {
            // If credentials are configured, execute real sandbox dispatch
            const result = await dispatchRazorpayXPayout({
                withdrawal: withdrawalRecord,
                payoutMethod: payoutMethodA,
                idempotencyKey: withdrawalRecord.idempotency_key,
                fetcher: fetch
            });
            assert.ok(result.razorpay_payout_id, 'Real sandbox payout ID must be returned');
        }
    });

    // ==========================================================================
    // PHASE 10: WEBHOOK VALIDATION (RAW BODY & TIMING-SAFE HMAC)
    // ==========================================================================
    it('Phase 10: Webhook Validation — Rejects missing/invalid signatures and processes verified raw body', async () => {
        const webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';

        const payloadObj = {
            entity: 'event',
            account_id: 'acc_sandbox_test',
            event: 'payout.processed',
            event_id: `evt_processed_${Date.now()}`,
            payload: {
                payout: {
                    entity: {
                        id: 'pout_sandbox_real_test',
                        amount: 50000,
                        currency: 'INR',
                        status: 'processed',
                        reference_id: withdrawalRecord.withdrawal_reference
                    }
                }
            }
        };

        const rawBodyStr = JSON.stringify(payloadObj);
        const validSig = crypto.createHmac('sha256', webhookSecret).update(Buffer.from(rawBodyStr)).digest('hex');

        // 1. Missing signature -> 400
        const noSigRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBodyStr
        });
        assert.equal(noSigRes.status, 400);

        // 2. Invalid signature -> 400
        const badSigRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000'
            },
            body: rawBodyStr
        });
        assert.equal(badSigRes.status, 400);

        // 3. Valid signature on exact raw body -> 200
        const validRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': validSig
            },
            body: rawBodyStr
        });
        assert.equal(validRes.status, 200);

        // 4. Duplicate webhook event -> Idempotent 200
        const dupRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': validSig
            },
            body: rawBodyStr
        });
        assert.equal(dupRes.status, 200);
        const dupJson = await dupRes.json();
        assert.ok(dupJson.message.includes('idempotent'));
    });

    // ==========================================================================
    // PHASE 11: FAILURE / COMPENSATING TRANSACTION REVERSAL
    // ==========================================================================
    it('Phase 11: Failure Compensating Reversal — payout.failed / payout.reversed restores balance via append-only ledger', async () => {
        // Create another withdrawal of ₹500 to simulate failure
        const failOrder = `FAIL-ORD-${Date.now()}`;
        await attributeOrderToInfluencer({ order_reference: failOrder, sales_amount: 5000, influencer_id: testCreatorA.id });
        await makeCommissionAvailableInWallet({ influencer_id: testCreatorA.id, order_reference: failOrder });

        const withRes = await fetch(`${baseUrl}/api/creator/withdrawals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({ amount: 500.00, payout_method_id: payoutMethodA.id, idempotency_key: `wth-fail-${Date.now()}` })
        });
        const withData = (await withRes.json()).data;

        // Balance is now ₹0.00
        const wMid = await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        assert.equal(Number((await wMid.json()).data.available_balance), 0.00);

        // Dispatch payout.reversed webhook
        const webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || 'wishrite_payout_webhook_secret_default';
        const failPayload = {
            entity: 'event',
            event: 'payout.reversed',
            event_id: `evt_rev_${Date.now()}`,
            payload: {
                payout: {
                    entity: {
                        id: 'pout_reversed_sim',
                        amount: 50000,
                        status: 'reversed',
                        reference_id: withData.withdrawal_reference,
                        failure_reason: 'Beneficiary bank account closed'
                    }
                }
            }
        };

        const rawStr = JSON.stringify(failPayload);
        const sig = crypto.createHmac('sha256', webhookSecret).update(Buffer.from(rawStr)).digest('hex');

        const webhookRes = await fetch(`${baseUrl}/api/webhooks/razorpay-payouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
            body: rawStr
        });
        assert.equal(webhookRes.status, 200);

        // Balance restored to ₹500.00
        const wAfter = await fetch(`${baseUrl}/api/creator/wallet`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const wAfterJson = await wAfter.json();
        assert.equal(Number(wAfterJson.data.available_balance), 500.00, 'Compensating transaction must restore ₹500 available balance');

        // Ledger must contain append-only withdrawal_reversed transaction
        const txRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        const txJson = await txRes.json();
        const reversalTx = txJson.data.find(t => t.reference_id === withData.id && t.transaction_type === 'withdrawal_reversed');
        assert.ok(reversalTx, 'Append-only reversal transaction must exist');
        assert.equal(reversalTx.direction, 'credit');
        assert.equal(Number(reversalTx.amount), 500.00);
    });

    // ==========================================================================
    // PHASE 12: SUCCESS RECONCILIATION IN INTEGER PAISE
    // ==========================================================================
    it('Phase 12: Success Reconciliation — Wallet balances reconcile exactly with sum of ledger transactions in integer paise', async () => {
        const store = readLocalStore();
        const wallet = (store.wallets || []).find(w => w.influencer_id === testCreatorA.id);
        assert.ok(wallet, 'Creator A wallet must exist');

        const creatorTxList = (store.wallet_transactions || []).filter(t => t.influencer_id === testCreatorA.id && t.status === 'completed');

        // Sum ledger transactions in integer paise
        let computedAvailablePaise = 0;
        let computedPaidPaise = 0;

        for (const tx of creatorTxList) {
            const amountPaise = Math.round(Number(tx.amount) * 100);
            if (tx.transaction_type === 'commission_cleared' || tx.transaction_type === 'withdrawal_reversed' || tx.transaction_type === 'manual_credit') {
                computedAvailablePaise += amountPaise;
            } else if (tx.transaction_type === 'withdrawal_requested' || tx.transaction_type === 'manual_debit') {
                computedAvailablePaise -= amountPaise;
            } else if (tx.transaction_type === 'withdrawal_completed') {
                computedPaidPaise += amountPaise;
            }
        }

        const walletAvailablePaise = Math.round(Number(wallet.available_balance) * 100);
        const walletPaidPaise = Math.round(Number(wallet.paid_balance) * 100);

        assert.equal(walletAvailablePaise, computedAvailablePaise, 'Available balance in paise must match ledger sum');
        assert.equal(walletPaidPaise, computedPaidPaise, 'Paid balance in paise must match completed withdrawals sum');
    });

    // ==========================================================================
    // PHASE 14: SECURITY TESTING & ISOLATION
    // ==========================================================================
    it('Phase 14: Security Isolation — Strict boundaries prevent cross-creator access and role escalation', async () => {
        // Creator A cannot view Creator B wallet
        const walletARes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const walletAJson = await walletARes.json();

        const crossWalletRes = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const crossWalletJson = await crossWalletRes.json();
        assert.ok(crossWalletJson.data.wallet_id);
        assert.notEqual(crossWalletJson.data.wallet_id, walletAJson.data.wallet_id, 'Creator B sees own wallet, not Creator A');

        // Creator B cannot delete Creator A payout method
        const crossPmDelete = await fetch(`${baseUrl}/api/creator/payout-methods/${payoutMethodA.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        assert.equal(crossPmDelete.status, 404, 'Creator B cannot delete Creator A payout method');

        // Creator cannot call administrative approval endpoint
        const adminEscalate = await fetch(`${baseUrl}/api/admin/creator-withdrawals/${withdrawalRecord.id}/approve`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` }
        });
        assert.ok([401, 403].includes(adminEscalate.status), 'Creator cannot invoke admin endpoints (HTTP 401/403 required)');
    });
});

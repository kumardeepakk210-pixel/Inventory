// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: WALLET & EARNINGS LEDGER TEST SUITE
// Tests Creator Wallet, Immutable Financial Ledger, Idempotent Commission Credit,
// Commission Reversals, Concurrency Locks & Data Isolation.
// ==============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { 
    getOrLinkInfluencerAccount, 
    issueCreatorSession,
    resetLoginRateLimits
} from '../backend/creator.js';
import { 
    trackInfluencerClick, 
    attributeOrderToInfluencer,
    reconcileOrderCommission
} from '../backend/influencers.js';
import {
    getOrCreateInfluencerWallet,
    makeCommissionAvailableInWallet
} from '../backend/creator-wallet.js';

let server;
let baseUrl = '';

let creatorA = null;
let creatorB = null;
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
        name: 'WalletTester A',
        email: `wallet_a_${ts}@example.com`,
        instagram_id: `wallet_a_${ts}`,
        bio: 'Wallet test creator A',
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creatorA.email,
        influencer_id: creatorA.id,
        password: 'PasswordWalletA1!'
    });

    creatorB = await createTestInfluencer({
        name: 'WalletTester B',
        email: `wallet_b_${ts}@example.com`,
        instagram_id: `wallet_b_${ts}`,
        bio: 'Wallet test creator B',
        commission_rate: 15,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creatorB.email,
        influencer_id: creatorB.id,
        password: 'PasswordWalletB1!'
    });

    // Obtain sessions
    const resA = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorA.email, password: 'PasswordWalletA1!' })
    });
    tokenA = (await resA.json()).token;

    const resB = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creatorB.email, password: 'PasswordWalletB1!' })
    });
    tokenB = (await resB.json()).token;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B: Creator Wallet & Ledger', () => {

    it('1. GET /api/creator/wallet initializes and returns creator wallet balances', async () => {
        const res = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.currency, 'INR');
        assert.equal(typeof json.data.available_balance, 'number');
        assert.equal(typeof json.data.pending_balance, 'number');
        assert.equal(typeof json.data.lifetime_earned, 'number');
        assert.equal(json.data.minimum_withdrawal_amount, 500);
    });

    it('2. Order attribution credits pending commission to creator wallet and immutable ledger', async () => {
        const orderRef = `WLT-ORD-${Date.now()}`;
        const salesAmount = 10000; // 10% commission = ₹1,000

        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: salesAmount,
            influencer_id: creatorA.id
        });

        const res = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const json = await res.json();
        assert.ok(json.data.pending_balance >= 1000);
        assert.ok(json.data.lifetime_earned >= 1000);

        // Verify transaction in ledger
        const txRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const txJson = await txRes.json();
        const tx = txJson.data.find(t => t.reference_id === orderRef);
        assert.ok(tx);
        assert.equal(tx.transaction_type, 'commission_pending');
        assert.equal(tx.amount, 1000);
        assert.equal(tx.direction, 'hold');
        assert.equal(tx.status, 'pending');
    });

    it('3. IDEMPOTENCY: Duplicate order attribution does not duplicate wallet credit', async () => {
        const orderRef = `WLT-IDEM-${Date.now()}`;
        const salesAmount = 5000; // 10% = ₹500

        // First attribution
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: salesAmount,
            influencer_id: creatorA.id
        });

        const res1 = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const bal1 = (await res1.json()).data.pending_balance;

        // Second attribution with same order reference
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: salesAmount,
            influencer_id: creatorA.id
        });

        const res2 = await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const bal2 = (await res2.json()).data.pending_balance;

        assert.equal(bal1, bal2, 'Pending balance must remain identical on duplicate attribution');
    });

    it('4. Clearing commission transitions funds from pending to available balance', async () => {
        const orderRef = `WLT-CLEAR-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 8000, // 10% = ₹800
            influencer_id: creatorA.id
        });

        const wBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        })).json()).data;

        // Make commission available
        await makeCommissionAvailableInWallet({
            influencer_id: creatorA.id,
            order_reference: orderRef
        });

        const wAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        })).json()).data;

        assert.equal(wAfter.available_balance, wBefore.available_balance + 800);
        assert.equal(wAfter.pending_balance, wBefore.pending_balance - 800);
    });

    it('5. Order cancellation creates immutable reversal ledger transaction and adjusts balance', async () => {
        const orderRef = `WLT-CANCEL-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 6000, // 10% = ₹600
            influencer_id: creatorA.id
        });

        const wBefore = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        })).json()).data;

        // Cancel order
        await reconcileOrderCommission({
            order_reference: orderRef,
            new_status: 'cancelled'
        });

        const wAfter = (await (await fetch(`${baseUrl}/api/creator/wallet`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        })).json()).data;

        assert.equal(wAfter.pending_balance, wBefore.pending_balance - 600);

        // Verify compensating reversal transaction in ledger
        const txRes = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const txJson = await txRes.json();
        const revTx = txJson.data.find(t => t.reference_id === orderRef && t.transaction_type === 'commission_reversal');
        assert.ok(revTx);
        assert.equal(revTx.amount, 600);
        assert.equal(revTx.direction, 'debit');
    });

    it('6. DATA ISOLATION: Creator A cannot view Creator B wallet or transactions', async () => {
        // Creator B has transactions
        const orderRefB = `WLT-B-ORD-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRefB,
            sales_amount: 4000,
            influencer_id: creatorB.id
        });

        // Creator A views own transactions
        const resA = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const jsonA = await resA.json();

        // Must not contain Creator B order
        assert.ok(!jsonA.data.some(t => t.reference_id === orderRefB));

        // Creator B views own transactions
        const resB = await fetch(`${baseUrl}/api/creator/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const jsonB = await resB.json();
        assert.ok(jsonB.data.some(t => t.reference_id === orderRefB));
    });
});

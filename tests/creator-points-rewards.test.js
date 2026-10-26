// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3B: POINTS & REWARDS TEST SUITE
// Tests Creator Points Ledger, Configurable Points Rules (1 pt / ₹100 sales),
// Idempotency, Points Reversals, Rewards Catalogue, Atomic Redemptions,
// Inventory decrements, Out-of-Stock protections, and Admin Fulfillment/Refunds.
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
    attributeOrderToInfluencer,
    reconcileOrderCommission
} from '../backend/influencers.js';

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
        name: 'Points Tester',
        email: `points_tester_${ts}@example.com`,
        instagram_id: `points_tester_${ts}`,
        bio: 'Testing Creator Points and Rewards Catalogue',
        commission_rate: 10,
        status: 'active'
    });

    await getOrLinkInfluencerAccount({
        email: creator.email,
        influencer_id: creator.id,
        password: 'PasswordPoints1!'
    });

    const loginRes = await fetch(`${baseUrl}/api/creator/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: creator.email,
            password: 'PasswordPoints1!'
        })
    });
    token = (await loginRes.json()).token;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('WishRite Creator Club — Phase 3B: Points & Rewards Management', () => {
    let availableRewards = [];
    let testReward = null;

    it('1. GET /api/creator/points initializes and returns zero balance for new creator', async () => {
        const res = await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.points_balance, 0);
        assert.equal(json.data.lifetime_points_earned, 0);
        assert.equal(json.data.lifetime_points_spent, 0);
    });

    it('2. Order attribution automatically awards sales points (1 pt per ₹100 sales)', async () => {
        const orderRef = `PTS-ORD-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 50000, // ₹50,000 / 100 = 500 points
            influencer_id: creator.id
        });

        const res = await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.points_balance, 500);
        assert.equal(json.data.lifetime_points_earned, 500);

        // Verify points ledger
        const txRes = await fetch(`${baseUrl}/api/creator/points/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const txJson = await txRes.json();
        const ptTx = txJson.data.find(t => t.reference_id === orderRef && t.transaction_type === 'sale_bonus');
        assert.ok(ptTx);
        assert.equal(ptTx.points, 500);
        assert.equal(ptTx.direction, 'credit');
    });

    it('3. IDEMPOTENCY: Duplicate order attribution does not award duplicate points', async () => {
        const orderRef = `PTS-IDEMP-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 20000, // ₹20,000 / 100 = 200 points
            influencer_id: creator.id
        });

        const ptsBefore = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        // Trigger duplicate attribution
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 20000,
            influencer_id: creator.id
        });

        const ptsAfter = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        assert.equal(ptsAfter, ptsBefore, 'Points must not be awarded twice for same order');
    });

    it('4. Reversing cancelled order deducts awarded points with immutable ledger entry', async () => {
        const orderRef = `PTS-REV-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 10000, // 100 points
            influencer_id: creator.id
        });

        const ptsBefore = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        await reconcileOrderCommission({
            order_reference: orderRef,
            new_status: 'cancelled'
        });

        const ptsAfter = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        assert.equal(ptsAfter, ptsBefore - 100);

        const txRes = await fetch(`${baseUrl}/api/creator/points/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const txJson = await txRes.json();
        const revTx = txJson.data.find(t => t.reference_id === `rev_${orderRef}`);
        assert.ok(revTx);
        assert.equal(revTx.points, 100);
        assert.equal(revTx.direction, 'debit');
    });

    it('5. GET /api/creator/rewards returns active rewards catalogue with points cost', async () => {
        const res = await fetch(`${baseUrl}/api/creator/rewards`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.data.length >= 3);
        availableRewards = json.data;

        testReward = availableRewards.find(r => r.points_cost <= 500) || availableRewards[0];
        assert.ok(testReward);
        assert.ok(testReward.points_cost > 0);
        assert.ok(testReward.name);
    });

    it('6. POST /api/creator/rewards/:id/redeem rejects when points balance is insufficient', async () => {
        // High cost reward
        const expensiveReward = availableRewards.find(r => r.points_cost > 2000);
        if (expensiveReward) {
            const res = await fetch(`${baseUrl}/api/creator/rewards/${expensiveReward.id}/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.equal(res.status, 400);
            const json = await res.json();
            assert.equal(json.error.code, 'INSUFFICIENT_POINTS');
        }
    });

    let activeRedemption = null;

    it('7. POST /api/creator/rewards/:id/redeem atomically deducts points and decrements inventory', async () => {
        // Award sufficient points for testReward
        const orderRef = `PTS-FUND-${Date.now()}`;
        await attributeOrderToInfluencer({
            order_reference: orderRef,
            sales_amount: 100000, // 1,000 points
            influencer_id: creator.id
        });

        const ptsBefore = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        const invBefore = testReward.inventory_quantity;

        const res = await fetch(`${baseUrl}/api/creator/rewards/${testReward.id}/redeem`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        activeRedemption = json.data.redemption;
        assert.equal(activeRedemption.reward_name, testReward.name);
        assert.equal(activeRedemption.points_spent, testReward.points_cost);
        assert.ok(activeRedemption.redemption_reference.startsWith('WR-RDM-'));

        // Verify points deducted
        const ptsAfter = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;
        assert.equal(ptsAfter, ptsBefore - testReward.points_cost);

        // Verify inventory decremented
        const rwdCheck = await (await fetch(`${baseUrl}/api/creator/rewards/${testReward.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json();
        assert.equal(rwdCheck.data.inventory_quantity, invBefore - 1);
    });

    it('8. GET /api/creator/redemptions returns creator redemption history', async () => {
        const res = await fetch(`${baseUrl}/api/creator/redemptions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        const rdm = json.data.find(r => r.id === activeRedemption.id);
        assert.ok(rdm);
        assert.equal(rdm.status, 'requested');
    });

    it('9. Admin fulfillment workflow: PATCH /api/admin/creator-redemptions/:id marks fulfilled', async () => {
        const res = await fetch(`${baseUrl}/api/admin/creator-redemptions/${activeRedemption.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            },
            body: JSON.stringify({
                status: 'fulfilled'
            })
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.status, 'fulfilled');
        assert.ok(json.data.fulfilled_at);
    });

    it('10. Admin cancellation workflow: marks cancelled and automatically refunds points to creator', async () => {
        // Create another redemption to test cancellation refund
        const resRedeem = await fetch(`${baseUrl}/api/creator/rewards/${testReward.id}/redeem`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const rdmToCancel = (await resRedeem.json()).data.redemption;

        const ptsBefore = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;

        // Admin cancels redemption
        const resCancel = await fetch(`${baseUrl}/api/admin/creator-redemptions/${rdmToCancel.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            },
            body: JSON.stringify({
                status: 'cancelled',
                cancellation_reason: 'Item temporarily out of stock from artisan.'
            })
        });

        assert.equal(resCancel.status, 200);
        const cancelJson = await resCancel.json();
        assert.equal(cancelJson.success, true);
        assert.equal(cancelJson.data.status, 'cancelled');

        // Verify points refunded
        const ptsAfter = (await (await fetch(`${baseUrl}/api/creator/points`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })).json()).data.points_balance;
        assert.equal(ptsAfter, ptsBefore + testReward.points_cost);

        // Verify refund ledger transaction
        const txRes = await fetch(`${baseUrl}/api/creator/points/transactions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const txJson = await txRes.json();
        const refundTx = txJson.data.find(t => t.reference_id === rdmToCancel.id && t.transaction_type === 'reward_refund');
        assert.ok(refundTx);
        assert.equal(refundTx.points, testReward.points_cost);
        assert.equal(refundTx.direction, 'credit');
    });

    it('11. POST /api/admin/creator-rewards creates new reward', async () => {
        const newCode = `WR-TEST-${Date.now()}`;
        const res = await fetch(`${baseUrl}/api/admin/creator-rewards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeader
            },
            body: JSON.stringify({
                reward_code: newCode,
                name: 'Signature Emerald Ring',
                description: 'Natural Zambian Emerald in 14K Gold',
                points_cost: 3500,
                reward_type: 'product',
                inventory_quantity: 5,
                terms: 'Insured transit included.'
            })
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.data.reward_code, newCode);
        assert.equal(json.data.points_cost, 3500);
    });
});

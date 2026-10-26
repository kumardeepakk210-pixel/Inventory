# WishRite Creator Club — Phase 3B Architecture & Reference Manual

## Executive Summary

**WishRite Creator Club Phase 3B** implements the financial backbone, reward ecosystem, and automated payout infrastructure for creators on the WishRite platform. Built upon Phase 1 (Creator Foundation), Phase 2 (Attribution Engine & Discount Links), and Phase 3A (Creator Dashboard & Onboarding), Phase 3B delivers:

1. **Creator Wallet & Immutable Financial Ledger**: Exact dual-entry transaction accounting with strictly positive balance guarantees.
2. **End-to-End Commission Lifecycle**: Real-time attribution hooks, 14-day clearance hold, atomic status transitions, and compensating reversals on returns or cancellations.
3. **UPI & Bank Payout Methods**: Secure storage, regex validation, PII masking (`XXXXXX1234`, `vi***@bank`), and deletion protection for in-flight withdrawals.
4. **Withdrawal State Machine**: Server-side enforced minimum (₹500) and maximum (₹100,000) thresholds, two-step approvals, automated payout triggering, and fund restitution upon failure.
5. **Razorpay Payout Architecture**: Idempotent dispatch, HMAC-SHA256 webhook signature verification, and deduplicated event handling.
6. **Creator Points & Rewards Catalogue**: Point earning on attributed GMV (1 point per ₹100 sales), rewards catalogue, and atomic anti-double-spend redemption engine.
7. **Creator & Admin Control Suites**: Creator-facing dashboard interfaces in `index.html` and administrative endpoints for payout operations and catalogue maintenance.

---

## 1. Database Schema (`supabase-creator-club-v3b.sql`)

Phase 3B introduces 9 production-grade PostgreSQL tables with strict constraints, foreign keys, and Row Level Security (RLS) policies.

### 1.1 Table Definitions

```
                     +---------------------------+
                     |    influencer_wallets     |
                     +---------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+-----------------------------------+       +-----------------------------------+
|   influencer_wallet_transactions  |       |       influencer_withdrawals      |
+-----------------------------------+       +-----------------------------------+
                                                              |
                                                              v
                                            +-----------------------------------+
                                            |   influencer_withdrawal_attempts  |
                                            +-----------------------------------+

                     +---------------------------+
                     | influencer_payout_methods |
                     +---------------------------+

                     +---------------------------+
                     | influencer_points_accounts|
                     +---------------------------+
                                   |
                                   v
                     +---------------------------+
                     |influencer_points_transact.|
                     +---------------------------+

                     +---------------------------+
                     |    influencer_rewards     |
                     +---------------------------+
                                   |
                                   v
                     +---------------------------+
                     |influencer_reward_redempt. |
                     +---------------------------+
```

#### 1. `influencer_wallets`
Maintains real-time aggregated financial balances for each influencer.
- `influencer_id` (UUID PK, FK to `influencers.id`)
- `currency` (VARCHAR(3), default `'INR'`)
- `pending_balance` (NUMERIC(12,2) >= 0) — Commissions awaiting return-window clearance.
- `available_balance` (NUMERIC(12,2) >= 0) — Cleared funds eligible for withdrawal.
- `locked_balance` (NUMERIC(12,2) >= 0) — Funds locked in pending withdrawals.
- `lifetime_earnings` (NUMERIC(12,2) >= 0) — Cumulative cleared earnings.
- `lifetime_withdrawn` (NUMERIC(12,2) >= 0) — Cumulative completed payouts.
- `created_at`, `updated_at` (TIMESTAMPTZ)

#### 2. `influencer_wallet_transactions`
Append-only, immutable financial transaction ledger.
- `id` (UUID PK)
- `wallet_id` (UUID FK to `influencer_wallets.id`)
- `influencer_id` (UUID FK to `influencers.id`)
- `transaction_type` (`credit`, `debit`, `hold`, `release`, `reversal`, `adjustment`)
- `amount` (NUMERIC(12,2) > 0)
- `balance_after` (NUMERIC(12,2) >= 0)
- `category` (`commission_pending`, `commission_available`, `withdrawal_hold`, `withdrawal_complete`, `withdrawal_failed_refund`, `commission_reversed`, `admin_adjustment`)
- `reference_id` (VARCHAR(128)) — e.g. order number, withdrawal ID
- `reference_type` (`order`, `withdrawal`, `manual_adjustment`)
- `description` (TEXT)
- `metadata` (JSONB)
- `created_at` (TIMESTAMPTZ)

#### 3. `influencer_payout_methods`
Payout destinations registered by the creator.
- `id` (UUID PK)
- `influencer_id` (UUID FK to `influencers.id`)
- `method_type` (`upi`, `bank_account`)
- `account_holder_name` (VARCHAR(255))
- `upi_id` (VARCHAR(255), masked)
- `bank_name` (VARCHAR(255))
- `account_number_masked` (VARCHAR(32), e.g. `XXXXXX5678`)
- `account_number_hash` (VARCHAR(64), SHA-256 for uniqueness checks)
- `ifsc_code` (VARCHAR(16))
- `is_default` (BOOLEAN)
- `status` (`active`, `deleted`)
- `created_at`, `updated_at` (TIMESTAMPTZ)

#### 4. `influencer_withdrawals`
Withdrawal requests and state tracking.
- `id` (UUID PK)
- `influencer_id` (UUID FK to `influencers.id`)
- `payout_method_id` (UUID FK to `influencer_payout_methods.id`)
- `amount` (NUMERIC(12,2) >= 500)
- `status` (`requested`, `approved`, `processing`, `completed`, `rejected`, `failed`, `reversed`)
- `payout_mode` (`upi`, `bank_transfer`)
- `payout_reference` (VARCHAR(255)) — Razorpay Payout ID
- `failure_reason` (TEXT)
- `approved_by` (VARCHAR(128))
- `approved_at`, `processed_at`, `created_at`, `updated_at` (TIMESTAMPTZ)

#### 5. `influencer_withdrawal_attempts`
Audit log of payout dispatch executions with third-party gateway payloads.
- `id` (UUID PK)
- `withdrawal_id` (UUID FK to `influencer_withdrawals.id`)
- `idempotency_key` (VARCHAR(255) UNIQUE)
- `gateway` (VARCHAR(64), e.g. `'razorpay_payouts'`)
- `status` (`initiated`, `success`, `failed`)
- `raw_response` (JSONB)
- `created_at` (TIMESTAMPTZ)

#### 6. `influencer_points_accounts`
Creator loyalty points balances.
- `influencer_id` (UUID PK, FK to `influencers.id`)
- `available_points` (INTEGER >= 0)
- `lifetime_points` (INTEGER >= 0)
- `redeemed_points` (INTEGER >= 0)
- `created_at`, `updated_at` (TIMESTAMPTZ)

#### 7. `influencer_points_transactions`
Immutable point credits, debits, and reversals.
- `id` (UUID PK)
- `account_id` (UUID FK to `influencer_points_accounts.id`)
- `influencer_id` (UUID FK to `influencers.id`)
- `transaction_type` (`credit`, `debit`, `reversal`)
- `points` (INTEGER > 0)
- `balance_after` (INTEGER >= 0)
- `reason` (`sales_milestone`, `reward_redemption`, `order_cancelled`, `admin_adjustment`)
- `reference_id` (VARCHAR(128))
- `created_at` (TIMESTAMPTZ)

#### 8. `influencer_rewards`
Catalogue of redeemable products, gift cards, and creator perks.
- `id` (UUID PK)
- `title` (VARCHAR(255) NOT NULL)
- `description` (TEXT)
- `reward_type` (`merchandise`, `gift_card`, `discount_code`, `perk`)
- `points_cost` (INTEGER > 0)
- `inventory_count` (INTEGER >= 0)
- `is_active` (BOOLEAN DEFAULT TRUE)
- `metadata` (JSONB)
- `created_at`, `updated_at` (TIMESTAMPTZ)

#### 9. `influencer_reward_redemptions`
Redemption history and voucher fulfillment.
- `id` (UUID PK)
- `influencer_id` (UUID FK to `influencers.id`)
- `reward_id` (UUID FK to `influencer_rewards.id`)
- `points_spent` (INTEGER > 0)
- `status` (`pending`, `fulfilled`, `cancelled`)
- `voucher_code` (VARCHAR(128))
- `created_at`, `updated_at` (TIMESTAMPTZ)

---

## 2. Core Financial Invariants & Concurrency Control

### 2.1 Non-Negative Balance Invariant
Every balance mutation enforces `balance >= 0` both in memory and via database `CHECK` constraints:
```sql
ALTER TABLE influencer_wallets
  ADD CONSTRAINT chk_wallets_pending_nonneg CHECK (pending_balance >= 0),
  ADD CONSTRAINT chk_wallets_available_nonneg CHECK (available_balance >= 0),
  ADD CONSTRAINT chk_wallets_locked_nonneg CHECK (locked_balance >= 0);
```

### 2.2 Wallet Concurrency Lock
Race conditions and double-spending are prevented using an in-memory asynchronous lock per creator:
```javascript
const walletLocks = new Map();

async function acquireWalletLock(influencerId, fn) {
  const currentLock = walletLocks.get(influencerId) || Promise.resolve();
  let release;
  const newLock = new Promise(resolve => { release = resolve; });
  walletLocks.set(influencerId, currentLock.then(() => newLock));

  await currentLock;
  try {
    return await fn();
  } finally {
    release();
    if (walletLocks.get(influencerId) === newLock) {
      walletLocks.delete(influencerId);
    }
  }
}
```

### 2.3 Immutable Ledger Entry Principle
Ledger rows are strictly append-only. Balance modifications require an explicit entry in `influencer_wallet_transactions` stating:
- Category (e.g. `commission_pending`, `withdrawal_hold`)
- Transaction type (`credit`, `debit`, `hold`, `release`, `reversal`)
- Exact resulting balance (`balance_after`)
- External reference ID (order number, withdrawal UUID, or refund ID)

---

## 3. Commission Lifecycle & Attribution Integration

Phase 3B seamlessly hooks into the Phase 2 attribution pipeline (`backend/influencers.js`):

```
+-----------------------------------------------------------------------------------------+
|                               Commission State Flow                                     |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|  [Customer Checkout]                                                                    |
|           |                                                                             |
|           v                                                                             |
|  attributeOrderToInfluencer()                                                           |
|           |                                                                             |
|           +---> recordOrderCommissionInWallet()                                         |
|           |        - credit wallet.pending_balance                                      |
|           |        - record influencer_wallet_transactions (category: commission_pending)|
|           |                                                                             |
|           +---> recordOrderPointsInAccount()                                            |
|                    - credit 1 pt per ₹100 GMV                                           |
|                    - record influencer_points_transactions                              |
|                                                                                         |
|  [Return Window Passes (14 Days) / Reconciliation]                                      |
|           |                                                                             |
|           v                                                                             |
|  makeCommissionAvailableInWallet()                                                      |
|           |                                                                             |
|           +---> pending_balance -= commission                                           |
|           +---> available_balance += commission                                         |
|           +---> lifetime_earnings += commission                                         |
|           +---> record influencer_wallet_transactions (category: commission_available)  |
|                                                                                         |
|  [Order Cancelled / Refunded]                                                           |
|           |                                                                             |
|           v                                                                             |
|  recordOrderCommissionReversalInWallet()                                                |
|           |                                                                             |
|           +---> if in pending: pending_balance -= commission                            |
|           +---> if in available: available_balance -= commission                        |
|           +---> record influencer_wallet_transactions (category: commission_reversed)   |
|           +---> reverse points in influencer_points_accounts                            |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Withdrawal Lifecycle & Payout Operations

### 4.1 Withdrawal Rules
- **Minimum Amount**: ₹500
- **Maximum Amount**: ₹100,000 per request
- **Eligible Balance**: Deducted exclusively from `available_balance`
- **Locking**: Upon request creation, funds immediately transition from `available_balance` to `locked_balance`.

### 4.2 State Machine
```
[requested] ---> [approved] ---> [processing] ---> [completed]
     |                                 |
     +------------> [rejected]         +------------> [failed] ---> [reversed]
```

1. **Requested**: Creator creates a withdrawal specifying an active payout method. Funds moved to `locked_balance`.
2. **Approved**: Admin validates the request. Request moves to `approved`.
3. **Processing**: System/admin initiates Razorpay Payout. Idempotency key generated.
4. **Completed**: Razorpay webhook `payout.processed` received with valid HMAC signature. Funds deducted from `locked_balance`, `lifetime_withdrawn` increased.
5. **Rejected**: Admin rejects the request with a mandatory reason. Funds released from `locked_balance` back to `available_balance`.
6. **Failed**: Gateway fails (e.g. invalid account). Funds automatically refunded back to `available_balance` with category `withdrawal_failed_refund`.

---

## 5. Security & Isolation Controls

### 5.1 Creator Identity Derivation
Creator routes **never** trust user-supplied creator IDs in request bodies or query parameters. The influencer's identity is derived strictly from the verified session token on the server (`req.creator.influencer_id`).

### 5.2 Admin Barrier
Admin routes require verified admin credentials and unconditionally reject creator tokens:
```javascript
if (authHeader.includes('crt_')) {
  return res.status(403).json({
    success: false,
    error: { code: 'ADMIN_ACCESS_REQUIRED', message: 'Creators cannot access administrative functions' }
  });
}
```

### 5.3 Webhook HMAC-SHA256 Verification
Razorpay webhook payloads are authenticated via HMAC-SHA256:
```javascript
const crypto = require('crypto');
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(400).json({ error: 'INVALID_SIGNATURE' });
}
```

### 5.4 PII & Banking Protection
- Bank account numbers are stored masked as `XXXXXX1234` on read operations.
- UPI IDs are masked (`vi***@bank`) in UI responses.
- Complete raw bank account numbers and secrets are strictly excluded from client-facing payloads.

---

## 6. Complete API Reference

### 6.1 Creator Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/creator/wallet` | Fetch current wallet balances (pending, available, locked, lifetime) |
| `GET` | `/api/creator/wallet/transactions` | Fetch chronological immutable transaction ledger |
| `GET` | `/api/creator/payout-methods` | List configured payout methods (masked) |
| `POST` | `/api/creator/payout-methods` | Register new UPI or Bank Account payout method |
| `DELETE` | `/api/creator/payout-methods/:id` | Remove payout method (blocked if active withdrawal pending) |
| `POST` | `/api/creator/withdrawals` | Request a withdrawal (min ₹500, max ₹100,000) |
| `GET` | `/api/creator/withdrawals` | List withdrawal requests and historical statuses |
| `GET` | `/api/creator/points` | Fetch points account balance and point history |
| `GET` | `/api/creator/rewards` | Browse rewards catalogue with inventory & point costs |
| `POST` | `/api/creator/rewards/redeem` | Redeem a reward using points (atomic balance lock) |
| `GET` | `/api/creator/redemptions` | View claimed rewards and voucher codes |

### 6.2 Admin Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/creator-club/withdrawals` | List all creators' withdrawal requests with filtering |
| `POST` | `/api/admin/creator-club/withdrawals/:id/approve` | Approve a pending withdrawal request |
| `POST` | `/api/admin/creator-club/withdrawals/:id/reject` | Reject withdrawal and auto-restore locked funds |
| `POST` | `/api/admin/creator-club/withdrawals/:id/retry` | Retry a failed payout dispatch |
| `POST` | `/api/admin/creator-club/wallets/adjust` | Manual balance adjustment with mandatory audit note |
| `POST` | `/api/admin/creator-club/rewards` | Create or update catalogue reward items |

### 6.3 Webhook Endpoint

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/webhooks/razorpay-payouts` | Ingests Razorpay payout lifecycle events with HMAC validation |

---

## 7. Frontend Integration in `index.html`

The creator dashboard features a high-end luxury aesthetic (`#5E3435`, `#FAF6F0`, polished borders, and responsive cards):
- **Desktop Navigation**: Added `Wallet` and `Rewards` tabs to the creator dashboard top bar.
- **Mobile Navigation**: Added bottom action buttons for quick navigation to Wallet and Rewards.
- **Wallet Section (`#creator-section-wallet`)**:
  - 4 KPI Cards: Available Balance, Pending Balance, Locked Balance, Lifetime Paid.
  - Action buttons: "Request Withdrawal" and "Manage Payout Methods".
  - Ledger Table: Chronological transactions with status badges (`+₹ Credit`, `-₹ Debit`, `Hold`).
  - Active & Past Withdrawals Table.
- **Rewards Section (`#creator-section-rewards`)**:
  - Points Header: Available, Lifetime, and Redeemed points display.
  - Product Catalogue: Card grid showing title, points cost, inventory status, and "Redeem" button.
  - Claimed Rewards Table: Displaying voucher codes and fulfillment status.
- **Interactive Modals**:
  - Request Withdrawal Modal with real-time balance comparison and payout method selector.
  - Add Payout Method Modal with dynamic form switching (UPI vs. Bank Account).

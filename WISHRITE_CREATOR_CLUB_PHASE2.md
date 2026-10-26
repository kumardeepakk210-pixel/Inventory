# WishRite Creator Club — Phase 2 Architecture & Documentation
## Public Influencer URL + Referral & Attribution Tracking

---

## 1. Executive Summary

Phase 2 of the **WishRite Creator Club** upgrades the foundational creator registry established in Phase 1 into a live, server-authoritative, 30-day referral and commission tracking engine.

With Phase 2, every active creator registered in the WishRite Creator Club possesses a permanent, luxury-branded storefront accessible at:
```
https://wishrite.in/influencer/{public_slug}
```
as well as direct, product-specific referral deep links:
```
https://wishrite.in/influencer/{public_slug}/product/{product_code}
```

When a prospective customer visits through an influencer referral link:
1. A first-party referral session is initialized and bound to the visitor for **30 days** (`INFLUENCER_ATTRIBUTION_DAYS = 30`).
2. A debounced click record is created in `public.influencer_clicks` to track engagement without inflating metrics on rapid accidental refreshes.
3. The attribution silently persists in first-party local storage (`wishrite_influencer_attribution`) and cookies as the visitor browses WishRite products, views details, adds items to their cart, and proceeds to checkout.
4. When the order is placed, the backend server resolves the active attribution, calculates the commission based on a snapshot of the creator's current commission rate, creates an immutable pending commission record in `public.influencer_order_attributions`, and updates `public.influencer_stats` in real time.
5. If the order is cancelled or refunded, backend reconciliation revokes the pending commission and reconciles the creator's stats.
6. The frontend **never** dictates commission amounts, order eligible sales, or influencer rates—the database and server layer remain the sole authority.

---

## 2. Attribution Lifecycle & Architecture

### 2.1 The Complete Attribution Flow
```
Instagram / Social Bio Link
            │
            ▼
https://wishrite.in/influencer/priya.jewels
            │
            ├─► Server validates status = 'active'
            │
            ▼
Public Storefront UI (No Forced Login / No Popups)
            │
            ├─► 1. Debounced Click Record (public.influencer_clicks)
            ├─► 2. 30-Day Attribution Session (public.influencer_attributions)
            ├─► 3. First-Party Storage: wishrite_influencer_attribution
            │
            ▼
Customer Browses & Adds to Cart
            │
            ▼
Cart & Checkout
            │
            ├─► Client passes referral session token to POST /api/orders
            │
            ▼
Order Confirmation & Attribution Engine
            │
            ├─► 1. Verify 1 Order = 1 Attribution (Idempotency)
            ├─► 2. Read Server-Side Commission Rate snapshot (e.g. 10%)
            ├─► 3. Calculate Commission: sales_amount * (rate / 100)
            ├─► 4. Insert public.influencer_order_attributions (status: 'pending')
            ├─► 5. Increment public.influencer_stats (total_orders, total_sales, pending_earnings)
            │
            ▼
Inventory Admin View
            │
            └─► Real-time Clicks, Orders, Sales, Pending Earnings, Conversion Rate
```

---

## 3. Core Architectural Rules

### 3.1 30-Day Attribution Window
- Centralized configuration constant: `INFLUENCER_ATTRIBUTION_DAYS = 30`.
- Stored both in database `public.influencer_attributions.expires_at` and client `localStorage['wishrite_influencer_attribution']`.
- If a customer visits on Day 1 via `@priya.jewels`, returns directly on Day 15, and buys on Day 28, the order is credited to `@priya.jewels`.
- After 30 days, the attribution expires unless refreshed by a new referral link.

### 3.2 Last-Click Attribution Model
- If a customer visits via Influencer A on Day 1, and later visits via Influencer B on Day 5:
  - Influencer B becomes the active attributed creator (`last_influencer_id = B`, `influencer_id = B`).
  - The first referrer is preserved for attribution audit history (`first_influencer_id = A`).
  - Orders placed while Influencer B is active credit commission to Influencer B.
- Normal browsing across WishRite does **not** overwrite or clear the active attribution.

### 3.3 Anti-Inflation Click Debouncing
- To prevent bot spam or rapid accidental page refreshes from inflating `total_clicks`:
  - The backend click tracker inspects recent clicks for the same `session_id` and `influencer_id`.
  - If a click occurred within the last **10 seconds**, the record is marked `debounced: true` and does not increment `total_clicks` in `influencer_stats`.

### 3.4 Server-Authoritative Commission Calculation
- The browser must **never** send commission calculations to the backend.
- The server computes commission using:
  $$\text{Commission} = \text{Eligible Sales Amount} \times \left(\frac{\text{Influencer Commission Rate}}{100}\right)$$
  *(e.g., ₹2,000 at 10% = ₹200 pending commission)*.
- A **snapshot** of the rate at the time of order creation is saved with the order attribution record. Future changes to the creator's master commission rate do not alter historical commissions.

### 3.5 Single Attribution & Idempotency
- An order can only be attributed once.
- Enforced at both the database level via a unique index on `order_reference` in `public.influencer_order_attributions`, and in application logic.
- Duplicate calls (e.g., retried webhooks or double-clicks) return the existing attribution record without duplicate commission credit.

### 3.6 Commission Status & Reconciliation
- Initial commission status for successful orders is strictly `'pending'`.
- Pending commission is **not** included in `available_earnings`.
- If an order is marked `cancelled` or `refunded`:
  - `reconcileOrderCommission()` automatically updates attribution status to `'cancelled'`.
  - Deducts the pending commission and sales amount from `influencer_stats`.
  - Decrements `total_orders`.

---

## 4. Database Schema (`supabase-influencer-attribution-v2.sql`)

### 4.1 `public.influencer_clicks`
Tracks referral clicks for performance analytics:
```sql
CREATE TABLE IF NOT EXISTS public.influencer_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    influencer_link_id UUID NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
    attribution_id UUID NULL,
    landing_url TEXT,
    product_id UUID NULL,
    product_code TEXT NULL,
    session_id TEXT NULL,
    device_type TEXT NULL,
    user_agent TEXT NULL,
    referrer_url TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.2 `public.influencer_attributions`
Maintains 30-day attribution sessions:
```sql
CREATE TABLE IF NOT EXISTS public.influencer_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    influencer_link_id UUID NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    first_landing_url TEXT,
    last_landing_url TEXT,
    first_influencer_id UUID NULL,
    last_influencer_id UUID NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.3 `public.influencer_order_attributions`
Decoupled order-to-creator commission attribution records:
```sql
CREATE TABLE IF NOT EXISTS public.influencer_order_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE RESTRICT,
    order_id UUID NULL,
    order_reference TEXT NOT NULL,
    attribution_id UUID NULL,
    influencer_link_id UUID NULL,
    sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'cancelled' | 'paid'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inf_order_attr_ref ON public.influencer_order_attributions (order_reference);
```

---

## 5. API Endpoints

### 5.1 Public Endpoints (Safe, No Private Data)
| Endpoint | Method | Description |
|---|---|---|
| `/api/public/influencers/:slug` | `GET` | Returns sanitized creator profile (avatar, name, handle, bio, tier). Never returns email, phone, commission_rate, or earnings. Only works for `status = 'active'`. |
| `/api/public/influencers/:slug/products` | `GET` | Returns creator's curated product collection (or fallback active WishRite jewelry picks). |
| `/api/influencers/:id/click` | `POST` | Records referral click and returns 30-day session attribution token. |

### 5.2 Admin Endpoints (Creator Management & Analytics)
| Endpoint | Method | Description |
|---|---|---|
| `/api/influencers/:id/stats` | `GET` | Returns full performance stats (clicks, orders, sales, pending earnings, available earnings, conversion rate). |
| `/api/influencers/:id/links` | `GET` | Returns all links (profile, product referral links) with click metrics. |
| `/api/influencers/:id/links` | `POST` | Generates a new product referral link for creator. |
| `/api/influencers/:id/orders` | `GET` | Returns all orders attributed to creator with commission breakdowns and statuses. |
| `/api/influencers/:id/earnings` | `GET` | Financial summary breakdown for the creator. |
| `/api/orders` | `POST` | Creates order and automatically resolves referral attribution to award pending commission. |
| `/api/orders/:id/status` | `PATCH` | Updates order status and automatically reconciles commission if order is cancelled or refunded. |

---

## 6. Frontend Components (`index.html`)

### 6.1 Public Storefront (`#public-influencer-storefront`)
- **Brand Consistency**: Crafted in WishRite's luxury `#5E3435` aesthetic, certified 925 sterling silver messaging, and mobile-first responsive layout.
- **Creator Hero**: Displays verified creator badge, tier, category, bio, and Instagram link.
- **Shop My Picks**: Product card grid displaying canonical products, selling prices, in-stock indicators, "Add to Cart", and "Buy Now" buttons.
- **Silent Attribution**: Visitor experiences the store seamlessly; attribution is recorded in the background without forcing login, signup, popups, or discount codes.
- **Shopping Cart & Checkout**: Slide-out cart drawer and instant checkout modal with subtle creator attribution confirmation.

### 6.2 Upgraded Creator Club Admin View
- **Creator Directory Table**: Upgraded with 14 columns: Profile, Name, Instagram, Creator URL, Tier, Commission, Status, Clicks, Orders, Sales, Pending Earnings, Available Earnings, Conversion Rate (`orders / clicks * 100`, handling 0 as `0%`), and Actions.
- **Influencer Detail View Modal**:
  - Default Creator URL card with `COPY LINK`, `OPEN ↗`, and `SHARE` buttons.
  - Performance analytics cards: Total Clicks, Total Orders, Total Sales, Pending Commission, Available Commission, Conversion Rate.
  - Product Referral Links generator: Catalog selector dropdown + link creation + clicks breakdown.
  - Attributed Orders Table: Lists orders, sales amounts, snapshot commission rates, and statuses.

---

## 7. Security Best Practices Implemented

1. **Service Role Key Protection**: No Supabase service-role keys or database credentials are exposed in the client. All database writes pass through the server.
2. **Sanitized Public Responses**: The public API strictly strips `email`, `phone`, `commission_rate`, `total_earnings`, `available_earnings`, `pending_earnings`, and admin notes.
3. **Inactive Creator Protection**: Non-active influencers (`pending`, `inactive`, `suspended`, or nonexistent) return `403 Forbidden` / `404 Not Found` with an elegant public "Creator Profile Unavailable" view.
4. **Debounced Clicks**: Click tracker enforces a 10-second window to prevent click flooding.
5. **Database-Level RLS & Constraints**: RLS policies enforce authenticated read/write access while allowing service-role administration.

---

## 8. Test Suite Verification

Comprehensive test suites verify both Phase 1 and Phase 2 functionality:
- `tests/influencers.test.js`: **14/14 PASS**
- `tests/influencer-attribution.test.js`: **22/22 PASS**

Key automated tests include:
- 30-day attribution expiration calculations.
- Exact snapshot commission math (e.g. ₹2,000 $\times$ 10% = ₹200).
- Last-Click replacement while retaining first-click audit records.
- 10-second rapid click debounce protection.
- Successful order attribution and pending commission crediting.
- Single attribution idempotency preventing double-commission.
- Cancellation reconciliation revoking pending earnings.
- Public endpoint sanitization preventing leaks of private creator data.

---

## 9. Future Extension Points (Phase 3+)
The following are intentionally deferred to future phases and will integrate seamlessly with this foundation:
- Instagram Graph API & Reel insights verification.
- Creator self-service dashboard (`/creator/login`).
- Approved commission clearance window (e.g., 14-day return period expiry).
- UPI and bank withdrawals via Razorpay Payouts.
- Gamified tiers, points redemption, and creator contests.

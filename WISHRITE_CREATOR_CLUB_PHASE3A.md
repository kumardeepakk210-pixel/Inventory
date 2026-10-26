# WISHRITE CREATOR CLUB — PHASE 3A SPECIFICATION
## SECURE CREATOR LOGIN + CREATOR DASHBOARD

---

## 1. Executive Summary

Phase 3A of the WishRite Creator Club introduces the authenticated creator experience for WishRite's brand ambassadors and influencers. Built on top of Phase 1 (Influencer Master Registry & Admin Control) and Phase 2 (30-Day Referral Attribution, Last-Click Tracking & Storefront), Phase 3A enables creators to securely sign in, access real-time personal analytics, inspect attributed sales with zero customer PII exposure, generate canonical product referral links, and manage their public brand profile.

All private creator data is protected under a strict server-authoritative authorization rule that resolves identity from the verified session and database mapping, rejecting manipulated frontend identifiers.

---

## 2. System Architecture

```text
       CUSTOMER / CREATOR
              │
              ▼
       WISHRITE WEBSITE
   (Storefront & Creator Portal)
              │
              ▼
         WISHRITE API
     (/api/creator/*)
        ┌─────┴─────┐
        ▼           ▼
  SUPABASE AUTH  SUPABASE DB
        ▲           ▲
        └─────┬─────┘
              │
        INVENTORY ADMIN
    (Employee Management UI)
```

- **Separation of Concerns:** 
  - **Inventory Application:** Remains the internal administrative control center for WishRite staff.
  - **WishRite Website:** Delivers both customer shopping and authenticated creator portal experiences.
  - **Canonical Store:** `public.influencers` remains the single canonical source of truth for all influencer entities.

---

## 3. Creator Authentication & Identity Resolution

### 3.1 Mapping Architecture

```text
Supabase auth.users (or verified credentials)
              │
              ▼ (auth_user_id / email)
   public.influencer_accounts
              │
              ▼ (influencer_id)
      public.influencers
```

### 3.2 Database Schema: `public.influencer_accounts`

```sql
CREATE TABLE IF NOT EXISTS public.influencer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
    auth_user_id UUID NULL,
    email TEXT NOT NULL,
    password_hash TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_influencer_accounts_influencer_id UNIQUE (influencer_id),
    CONSTRAINT uq_influencer_accounts_auth_user_id UNIQUE (auth_user_id),
    CONSTRAINT uq_influencer_accounts_email UNIQUE (email)
);
```

### 3.3 Authorization Rule (Anti-Tampering)

1. The frontend NEVER supplies `influencer_id` to determine authorization.
2. Any client query string (e.g. `?influencer_id=xxx`) or request payload parameter is strictly disregarded.
3. Middleware `requireCreatorAuth` parses the incoming `Authorization: Bearer <token>`:
   - Verifies session token or Supabase JWT.
   - Maps user to `public.influencer_accounts`.
   - Checks that `account.is_active !== false`.
   - Fetches creator from `public.influencers` and asserts `creator.status === 'active'`.
   - Injects `req.creator` and `req.creatorAccount` into request context.

---

## 4. API Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/creator/login` | No | Authenticates creator with email/handle & password or Supabase JWT, issues session token. |
| `POST` | `/api/creator/logout` | Yes | Revokes active creator session. |
| `GET` | `/api/creator/me` | Yes | Returns authenticated creator summary and account status. |
| `GET` | `/api/creator/stats` | Yes | Returns real-time clicks, orders, sales, conversion rate, pending and available commission. |
| `GET` | `/api/creator/performance` | Yes | Returns performance trends (`7d`, `30d`, `90d`, `all`) with daily aggregated activity. |
| `GET` | `/api/creator/orders` | Yes | Returns paginated attributed orders with complete customer PII stripped. |
| `GET` | `/api/creator/links` | Yes | Returns permanent profile URL and product referral links with click counts. |
| `POST` | `/api/creator/links` | Yes | Generates a canonical product referral link for a specific jewelry product code. |
| `GET` | `/api/creator/profile` | Yes | Returns creator's public profile data and governance details. |
| `PATCH` | `/api/creator/profile` | Yes | Allows editing permitted fields (`name`, `bio`, `profile_image`, `instagram_url`). |

---

## 5. Security & Privacy Guardrails

1. **Zero Customer PII in Creator Portal:**
   - Order history visible to creators contains only: `order_reference`, `created_at`, `sales_amount`, `commission_rate`, `commission_amount`, `order_status`, `commission_status`, `product_summary`.
   - Customer name, phone number, email address, shipping address, and internal admin notes are strictly omitted.
2. **Administrative Governance Protection:**
   - Creators cannot modify `commission_rate`, `tier`, `status`, `public_slug`, `influencer_code`, or historical earnings.
   - Any attempt to send updates for governed fields is ignored and rejected.
3. **Credential Isolation:**
   - `SUPABASE_SERVICE_ROLE_KEY` is never sent to the browser or embedded in client assets.
   - Password hashes are stored using PBKDF2 with unique salts and are never returned in API payloads.

---

## 6. Frontend User Experience

- **Design Language:** Luxury `#5E3435` primary brand color, obsidian stone gradients, gold and bronze accents.
- **Mobile-First Responsiveness:**
  - Responsive metric cards.
  - Interactive daily performance trend chart with hover/touch tooltips.
  - Native sharing integration via `navigator.share()` with seamless fallback to clipboard copy.
  - Sticky bottom navigation on mobile devices (`Overview`, `Trends`, `Links`, `Orders`, `Profile`).
- **Routing:**
  - Handles `/creator`, `/creator/login`, `/creator/dashboard`, `/creator/profile`, `/creator/orders`, `/creator/links`, `/creator/performance`.
  - Supports browser history back/forward and hash fallbacks.

---

## 7. Out of Scope for Phase 3A

The following capabilities are explicitly deferred to future phases:
- UPI and bank account withdrawals (Phase 3B Wallet).
- Razorpay Payouts integration (Phase 3B Wallet).
- Points redemption and product gifting catalog.
- Instagram Graph API / OAuth / Reel insights automation.
- Contests and leaderboard modules.
- Automated TDS/Tax deductions.

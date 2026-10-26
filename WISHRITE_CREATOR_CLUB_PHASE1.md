# WishRite Creator Club — Phase 1 Architecture & Reference

## Overview
Phase 1 establishes the master data foundation, permanent Instagram-based public URL architecture, admin management interface, and basic statistics structure for the **WISHRITE CREATOR CLUB** system within the existing WishRite Inventory application.

---

## 1. Database Architecture

Migration script: [`supabase-influencer-foundation-v1.sql`](file:///Users/deepakkumar/Desktop/WISHRITE/Inventory_Code/Inventory/supabase-influencer-foundation-v1.sql)

### 1.1 `public.influencers`
Stores the canonical master data for each creator/influencer.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary Key |
| `influencer_code` | TEXT | *Generated* | Permanent human-readable identifier (e.g. `WR-INF-000001`), unique |
| `name` | TEXT | *Required* | Display / Legal Name of the creator |
| `email` | TEXT | `NULL` | Creator contact email |
| `phone` | TEXT | `NULL` | Contact phone number |
| `instagram_id` | TEXT | *Required* | Normalized Instagram username (e.g. `priya.jewels`), unique |
| `instagram_url` | TEXT | *Computed* | `https://instagram.com/{instagram_id}` |
| `public_slug` | TEXT | *Required* | Permanent URL slug (initially equals normalized `instagram_id`), unique |
| `public_profile_url` | TEXT | *Computed* | `https://wishrite.in/influencer/{public_slug}` |
| `profile_image` | TEXT | *Default Avatar* | Profile picture image URL |
| `category` | TEXT | `'Jewelry & Lifestyle'` | Content niche / category |
| `bio` | TEXT | `NULL` | Creator biography |
| `commission_rate` | NUMERIC(5,2) | `10.00` | Default affiliate commission rate percentage |
| `tier` | TEXT | `'starter'` | Creator tier: `starter`, `silver`, `gold`, `platinum`, `elite` |
| `status` | TEXT | `'pending'` | Creator status: `pending`, `active`, `inactive`, `suspended` |
| `created_at` | TIMESTAMPTZ | `now()` | Timestamp of creation |
| `updated_at` | TIMESTAMPTZ | `now()` | Timestamp of last modification |

**Indexes & Constraints:**
- `status` CHECK (`status IN ('pending', 'active', 'inactive', 'suspended')`)
- `tier` CHECK (`tier IN ('starter', 'silver', 'gold', 'platinum', 'elite')`)
- Unique index on `lower(instagram_id)` (prevents case-variation duplicate accounts)
- Unique index on `lower(public_slug)`
- Unique constraint on `influencer_code`
- B-tree indexes on `status` and `tier`

### 1.2 `public.influencer_links`
Manages affiliate, profile, and campaign links associated with the influencer.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary Key |
| `influencer_id` | UUID | *Required* | Foreign Key -> `public.influencers(id)` ON DELETE CASCADE |
| `link_type` | TEXT | `'profile'` | `profile`, `product`, `campaign` |
| `url` | TEXT | *Required* | Destination / tracked link URL |
| `campaign_id` | UUID | `NULL` | Optional campaign identifier |
| `is_default` | BOOLEAN | `false` | Marks canonical profile link |
| `created_at` | TIMESTAMPTZ | `now()` | Timestamp created |

### 1.3 `public.influencer_stats`
Stores affiliate sales, traffic, earnings, and engagement metrics for each creator.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary Key |
| `influencer_id` | UUID | *Required* | Unique Foreign Key -> `public.influencers(id)` ON DELETE CASCADE |
| `total_clicks` | BIGINT | `0` | Click tracking count |
| `total_orders` | BIGINT | `0` | Attributed orders count |
| `total_sales` | NUMERIC(14,2)| `0` | Attributed gross revenue |
| `total_views` | BIGINT | `0` | Public profile views |
| `total_earnings` | NUMERIC(14,2)| `0` | Cumulative commission earned |
| `available_earnings` | NUMERIC(14,2)| `0` | Cleared balance available for payout |
| `pending_earnings` | NUMERIC(14,2)| `0` | In-flight / return-period earnings |
| `total_points` | BIGINT | `0` | Creator reward club points |
| `updated_at` | TIMESTAMPTZ | `now()` | Timestamp of last metric update |

---

## 2. Public URL & Handle Normalization Architecture

### 2.1 Instagram Handle Normalization Rule
All Instagram IDs must be normalized before persistence or querying:
1. Strip leading `@` characters.
2. Trim leading and trailing whitespace.
3. Lowercase all characters.
4. Preserve periods (`.`) and underscores (`_`) while ensuring valid characters `^[a-z0-9._]{1,30}$`.

*Example:*
- User inputs: ` @Priya.Jewels `
- Normalized `instagram_id`: `priya.jewels`
- Initial `public_slug`: `priya.jewels`

### 2.2 Canonical Public URL Format
The public profile URL is strictly generated via `buildInfluencerPublicUrl(publicSlug)`:
```
https://wishrite.in/influencer/{public_slug}
```
No other domain or URL structure is used.

### 2.3 Permanent Influencer Code
Human-readable sequential code `WR-INF-XXXXXX` (e.g. `WR-INF-000001`):
- Generated monotonically from current database and mirror records.
- **Permanent and immutable**: Does not change even if the influencer changes their Instagram username in the future.

---

## 3. API Endpoints

All endpoints are registered on the existing Express application in [`server.js`](file:///Users/deepakkumar/Desktop/WISHRITE/Inventory_Code/Inventory/server.js) and backed by [`backend/influencers.js`](file:///Users/deepakkumar/Desktop/WISHRITE/Inventory_Code/Inventory/backend/influencers.js).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/influencers` | List all creators with aggregated statistics, filterable by `search`, `status`, `tier`, plus top summary cards metrics |
| `GET` | `/api/influencers/:id` | Fetch creator details by UUID, `influencer_code`, or `public_slug` |
| `POST` | `/api/influencers` | Create a new creator. Automatically normalizes handle, creates `influencer_stats` (zeros) and default `influencer_links` |
| `PUT` | `/api/influencers/:id` | Update creator profile, commission, tier, contact info |
| `PATCH`| `/api/influencers/:id/status`| Transition creator status (`pending`, `active`, `inactive`, `suspended`) |
| `DELETE`| `/api/influencers/:id` | Delete creator (cascades to links and stats) |
| `POST` | `/api/influencers/:id/regenerate-profile-url` | Rebuilds canonical public profile URL from normalized Instagram handle |

### Error Codes:
- `400 VALIDATION_FAILED` / `INVALID_INSTAGRAM_ID` / `INVALID_STATUS` / `INVALID_TIER`
- `404 NOT_FOUND`: When influencer is not found (displays "Influencer not found", never fakes data)
- `409 DUPLICATE_INSTAGRAM_ID`: When handle already exists
- `409 DUPLICATE_PUBLIC_SLUG`: When slug already exists

---

## 4. Frontend Interface (`index.html`)

The existing Influencers navigation item seamlessly maps to **WISHRITE CREATOR CLUB**:
1. **Header**: "WISHRITE CREATOR CLUB" with subtitle "Manage influencers, affiliate creators and creator performance."
2. **Top Summary Cards** (Calculated directly from live data; never faked):
   - Total Influencers
   - Active Creators
   - Pending Creators
   - Total Sales
   - Total Earnings
3. **Creator Directory Table**:
   - Columns: Profile, Name, Instagram, Creator URL, Tier, Commission, Status, Orders, Sales, Earnings, Actions.
   - Actions: View, Edit, Activate/Deactivate Toggle, Copy Link.
4. **Add / Edit Modal**:
   - Fields: Name \*, Instagram ID \*, Email, Phone, Category, Commission %, Tier, Status, Profile Image, Bio.
   - Dynamic interactive handle preview showing normalized ID and read-only URL: `wishrite.in/influencer/...` with instant **[COPY LINK]** button.
5. **View Modal**:
   - Complete profile overview and live statistics grid (Orders, Sales, Views, Clicks, Total Earnings, Available Earnings, Pending Earnings, Points).
   - Clear Phase 1 future placeholders:
     - **Instagram**: *Not Connected Yet*
     - **Withdrawals**: *Coming in next phase*
     - **Rewards**: *Coming in next phase*
6. **Backward Compatibility**:
   - The existing product-tagging / lookbook tagging functionality (`collabRoster`) is preserved and linked to the creator database.

---

## 5. Security & Architecture Assumptions

1. **Row Level Security (RLS)**:
   - RLS is enabled on `influencers`, `influencer_links`, and `influencer_stats`.
   - Read-only policies permit public viewing for published public profiles (`wishrite.in/influencer/*`).
   - Admin-side writes are strictly routed through the server API layer (`useAdmin: true`).
   - Service-role credentials and master secret keys are never exposed to browser client JavaScript.
2. **Resilience & Storage Mirror**:
   - Live Supabase operations are complemented with a synchronized local mirror in `data/influencers_store.json` so development environments remain resilient.
   - Zero faked numbers: Stats initialize to `0` and only reflect real transactions.

---

## 6. How to Test

### Automated Unit & API Test Suite
Run the 14-point test suite covering normalization, code generation, URL building, constraints, duplicate rejection, and full CRUD API workflows:
```bash
node --test tests/influencers.test.js
```

### Manual Verification Checklist
1. Open the application in browser and click **Influencers** in navigation.
2. Confirm header reads **WISHRITE CREATOR CLUB** with 5 live summary cards.
3. Click **Add Influencer**:
   - Type name: `Priya Sharma`
   - Type handle: `@Priya.Jewels`
   - Observe live URL preview dynamically updating to `wishrite.in/influencer/priya.jewels`.
   - Click **Copy Link** to test clipboard copy.
   - Save and verify new creator appears in table with `WR-INF-000001` format.
4. Attempt to add another creator with `@priya.jewels`:
   - Verify modal stops duplicate with clear conflict alert.
5. Click **View** on the creator row:
   - Verify details, zero stats, and placeholders (*Instagram: Not Connected Yet*, *Withdrawals: Coming in next phase*, *Rewards: Coming in next phase*).
6. Click **Activate/Deactivate** to toggle status between active and inactive.
7. Verify existing Inventory and Order tabs continue functioning with zero regressions.

---

## 7. What Is Intentionally NOT Implemented Yet (Phase 1 Boundaries)

As specified in Phase 1 requirements, the following modules are deferred to future phases:
- Instagram Graph API OAuth & Token Exchange
- Automated Instagram Reel / Post Insights fetching
- Financial payout / withdrawal processing system
- Creator loyalty points redemption store
- Influencer leaderboard & affiliate contests

---

## 8. Phase 2 Upgrade Reference
Phase 2 (Public Influencer URL + Referral & Attribution Tracking) has been implemented on top of this foundation. See [WISHRITE_CREATOR_CLUB_PHASE2.md](file:///Users/deepakkumar/Desktop/WISHRITE/Inventory_Code/Inventory/WISHRITE_CREATOR_CLUB_PHASE2.md) for full architectural documentation.

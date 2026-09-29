# WishRite Storefront Audience Integration Contract
**Version:** 1.0.0  
**Target Consumer:** WishRite Customer Website / Storefront Frontend Application  
**Database Table:** `public.inventory`  
**Field:** `audience`

---

## 1. Executive Summary & Canonical Architecture

WishRite operates a centralized inventory and product catalog system. To deliver a seamless customer shopping experience across Men, Women, and Kids collections while ensuring database integrity, the **Audience Model** is strictly defined as follows:

1. **Single Source of Truth:** A single nullable column `audience` on table `public.inventory`.
2. **Immutable Canonical Values:** Persisted values are strictly constrained to:
   - `'Male'`
   - `'Female'`
   - `'Boys'`
   - `'Girls'`
3. **The "Kids" Contract:**
   - **`Kids` is NEVER persisted in the database.** The database check constraint `chk_inventory_audience` will reject any insert/update with value `'Kids'`.
   - **`Kids` is a customer-facing aggregation** representing the set `{ 'Boys', 'Girls' }`.
   - On the storefront, the "Kids" panel/filter fetches products where `audience` is either `'Boys'` or `'Girls'`.
4. **Legacy Record Handling:**
   - Products where `audience IS NULL` are classified as `'Unassigned'`.
   - The storefront MUST NOT infer audience from product titles (e.g., "Silver Baby Kada" must not be automatically assumed to be Kids unless its `audience` column is set).
   - Unassigned products remain accessible in general catalog views, search, and category pages, but will not show in audience-specific collection filters until backfilled in the Inventory Admin.

---

## 2. Database Schema Specification

```sql
-- DDL definition applied via supabase-audience-migration.sql
ALTER TABLE public.inventory 
ADD COLUMN IF NOT EXISTS audience text NULL;

ALTER TABLE public.inventory 
DROP CONSTRAINT IF EXISTS chk_inventory_audience;

ALTER TABLE public.inventory 
ADD CONSTRAINT chk_inventory_audience 
CHECK (audience IS NULL OR audience IN ('Male', 'Female', 'Boys', 'Girls'));

CREATE INDEX IF NOT EXISTS idx_inventory_audience 
ON public.inventory (audience);
```

---

## 3. PostgREST & Supabase Client Query Guide

The WishRite storefront queries Supabase directly or via backend API. Below are the canonical query patterns.

### 3.1. Fetching Men's Jewellery
```typescript
const { data, error } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .eq('audience', 'Male')
  .order('created_at', { ascending: false });
```
**Equivalent HTTP / PostgREST URL:**
```http
GET /rest/v1/inventory?status=eq.Active&audience=eq.Male&select=*
```

### 3.2. Fetching Women's Jewellery
```typescript
const { data, error } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .eq('audience', 'Female')
  .order('created_at', { ascending: false });
```
**Equivalent HTTP / PostgREST URL:**
```http
GET /rest/v1/inventory?status=eq.Active&audience=eq.Female&select=*
```

### 3.3. Fetching All Kids Jewellery (Aggregating Boys & Girls)
> **Crucial Rule:** The storefront MUST query for both `'Boys'` and `'Girls'` when displaying the primary "Kids" collection.
```typescript
const { data, error } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .in('audience', ['Boys', 'Girls'])
  .order('created_at', { ascending: false });
```
**Equivalent HTTP / PostgREST URL:**
```http
GET /rest/v1/inventory?status=eq.Active&audience=in.(Boys,Girls)&select=*
```

### 3.4. Fetching Kids Sub-Categories (Boys or Girls)
```typescript
// Boys Only
const { data: boysData } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .eq('audience', 'Boys');

// Girls Only
const { data: girlsData } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .eq('audience', 'Girls');
```

### 3.5. Multi-Faceted Filter (Category + Audience + Price)
When a user on the storefront selects e.g. "Rings for Men under ₹2,000":
```typescript
const { data } = await supabase
  .from('inventory')
  .select('*')
  .eq('status', 'Active')
  .eq('category', 'Ring')
  .eq('audience', 'Male')
  .lte('selling_price', 2000);
```

---

## 4. Storefront Navigation & UI Recommendations

### 4.1. Navigation Menu Structure
```
[Header Navigation]
├── Women's Jewellery (/collections/women)
│   └── Audience Filter: audience = 'Female'
├── Men's Jewellery (/collections/men)
│   └── Audience Filter: audience = 'Male'
├── Kids Jewellery (/collections/kids)
│   ├── View All Kids (/collections/kids) -> audience IN ('Boys', 'Girls')
│   ├── Boys Jewellery (/collections/kids-boys) -> audience = 'Boys'
│   └── Girls Jewellery (/collections/kids-girls) -> audience = 'Girls'
└── Festive Collections (/collections/festive)
    └── Filter by occasion_slug (e.g. 'durga-puja') with optional audience sub-filter
```

### 4.2. Breadcrumbs & Badges
When displaying a product card or product detail page:
- `product.audience === 'Female'`: Display badge `"👩 Women"` or `"👩 Female"`
- `product.audience === 'Male'`: Display badge `"👨 Men"` or `"👨 Male"`
- `product.audience === 'Boys'`: Display badge `"👦 Boys (Kids)"`
- `product.audience === 'Girls'`: Display badge `"👧 Girls (Kids)"`
- `product.audience == null`: Do not display an audience badge (render neutral category breadcrumb)

---

## 5. Domain Boundary Separation

The storefront must strictly maintain separation between orthogonal product dimensions:

| Dimension | Database Column | Possible Values / Examples | Purpose |
|---|---|---|---|
| **Audience** | `audience` | `Male`, `Female`, `Boys`, `Girls` | Target demographic/wearer |
| **Catalog Type** | `catalog_type` | `silver_jewellery`, `saree`, `artificial_jewellery` | Broad department |
| **Category** | `category` | `Ring`, `Earring`, `Necklace`, `Anklet` | Physical jewellery form |
| **Occasion** | `occasion_slug` | `durga-puja`, `diwali`, `wedding` | Festive campaign |
| **Stock** | `stock_quantity` | `0, 1, 2, ...` | Inventory count |

---

## 6. Error Handling & Guardrails

1. **Never send `audience: 'Kids'` in any API mutation:**  
   If the storefront has any reviews or customer inquiry forms that touch product data, never pass `'Kids'` as a canonical value.
2. **Never hide products when audience filter is omitted:**  
   Default catalog queries without an audience filter should retrieve all items (`status = 'Active'`), including `audience IS NULL` legacy records.
3. **No Automatic Inference:**  
   Do not apply regex on `product_name` to deduce audience on the storefront. Consistent categorization relies solely on the `audience` column managed through the inventory portal.

-- ==============================================================================
-- WISHRITE INVENTORY & STOREFRONT — CUSTOMER WALLET & REWARD POINTS MIGRATION
-- Safely adds wallet_balance and points_balance columns and audit tables
-- Fully idempotent and non-destructive to existing customer records.
-- ==============================================================================

-- 1. Extend public.customers table if columns do not exist
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS wallet_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS points_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS total_purchased_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS user_id uuid NULL,
    ADD COLUMN IF NOT EXISTS referral_code varchar(20) NULL,
    ADD COLUMN IF NOT EXISTS referred_by_code varchar(20) NULL;

-- 2. Indexes for fast customer directory lookups
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (customer_phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers (customer_email);
CREATE INDEX IF NOT EXISTS idx_customers_wallet_balance ON public.customers (wallet_balance);
CREATE INDEX IF NOT EXISTS idx_customers_points_balance ON public.customers (points_balance);

-- 3. Customer Balance Audit Ledger (Tracks admin credits/debits & redemption events)
CREATE TABLE IF NOT EXISTS public.customer_balance_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    customer_phone text NULL,
    action_type text NOT NULL, -- 'WALLET_ADJUST', 'POINTS_ADJUST', 'ORDER_PURCHASE', 'REFUND'
    wallet_delta numeric(12, 2) NOT NULL DEFAULT 0.00,
    wallet_balance_after numeric(12, 2) NOT NULL DEFAULT 0.00,
    points_delta numeric(12, 2) NOT NULL DEFAULT 0.00,
    points_balance_after numeric(12, 2) NOT NULL DEFAULT 0.00,
    note text NULL,
    performed_by text NOT NULL DEFAULT 'Admin',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Enable Row Level Security (RLS) on audit table
ALTER TABLE public.customer_balance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer audit readable by staff" ON public.customer_balance_audit;
CREATE POLICY "Customer audit readable by staff"
ON public.customer_balance_audit FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Customer audit insertable by staff" ON public.customer_balance_audit;
CREATE POLICY "Customer audit insertable by staff"
ON public.customer_balance_audit FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- 5. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

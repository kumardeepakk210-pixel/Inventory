// ==============================================================================
// WISHRITE INVENTORY — SERVER-SIDE SUPABASE CLIENT
// All database queries and storage operations run strictly server-side.
// Credentials and service-role keys NEVER leave this layer.
// Transient retry policy: only retry network/5xx; never retry deterministic errors.
// ==============================================================================

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DOTENV_PATH = path.resolve(PROJECT_ROOT, '.env');
if (!process.env.VERCEL) {
    dotenv.config({ path: DOTENV_PATH });
}

// Server-side Supabase client initialization explicitly reading Vercel Production variables
export const SUPABASE_URL = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
).trim();

const rawSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
const rawServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const rawAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
).trim();

const rawPublishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
).trim();

// Credential Priority & Categorization:
// 1. SUPABASE_SECRET_KEY (must NOT start with sb_publishable_)
// 2. Legacy SUPABASE_SERVICE_ROLE_KEY (must NOT start with sb_publishable_)
// 3. SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY for normal public/read operations
let adminKey = '';
let adminCredentialType = 'none';

if (rawSecretKey) {
    adminKey = rawSecretKey;
    adminCredentialType = rawSecretKey.startsWith('sb_secret_') ? 'secret' : 'service_role';
} else if (rawServiceRoleKey) {
    adminKey = rawServiceRoleKey;
    adminCredentialType = rawServiceRoleKey.startsWith('sb_secret_') ? 'secret' : 'service_role';
}

// Publishable / Client Credential:
let publishableKey = '';
if (rawAnonKey) {
    publishableKey = rawAnonKey;
} else if (rawPublishableKey) {
    publishableKey = rawPublishableKey;
} else if (adminKey) {
    publishableKey = adminKey;
}

// Default key for normal public/read-only database operations
export const SUPABASE_KEY = publishableKey || adminKey;
export const SUPABASE_ADMIN_KEY = adminKey;
export const CREDENTIAL_TYPE = adminKey ? adminCredentialType : 'publishable/anon';

/**
 * Check whether a valid server admin credential is configured (STEP 3)
 */
export function hasServerAdminCredential() {
    return Boolean(adminKey);
}

/**
 * Return admin credential type: 'secret', 'service_role', or 'none'
 */
export function getAdminCredentialType() {
    return adminCredentialType;
}

/**
 * Check whether publishable key is configured
 */
export function isPublishableKeyConfigured() {
    return Boolean(publishableKey);
}

/**
 * Require a valid server admin credential or throw clean error
 */
export function requireServerAdminCredential(customMessage) {
    if (!hasServerAdminCredential()) {
        const err = new Error(
            customMessage || 'A server-side Supabase secret/service-role credential is required for administrative database mutations.'
        );
        err.code = 'SERVER_ADMIN_CREDENTIAL_MISSING';
        err.status = 403;
        throw err;
    }
}

// Backward compatibility alias
export const requireAdminWriteCredentials = requireServerAdminCredential;

// STEP 2 — Safe Environment Startup Logging (NEVER print actual keys!)
const hasSecret = Boolean(rawSecretKey);
const hasLegacyServiceRole = Boolean(rawServiceRoleKey);

console.log('[Supabase Config]');
console.log(`URL configured: ${Boolean(SUPABASE_URL) ? 'YES' : 'NO'}`);
console.log(`Publishable key configured: ${Boolean(publishableKey) ? 'YES' : 'NO'}`);
console.log(`Secret key configured: ${hasSecret ? 'YES' : 'NO'}`);
console.log(`Legacy service-role configured: ${hasLegacyServiceRole ? 'YES' : 'NO'}`);
console.log(`Admin credential available: ${hasServerAdminCredential() ? 'YES' : 'NO'}`);
console.log(`process.cwd(): ${process.cwd()}`);

if (adminKey) {
    console.log(`[Supabase] Server admin credential: configured`);
    console.log(`[Supabase] Admin credential type: ${adminCredentialType}`);
} else {
    console.log(`[Supabase] Server admin credential: MISSING`);
}

// STEP 4 — Separate Clients for Public Reads vs Admin Writes
const backendAuthOptions = {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
};

export const publicClient = (() => {
    try {
        return (SUPABASE_URL && publishableKey)
            ? createClient(SUPABASE_URL, publishableKey, backendAuthOptions)
            : null;
    } catch (e) {
        console.warn('[Supabase Client] Failed to create public client at startup:', e.message);
        return null;
    }
})();

export const adminClient = (() => {
    try {
        return (SUPABASE_URL && adminKey)
            ? createClient(SUPABASE_URL, adminKey, backendAuthOptions)
            : null;
    } catch (e) {
        console.warn('[Supabase Client] Failed to create admin client at startup:', e.message);
        return null;
    }
})();

export const supabasePublicClient = publicClient;
export const supabaseAdminClient = adminClient;

export const getHeaders = (extraHeaders = {}) => ({
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extraHeaders
});

export const getAdminHeaders = (extraHeaders = {}) => {
    if (!adminKey) {
        requireServerAdminCredential('A server-side Supabase secret/service-role credential is required for administrative operations.');
    }
    return {
        'apikey': adminKey,
        'Authorization': `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extraHeaders
    };
};

// Known schema column caches to avoid blind schema mismatch requests
export const tableColumnsCache = {
    inventory: new Set([
        'id', 'product_code', 'product_name', 'product_description', 'short_description', 'category',
        'catalog_type', 'stock_quantity', 'low_stock_threshold', 'status',
        'purchase_price', 'cost_price', 'selling_price', 'compare_at_price', 'gst_rate',
        'weight', 'size', 'material', 'purity', 'finish',
        'purchase_date', 'shop_name', 'shop_address',
        'storage_folder', 'image_url', 'product_media_urls', 'audience',
        'design_group', 'variant_type', 'variant_value', 'product_slug', 'slug',
        'occasion_slug', 'occasion_category', 'occasion_enabled', 'occasion_featured',
        'color', 'fabric', 'design', 'pattern', 'border_style', 'matching_tags',
        'seo_title', 'seo_description', 'seo_keywords',
        'created_at', 'updated_at'
    ]),
    occasion_inventory: new Set([
        'id', 'product_code', 'product_name', 'product_description', 'category',
        'fabric', 'pattern', 'weight', 'selling_price', 'purchase_price',
        'discount', 'stock_quantity', 'occasion_slug', 'status', 'is_featured',
        'purchase_date', 'created_at', 'updated_at'
    ]),
    occasion_settings: new Set([
        'id', 'occasion_name', 'occasion_slug', 'is_selected', 'is_active', 'start_date', 'end_date',
        'page_title', 'page_description', 'banner_image',
        'created_at', 'updated_at'
    ]),
    occasion_product_images: new Set([
        'id', 'product_id', 'image_url', 'is_primary', 'sort_order', 'created_at'
    ]),
    product_images: new Set([
        'id', 'product_id', 'product_code', 'file_name', 'image_url', 'storage_path',
        'image_type', 'image_role', 'sort_order', 'alt_text', 'is_primary', 'is_active',
        'generation_source', 'generation_model', 'generation_prompt',
        'resolution', 'width', 'height', 'generation_status', 'generation_job_id',
        'is_ai_generated', 'parent_image_id',
        'master_8k_url', 'master_4k_url', 'derivative_urls',
        'generation_resolution', 'is_native_4k', 'upscale_provider', 'upscale_method', 'upscale_quality',
        'version', 'created_at', 'updated_at'
    ]),
    ai_image_jobs: new Set([
        'id', 'product_id', 'product_code', 'source_image_url', 'status',
        'total_images', 'completed_images', 'failed_images', 'model',
        'output_resolution', 'created_at', 'started_at', 'completed_at',
        'error_message'
    ]),
    customers: new Set([
        'id', 'customer_name', 'customer_phone', 'customer_email',
        'customer_address', 'customer_city', 'customer_state', 'customer_country', 'customer_pin',
        'wallet_balance', 'points_balance', 'total_purchased_amount',
        'referral_code', 'referred_by_code',
        'is_phone_verified', 'last_login_at', 'user_id', 'password_set',
        'created_at', 'updated_at'
    ]),
    customer_balance_audit: new Set([
        'id', 'customer_id', 'customer_phone', 'action_type',
        'wallet_delta', 'wallet_balance_after', 'points_delta', 'points_balance_after',
        'note', 'performed_by', 'created_at'
    ]),
    influencers: new Set([
        'id', 'influencer_code', 'name', 'email', 'phone',
        'instagram_id', 'instagram_url', 'public_slug', 'public_profile_url',
        'profile_image', 'category', 'bio', 'commission_rate', 'tier', 'status',
        'created_at', 'updated_at'
    ]),
    influencer_accounts: new Set([
        'id', 'influencer_id', 'auth_user_id', 'email', 'password_hash',
        'is_active', 'last_login_at', 'created_at', 'updated_at'
    ]),
    influencer_links: new Set([
        'id', 'influencer_id', 'link_type', 'url', 'campaign_id', 'is_default', 'created_at'
    ]),
    influencer_stats: new Set([
        'id', 'influencer_id', 'total_clicks', 'total_orders', 'total_sales',
        'total_views', 'total_earnings', 'available_earnings', 'pending_earnings',
        'total_points', 'updated_at'
    ]),
    influencer_clicks: new Set([
        'id', 'influencer_id', 'influencer_link_id', 'attribution_id',
        'landing_url', 'product_id', 'product_code', 'session_id',
        'device_type', 'user_agent', 'referrer_url', 'created_at'
    ]),
    influencer_attributions: new Set([
        'id', 'influencer_id', 'influencer_link_id', 'first_seen_at',
        'last_seen_at', 'expires_at', 'first_landing_url', 'last_landing_url',
        'first_influencer_id', 'last_influencer_id', 'session_id',
        'status', 'created_at', 'updated_at'
    ]),
    influencer_order_attributions: new Set([
        'id', 'influencer_id', 'order_id', 'order_reference', 'attribution_id',
        'influencer_link_id', 'sales_amount', 'commission_rate', 'commission_amount',
        'status', 'created_at', 'updated_at'
    ]),
    orders: new Set([
        'id', 'order_number', 'customer_name', 'customer_phone', 'customer_email',
        'subtotal', 'discount', 'tax', 'grand_total', 'order_status', 'payment_status',
        'razorpay_order_id', 'razorpay_payment_id', 'influencer_id', 'influencer_code',
        'influencer_attribution_id', 'influencer_link_id', 'influencer_commission_rate',
        'influencer_commission_amount', 'created_at', 'updated_at'
    ]),
    sales: new Set([
        'id', 'product_code', 'product_name', 'product_description', 'category',
        'quantity', 'selling_price', 'discount', 'tax', 'weight', 'size',
        'customer_name', 'customer_phone', 'customer_email', 'customer_address',
        'customer_city', 'customer_state', 'customer_pin', 'customer_country',
        'invoice_total', 'paid_amount', 'due_amount', 'payment_status',
        'order_id', 'inventory_id', 'influencer_id', 'influencer_code',
        'influencer_attribution_id', 'influencer_commission_rate', 'influencer_commission_amount',
        'created_at'
    ])
};

/**
 * Dynamically check if a column exists on a table and cache it
 */
export async function verifyTableColumn(table, column) {
    if (!tableColumnsCache[table]) tableColumnsCache[table] = new Set();
    if (tableColumnsCache[table].has(column)) return true;

    try {
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=1`;
        const res = await fetch(url, { method: 'GET', headers: getHeaders() });
        if (res.ok) {
            tableColumnsCache[table].add(column);
            return true;
        }
    } catch (e) {}
    return false;
}

/**
 * Filter payload so only columns known to exist in the database table are sent
 */
export function filterPayloadForTable(table, payload) {
    const knownColumns = tableColumnsCache[table];
    if (!knownColumns || knownColumns.size === 0) {
        return { validPayload: { ...payload }, omittedColumns: [] };
    }

    const validPayload = {};
    const omittedColumns = [];

    for (const [key, value] of Object.entries(payload)) {
        if (knownColumns.has(key)) {
            validPayload[key] = value;
        } else {
            omittedColumns.push(key);
        }
    }

    return { validPayload, omittedColumns };
}

/**
 * Check whether an HTTP response or error is transient (network / 502 / 503 / 504 / timeout)
 */
function isTransientError(status, error) {
    if ([502, 503, 504].includes(status)) return true;
    if (error && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.name === 'TimeoutError')) {
        return true;
    }
    return false;
}

/**
 * Execute a query on a Supabase table via PostgREST
 * Throws on failure; does NOT convert database errors to empty arrays.
 */
export async function dbQuery(table, queryParams = '', options = {}) {
    const useAdmin = Boolean(options.useAdmin);
    const headers = useAdmin ? getAdminHeaders() : getHeaders();
    const url = `${SUPABASE_URL}/rest/v1/${table}${queryParams ? `?${queryParams}` : ''}`;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers
            });

            if (res.ok) {
                return await res.json();
            }

            const errData = await res.json().catch(() => ({ message: res.statusText }));
            const errMsg = errData.message || `Database query failed on table '${table}'`;

            if (attempts < maxAttempts && isTransientError(res.status, null)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            const err = new Error(errMsg);
            err.status = res.status;
            err.code = errData.code;
            throw err;
        } catch (fetchErr) {
            if (attempts < maxAttempts && isTransientError(null, fetchErr)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
            throw fetchErr;
        }
    }
}

/**
 * Execute an administrative query using the server admin Supabase client
 */
export async function dbAdminQuery(table, queryParams = '') {
    return dbQuery(table, queryParams, { useAdmin: true });
}

/**
 * Insert record(s) into Supabase with schema column validation and transient retry
 */
export async function dbInsert(table, payload, options = {}) {
    const isArray = Array.isArray(payload);
    const rawItems = isArray ? payload : [payload];
    
    // Filter out unknown columns before sending to PostgREST
    const processed = rawItems.map(item => filterPayloadForTable(table, item));
    const validItems = processed.map(p => p.validPayload);
    const omittedColumns = Array.from(new Set(processed.flatMap(p => p.omittedColumns)));

    const useAdmin = Boolean(options.useAdmin);
    if (useAdmin && !hasServerAdminCredential()) {
        requireServerAdminCredential(`A server-side Supabase secret/service-role credential is required to insert into table '${table}'.`);
    }
    const headers = useAdmin ? getAdminHeaders() : getHeaders();

    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(isArray ? validItems : validItems[0])
            });

            if (res.ok) {
                const data = await res.json().catch(() => []);
                return {
                    data: isArray ? data : (data[0] || null),
                    omittedColumns
                };
            }

            const errData = await res.json().catch(() => ({ message: res.statusText }));
            const errMsg = errData.message || `Failed to insert record into table '${table}'`;

            const missingMatch = errMsg.match(/Could not find the '([^']+)' column/i) ||
                                 errMsg.match(/column "?([^"\s]+)"? does not exist/i);
            if (missingMatch && missingMatch[1]) {
                const col = missingMatch[1];
                if (isArray) {
                    validItems.forEach(item => delete item[col]);
                } else {
                    delete validItems[0][col];
                }
                omittedColumns.push(col);
                continue;
            }

            if (attempts < maxAttempts && isTransientError(res.status, null)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            const err = new Error(errMsg);
            err.status = res.status;
            err.code = errData.code;
            throw err;
        } catch (fetchErr) {
            if (attempts < maxAttempts && isTransientError(null, fetchErr)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
            throw fetchErr;
        }
    }
}

/**
 * Execute an administrative insert using the server admin Supabase client
 */
export async function dbAdminInsert(table, payload) {
    return dbInsert(table, payload, { useAdmin: true });
}

/**
 * Update record(s) in Supabase with schema column validation and transient retry
 */
export async function dbUpdate(table, filterKey, filterVal, payload, options = {}) {
    const { validPayload, omittedColumns } = filterPayloadForTable(table, payload);

    if (Object.keys(validPayload).length === 0) {
        return { data: null, omittedColumns };
    }

    const useAdmin = Boolean(options.useAdmin);
    if (useAdmin && !hasServerAdminCredential()) {
        requireServerAdminCredential(`A server-side Supabase secret/service-role credential is required to update table '${table}'.`);
    }
    const headers = useAdmin ? getAdminHeaders() : getHeaders();

    const url = `${SUPABASE_URL}/rest/v1/${table}?${filterKey}=eq.${encodeURIComponent(filterVal)}`;
    let attempts = 0;
    const maxAttempts = 15;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(validPayload)
            });

            if (res.ok) {
                const data = await res.json().catch(() => []);
                return {
                    data: (Array.isArray(data) ? data[0] : data) || null,
                    omittedColumns
                };
            }

            const errData = await res.json().catch(() => ({ message: res.statusText }));
            const errMsg = errData.message || `Failed to update record in table '${table}'`;

            const missingMatch = errMsg.match(/Could not find the '([^']+)' column/i) ||
                                 errMsg.match(/column "?([^"\s]+)"? does not exist/i);
            if (missingMatch && missingMatch[1]) {
                const col = missingMatch[1];
                delete validPayload[col];
                omittedColumns.push(col);
                if (Object.keys(validPayload).length === 0) {
                    return { data: null, omittedColumns };
                }
                continue;
            }

            if (attempts < maxAttempts && isTransientError(res.status, null)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            const err = new Error(errMsg);
            err.status = res.status;
            err.code = errData.code;
            throw err;
        } catch (fetchErr) {
            if (attempts < maxAttempts && isTransientError(null, fetchErr)) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
            throw fetchErr;
        }
    }
}

/**
 * Execute an administrative update using the server admin Supabase client
 */
export async function dbAdminUpdate(table, filterKey, filterVal, payload) {
    return dbUpdate(table, filterKey, filterVal, payload, { useAdmin: true });
}

/**
 * Delete record(s) from Supabase table
 */
export async function dbDelete(table, filterKey, filterVal, options = {}) {
    const useAdmin = Boolean(options.useAdmin);
    if (useAdmin && !hasServerAdminCredential()) {
        requireServerAdminCredential(`A server-side Supabase secret/service-role credential is required to delete from table '${table}'.`);
    }
    const headers = useAdmin ? getAdminHeaders() : getHeaders();
    const url = `${SUPABASE_URL}/rest/v1/${table}?${filterKey}=eq.${encodeURIComponent(filterVal)}`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errData.message || `Failed to delete record from table '${table}'`);
    }

    return true;
}

/**
 * Execute an administrative delete using the server admin Supabase client
 */
export async function dbAdminDelete(table, filterKey, filterVal) {
    return dbDelete(table, filterKey, filterVal, { useAdmin: true });
}

/**
 * Storage: Upload file buffer to bucket
 */
export async function storageUpload(bucket, path, buffer, contentType) {
    const cleanPath = path.replace(/^\/+/, '');
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${cleanPath}`;
    const activeKey = adminKey || SUPABASE_KEY;
    
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': activeKey,
            'Authorization': `Bearer ${activeKey}`,
            'Content-Type': contentType || 'application/octet-stream',
            'x-upsert': 'true'
        },
        body: buffer
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errData.message || `Storage upload failed for ${path}`);
    }

    return getStoragePublicUrl(bucket, cleanPath);
}

/**
 * Storage: Delete file from bucket
 */
export async function storageDelete(bucket, path) {
    const cleanPath = path.replace(/^\/+/, '');
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${cleanPath}`;
    
    const res = await fetch(url, {
        method: 'DELETE',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errData.message || `Storage delete failed for ${path}`);
    }

    return true;
}

/**
 * Storage: List files in bucket folder
 */
export async function storageList(bucket, prefix = '') {
    const url = `${SUPABASE_URL}/storage/v1/object/list/${bucket}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
            prefix: prefix.replace(/^\/+/, ''),
            limit: 100,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' }
        })
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errData.message || `Storage listing failed for ${bucket}/${prefix}`);
    }

    return await res.json();
}

/**
 * Storage: Get public URL
 */
export function getStoragePublicUrl(bucket, path) {
    const cleanPath = path.replace(/^\/+/, '');
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${cleanPath}`;
}



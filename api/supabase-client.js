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
dotenv.config({ path: DOTENV_PATH });

export const SUPABASE_URL = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
).trim();

const rawSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
const rawServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const rawPublishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
).trim();

const rawAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
).trim();

// Credential Priority & Categorization (STEP 3):
// 1. SUPABASE_SECRET_KEY (must NOT start with sb_publishable_)
// 2. Legacy SUPABASE_SERVICE_ROLE_KEY (must NOT start with sb_publishable_)
// 3. SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY for normal public/read operations
let adminKey = '';
let adminCredentialType = 'none';

if (rawSecretKey && !rawSecretKey.startsWith('sb_publishable_')) {
    adminKey = rawSecretKey;
    adminCredentialType = rawSecretKey.startsWith('sb_secret_') ? 'secret' : 'secret';
} else if (rawServiceRoleKey && !rawServiceRoleKey.startsWith('sb_publishable_')) {
    adminKey = rawServiceRoleKey;
    adminCredentialType = rawServiceRoleKey.startsWith('sb_secret_') ? 'secret' : 'service_role';
}

// Publishable / Client Credential:
let publishableKey = '';
if (rawPublishableKey) {
    publishableKey = rawPublishableKey;
} else if (rawAnonKey) {
    publishableKey = rawAnonKey;
} else if (rawServiceRoleKey && rawServiceRoleKey.startsWith('sb_publishable_')) {
    publishableKey = rawServiceRoleKey;
} else if (rawSecretKey && rawSecretKey.startsWith('sb_publishable_')) {
    publishableKey = rawSecretKey;
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
 * Require a valid server admin credential or throw clean error (STEP 1, 5)
 */
export function requireServerAdminCredential() {
    if (!hasServerAdminCredential()) {
        const err = new Error(
            'A server-side Supabase secret/service-role credential is required for administrative occasion updates.'
        );
        err.code = 'SERVER_ADMIN_CREDENTIAL_MISSING';
        err.status = 403;
        throw err;
    }
}

// Backward compatibility alias
export const requireAdminWriteCredentials = requireServerAdminCredential;

// STEP 2 — Safe Environment Startup Logging (NEVER print actual keys!)
const hasSecret = Boolean(rawSecretKey && !rawSecretKey.startsWith('sb_publishable_'));
const hasLegacyServiceRole = Boolean(rawServiceRoleKey && !rawServiceRoleKey.startsWith('sb_publishable_'));

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
    if (!adminKey) return getHeaders(extraHeaders);
    return {
        'apikey': adminKey,
        'Authorization': `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extraHeaders
    };
};

// Known schema column caches to avoid blind schema mismatch requests
const tableColumnsCache = {
    inventory: new Set([
        'id', 'product_code', 'product_name', 'product_description', 'category',
        'selling_price', 'purchase_price', 'stock_quantity', 'weight', 'size',
        'shop_name', 'shop_address', 'purchase_date', 'storage_folder',
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
                if (tableColumnsCache[table]) tableColumnsCache[table].delete(col);
                const err = new Error(`Schema mismatch: column '${col}' does not exist on table '${table}'`);
                err.status = 400;
                err.code = 'SCHEMA_COLUMN_NOT_FOUND';
                throw err;
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

    const useAdmin = Boolean(options.useAdmin) && hasServerAdminCredential();
    const headers = useAdmin ? getAdminHeaders() : getHeaders();

    const url = `${SUPABASE_URL}/rest/v1/${table}?${filterKey}=eq.${encodeURIComponent(filterVal)}`;
    let attempts = 0;
    const maxAttempts = 2;

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
                if (tableColumnsCache[table]) tableColumnsCache[table].delete(col);
                const err = new Error(`Schema mismatch: column '${col}' not found in table '${table}'`);
                err.status = 400;
                err.code = 'SCHEMA_COLUMN_NOT_FOUND';
                throw err;
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
    
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
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



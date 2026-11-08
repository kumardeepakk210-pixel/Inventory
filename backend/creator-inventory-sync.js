// ==============================================================================
// WISHRITE INVENTORY — CREATOR INVENTORY SYNCHRONIZATION SERVICE
// Connects the existing Creator platform influencer records and Instagram profile
// data to the Inventory influencer management system using the canonical primary
// key: public.influencers.influencer_id (UUID).
//
// Key Invariants:
// 1. Single source of truth: public.influencers.
// 2. Matching key is ALWAYS influencer_id (never email or instagram handle).
// 3. No duplicate records.
// 4. Financial, commission rate, tier, status, and wallet data are strictly preserved.
// 5. Meta access tokens and secrets are NEVER exposed in API responses or logs.
// 6. Resilient: works gracefully if Meta Graph API or Creator API is temporarily down.
// ==============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbInsert, dbUpdate, hasServerAdminCredential } from './supabase-client.js';
import { logCreatorAudit } from './creator-audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const INFLUENCERS_STORE_PATH = path.join(DATA_DIR, 'influencers_store.json');

export const META_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v26.0';
export const WISHRITE_OFFICIAL_IG_HANDLE = 'wishrite.in';
export const WISHRITE_OFFICIAL_IG_ACCOUNT_ID = '17841445671263800';

export const ALLOWED_CREATOR_NICHES = [
    'Fashion & Lifestyle',
    'Beauty & Skincare',
    'Jewellery & Accessories',
    'Parenting & Kids',
    'Travel',
    'Food',
    'Fitness & Health',
    'Technology',
    'Home & Decor',
    'Entertainment',
    'Other'
];

const ENCRYPTION_ALGO = 'aes-256-gcm';

// In-memory mutex to prevent duplicate concurrent sync for the same creator
const activeSyncJobs = new Set();

/**
 * Read local JSON mirror store (safe fallback)
 */
function readLocalStore() {
    try {
        if (!fs.existsSync(INFLUENCERS_STORE_PATH)) return {};
        const raw = fs.readFileSync(INFLUENCERS_STORE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return {};
    }
}

/**
 * Write to local JSON mirror store
 */
function writeLocalStore(store) {
    try {
        fs.writeFileSync(INFLUENCERS_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        console.warn('[Creator Sync] Failed to update local mirror store:', e.message);
    }
}

/**
 * Derives a 32-byte key from server secret for token encryption/decryption
 */
function getEncryptionKey() {
    const secret = process.env.META_APP_SECRET ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        'wishrite-meta-sec-fallback-key-32b';
    return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypts an access token before storage
 */
export function encryptToken(token) {
    if (!token) return null;
    if (token.startsWith('enc:')) return token;
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, getEncryptionKey(), iv);
        let enc = cipher.update(token, 'utf8', 'hex');
        enc += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `enc:${iv.toString('hex')}:${tag}:${enc}`;
    } catch (err) {
        return token;
    }
}

/**
 * Decrypts an access token immediately before making Meta API calls
 */
export function decryptToken(encrypted) {
    if (!encrypted) return null;
    if (!encrypted.startsWith('enc:')) return encrypted;
    try {
        const parts = encrypted.split(':');
        if (parts.length !== 4) return encrypted;
        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const encText = parts[3];
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, getEncryptionKey(), iv);
        decipher.setAuthTag(tag);
        let dec = decipher.update(encText, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (err) {
        return null;
    }
}

/**
 * Redacts any Meta access token patterns from strings, warnings, and logs
 */
export function redactTokens(str, tokenToRedact = null) {
    if (!str || typeof str !== 'string') return str;
    let result = str;
    if (tokenToRedact && typeof tokenToRedact === 'string') {
        result = result.replaceAll(tokenToRedact, '[REDACTED_TOKEN]');
    }
    result = result.replace(/EAA[a-zA-Z0-9_\-]+/g, '[REDACTED_TOKEN]');
    result = result.replace(/enc:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+/g, '[REDACTED_TOKEN]');
    result = result.replace(/(access_token=)[^& \t\n\r]+/gi, '$1[REDACTED_TOKEN]');
    return result;
}

/**
 * Strips all Meta access tokens and sensitive credentials from an influencer record
 * Ensures no token appears in any API response or log.
 */
export function sanitizeInfluencerRecord(record) {
    if (!record || typeof record !== 'object') return record;
    const sanitized = { ...record };

    // Strip top-level sensitive fields
    delete sanitized.access_token;
    delete sanitized.decrypted_token;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.password_hash;
    delete sanitized.system_user_token;

    // Sanitize instagram_connection object
    if (sanitized.instagram_connection && typeof sanitized.instagram_connection === 'object') {
        const rawConn = sanitized.instagram_connection;
        sanitized.instagram_connection = {
            account_id: rawConn.account_id || null,
            username: rawConn.username || sanitized.instagram_id || null,
            account_type: rawConn.account_type || 'professional',
            connected: Boolean(rawConn.connected),
            insights_status: rawConn.insights_status || 'connected',
            profile_synced_at: rawConn.profile_synced_at || sanitized.instagram_profile_synced_at || null
        };
    }

    return sanitized;
}

/**
 * Normalizes an influencer record from Supabase or memory,
 * mapping canonical columns to legacy aliases while maintaining backward compatibility.
 */
export function mapCreatorToInventory(record) {
    if (!record || typeof record !== 'object') return null;

    const influencerId = record.influencer_id || record.id;
    if (!influencerId) return null;

    const infName = record.influencer_name || record.name || '';
    const email = record.email_id || record.email || null;
    const phone = record.phone_number || record.phone || null;

    // Follower counts
    const followers = typeof record.instagram_followers_count === 'number'
        ? record.instagram_followers_count
        : (typeof record.followers === 'number' ? record.followers : 0);

    const following = typeof record.instagram_following_count === 'number'
        ? record.instagram_following_count
        : 0;

    const mediaCount = typeof record.instagram_media_count === 'number'
        ? record.instagram_media_count
        : (typeof record.no_of_posts === 'number' ? record.no_of_posts : 0);

    // Profile pictures: prefer instagram_profile_picture, fallback to profile_image
    const profilePic = record.instagram_profile_picture || record.profile_image || null;

    // Categories: maintain instagram_category (Meta API) and creator_niche (WishRite) separately
    const creatorNiche = record.creator_niche || record.category || null;
    const instagramCategory = record.instagram_category || null;

    // Status and commission invariants
    const status = (record.status || 'pending').toLowerCase();
    const tier = (record.tier || 'starter').toLowerCase();
    const commissionRate = record.commission_rate != null ? Number(record.commission_rate) : 10;

    const normalized = {
        ...record,
        influencer_id: influencerId,
        id: influencerId,
        influencer_name: infName,
        name: infName,
        email_id: email,
        email: email,
        phone_number: phone,
        phone: phone,
        instagram_id: (record.instagram_id || '').replace(/^@/, '').trim(),
        instagram_followers_count: followers,
        followers: followers,
        instagram_following_count: following,
        instagram_media_count: mediaCount,
        no_of_posts: mediaCount,
        instagram_profile_picture: profilePic,
        profile_image: profilePic,
        creator_niche: creatorNiche,
        category: creatorNiche || instagramCategory || 'General',
        instagram_category: instagramCategory,
        instagram_validation_status: record.instagram_validation_status || 'pending',
        instagram_profile_synced_at: record.instagram_profile_synced_at || null,
        tier,
        commission_rate: commissionRate,
        status
    };

    return sanitizeInfluencerRecord(normalized);
}

/**
 * Reads canonical Creator platform influencer record from Supabase public.influencers.
 */
export async function readCanonicalCreatorRecord(influencerId) {
    if (!influencerId) return null;
    try {
        const rows = await dbQuery('influencers', `influencer_id=eq.${encodeURIComponent(influencerId)}&limit=1`, { useAdmin: true });
        if (Array.isArray(rows) && rows.length > 0) {
            return rows[0];
        }
    } catch (err) {
        console.warn(`[Creator Sync] dbQuery failed for influencer ${influencerId}:`, err.message);
    }

    // Fallback to local store
    const local = readLocalStore();
    const localRow = (local.influencers || []).find(i => (i.influencer_id === influencerId || i.id === influencerId));
    return localRow || null;
}

/**
 * Resolves Instagram connection and decrypted token for profile fetching
 */
export async function getCreatorInstagramConnection(creator) {
    const creatorId = creator.influencer_id || creator.id;
    let conn = creator.instagram_connection || null;

    if (!conn && creatorId) {
        const canonical = await readCanonicalCreatorRecord(creatorId);
        if (canonical && canonical.instagram_connection) {
            conn = canonical.instagram_connection;
        }
    }

    const rawHandle = (conn?.username || creator.instagram_id || '').toLowerCase().trim().replace(/^@/, '');
    const isWishriteBrandAccount = (rawHandle === WISHRITE_OFFICIAL_IG_HANDLE);
    const systemUserToken = (process.env.INSTAGRAM_SYSTEM_USER_TOKEN || '').trim();

    if (isWishriteBrandAccount && systemUserToken) {
        return {
            ...(conn || {}),
            username: conn?.username || WISHRITE_OFFICIAL_IG_HANDLE,
            connected: true,
            account_id: WISHRITE_OFFICIAL_IG_ACCOUNT_ID,
            account_type: conn?.account_type || 'professional',
            insights_status: 'connected',
            decrypted_token: systemUserToken,
            is_system_user: true
        };
    }

    if (!conn) return null;

    const rawToken = conn.access_token ? decryptToken(conn.access_token) : null;
    return {
        ...conn,
        decrypted_token: rawToken
    };
}

/**
 * Fetches Instagram influencer profile information from official Meta Graph API v26.0.
 * Resilient: returns error object if network or API is down without throwing unhandled exceptions.
 */
export async function fetchInstagramProfileDetails(accountId, accessToken, pageId = null) {
    if (!accountId || !accessToken) return null;

    const igFields = 'id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count';
    const igUrl = `https://graph.facebook.com/${META_API_VERSION}/${accountId}?fields=${igFields}&access_token=${encodeURIComponent(accessToken)}`;

    let igData = null;
    try {
        const res = await fetch(igUrl);
        const json = await res.json();
        if (json && json.id) {
            igData = json;
        } else if (json && json.error) {
            const cleanMsg = redactTokens(json.error.message || '', accessToken);
            console.warn('[Creator Sync] Meta Graph API returned error:', cleanMsg);
            return { error: { ...json.error, message: cleanMsg } };
        }
    } catch (err) {
        console.warn('[Creator Sync] Network error connecting to Meta Graph API:', err.message);
        return { error: { message: err.message, network_error: true } };
    }

    if (!igData) return null;

    // Optional Page category lookup
    let instagramCategory = null;
    if (pageId) {
        try {
            const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}?fields=id,name,category,category_list&access_token=${encodeURIComponent(accessToken)}`;
            const pageRes = await fetch(pageUrl);
            const pageData = await pageRes.json();
            if (pageData && (pageData.category || (pageData.category_list && pageData.category_list[0]?.name))) {
                instagramCategory = pageData.category || pageData.category_list[0]?.name || null;
            }
        } catch (_) {}
    }

    return {
        account_id: igData.id,
        username: igData.username,
        name: igData.name || null,
        biography: igData.biography || null,
        website: igData.website || null,
        profile_picture_url: igData.profile_picture_url || null,
        followers_count: typeof igData.followers_count === 'number' ? igData.followers_count : 0,
        following_count: typeof igData.follows_count === 'number' ? igData.follows_count : 0,
        media_count: typeof igData.media_count === 'number' ? igData.media_count : 0,
        instagram_category: instagramCategory,
        account_type: 'professional',
        validation_status: 'verified',
        profile_synced_at: new Date().toISOString()
    };
}

/**
 * Synchronizes an incoming creator record into Inventory without creating duplicates
 * or overwriting sensitive financial, commission, tier, status, or wallet data.
 */
export async function syncCreatorProfileToInventory(creatorData) {
    if (!creatorData || typeof creatorData !== 'object') {
        throw new Error('Invalid creator data supplied for synchronization');
    }

    const influencerId = creatorData.influencer_id || creatorData.id;
    if (!influencerId) {
        throw new Error('Canonical influencer_id is required for creator synchronization');
    }

    // Check if influencer already exists in DB
    const existing = await readCanonicalCreatorRecord(influencerId);

    const nowIso = new Date().toISOString();

    if (existing) {
        // RECORD EXISTS: Update ONLY approved profile fields
        // NEVER overwrite commission_rate, tier, status, wallet, or payout methods!
        const updates = {
            updated_at: nowIso
        };

        if (creatorData.influencer_name || creatorData.name) {
            updates.influencer_name = creatorData.influencer_name || creatorData.name;
        }

        if (creatorData.email_id || creatorData.email) {
            updates.email_id = creatorData.email_id || creatorData.email;
        }

        if (creatorData.phone_number || creatorData.phone) {
            updates.phone_number = creatorData.phone_number || creatorData.phone;
        }

        if (creatorData.instagram_id) {
            updates.instagram_id = String(creatorData.instagram_id).replace(/^@/, '').trim();
        }

        // Metrics: update only if valid numbers provided
        if (typeof creatorData.instagram_followers_count === 'number') {
            updates.instagram_followers_count = creatorData.instagram_followers_count;
            updates.followers = creatorData.instagram_followers_count;
        } else if (typeof creatorData.followers === 'number') {
            updates.instagram_followers_count = creatorData.followers;
            updates.followers = creatorData.followers;
        }

        if (typeof creatorData.instagram_following_count === 'number') {
            updates.instagram_following_count = creatorData.instagram_following_count;
        }

        if (typeof creatorData.instagram_media_count === 'number') {
            updates.instagram_media_count = creatorData.instagram_media_count;
            updates.no_of_posts = creatorData.instagram_media_count;
        } else if (typeof creatorData.no_of_posts === 'number') {
            updates.instagram_media_count = creatorData.no_of_posts;
            updates.no_of_posts = creatorData.no_of_posts;
        }

        // Profile Picture: Missing/null picture must NOT erase a valid previous picture
        const incomingPic = creatorData.instagram_profile_picture || creatorData.profile_image;
        if (incomingPic && String(incomingPic).trim()) {
            updates.instagram_profile_picture = incomingPic;
            updates.profile_image = incomingPic;
        }

        // Creator Niche: Validate against ALLOWED_CREATOR_NICHES if provided
        const incomingNiche = creatorData.creator_niche || creatorData.category;
        if (incomingNiche && ALLOWED_CREATOR_NICHES.includes(incomingNiche)) {
            updates.creator_niche = incomingNiche;
        }

        // Instagram Category: Meta Page category remains separate from creator_niche
        // Null Meta category does NOT erase creator_niche!
        if (creatorData.instagram_category !== undefined && creatorData.instagram_category !== null) {
            updates.instagram_category = creatorData.instagram_category;
        }

        if (creatorData.instagram_validation_status) {
            updates.instagram_validation_status = creatorData.instagram_validation_status;
        }

        if (creatorData.instagram_profile_synced_at) {
            updates.instagram_profile_synced_at = creatorData.instagram_profile_synced_at;
        }

        if (creatorData.instagram_connection && typeof creatorData.instagram_connection === 'object') {
            // Store encrypted connection if token is present
            const conn = { ...creatorData.instagram_connection };
            if (conn.access_token && !conn.access_token.startsWith('enc:')) {
                conn.access_token = encryptToken(conn.access_token);
            }
            delete conn.decrypted_token;
            updates.instagram_connection = conn;
        }

        // Execute DB update
        try {
            await dbUpdate('influencers', 'influencer_id', influencerId, updates, { useAdmin: true });
        } catch (dbErr) {
            console.warn('[Creator Sync] dbUpdate failed, writing to mirror store:', dbErr.message);
        }

        // Update local mirror store
        const local = readLocalStore();
        local.influencers = local.influencers || [];
        const idx = local.influencers.findIndex(i => (i.influencer_id === influencerId || i.id === influencerId));
        const merged = { ...existing, ...updates };
        if (idx >= 0) {
            local.influencers[idx] = merged;
        } else {
            local.influencers.push(merged);
        }
        writeLocalStore(local);

        return mapCreatorToInventory(merged);
    } else {
        // NEW CREATOR: Insert only if eligible (has influencer_id and identifying info)
        const name = creatorData.influencer_name || creatorData.name || 'New Creator';
        const rawHandle = (creatorData.instagram_id || '').replace(/^@/, '').trim();
        const incomingNiche = creatorData.creator_niche || creatorData.category;
        const validNiche = ALLOWED_CREATOR_NICHES.includes(incomingNiche) ? incomingNiche : 'Other';

        const newRecord = {
            influencer_id: influencerId,
            influencer_code: creatorData.influencer_code || `WR-INF-${influencerId.slice(0, 6).toUpperCase()}`,
            influencer_name: name,
            email_id: creatorData.email_id || creatorData.email || null,
            phone_number: creatorData.phone_number || creatorData.phone || null,
            instagram_id: rawHandle,
            instagram_followers_count: Number(creatorData.instagram_followers_count || creatorData.followers || 0),
            followers: Number(creatorData.instagram_followers_count || creatorData.followers || 0),
            instagram_following_count: Number(creatorData.instagram_following_count || 0),
            instagram_media_count: Number(creatorData.instagram_media_count || creatorData.no_of_posts || 0),
            no_of_posts: Number(creatorData.instagram_media_count || creatorData.no_of_posts || 0),
            instagram_profile_picture: creatorData.instagram_profile_picture || creatorData.profile_image || null,
            profile_image: creatorData.instagram_profile_picture || creatorData.profile_image || null,
            creator_niche: validNiche,
            category: validNiche,
            instagram_category: creatorData.instagram_category || null,
            instagram_validation_status: creatorData.instagram_validation_status || 'pending',
            instagram_profile_synced_at: creatorData.instagram_profile_synced_at || nowIso,
            tier: (creatorData.tier || 'starter').toLowerCase(),
            commission_rate: creatorData.commission_rate != null ? Number(creatorData.commission_rate) : 10,
            status: (creatorData.status || 'pending').toLowerCase(),
            created_at: nowIso,
            updated_at: nowIso
        };

        if (creatorData.instagram_connection && typeof creatorData.instagram_connection === 'object') {
            const conn = { ...creatorData.instagram_connection };
            if (conn.access_token && !conn.access_token.startsWith('enc:')) {
                conn.access_token = encryptToken(conn.access_token);
            }
            delete conn.decrypted_token;
            newRecord.instagram_connection = conn;
        }

        try {
            await dbInsert('influencers', newRecord, { useAdmin: true });
        } catch (dbErr) {
            console.warn('[Creator Sync] dbInsert failed, writing to mirror store:', dbErr.message);
        }

        const local = readLocalStore();
        local.influencers = local.influencers || [];
        local.influencers.push(newRecord);
        writeLocalStore(local);

        await logCreatorAudit({
            action_type: 'creator_activated',
            influencer_id: influencerId,
            influencer_name: name,
            details: `Creator synchronized to Inventory with canonical ID ${influencerId}`,
            metadata: { niche: validNiche, handle: rawHandle }
        });

        return mapCreatorToInventory(newRecord);
    }
}

/**
 * Refreshes an influencer's Instagram profile statistics and metadata.
 * Uses Meta Graph API if credentials are connected.
 * Invariants strictly upheld:
 * - Mutex prevents duplicate concurrent execution for the same creator.
 * - Commission rate, tier, status, wallet balances, and payout history are NEVER modified.
 * - Missing profile picture or null Meta category does NOT erase valid previous data.
 * - Resilient when Meta Graph API is temporarily down or offline.
 * - Meta access tokens are never returned in responses or logged.
 */
export async function refreshCreatorInstagramProfile(influencerId, options = {}) {
    if (!influencerId) {
        throw new Error('Influencer ID is required for profile refresh');
    }

    // Mutex check: prevent duplicate concurrent sync
    if (activeSyncJobs.has(influencerId)) {
        const existing = await readCanonicalCreatorRecord(influencerId);
        return {
            success: true,
            sync_in_progress: true,
            message: 'A profile refresh is already in progress for this creator.',
            data: mapCreatorToInventory(existing)
        };
    }

    activeSyncJobs.add(influencerId);

    try {
        const creator = await readCanonicalCreatorRecord(influencerId);
        if (!creator) {
            const err = new Error(`Creator record not found for influencer_id: ${influencerId}`);
            err.status = 404;
            throw err;
        }

        const nowIso = new Date().toISOString();
        let updatedProfile = { ...creator };
        let refreshOutcome = 'success';
        let apiWarning = null;

        // Try resolving Instagram connection
        const conn = await getCreatorInstagramConnection(creator);

        if (conn && (conn.decrypted_token || conn.access_token) && conn.account_id) {
            const token = conn.decrypted_token || decryptToken(conn.access_token);
            if (token) {
                // Outbound Meta Graph API request
                const igProfile = await fetchInstagramProfileDetails(conn.account_id, token, conn.page_id || null);

                if (igProfile && !igProfile.error) {
                    // Successful Meta profile fetch
                    const updates = {
                        instagram_followers_count: igProfile.followers_count,
                        followers: igProfile.followers_count,
                        instagram_following_count: igProfile.following_count,
                        instagram_media_count: igProfile.media_count,
                        no_of_posts: igProfile.media_count,
                        instagram_validation_status: 'verified',
                        instagram_profile_synced_at: nowIso,
                        updated_at: nowIso
                    };

                    // Only update profile picture if Meta returned a valid picture URL
                    if (igProfile.profile_picture_url && String(igProfile.profile_picture_url).trim()) {
                        updates.instagram_profile_picture = igProfile.profile_picture_url;
                        updates.profile_image = igProfile.profile_picture_url;
                    }

                    // Only update instagram_category if returned; never overwrite creator_niche!
                    if (igProfile.instagram_category) {
                        updates.instagram_category = igProfile.instagram_category;
                    }

                    // Update Supabase
                    try {
                        await dbUpdate('influencers', 'influencer_id', influencerId, updates, { useAdmin: true });
                    } catch (dbErr) {
                        console.warn('[Creator Sync] dbUpdate during refresh error:', dbErr.message);
                    }

                    updatedProfile = { ...updatedProfile, ...updates };
                } else if (igProfile && igProfile.error) {
                    // API returned error or network down
                    refreshOutcome = 'api_error';
                    const rawMsg = igProfile.error.message || 'Meta Graph API temporarily unavailable';
                    apiWarning = redactTokens(rawMsg, token);
                    console.warn(`[Creator Sync] Meta API error for creator ${influencerId}:`, apiWarning);

                    // Update timestamp of sync attempt without erasing existing valid metrics
                    const attemptUpdate = {
                        instagram_profile_synced_at: nowIso,
                        updated_at: nowIso
                    };
                    try {
                        await dbUpdate('influencers', 'influencer_id', influencerId, attemptUpdate, { useAdmin: true });
                    } catch (_) {}
                    updatedProfile = { ...updatedProfile, ...attemptUpdate };
                }
            } else {
                refreshOutcome = 'token_unavailable';
                apiWarning = 'Access token could not be decrypted';
            }
        } else if (creator.instagram_id) {
            // Account has an Instagram handle but no OAuth connection yet
            // Preserve stored values, update sync timestamp
            const fallbackUpdate = {
                instagram_profile_synced_at: nowIso,
                updated_at: nowIso
            };
            try {
                await dbUpdate('influencers', 'influencer_id', influencerId, fallbackUpdate, { useAdmin: true });
            } catch (_) {}
            updatedProfile = { ...updatedProfile, ...fallbackUpdate };
        }

        // Mirror to local store
        const local = readLocalStore();
        local.influencers = local.influencers || [];
        const idx = local.influencers.findIndex(i => (i.influencer_id === influencerId || i.id === influencerId));
        if (idx >= 0) {
            local.influencers[idx] = updatedProfile;
        } else {
            local.influencers.push(updatedProfile);
        }
        writeLocalStore(local);

        // Audit log
        await logCreatorAudit({
            action_type: 'profile_refreshed',
            influencer_id: influencerId,
            influencer_name: updatedProfile.influencer_name || updatedProfile.name || '',
            details: `Instagram profile refreshed. Status: ${refreshOutcome}${apiWarning ? ` (${apiWarning})` : ''}`,
            metadata: {
                followers: updatedProfile.instagram_followers_count || updatedProfile.followers || 0,
                outcome: refreshOutcome
            }
        }).catch(() => null);

        const sanitized = mapCreatorToInventory(updatedProfile);

        return {
            success: true,
            outcome: refreshOutcome,
            warning: apiWarning,
            data: sanitized
        };
    } finally {
        activeSyncJobs.delete(influencerId);
    }
}

/**
 * Filters eligible creators for a campaign based on niche, follower range, tier and status.
 */
export function filterEligibleCampaignCreators(creators = [], filters = {}) {
    if (!Array.isArray(creators)) return [];
    const {
        niche,
        minFollowers = 0,
        maxFollowers = Infinity,
        tier,
        status = 'active'
    } = filters;

    return creators.filter(c => {
        // Status filter
        if (status && status !== 'all') {
            const sLower = String(c.status || 'pending').toLowerCase();
            if (sLower !== String(status).toLowerCase()) return false;
        }

        // Tier filter
        if (tier && tier !== 'all') {
            const tLower = String(c.tier || 'starter').toLowerCase();
            if (tLower !== String(tier).toLowerCase()) return false;
        }

        // Niche filter
        if (niche && niche !== 'all') {
            const cNiche = String(c.creator_niche || c.category || '').toLowerCase();
            if (cNiche !== String(niche).toLowerCase()) return false;
        }

        // Followers filter
        const count = Number(c.instagram_followers_count ?? c.followers ?? 0);
        if (minFollowers && count < Number(minFollowers)) return false;
        if (maxFollowers && maxFollowers !== Infinity && count > Number(maxFollowers)) return false;

        return true;
    });
}

/**
 * Retrieves creator content linked strictly using influencer_id.
 * Only returns content with eligible Submitted or Approved status.
 * Excludes rejected or unrelated media.
 */
export async function getCreatorApprovedContent(influencerId, options = {}) {
    if (!influencerId) return [];
    const allowedStatuses = ['Submitted', 'Under Review', 'Approved'];

    let items = [];
    try {
        const rows = await dbQuery(
            'creator_content',
            `influencer_id=eq.${encodeURIComponent(influencerId)}&order=created_at.desc`,
            { useAdmin: true }
        );
        if (Array.isArray(rows)) {
            items = rows;
        }
    } catch (err) {
        console.warn('[Creator Sync] dbQuery for creator_content failed:', err.message);
    }

    if (items.length === 0) {
        const local = readLocalStore();
        items = (local.creator_content || []).filter(c => (c.influencer_id === influencerId));
    }

    // Filter to only Submitted or Approved product content
    return items.filter(c => {
        const status = c.status || '';
        const isEligibleStatus = allowedStatuses.some(s => s.toLowerCase() === status.toLowerCase());
        const hasProductLink = Boolean(c.product_code || c.product_name || c.url);
        return isEligibleStatus && hasProductLink;
    });
}

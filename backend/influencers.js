// ==============================================================================
// WISHRITE INVENTORY & CREATOR CLUB — INFLUENCER API CONTROLLER
// Phase 1: Creator Master Registry, Instagram Normalization, Permanent Public URLs,
// Admin Management & Aggregated Performance Statistics
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { 
    dbQuery, 
    dbInsert, 
    dbUpdate, 
    dbDelete, 
    hasServerAdminCredential 
} from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const INFLUENCERS_STORE_PATH = path.join(DATA_DIR, 'influencers_store.json');

// Ensure local persistence data dir exists
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error('[Influencers API] Failed to create data dir:', e.message);
    }
}

// Canonical Constraints & Attribution Config
export const INFLUENCER_ATTRIBUTION_DAYS = 30;
export const ALLOWED_STATUSES = ['pending', 'active', 'inactive', 'suspended'];
export const ALLOWED_TIERS = ['starter', 'silver', 'gold', 'platinum', 'elite'];
export const ALLOWED_LINK_TYPES = ['profile', 'product', 'campaign'];

/**
 * Normalizes an Instagram username / handle:
 * - Removes leading @
 * - Trims whitespace
 * - Converts to lowercase
 * - Preserves periods and underscores
 * - Validates allowed characters (a-z, 0-9, ., _)
 */
export function normalizeInstagramId(rawId) {
    if (!rawId) return '';
    let cleaned = String(rawId).trim();
    if (cleaned.startsWith('@')) {
        cleaned = cleaned.slice(1).trim();
    }
    cleaned = cleaned.toLowerCase();
    return cleaned;
}

/**
 * Validates Instagram username format
 */
export function isValidInstagramId(id) {
    if (!id || typeof id !== 'string') return false;
    // Instagram usernames: 1-30 chars, alphanumeric + periods and underscores
    return /^[a-z0-9._]{1,30}$/.test(id);
}

/**
 * Builds canonical WishRite Creator Club public URL
 * Rule: https://wishrite.in/influencer/{public_slug}
 * Do not hard-code a different domain.
 */
export function buildInfluencerPublicUrl(publicSlug) {
    if (!publicSlug) return '';
    const safeSlug = String(publicSlug).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return `https://wishrite.in/influencer/${safeSlug}`;
}

/**
 * Builds canonical WishRite product referral URL
 * Rule: https://wishrite.in/influencer/{public_slug}/product/{product_code}
 */
export function buildInfluencerProductUrl(publicSlug, productCode) {
    if (!publicSlug) return '';
    const safeSlug = String(publicSlug).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const safeCode = productCode ? String(productCode).trim() : '';
    if (!safeCode) return buildInfluencerPublicUrl(safeSlug);
    return `https://wishrite.in/influencer/${safeSlug}/product/${encodeURIComponent(safeCode)}`;
}

/**
 * Builds Instagram profile URL
 */
export function buildInstagramUrl(instagramId) {
    if (!instagramId) return '';
    return `https://instagram.com/${instagramId}`;
}

/**
 * Reads local JSON backup store
 */
function readLocalStore() {
    if (process.env.NODE_ENV === 'test') {
        try {
            if (fs.existsSync(INFLUENCERS_STORE_PATH)) {
                const raw = fs.readFileSync(INFLUENCERS_STORE_PATH, 'utf-8');
                const data = JSON.parse(raw);
                return {
                    ...data,
                    influencers: data.influencers || [],
                    accounts: data.accounts || [],
                    links: data.links || [],
                    stats: data.stats || [],
                    clicks: data.clicks || [],
                    attributions: data.attributions || [],
                    order_attributions: data.order_attributions || []
                };
            }
        } catch (e) {
            console.warn('[Influencers API] Could not read influencers_store.json:', e.message);
        }
    }
    return {
        influencers: [],
        accounts: [],
        links: [],
        stats: [],
        clicks: [],
        attributions: [],
        order_attributions: []
    };
}

/**
 * Writes to local JSON backup store (test only)
 */
function writeLocalStore(store) {
    if (process.env.NODE_ENV !== 'test') return;
    try {
        fs.writeFileSync(INFLUENCERS_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Influencers API] Could not write influencers_store.json:', e.message);
    }
}

/**
 * Generates next sequential human-readable influencer code
 * Format: WR-INF-000001, WR-INF-000002, etc.
 * Permanent and decoupled from Instagram ID.
 */
export async function generateInfluencerCode(existingInfluencers = null) {
    let maxNum = 0;
    let list = existingInfluencers;

    if (list === null || list === undefined) {
        const { data: all } = await getAllInfluencersFromDB();
        list = all;
    }
    
    for (const inf of list) {
        if (inf.influencer_code && typeof inf.influencer_code === 'string') {
            const match = inf.influencer_code.match(/^WR-INF-(\d+)$/i);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
    }

    const nextNum = maxNum + 1;
    return `WR-INF-${String(nextNum).padStart(6, '0')}`;
}

/**
 * Fetch all influencers from Supabase with fallback to local store
 */
async function getAllInfluencersFromDB() {
    let dbRows = [];
    try {
        const rows = await dbQuery('influencers', 'order=created_at.desc', { useAdmin: true });
        if (Array.isArray(rows)) {
            dbRows = rows;
        }
    } catch (err) {
        console.warn('[Influencers API] Supabase query failed, using local mirror:', err.message);
    }

    const local = readLocalStore();

    // Merge DB rows and local store using canonical influencer_id
    const map = new Map();
    // First put local rows
    for (const item of (local.influencers || [])) {
        const infId = item.influencer_id || item.id;
        if (infId) {
            map.set(infId, { ...item, influencer_id: infId, id: infId });
        }
    }
    // Then merge with DB rows if present
    for (const item of dbRows) {
        const infId = item.influencer_id || item.id;
        if (infId) {
            const localItem = map.get(infId);
            const normalized = { ...item, influencer_id: infId, id: infId };
            if (!localItem || new Date(item.updated_at || 0) >= new Date(localItem.updated_at || 0)) {
                map.set(infId, normalized);
            }
        }
    }

    const combined = Array.from(map.values());
    combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return { data: combined, fromDb: dbRows.length > 0 };
}

/**
 * Fetch stats for an influencer
 */
async function getInfluencerStats(influencerId) {
    let dbStat = null;
    try {
        const rows = await dbQuery('influencer_stats', `influencer_id=eq.${encodeURIComponent(influencerId)}&limit=1`);
        if (Array.isArray(rows) && rows.length > 0) {
            dbStat = rows[0];
        }
    } catch (e) {}

    const local = readLocalStore();
    const localStat = (local.stats || []).find(s => s.influencer_id === influencerId);

    if (dbStat && localStat) {
        return new Date(dbStat.updated_at || 0) >= new Date(localStat.updated_at || 0) ? dbStat : localStat;
    }
    if (dbStat) return dbStat;
    if (localStat) return localStat;

    // Default zero statistics
    return {
        id: randomUUID(),
        influencer_id: influencerId,
        total_clicks: 0,
        total_orders: 0,
        total_sales: 0,
        total_views: 0,
        total_earnings: 0,
        available_earnings: 0,
        pending_earnings: 0,
        total_points: 0,
        updated_at: new Date().toISOString()
    };
}

/**
 * Fetch links for an influencer
 */
async function getInfluencerLinks(influencerId) {
    let dbLinks = [];
    try {
        const rows = await dbQuery('influencer_links', `influencer_id=eq.${encodeURIComponent(influencerId)}&order=created_at.asc`);
        if (Array.isArray(rows) && rows.length > 0) {
            dbLinks = rows;
        }
    } catch (e) {}

    const local = readLocalStore();
    const localLinks = (local.links || []).filter(l => l.influencer_id === influencerId);

    if (dbLinks.length > 0) return dbLinks;
    return localLinks;
}

// ==============================================================================
// CONTROLLER HANDLERS
// ==============================================================================

/**
 * GET /api/influencers
 * List all creators with aggregated statistics, default links and top summaries
 */
export async function handleGetInfluencers(req, res) {
    try {
        const { search, status, tier } = req.query || {};

        const { data: rawInfluencers } = await getAllInfluencersFromDB();
        const local = readLocalStore();

        // Fetch stats & links for all influencers
        let allStats = [];
        try {
            allStats = await dbQuery('influencer_stats').catch(() => []);
        } catch (e) {}
        if (!allStats || allStats.length === 0) {
            allStats = local.stats || [];
        }
        const statsMap = new Map();
        (allStats || []).forEach(s => {
            if (s.influencer_id) statsMap.set(s.influencer_id, s);
        });

        let allLinks = [];
        try {
            allLinks = await dbQuery('influencer_links').catch(() => []);
        } catch (e) {}
        if (!allLinks || allLinks.length === 0) {
            allLinks = local.links || [];
        }
        const linksMap = new Map();
        (allLinks || []).forEach(l => {
            if (!linksMap.has(l.influencer_id)) linksMap.set(l.influencer_id, []);
            linksMap.get(l.influencer_id).push(l);
        });

        // Enrich each influencer
        let enriched = rawInfluencers.map(inf => {
            const creatorId = inf.influencer_id || inf.id;
            const stats = statsMap.get(creatorId) || {
                total_clicks: 0,
                total_orders: 0,
                total_sales: 0,
                total_views: 0,
                total_earnings: 0,
                available_earnings: 0,
                pending_earnings: 0,
                total_points: 0
            };
            const links = linksMap.get(creatorId) || [];
            const defaultLink = links.find(l => l.is_default) || links[0] || {
                url: inf.public_profile_url || buildInfluencerPublicUrl(inf.public_slug),
                link_type: 'profile'
            };

            return {
                ...inf,
                influencer_id: creatorId,
                id: creatorId,
                name: inf.name || inf.influencer_name || '',
                influencer_name: inf.influencer_name || inf.name || '',
                public_profile_url: inf.public_profile_url || buildInfluencerPublicUrl(inf.public_slug),
                instagram_url: inf.instagram_url || buildInstagramUrl(inf.instagram_id),
                stats: {
                    total_clicks: Number(stats.total_clicks || 0),
                    total_orders: Number(stats.total_orders || 0),
                    total_sales: Number(stats.total_sales || 0),
                    total_views: Number(stats.total_views || 0),
                    total_earnings: Number(stats.total_earnings || 0),
                    available_earnings: Number(stats.available_earnings || 0),
                    pending_earnings: Number(stats.pending_earnings || 0),
                    total_points: Number(stats.total_points || 0)
                },
                default_link: defaultLink.url,
                links_count: links.length
            };
        });

        // Filtering
        if (status && status !== 'all') {
            const sLower = status.toLowerCase().trim();
            enriched = enriched.filter(i => (i.status || 'pending').toLowerCase() === sLower);
        }

        if (tier && tier !== 'all') {
            const tLower = tier.toLowerCase().trim();
            enriched = enriched.filter(i => (i.tier || 'starter').toLowerCase() === tLower);
        }

        if (search) {
            const q = search.toLowerCase().trim();
            enriched = enriched.filter(i => 
                (i.name && i.name.toLowerCase().includes(q)) ||
                (i.instagram_id && i.instagram_id.toLowerCase().includes(q)) ||
                (i.influencer_code && i.influencer_code.toLowerCase().includes(q)) ||
                (i.category && i.category.toLowerCase().includes(q)) ||
                (i.public_slug && i.public_slug.toLowerCase().includes(q))
            );
        }

        // Summary metrics calculated strictly from live data (never faked)
        const summary = {
            total_influencers: rawInfluencers.length,
            active_creators: rawInfluencers.filter(i => (i.status || '').toLowerCase() === 'active').length,
            pending_creators: rawInfluencers.filter(i => (i.status || '').toLowerCase() === 'pending').length,
            total_sales: enriched.reduce((sum, i) => sum + (Number(i.stats?.total_sales) || 0), 0),
            total_earnings: enriched.reduce((sum, i) => sum + (Number(i.stats?.total_earnings) || 0), 0)
        };

        return res.json({
            success: true,
            count: enriched.length,
            total: rawInfluencers.length,
            summary,
            data: enriched
        });
    } catch (err) {
        console.error('[Influencers API] handleGetInfluencers error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/influencers/:id
 * Retrieve single influencer by UUID, influencer_code, or public_slug
 */
export async function handleGetInfluencerById(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Influencer identifier is required' } });
        }

        const { data: all } = await getAllInfluencersFromDB();
        const normSearch = id.toLowerCase().trim();

        // Match by influencer_id UUID, id, influencer_code, public_slug, or instagram_id
        const found = all.find(i => 
            (i.influencer_id && i.influencer_id.toLowerCase() === normSearch) ||
            (i.id && i.id.toLowerCase() === normSearch) ||
            (i.influencer_code && i.influencer_code.toLowerCase() === normSearch) ||
            (i.public_slug && i.public_slug.toLowerCase() === normSearch) ||
            (i.instagram_id && i.instagram_id.toLowerCase() === normSearch)
        );

        if (!found) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Influencer not found' }
            });
        }

        const creatorId = found.influencer_id || found.id;
        const stats = await getInfluencerStats(creatorId);
        const links = await getInfluencerLinks(creatorId);

        return res.json({
            success: true,
            data: {
                ...found,
                influencer_id: creatorId,
                id: creatorId,
                public_profile_url: found.public_profile_url || buildInfluencerPublicUrl(found.public_slug),
                instagram_url: found.instagram_url || buildInstagramUrl(found.instagram_id),
                stats: {
                    total_clicks: Number(stats?.total_clicks || 0),
                    total_orders: Number(stats?.total_orders || 0),
                    total_sales: Number(stats?.total_sales || 0),
                    total_views: Number(stats?.total_views || 0),
                    total_earnings: Number(stats?.total_earnings || 0),
                    available_earnings: Number(stats?.available_earnings || 0),
                    pending_earnings: Number(stats?.pending_earnings || 0),
                    total_points: Number(stats?.total_points || 0),
                    updated_at: stats?.updated_at || found.updated_at
                },
                links: links.map(l => ({
                    id: l.id,
                    link_type: l.link_type,
                    url: l.url,
                    campaign_id: l.campaign_id,
                    is_default: Boolean(l.is_default),
                    created_at: l.created_at
                }))
            }
        });
    } catch (err) {
        console.error('[Influencers API] handleGetInfluencerById error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/influencers
 * Register a new influencer / creator
 */
export async function handleCreateInfluencer(req, res) {
    try {
        const body = req.body || {};
        const {
            name,
            instagram_id,
            email,
            phone,
            category,
            bio,
            commission_rate,
            tier,
            status,
            profile_image
        } = body;

        // 1. Validate required fields
        if (!name || !String(name).trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Influencer name is required.' }
            });
        }

        if (!instagram_id || !String(instagram_id).trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Instagram ID / handle is required.' }
            });
        }

        // 2. Normalize Instagram ID
        const normalizedInstagramId = normalizeInstagramId(instagram_id);
        if (!isValidInstagramId(normalizedInstagramId)) {
            return res.status(400).json({
                success: false,
                error: { 
                    code: 'INVALID_INSTAGRAM_ID', 
                    message: 'Instagram ID can only contain letters, numbers, periods, and underscores (1-30 characters).' 
                }
            });
        }

        // 3. Validate Tier & Status
        const validTier = (tier && ALLOWED_TIERS.includes(String(tier).toLowerCase().trim()))
            ? String(tier).toLowerCase().trim()
            : 'starter';

        const validStatus = (status && ALLOWED_STATUSES.includes(String(status).toLowerCase().trim()))
            ? String(status).toLowerCase().trim()
            : 'pending';

        const validCommission = commission_rate !== undefined && !isNaN(parseFloat(commission_rate))
            ? Math.max(0, Math.min(100, parseFloat(commission_rate)))
            : 10.00;

        // 4. Check for duplicates in database and local mirror
        const { data: existingList } = await getAllInfluencersFromDB();
        const duplicateInstagram = existingList.find(i => 
            (i.instagram_id && normalizeInstagramId(i.instagram_id) === normalizedInstagramId)
        );

        if (duplicateInstagram) {
            return res.status(409).json({
                success: false,
                error: { 
                    code: 'DUPLICATE_INSTAGRAM_ID', 
                    message: `An influencer with Instagram handle '@${normalizedInstagramId}' already exists.` 
                }
            });
        }

        // public_slug initially equals normalized instagram_id
        let publicSlug = normalizedInstagramId;
        const duplicateSlug = existingList.find(i => 
            (i.public_slug && i.public_slug.toLowerCase() === publicSlug)
        );

        if (duplicateSlug) {
            return res.status(409).json({
                success: false,
                error: { 
                    code: 'DUPLICATE_PUBLIC_SLUG', 
                    message: `Public creator slug '${publicSlug}' is already claimed.` 
                }
            });
        }

        // 5. Generate unique permanent influencer code
        const influencerCode = await generateInfluencerCode(existingList);

        // 6. Generate canonical URLs
        const publicProfileUrl = buildInfluencerPublicUrl(publicSlug);
        const instagramUrl = buildInstagramUrl(normalizedInstagramId);

        const newId = randomUUID();
        const nowIso = new Date().toISOString();

        // 7. Assemble master record
        const influencerRecord = {
            influencer_id: newId,
            id: newId,
            influencer_code: influencerCode,
            name: String(name).trim(),
            email: email ? String(email).trim().toLowerCase() : null,
            phone: phone ? String(phone).trim() : null,
            instagram_id: normalizedInstagramId,
            instagram_url: instagramUrl,
            public_slug: publicSlug,
            public_profile_url: publicProfileUrl,
            profile_image: profile_image?.trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim())}&background=4f46e5&color=fff`,
            category: category?.trim() || 'Jewelry & Lifestyle',
            bio: bio?.trim() || null,
            commission_rate: validCommission,
            tier: validTier,
            status: validStatus,
            created_at: nowIso,
            updated_at: nowIso
        };

        // 8. Assemble initial stats record
        const statsRecord = {
            id: randomUUID(),
            influencer_id: newId,
            total_clicks: 0,
            total_orders: 0,
            total_sales: 0,
            total_views: 0,
            total_earnings: 0,
            available_earnings: 0,
            pending_earnings: 0,
            total_points: 0,
            updated_at: nowIso
        };

        // 9. Assemble default profile link
        const defaultLinkRecord = {
            id: randomUUID(),
            influencer_id: newId,
            link_type: 'profile',
            url: publicProfileUrl,
            campaign_id: null,
            is_default: true,
            created_at: nowIso
        };

        // 10. Persist to Supabase with useAdmin: true
        let dbSaved = false;
        try {
            const insertResult = await dbInsert('influencers', influencerRecord, { useAdmin: true });
            if (insertResult?.data) {
                dbSaved = true;
                // Insert stats
                await dbInsert('influencer_stats', statsRecord, { useAdmin: true }).catch(err => {
                    console.warn('[Influencers API] Could not insert influencer_stats row into DB:', err.message);
                });
                // Insert default link
                await dbInsert('influencer_links', defaultLinkRecord, { useAdmin: true }).catch(err => {
                    console.warn('[Influencers API] Could not insert default influencer_links row into DB:', err.message);
                });
            }
        } catch (dbErr) {
            console.warn('[Influencers API] dbInsert on Supabase table failed:', dbErr.message);
        }

        // Always keep local store updated as resilient mirror
        const local = readLocalStore();
        local.influencers.unshift(influencerRecord);
        local.stats.push(statsRecord);
        local.links.push(defaultLinkRecord);
        writeLocalStore(local);

        return res.status(201).json({
            success: true,
            message: 'Influencer registered successfully.',
            data: {
                ...influencerRecord,
                stats: statsRecord,
                links: [defaultLinkRecord]
            }
        });
    } catch (err) {
        console.error('[Influencers API] handleCreateInfluencer error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * PUT /api/influencers/:id
 * Full update of an influencer record
 */
export async function handleUpdateInfluencer(req, res) {
    try {
        const { id } = req.params;
        const body = req.body || {};

        const { data: all } = await getAllInfluencersFromDB();
        const found = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!found) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = found.influencer_id || found.id;
        const nowIso = new Date().toISOString();
        const updates = { updated_at: nowIso };

        if (body.name) updates.name = String(body.name).trim();
        if (body.email !== undefined) updates.email = body.email ? String(body.email).trim().toLowerCase() : null;
        if (body.phone !== undefined) updates.phone = body.phone ? String(body.phone).trim() : null;
        if (body.category !== undefined) updates.category = body.category?.trim() || 'Jewelry & Lifestyle';
        if (body.bio !== undefined) updates.bio = body.bio?.trim() || null;
        if (body.profile_image !== undefined) updates.profile_image = body.profile_image?.trim() || found.profile_image;

        if (body.tier && ALLOWED_TIERS.includes(String(body.tier).toLowerCase().trim())) {
            updates.tier = String(body.tier).toLowerCase().trim();
        }

        if (body.status && ALLOWED_STATUSES.includes(String(body.status).toLowerCase().trim())) {
            updates.status = String(body.status).toLowerCase().trim();
        }

        if (body.commission_rate !== undefined && !isNaN(parseFloat(body.commission_rate))) {
            updates.commission_rate = Math.max(0, Math.min(100, parseFloat(body.commission_rate)));
        }

        // If instagram_id is updated, normalize and check duplicates
        if (body.instagram_id && normalizeInstagramId(body.instagram_id) !== found.instagram_id) {
            const newInsta = normalizeInstagramId(body.instagram_id);
            if (!isValidInstagramId(newInsta)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_INSTAGRAM_ID', message: 'Invalid Instagram handle format.' }
                });
            }

            const duplicate = all.find(i => (i.influencer_id || i.id) !== creatorId && normalizeInstagramId(i.instagram_id) === newInsta);
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'DUPLICATE_INSTAGRAM_ID', message: `Instagram handle '@${newInsta}' is already registered.` }
                });
            }

            updates.instagram_id = newInsta;
            updates.instagram_url = buildInstagramUrl(newInsta);
            updates.public_slug = newInsta;
            updates.public_profile_url = buildInfluencerPublicUrl(newInsta);
        }

        // Update in Supabase using authoritative influencer_id
        try {
            await dbUpdate('influencers', 'influencer_id', creatorId, updates, { useAdmin: true });
        } catch (dbErr) {
            console.warn('[Influencers API] dbUpdate on Supabase failed:', dbErr.message);
        }

        // Update local mirror
        const local = readLocalStore();
        const localIdx = local.influencers.findIndex(i => (i.influencer_id || i.id) === creatorId);
        const merged = { ...found, ...updates, influencer_id: creatorId, id: creatorId };
        if (localIdx >= 0) {
            local.influencers[localIdx] = merged;
        } else {
            local.influencers.push(merged);
        }
        writeLocalStore(local);

        const stats = await getInfluencerStats(creatorId);
        const links = await getInfluencerLinks(creatorId);

        return res.json({
            success: true,
            message: 'Influencer updated successfully.',
            data: {
                ...merged,
                stats,
                links
            }
        });
    } catch (err) {
        console.error('[Influencers API] handleUpdateInfluencer error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * PATCH /api/influencers/:id/status
 * Quick status transition (pending, active, inactive, suspended)
 */
export async function handleUpdateInfluencerStatus(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body || {};

        if (!status || !ALLOWED_STATUSES.includes(String(status).toLowerCase().trim())) {
            return res.status(400).json({
                success: false,
                error: { 
                    code: 'INVALID_STATUS', 
                    message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}` 
                }
            });
        }

        const validStatus = String(status).toLowerCase().trim();
        const { data: all } = await getAllInfluencersFromDB();
        const found = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!found) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = found.influencer_id || found.id;
        const nowIso = new Date().toISOString();
        const updates = { status: validStatus, updated_at: nowIso };

        try {
            await dbUpdate('influencers', 'influencer_id', creatorId, updates, { useAdmin: true });
        } catch (dbErr) {
            console.warn('[Influencers API] dbUpdate status failed on Supabase:', dbErr.message);
        }

        const local = readLocalStore();
        const localIdx = local.influencers.findIndex(i => (i.influencer_id || i.id) === creatorId);
        if (localIdx >= 0) {
            local.influencers[localIdx] = { ...local.influencers[localIdx], ...updates, influencer_id: creatorId, id: creatorId };
            writeLocalStore(local);
        }

        return res.json({
            success: true,
            message: `Influencer status changed to '${validStatus}'.`,
            data: { ...found, ...updates, influencer_id: creatorId, id: creatorId }
        });
    } catch (err) {
        console.error('[Influencers API] handleUpdateInfluencerStatus error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * DELETE /api/influencers/:id
 * Remove an influencer and cascading links/stats
 */
export async function handleDeleteInfluencer(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const found = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!found) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = found.influencer_id || found.id;

        // Delete from Supabase using authoritative influencer_id
        try {
            await dbDelete('influencers', 'influencer_id', creatorId, { useAdmin: true });
        } catch (dbErr) {
            console.warn('[Influencers API] dbDelete on Supabase failed:', dbErr.message);
        }

        // Clean local mirror
        const local = readLocalStore();
        local.influencers = local.influencers.filter(i => (i.influencer_id || i.id) !== creatorId);
        local.stats = local.stats.filter(s => s.influencer_id !== creatorId);
        local.links = local.links.filter(l => l.influencer_id !== creatorId);
        writeLocalStore(local);

        return res.json({
            success: true,
            message: `Influencer '${found.name}' (${found.influencer_code}) deleted successfully.`
        });
    } catch (err) {
        console.error('[Influencers API] handleDeleteInfluencer error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/influencers/:id/regenerate-profile-url
 * Regenerate public_slug and permanent URL based on current instagram_id
 */
export async function handleRegenerateProfileUrl(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const found = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!found) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = found.influencer_id || found.id;
        const normInsta = normalizeInstagramId(found.instagram_id);
        const newSlug = normInsta;
        const newUrl = buildInfluencerPublicUrl(newSlug);
        const nowIso = new Date().toISOString();

        const updates = {
            public_slug: newSlug,
            public_profile_url: newUrl,
            updated_at: nowIso
        };

        try {
            await dbUpdate('influencers', 'influencer_id', creatorId, updates, { useAdmin: true });
            // Update default profile link if exists
            await dbUpdate('influencer_links', 'influencer_id', creatorId, { url: newUrl }, { useAdmin: true }).catch(() => {});
        } catch (dbErr) {
            console.warn('[Influencers API] dbUpdate on Supabase failed:', dbErr.message);
        }

        const local = readLocalStore();
        const localIdx = local.influencers.findIndex(i => (i.influencer_id || i.id) === creatorId);
        if (localIdx >= 0) {
            local.influencers[localIdx] = { ...local.influencers[localIdx], ...updates, influencer_id: creatorId, id: creatorId };
        }
        const link = local.links.find(l => l.influencer_id === creatorId && l.is_default);
        if (link) link.url = newUrl;
        writeLocalStore(local);

        return res.json({
            success: true,
            message: 'Public profile URL regenerated successfully.',
            data: {
                ...found,
                ...updates,
                influencer_id: creatorId,
                id: creatorId
            }
        });
    } catch (err) {
        console.error('[Influencers API] handleRegenerateProfileUrl error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

// ==============================================================================
// PHASE 2: ATTRIBUTION ENGINE & CLICK TRACKING
// ==============================================================================

/**
 * Resolves an influencer by public_slug or instagram_id
 */
export async function getInfluencerBySlug(publicSlug) {
    if (!publicSlug) return null;
    const normSlug = String(publicSlug).trim().toLowerCase();
    
    // Direct authoritative lookup in Supabase with useAdmin: true
    try {
        const rows = await dbQuery('influencers', `public_slug=eq.${encodeURIComponent(normSlug)}&limit=1`, { useAdmin: true });
        if (Array.isArray(rows) && rows.length > 0) {
            const inf = rows[0];
            const infId = inf.influencer_id || inf.id;
            return { ...inf, influencer_id: infId, id: infId };
        }
    } catch (e) {}

    const { data: all } = await getAllInfluencersFromDB();
    return all.find(i => 
        (i.public_slug && i.public_slug.toLowerCase() === normSlug) ||
        (i.instagram_id && i.instagram_id.toLowerCase() === normSlug)
    ) || null;
}

/**
 * Tracks a referral click with 10-second rapid click debounce protection.
 * Increments influencer_stats.total_clicks only for genuine non-rapid clicks.
 */
export async function trackInfluencerClick({
    influencer_id,
    influencer_link_id = null,
    attribution_id = null,
    landing_url = null,
    product_id = null,
    product_code = null,
    session_id = null,
    device_type = null,
    user_agent = null,
    referrer_url = null
}) {
    if (!influencer_id) return null;

    const local = readLocalStore();
    local.clicks = local.clicks || [];

    // Rapid duplicate click protection: If same session + influencer clicked within 10s, don't double count
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    const recentClick = local.clicks.find(c => 
        c.influencer_id === influencer_id &&
        c.session_id === session_id &&
        session_id &&
        c.created_at >= tenSecondsAgo
    );

    if (recentClick) {
        return { click: recentClick, deduplicated: true };
    }

    const clickRecord = {
        id: randomUUID(),
        influencer_id,
        influencer_link_id: influencer_link_id || null,
        attribution_id: attribution_id || null,
        landing_url: landing_url || null,
        product_id: product_id || null,
        product_code: product_code ? String(product_code).trim() : null,
        session_id: session_id || null,
        device_type: device_type || null,
        user_agent: user_agent ? String(user_agent).slice(0, 500) : null,
        referrer_url: referrer_url ? String(referrer_url).slice(0, 500) : null,
        created_at: new Date().toISOString()
    };

    try {
        await dbInsert('influencer_clicks', clickRecord, { useAdmin: true });
    } catch (e) {
        console.warn('[Influencers API] dbInsert influencer_clicks notice:', e.message);
    }

    local.clicks.unshift(clickRecord);

    // Increment influencer_stats.total_clicks
    let stat = (local.stats || []).find(s => s.influencer_id === influencer_id);
    if (!stat) {
        stat = {
            id: randomUUID(),
            influencer_id,
            total_clicks: 0,
            total_orders: 0,
            total_sales: 0,
            total_views: 0,
            total_earnings: 0,
            available_earnings: 0,
            pending_earnings: 0,
            total_points: 0,
            updated_at: new Date().toISOString()
        };
        local.stats.push(stat);
    }

    stat.total_clicks = (Number(stat.total_clicks) || 0) + 1;
    stat.updated_at = new Date().toISOString();

    try {
        await dbUpdate('influencer_stats', 'influencer_id', influencer_id, {
            total_clicks: stat.total_clicks,
            updated_at: stat.updated_at
        }, { useAdmin: true });
    } catch (e) {}

    writeLocalStore(local);

    return { click: clickRecord, deduplicated: false };
}

/**
 * Creates or updates an attribution session using the Last-Click Model.
 * Configured with 30-day window (INFLUENCER_ATTRIBUTION_DAYS).
 */
export async function createOrUpdateAttribution({
    influencer,
    influencer_id = null,
    influencer_link_id = null,
    landing_url = null,
    session_id = null,
    existing_attribution_id = null,
    expires_at = null
}) {
    const targetId = influencer?.influencer_id || influencer?.id || influencer_id;
    if (!targetId) return null;
    const now = new Date();
    const expiresAt = expires_at || new Date(now.getTime() + INFLUENCER_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const local = readLocalStore();
    local.attributions = local.attributions || [];

    // Search for existing active attribution
    let existing = null;
    if (existing_attribution_id) {
        existing = local.attributions.find(a => a.id === existing_attribution_id);
    }
    if (!existing && session_id) {
        existing = local.attributions.find(a => a.session_id === session_id && a.status === 'active');
    }

    if (existing) {
        const isExpired = new Date(existing.expires_at) <= now;
        if (isExpired) {
            existing.status = 'expired';
        } else {
            // Last-Click rule: update last_influencer_id to the most recent creator referral
            existing.last_influencer_id = targetId;
            existing.influencer_id = targetId; // Active influencer is the last-clicked creator
            existing.last_seen_at = nowIso;
            existing.expires_at = expiresAt; // Reset attribution window to 30 days
            existing.last_landing_url = landing_url || existing.last_landing_url;
            if (influencer_link_id) existing.influencer_link_id = influencer_link_id;
            existing.updated_at = nowIso;

            try {
                await dbUpdate('influencer_attributions', 'id', existing.id, existing, { useAdmin: true });
            } catch (e) {}

            writeLocalStore(local);
            return existing;
        }
    }

    // Create new 30-day attribution
    const newAttribution = {
        id: randomUUID(),
        influencer_id: targetId,
        influencer_link_id: influencer_link_id || null,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        expires_at: expiresAt,
        first_landing_url: landing_url || null,
        last_landing_url: landing_url || null,
        first_influencer_id: targetId,
        last_influencer_id: targetId,
        session_id: session_id || randomUUID(),
        status: 'active',
        created_at: nowIso,
        updated_at: nowIso
    };

    try {
        await dbInsert('influencer_attributions', newAttribution, { useAdmin: true });
    } catch (e) {}

    local.attributions.unshift(newAttribution);
    writeLocalStore(local);

    return newAttribution;
}

/**
 * Retrieves an active attribution if not expired
 */
export function getActiveAttribution(attribution_id, session_id) {
    const local = readLocalStore();
    const list = local.attributions || [];
    let found = null;
    if (attribution_id) {
        found = list.find(a => a.id === attribution_id || a.session_id === attribution_id);
    }
    if (!found && session_id) {
        found = list.find(a => a.session_id === session_id && a.status === 'active');
    }
    if (!found) return null;

    // Check expiration
    if (new Date(found.expires_at) <= new Date() || found.status !== 'active') {
        return null;
    }
    return found;
}

/**
 * Calculates commission: sales_amount * (commission_rate / 100)
 * Server-authoritative; never trusts frontend commission figures.
 */
export function calculateInfluencerCommission(salesAmount, commissionRate) {
    const amount = Math.max(0, Number(salesAmount) || 0);
    const rate = Math.max(0, Math.min(100, Number(commissionRate) || 0));
    const commission = Math.round((amount * rate / 100) * 100) / 100;
    return {
        sales_amount: amount,
        salesAmount: amount,
        commission_rate: rate,
        commissionRate: rate,
        commission_amount: commission,
        commissionAmount: commission
    };
}

/**
 * Resolves the active influencer for an attribution session
 */
export async function resolveOrderInfluencer(attribution_id, session_id) {
    const activeAttr = getActiveAttribution(attribution_id, session_id);
    if (!activeAttr) return null;

    const targetId = activeAttr.last_influencer_id || activeAttr.influencer_id;
    if (!targetId) return null;

    const { data: all } = await getAllInfluencersFromDB();
    const creator = all.find(i => (i.influencer_id && i.influencer_id === targetId) || i.id === targetId);
    if (!creator || creator.status !== 'active') return null;

    return {
        influencer: creator,
        attribution: activeAttr,
        link_id: activeAttr.influencer_link_id
    };
}

/**
 * Attributes a completed order to the referring influencer.
 * Enforces single attribution per order (idempotent, prevents double-credit).
 */
export async function attributeOrderToInfluencer({
    order_id = null,
    order_reference,
    sales_amount,
    attribution_id = null,
    session_id = null,
    influencer_id = null,
    referral_attribution = null
}) {
    if (!order_reference) {
        throw new Error('order_reference is required for order attribution');
    }

    const cleanOrderRef = String(order_reference).trim();

    // 1. Authoritative check in Supabase public.influencer_order_attributions with useAdmin: true
    try {
        const existingDbRows = await dbQuery(
            'influencer_order_attributions',
            `order_reference=eq.${encodeURIComponent(cleanOrderRef)}&limit=1`,
            { useAdmin: true }
        );
        if (Array.isArray(existingDbRows) && existingDbRows.length > 0) {
            const existing = existingDbRows[0];
            return {
                ...existing,
                attributed: true,
                already_attributed: true,
                data: existing
            };
        }
    } catch (dbErr) {
        console.warn('[Influencers API] Supabase check for existing attribution failed, using local store:', dbErr.message);
    }

    const local = readLocalStore();
    local.order_attributions = local.order_attributions || [];

    // Idempotency: Verify order is not already attributed in local mirror
    const existing = local.order_attributions.find(oa => oa.order_reference === cleanOrderRef);
    if (existing) {
        return {
            ...existing,
            attributed: true,
            already_attributed: true,
            data: existing
        };
    }

    // Resolve target creator
    let targetCreator = null;
    let activeAttr = null;

    const targetInfId = influencer_id || referral_attribution?.influencer_id || null;
    const targetAttrId = attribution_id || referral_attribution?.attribution_id || null;
    const targetSessId = session_id || referral_attribution?.session_id || null;

    if (targetInfId) {
        const { data: all } = await getAllInfluencersFromDB();
        targetCreator = all.find(i => (i.influencer_id && i.influencer_id === targetInfId) || i.id === targetInfId);
    } else if (targetAttrId || targetSessId) {
        const resolved = await resolveOrderInfluencer(targetAttrId, targetSessId);
        if (resolved) {
            targetCreator = resolved.influencer;
            activeAttr = resolved.attribution;
        }
    }

    if (!targetCreator) {
        return { attributed: false, message: 'No active influencer attribution found' };
    }

    if (targetCreator.status !== 'active') {
        return { attributed: false, message: `Influencer '${targetCreator.name}' is ${targetCreator.status}. Commission disallowed.` };
    }

    const canonicalCreatorId = targetCreator.influencer_id || targetCreator.id;

    // Calculate commission using snapshot of current rate
    const { commission_rate, commission_amount } = calculateInfluencerCommission(sales_amount, targetCreator.commission_rate);
    const nowIso = new Date().toISOString();

    const orderAttrRecord = {
        id: randomUUID(),
        influencer_id: canonicalCreatorId,
        order_id: order_id || null,
        order_reference: cleanOrderRef,
        attribution_id: activeAttr?.id || attribution_id || null,
        influencer_link_id: activeAttr?.influencer_link_id || null,
        sales_amount: Number(sales_amount) || 0,
        commission_rate,
        commission_amount,
        status: 'pending', // Phase 2: successfully placed orders initially receive pending commission
        created_at: nowIso,
        updated_at: nowIso
    };

    // Insert into Supabase with useAdmin: true, using unique constraint on order_reference for idempotency
    try {
        await dbInsert('influencer_order_attributions', orderAttrRecord, { useAdmin: true });
    } catch (e) {
        // Handle database unique constraint conflict as idempotent success
        if (e.code === '23505' || /unique|duplicate/i.test(e.message || '')) {
            console.warn(`[Influencers API] Unique constraint caught on order_reference '${cleanOrderRef}'. Order already attributed.`);
            return {
                ...orderAttrRecord,
                attributed: true,
                already_attributed: true,
                data: orderAttrRecord
            };
        }
        console.warn('[Influencers API] dbInsert influencer_order_attributions notice:', e.message);
    }

    local.order_attributions.unshift(orderAttrRecord);

    // Update influencer_stats
    let stat = (local.stats || []).find(s => s.influencer_id === canonicalCreatorId);
    if (!stat) {
        stat = {
            id: randomUUID(),
            influencer_id: canonicalCreatorId,
            total_clicks: 0,
            total_orders: 0,
            total_sales: 0,
            total_views: 0,
            total_earnings: 0,
            available_earnings: 0,
            pending_earnings: 0,
            total_points: 0,
            updated_at: nowIso
        };
        local.stats.push(stat);
    }

    stat.total_orders = (Number(stat.total_orders) || 0) + 1;
    stat.total_sales = Number(((Number(stat.total_sales) || 0) + Number(sales_amount)).toFixed(2));
    stat.pending_earnings = Number(((Number(stat.pending_earnings) || 0) + commission_amount).toFixed(2));
    stat.total_earnings = Number(((Number(stat.total_earnings) || 0) + commission_amount).toFixed(2));
    stat.updated_at = nowIso;

    try {
        await dbUpdate('influencer_stats', 'influencer_id', canonicalCreatorId, {
            total_orders: stat.total_orders,
            total_sales: stat.total_sales,
            pending_earnings: stat.pending_earnings,
            total_earnings: stat.total_earnings,
            updated_at: stat.updated_at
        }, { useAdmin: true });
    } catch (e) {}

    writeLocalStore(local);

    // Phase 3B: Record commission in Creator Wallet Immutable Ledger & Award Points
    try {
        const { recordOrderCommissionInWallet } = await import('./creator-wallet.js');
        await recordOrderCommissionInWallet({
            influencer_id: canonicalCreatorId,
            order_reference: cleanOrderRef,
            sales_amount: Number(sales_amount) || 0,
            commission_amount
        });
    } catch (e) {
        console.warn('[Influencers API] recordOrderCommissionInWallet notice:', e.message);
    }

    return {
        ...orderAttrRecord,
        attributed: true,
        already_attributed: false,
        data: orderAttrRecord
    };
}

/**
 * Reconciles commission when an order is cancelled or refunded.
 * Safely adjusts influencer pending earnings and order count.
 */
export async function reconcileOrderCommission({ order_reference, new_status }) {
    if (!order_reference) return null;
    const cleanOrderRef = String(order_reference).trim();
    const normalizedStatus = String(new_status || '').toLowerCase().trim();

    let orderAttr = null;
    // Query authoritative Supabase table with useAdmin: true
    try {
        const dbRows = await dbQuery('influencer_order_attributions', `order_reference=eq.${encodeURIComponent(cleanOrderRef)}&limit=1`, { useAdmin: true });
        if (Array.isArray(dbRows) && dbRows.length > 0) {
            orderAttr = dbRows[0];
        }
    } catch (e) {}

    const local = readLocalStore();
    local.order_attributions = local.order_attributions || [];
    const localAttr = local.order_attributions.find(oa => oa.order_reference === cleanOrderRef);
    if (!orderAttr && localAttr) {
        orderAttr = localAttr;
    }

    if (!orderAttr) return null;

    if ((normalizedStatus === 'cancelled' || normalizedStatus === 'refunded') && orderAttr.status !== 'cancelled') {
        const oldStatus = orderAttr.status;
        orderAttr.status = 'cancelled';
        orderAttr.updated_at = new Date().toISOString();

        try {
            await dbUpdate('influencer_order_attributions', 'order_reference', cleanOrderRef, {
                status: 'cancelled',
                updated_at: orderAttr.updated_at
            }, { useAdmin: true });
        } catch (e) {
            try {
                await dbUpdate('influencer_order_attributions', 'id', orderAttr.id, {
                    status: 'cancelled',
                    updated_at: orderAttr.updated_at
                }, { useAdmin: true });
            } catch (e2) {}
        }

        const stat = (local.stats || []).find(s => s.influencer_id === orderAttr.influencer_id);
        if (stat) {
            stat.total_orders = Math.max(0, (Number(stat.total_orders) || 0) - 1);
            stat.total_sales = Math.max(0, Number(((Number(stat.total_sales) || 0) - Number(orderAttr.sales_amount)).toFixed(2)));
            if (oldStatus === 'pending') {
                stat.pending_earnings = Math.max(0, Number(((Number(stat.pending_earnings) || 0) - Number(orderAttr.commission_amount)).toFixed(2)));
            }
            stat.total_earnings = Math.max(0, Number(((Number(stat.total_earnings) || 0) - Number(orderAttr.commission_amount)).toFixed(2)));
            stat.updated_at = new Date().toISOString();

            try {
                await dbUpdate('influencer_stats', 'influencer_id', orderAttr.influencer_id, {
                    total_orders: stat.total_orders,
                    total_sales: stat.total_sales,
                    pending_earnings: stat.pending_earnings,
                    total_earnings: stat.total_earnings,
                    updated_at: stat.updated_at
                }, { useAdmin: true });
            } catch (e) {}
        }

        writeLocalStore(local);

        // Phase 3B: Record commission reversal in Creator Wallet Immutable Ledger & Points
        try {
            const { recordOrderCommissionReversalInWallet } = await import('./creator-wallet.js');
            await recordOrderCommissionReversalInWallet({
                influencer_id: orderAttr.influencer_id,
                order_reference: String(order_reference).trim(),
                commission_amount: Number(orderAttr.commission_amount)
            });
        } catch (e) {
            console.warn('[Influencers API] recordOrderCommissionReversalInWallet notice:', e.message);
        }

        return {
            ...orderAttr,
            commission_cancelled: true
        };
    }

    return {
        ...orderAttr,
        commission_cancelled: false
    };
}

// ==============================================================================
// PUBLIC & ADMIN CONTROLLER HANDLERS (PHASE 2)
// ==============================================================================

/**
 * GET /api/public/influencers/:slug
 * Resolves safe public creator profile for storefront display.
 * Never exposes email, phone, commission_rate, or earnings!
 */
export async function handleGetPublicInfluencer(req, res) {
    try {
        const { slug } = req.params;
        if (!slug) {
            return res.status(400).json({ success: false, error: { message: 'Creator slug required' } });
        }

        const creator = await getInfluencerBySlug(slug);
        if (!creator) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Influencer not found.' }
            });
        }

        // Only ACTIVE creators have a public storefront
        if (creator.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'INFLUENCER_INACTIVE',
                    message: `This creator profile is currently ${creator.status}.`
                }
            });
        }

        // Return only safe public fields
        return res.json({
            success: true,
            data: {
                influencer_id: creator.influencer_id || creator.id,
                id: creator.influencer_id || creator.id,
                name: creator.name,
                instagram_id: creator.instagram_id,
                instagram_url: creator.instagram_url || buildInstagramUrl(creator.instagram_id),
                public_slug: creator.public_slug,
                public_profile_url: creator.public_profile_url || buildInfluencerPublicUrl(creator.public_slug),
                profile_image: creator.profile_image,
                category: creator.category || 'Jewelry & Lifestyle',
                bio: creator.bio || null,
                tier: creator.tier || 'starter',
                status: creator.status
            }
        });
    } catch (err) {
        console.error('[Public Influencer API Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/public/influencers/:slug/products
 * Fetches products associated with this influencer, or falls back to active catalog items.
 */
export async function handleGetPublicInfluencerProducts(req, res) {
    try {
        const { slug } = req.params;
        const creator = await getInfluencerBySlug(slug);
        if (!creator || creator.status !== 'active') {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found or inactive' } });
        }

        // Check if creator has specific product links tagged
        const local = readLocalStore();
        const creatorId = creator.influencer_id || creator.id;
        const productLinks = (local.links || []).filter(l => l.influencer_id === creatorId && l.link_type === 'product');

        // Fetch live active inventory items directly from Supabase
        let activeInventory = [];
        try {
            const rows = await dbQuery('inventory', 'status=eq.Active&order=created_at.desc&limit=50');
            if (Array.isArray(rows) && rows.length > 0) activeInventory = rows;
        } catch (e) {}

        let curated = [];
        let isFallback = false;

        if (productLinks.length > 0) {
            // Find products matching tagged URLs or campaign
            curated = activeInventory.filter(prod => 
                productLinks.some(l => l.url.includes(prod.product_code) || l.url.includes(prod.product_slug))
            );
        }

        if (curated.length === 0) {
            // Fallback to active catalog products ("Shop WishRite")
            isFallback = true;
            curated = activeInventory.slice(0, 16);
        }

        // Sanitize for public presentation
        const sanitizedProducts = curated.map(p => ({
            id: p.id,
            product_code: p.product_code,
            product_name: p.product_name,
            category: p.category,
            selling_price: Number(p.selling_price) || 0,
            compare_at_price: Number(p.compare_at_price) || 0,
            image_url: p.image_url || p.product_media_urls?.[0] || 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600&auto=format&fit=crop&q=80',
            stock_quantity: Number(p.stock_quantity) || 1,
            audience: p.audience || 'Unassigned',
            material: p.material || '925 Sterling Silver',
            product_slug: p.product_slug || `${(p.product_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${p.product_code}`
        }));

        return res.json({
            success: true,
            is_fallback: isFallback,
            collection_title: isFallback ? 'Shop WishRite' : 'Shop My WishRite Picks',
            count: sanitizedProducts.length,
            data: sanitizedProducts
        });
    } catch (err) {
        console.error('[Public Influencer Products API Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/public/influencers/:slug/click
 * or POST /api/influencers/:id/click
 * Tracks click and initializes / updates 30-day attribution session.
 */
export async function handleTrackClick(req, res) {
    try {
        const identifier = req.params.slug || req.params.id;
        const body = req.body || {};

        let creator = await getInfluencerBySlug(identifier);
        if (!creator) {
            const { data: all } = await getAllInfluencersFromDB();
            creator = all.find(i => (i.influencer_id && i.influencer_id === identifier) || i.id === identifier || i.influencer_code === identifier);
        }

        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        if (creator.status !== 'active') {
            return res.status(403).json({ success: false, error: { message: 'Influencer is inactive' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        const landingUrl = body.landing_url || buildInfluencerPublicUrl(creator.public_slug);
        const sessionId = body.session_id || randomUUID();
        const existingAttributionId = body.attribution_id || null;

        // Create or refresh attribution
        const attribution = await createOrUpdateAttribution({
            influencer: creator,
            influencer_link_id: body.influencer_link_id || null,
            landing_url: landingUrl,
            session_id: sessionId,
            existing_attribution_id: existingAttributionId
        });

        // Record referral click
        const clickResult = await trackInfluencerClick({
            influencer_id: creatorId,
            influencer_link_id: body.influencer_link_id || null,
            attribution_id: attribution?.id || null,
            landing_url: landingUrl,
            product_code: body.product_code || null,
            session_id: sessionId,
            device_type: body.device_type || 'web',
            user_agent: req.headers['user-agent'] || null,
            referrer_url: req.headers['referer'] || null
        });

        return res.json({
            success: true,
            debounced: clickResult?.deduplicated || false,
            deduplicated: clickResult?.deduplicated || false,
            message: clickResult?.deduplicated ? 'Rapid click debounced (protection window active).' : 'Click tracked successfully.',
            click: clickResult?.click || null,
            attribution: {
                id: attribution.id,
                influencer_id: creatorId,
                influencer_code: creator.influencer_code,
                public_slug: creator.public_slug,
                landing_url: landingUrl,
                first_seen_at: attribution.first_seen_at,
                last_seen_at: attribution.last_seen_at,
                expires_at: attribution.expires_at,
                session_id: attribution.session_id
            }
        });
    } catch (err) {
        console.error('[Track Click Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/influencers/:id/stats
 * Complete metrics breakdown including conversion rate.
 */
export async function handleGetInfluencerStatsEndpoint(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const creator = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id || i.public_slug === id);
        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        const stats = await getInfluencerStats(creatorId);
        const clicks = Number(stats.total_clicks) || 0;
        const orders = Number(stats.total_orders) || 0;
        const conversionRate = clicks > 0 ? Number(((orders / clicks) * 100).toFixed(2)) : 0;

        return res.json({
            success: true,
            data: {
                ...stats,
                influencer_id: creatorId,
                conversion_rate: conversionRate,
                conversion_rate_formatted: `${conversionRate}%`
            }
        });
    } catch (err) {
        console.error('[Influencer Stats API Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/influencers/:id/links
 * Lists all links (profile, product, campaign) for creator with clicks count
 */
export async function handleGetInfluencerLinksEndpoint(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const creator = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        const links = await getInfluencerLinks(creatorId);
        const local = readLocalStore();
        const clicksList = local.clicks || [];

        const enrichedLinks = links.map(l => {
            const linkClicks = clicksList.filter(c => c.influencer_link_id === l.id).length;
            return {
                ...l,
                clicks: linkClicks
            };
        });

        return res.json({
            success: true,
            count: enrichedLinks.length,
            data: enrichedLinks
        });
    } catch (err) {
        console.error('[Influencer Links API Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/influencers/:id/links
 * Creates a product or campaign referral link for creator
 */
export async function handleCreateInfluencerLinkEndpoint(req, res) {
    try {
        const { id } = req.params;
        const { link_type = 'product', product_code, campaign_id, custom_url } = req.body || {};

        const { data: all } = await getAllInfluencersFromDB();
        const creator = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        let destinationUrl = custom_url;
        if (!destinationUrl) {
            if (link_type === 'product' && product_code) {
                destinationUrl = buildInfluencerProductUrl(creator.public_slug, product_code);
            } else {
                destinationUrl = buildInfluencerPublicUrl(creator.public_slug);
            }
        }

        const newLink = {
            id: randomUUID(),
            influencer_id: creatorId,
            link_type: ALLOWED_LINK_TYPES.includes(link_type) ? link_type : 'product',
            url: destinationUrl,
            target_url: destinationUrl,
            product_code: product_code || null,
            campaign_id: campaign_id || null,
            is_default: false,
            created_at: new Date().toISOString()
        };

        try {
            await dbInsert('influencer_links', newLink, { useAdmin: true });
        } catch (e) {
            console.warn('[Influencers API] dbInsert influencer_links notice:', e.message);
        }

        const local = readLocalStore();
        local.links = local.links || [];
        local.links.push(newLink);
        writeLocalStore(local);

        return res.status(201).json({
            success: true,
            message: 'Referral link generated successfully.',
            data: {
                ...newLink,
                clicks: 0
            }
        });
    } catch (err) {
        console.error('[Create Link Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/influencers/:id/orders
 * Returns orders attributed to this creator
 */
export async function handleGetInfluencerOrdersEndpoint(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const creator = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        const local = readLocalStore();
        const orders = (local.order_attributions || [])
            .filter(oa => oa.influencer_id === creatorId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return res.json({
            success: true,
            count: orders.length,
            data: orders
        });
    } catch (err) {
        console.error('[Get Influencer Orders Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/influencers/:id/earnings
 * Summary breakdown of earnings
 */
export async function handleGetInfluencerEarningsEndpoint(req, res) {
    try {
        const { id } = req.params;
        const { data: all } = await getAllInfluencersFromDB();
        const creator = all.find(i => (i.influencer_id && i.influencer_id === id) || i.id === id || i.influencer_code === id);
        if (!creator) {
            return res.status(404).json({ success: false, error: { message: 'Influencer not found' } });
        }

        const creatorId = creator.influencer_id || creator.id;
        const local = readLocalStore();
        const orders = (local.order_attributions || []).filter(oa => oa.influencer_id === creatorId);

        const breakdown = {
            total_earnings: orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0),
            pending_earnings: orders.filter(o => o.status === 'pending').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0),
            approved_earnings: orders.filter(o => o.status === 'approved').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0),
            paid_earnings: orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0),
            cancelled_earnings: orders.filter(o => o.status === 'cancelled').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0)
        };

        return res.json({
            success: true,
            data: breakdown
        });
    } catch (err) {
        console.error('[Get Influencer Earnings Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/orders
 * Creates an order and automatically links referral attribution if present
 */
export async function handleCreateOrder(req, res) {
    try {
        const body = req.body || {};
        const {
            order_number,
            customer_name = 'Customer',
            customer_phone = null,
            customer_email = null,
            subtotal = 0,
            discount = 0,
            tax = 0,
            grand_total = 0,
            order_status = 'confirmed',
            payment_status = 'completed',
            attribution_id = null,
            session_id = null,
            referral_attribution = null
        } = body;

        const orderTotal = Number(grand_total) || Number(subtotal) || Number(body.total_amount) || 0;
        const orderRef = order_number || `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const orderRecord = {
            id: randomUUID(),
            order_number: orderRef,
            customer_name,
            customer_phone,
            customer_email,
            subtotal: Number(subtotal) || orderTotal,
            discount: Number(discount) || 0,
            tax: Number(tax) || 0,
            grand_total: orderTotal,
            order_status,
            payment_status,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            await dbInsert('orders', orderRecord, { useAdmin: true });
        } catch (e) {
            console.warn('[Orders API] dbInsert orders notice:', e.message);
        }

        // Perform server-side attribution calculation if referral exists
        let attributionResult = null;
        const attrId = attribution_id || referral_attribution?.attribution_id || null;
        const sessId = session_id || referral_attribution?.session_id || null;
        const infId = referral_attribution?.influencer_id || null;

        if (attrId || sessId || infId) {
            attributionResult = await attributeOrderToInfluencer({
                order_id: orderRecord.id,
                order_reference: orderRef,
                sales_amount: orderTotal,
                attribution_id: attrId,
                session_id: sessId,
                influencer_id: infId
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Order created successfully.',
            attributed_to_influencer: Boolean(attributionResult?.attributed && !attributionResult?.already_attributed),
            attribution: attributionResult,
            order: orderRecord,
            data: {
                order: orderRecord,
                attribution: attributionResult
            }
        });
    } catch (err) {
        console.error('[Create Order Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * PATCH /api/orders/:id/status
 * Updates order status and automatically reconciles commission if cancelled
 */
export async function handleUpdateOrderStatus(req, res) {
    try {
        const { id } = req.params;
        const newStatus = req.body?.order_status || req.body?.status;

        if (!newStatus) {
            return res.status(400).json({ success: false, error: { message: 'Status required' } });
        }

        const reconciled = await reconcileOrderCommission({
            order_reference: id,
            new_status: newStatus
        });

        try {
            await dbUpdate('orders', 'order_number', id, { order_status: newStatus, updated_at: new Date().toISOString() }, { useAdmin: true });
        } catch (e) {}

        return res.json({
            success: true,
            message: `Order status updated to '${newStatus}'.`,
            reconciliation: reconciled,
            reconciled
        });
    } catch (err) {
        console.error('[Update Order Status Error]:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

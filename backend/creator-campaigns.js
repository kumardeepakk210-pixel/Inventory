// ==============================================================================
// WISHRITE CREATOR CLUB — CAMPAIGNS, CONTENT, TIERS & DASHBOARD CONTROLLER
// Handles:
// - Campaign lifecycle (DRAFT, ACTIVE, COMPLETED, CANCELLED)
// - Content submission & verification (SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED)
// - Instagram API status ("Awaiting Instagram sync")
// - Configurable Tiers (STARTER, GROWTH, PRO, ELITE) & Reward Rules Engine
// - Unified Admin Dashboard Aggregates
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { dbQuery, dbInsert, dbUpdate } from './supabase-client.js';
import { logCreatorAudit } from './creator-audit.js';
import { getOrCreateInfluencerPointsAccount } from './creator-wallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const INFLUENCERS_STORE_PATH = path.join(DATA_DIR, 'influencers_store.json');

function readLocalStore() {
    try {
        if (!fs.existsSync(INFLUENCERS_STORE_PATH)) return {};
        const raw = fs.readFileSync(INFLUENCERS_STORE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return {};
    }
}

function writeLocalStore(store) {
    try {
        fs.writeFileSync(INFLUENCERS_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        console.error('[Creator Campaigns] Failed to persist local store:', e.message);
    }
}

export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
export const CONTENT_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];

const DEFAULT_TIER_CONFIGS = [
    {
        tier: 'starter',
        name: 'Starter Creator',
        default_commission_rate: 10,
        min_sales: 0,
        min_views: 0,
        payout_limit: 50000,
        perks: 'Standard 10% commission, personalized referral links, creator dashboard'
    },
    {
        tier: 'growth',
        name: 'Growth Creator',
        default_commission_rate: 12,
        min_sales: 25000,
        min_views: 25000,
        payout_limit: 100000,
        perks: '12% commission, campaign eligibility, priority support, silver badge'
    },
    {
        tier: 'pro',
        name: 'Pro Creator',
        default_commission_rate: 15,
        min_sales: 100000,
        min_views: 100000,
        payout_limit: 250000,
        perks: '15% commission, seasonal gift box, featured in lookbook, gold badge'
    },
    {
        tier: 'elite',
        name: 'Elite Ambassador',
        default_commission_rate: 20,
        min_sales: 250000,
        min_views: 250000,
        payout_limit: 500000,
        perks: '20% commission, premium gifts, co-designed drops, VIP instant payouts'
    }
];

const DEFAULT_REWARD_RULES = [
    {
        id: 'rule-views-100k',
        metric: 'views',
        threshold: 100000,
        reward_type: 'gift',
        reward_name: 'Silver Studs Gift Box',
        is_active: true
    },
    {
        id: 'rule-views-250k',
        metric: 'views',
        threshold: 250000,
        reward_type: 'premium_gift',
        reward_name: 'Premium Solitaire Pendant',
        is_active: true
    },
    {
        id: 'rule-sales-25k',
        metric: 'sales',
        threshold: 25000,
        reward_type: 'bonus',
        bonus_amount: 1000,
        reward_name: '₹1,000 Milestone Bonus',
        is_active: true
    },
    {
        id: 'rule-sales-50k',
        metric: 'sales',
        threshold: 50000,
        reward_type: 'bonus',
        bonus_amount: 2500,
        reward_name: '₹2,500 Higher Reward Bonus',
        is_active: true
    }
];

// ==============================================================================
// 1. CAMPAIGNS MANAGEMENT
// ==============================================================================

export async function handleAdminGetCampaigns(req, res) {
    try {
        const { status, search } = req.query || {};
        let campaigns = [];

        try {
            const dbRows = await dbQuery('creator_campaigns', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) {
                campaigns = dbRows;
            }
        } catch (e) { }

        if (campaigns.length === 0) {
            const local = readLocalStore();
            campaigns = local.campaigns || [];
        }

        if (status && status !== 'all') {
            const sUpper = status.toUpperCase().trim();
            campaigns = campaigns.filter(c => (c.status || 'DRAFT').toUpperCase() === sUpper);
        }

        if (search) {
            const s = search.toLowerCase().trim();
            campaigns = campaigns.filter(c =>
                (c.campaign_name && c.campaign_name.toLowerCase().includes(s)) ||
                (c.required_content && c.required_content.toLowerCase().includes(s))
            );
        }

        return res.json({
            success: true,
            count: campaigns.length,
            data: campaigns
        });
    } catch (err) {
        console.error('[Creator Campaigns] handleAdminGetCampaigns error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

export async function handleAdminCreateCampaign(req, res) {
    try {
        const body = req.body || {};
        const {
            campaign_name,
            start_date,
            end_date,
            products = [],
            creators = [],
            required_content = '1 Reel + 1 Story',
            content_deadline,
            target_views = 0,
            target_sales = 0,
            commission_rate = 10,
            gift_reward = '',
            status = 'DRAFT'
        } = body;

        if (!campaign_name || !String(campaign_name).trim()) {
            return res.status(400).json({ success: false, error: { message: 'Campaign name is required.' } });
        }

        const validStatus = CAMPAIGN_STATUSES.includes(String(status).toUpperCase())
            ? String(status).toUpperCase()
            : 'DRAFT';

        const nowIso = new Date().toISOString();
        const campaign = {
            id: randomUUID(),
            campaign_name: String(campaign_name).trim(),
            start_date: start_date || null,
            end_date: end_date || null,
            products: Array.isArray(products) ? products : (products ? [products] : []),
            creators: Array.isArray(creators) ? creators : (creators ? [creators] : []),
            required_content: String(required_content || '1 Reel').trim(),
            content_deadline: content_deadline || null,
            target_views: Number(target_views) || 0,
            target_sales: Number(target_sales) || 0,
            commission_rate: Number(commission_rate) || 10,
            gift_reward: String(gift_reward || '').trim(),
            status: validStatus,
            created_at: nowIso,
            updated_at: nowIso
        };

        const local = readLocalStore();
        local.campaigns = local.campaigns || [];
        local.campaigns.unshift(campaign);
        writeLocalStore(local);

        try {
            await dbInsert('creator_campaigns', campaign, { useAdmin: true }).catch(() => null);
        } catch (e) { }

        return res.status(201).json({
            success: true,
            message: 'Campaign created successfully.',
            data: campaign
        });
    } catch (err) {
        console.error('[Creator Campaigns] handleAdminCreateCampaign error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

export async function handleAdminUpdateCampaign(req, res) {
    try {
        const { id } = req.params;
        const body = req.body || {};

        const local = readLocalStore();
        local.campaigns = local.campaigns || [];
        const idx = local.campaigns.findIndex(c => c.id === id);

        if (idx < 0) {
            return res.status(404).json({ success: false, error: { message: 'Campaign not found.' } });
        }

        const existing = local.campaigns[idx];
        const nowIso = new Date().toISOString();

        if (body.campaign_name) existing.campaign_name = String(body.campaign_name).trim();
        if (body.start_date !== undefined) existing.start_date = body.start_date;
        if (body.end_date !== undefined) existing.end_date = body.end_date;
        if (body.products !== undefined) existing.products = Array.isArray(body.products) ? body.products : [body.products];
        if (body.creators !== undefined) existing.creators = Array.isArray(body.creators) ? body.creators : [body.creators];
        if (body.required_content !== undefined) existing.required_content = String(body.required_content).trim();
        if (body.content_deadline !== undefined) existing.content_deadline = body.content_deadline;
        if (body.target_views !== undefined) existing.target_views = Number(body.target_views) || 0;
        if (body.target_sales !== undefined) existing.target_sales = Number(body.target_sales) || 0;
        if (body.commission_rate !== undefined) existing.commission_rate = Number(body.commission_rate) || 10;
        if (body.gift_reward !== undefined) existing.gift_reward = String(body.gift_reward).trim();
        if (body.status && CAMPAIGN_STATUSES.includes(String(body.status).toUpperCase())) {
            existing.status = String(body.status).toUpperCase();
        }
        existing.updated_at = nowIso;

        local.campaigns[idx] = existing;
        writeLocalStore(local);

        try {
            await dbUpdate('creator_campaigns', 'id', id, existing, { useAdmin: true }).catch(() => null);
        } catch (e) { }

        return res.json({
            success: true,
            message: 'Campaign updated successfully.',
            data: existing
        });
    } catch (err) {
        console.error('[Creator Campaigns] handleAdminUpdateCampaign error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

export async function handleAdminDeleteCampaign(req, res) {
    try {
        const { id } = req.params;
        const local = readLocalStore();
        local.campaigns = local.campaigns || [];
        const idx = local.campaigns.findIndex(c => c.id === id);

        if (idx < 0) {
            return res.status(404).json({ success: false, error: { message: 'Campaign not found.' } });
        }

        local.campaigns.splice(idx, 1);
        writeLocalStore(local);

        return res.json({
            success: true,
            message: 'Campaign removed successfully.'
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

// ==============================================================================
// ==============================================================================
// 2. CONTENT SUBMISSIONS MANAGEMENT & REEL APPROVAL WORKFLOW
// Single Source of Truth: public.creator_content in Supabase
// ==============================================================================

/**
 * Robust content type detector
 * Recognizes Instagram Reels (/reel/, /reels/, instagram.com/reel) as 'reel'
 * Preserves standard posts (/p/), stories, videos
 */
export function detectContentType(url = '', contentType = '') {
    const rawUrl = String(url || '').toLowerCase();
    const rawType = String(contentType || '').toLowerCase();

    if (rawUrl.includes('/reel/') || rawUrl.includes('/reels/') || rawUrl.includes('instagram.com/reel')) {
        return 'reel';
    }
    if (rawType === 'reel' || rawType === 'reels') {
        return 'reel';
    }
    if (rawUrl.includes('/stories/') || rawType === 'story') {
        return 'story';
    }
    if (rawUrl.includes('/p/') || rawType === 'post') {
        return 'post';
    }
    return rawType || 'post';
}

/**
 * Normalizes status values across uppercase/lowercase/spaces/underscores
 * Returns canonical Title Case: 'Submitted', 'Under Review', 'Approved', 'Rejected'
 */
export function normalizeContentStatus(rawStatus) {
    if (!rawStatus) return null;
    const clean = String(rawStatus).trim().toLowerCase().replace(/_/g, ' ');
    if (clean === 'submitted') return 'Submitted';
    if (clean === 'under review') return 'Under Review';
    if (clean === 'approved') return 'Approved';
    if (clean === 'rejected') return 'Rejected';
    return null;
}

/**
 * Award 100 points for an approved Reel.
 * Strictly idempotent: checks public.influencer_points_transactions by reference_id and transaction_type.
 * Never awards points twice, even if approved, rejected, and approved again.
 */
export async function awardReelApprovalPoints({ content_id, influencer_id, url, reviewer = 'Inventory Admin' }) {
    if (!influencer_id || !content_id) {
        return { success: false, reason: 'missing_parameters' };
    }

    // 1. Idempotency Check in Supabase influencer_points_transactions
    let existingTx = null;
    try {
        const txRows = await dbQuery(
            'influencer_points_transactions',
            `reference_id=eq.${encodeURIComponent(content_id)}`,
            { useAdmin: true }
        );
        if (Array.isArray(txRows) && txRows.length > 0) {
            existingTx = txRows[0];
        }
    } catch (e) { }

    if (!existingTx) {
        const local = readLocalStore();
        existingTx = (local.points_transactions || []).find(pt =>
            pt.reference_id === content_id
        );
    }

    if (existingTx) {
        return {
            success: true,
            already_awarded: true,
            points_awarded: 0,
            transaction: existingTx
        };
    }

    // 2. Fetch or create points account
    const account = await getOrCreateInfluencerPointsAccount(influencer_id);
    const nowIso = new Date().toISOString();

    const ptTx = {
        id: randomUUID(),
        influencer_id,
        points_account_id: account.id,
        transaction_type: 'reel_approval',
        points: 100,
        direction: 'credit',
        reference_type: 'creator_content',
        reference_id: content_id,
        description: 'Reel approval bonus: +100 points',
        metadata: {
            content_id,
            content_url: url,
            awarded_by: reviewer,
            awarded_at: nowIso
        },
        created_at: nowIso
    };

    // Insert transaction into Supabase with constraint fallback if needed
    try {
        await dbInsert('influencer_points_transactions', ptTx, { useAdmin: true });
    } catch (dbErr) {
        if (dbErr.code === '23514' || String(dbErr.message || '').includes('check constraint')) {
            try {
                const fallbackTx = {
                    ...ptTx,
                    transaction_type: 'manual_credit',
                    reference_type: 'campaign',
                    metadata: {
                        ...ptTx.metadata,
                        original_transaction_type: 'reel_approval',
                        original_reference_type: 'creator_content'
                    }
                };
                await dbInsert('influencer_points_transactions', fallbackTx, { useAdmin: true });
            } catch (fallbackErr) {
                console.error('[Points Award] Fallback DB insert failed:', fallbackErr.message);
            }
        } else {
            console.error('[Points Award] DB insert failed:', dbErr.message);
        }
    }

    // Update account balance in Supabase
    const newBal = (Number(account.points_balance) || 0) + 100;
    const newLifetime = (Number(account.lifetime_points_earned) || 0) + 100;
    try {
        await dbUpdate('influencer_points_accounts', 'id', account.id, {
            points_balance: newBal,
            lifetime_points_earned: newLifetime,
            updated_at: nowIso
        }, { useAdmin: true });
    } catch (e) {
        console.error('[Points Award] DB account update failed:', e.message);
    }

    // Update influencer_stats if present
    try {
        const statsRows = await dbQuery('influencer_stats', `influencer_id=eq.${encodeURIComponent(influencer_id)}`, { useAdmin: true });
        if (Array.isArray(statsRows) && statsRows.length > 0) {
            const st = statsRows[0];
            await dbUpdate('influencer_stats', 'id', st.id, {
                total_points: (Number(st.total_points) || 0) + 100,
                updated_at: nowIso
            }, { useAdmin: true });
        }
    } catch (e) { }

    // Sync local store
    try {
        const local = readLocalStore();
        local.points_accounts = local.points_accounts || [];
        const localAcct = local.points_accounts.find(p => p.influencer_id === influencer_id || p.id === account.id);
        if (localAcct) {
            localAcct.points_balance = newBal;
            localAcct.lifetime_points_earned = newLifetime;
            localAcct.updated_at = nowIso;
        }
        local.points_transactions = local.points_transactions || [];
        local.points_transactions.unshift(ptTx);
        writeLocalStore(local);
    } catch (e) { }

    return {
        success: true,
        already_awarded: false,
        points_awarded: 100,
        transaction: ptTx,
        new_balance: newBal
    };
}

/**
 * GET /api/admin/creator-content
 * Queries canonical public.creator_content from Supabase
 */
export async function handleAdminGetContentSubmissions(req, res) {
    try {
        const { status, type, influencer_id, search } = req.query || {};
        let contentList = [];

        // 1. Query public.creator_content directly
        try {
            const dbRows = await dbQuery('creator_content', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) {
                contentList = dbRows;
            }
        } catch (e) {
            console.error('[Creator Content] Failed to query creator_content from DB:', e.message);
        }

        // Fallback or merge with local store
        if (contentList.length === 0) {
            const local = readLocalStore();
            contentList = local.creator_content || local.content_submissions || [];
        } else {
            const local = readLocalStore();
            const localItems = local.creator_content || [];
            for (const item of localItems) {
                if (!contentList.some(c => c.id === item.id)) {
                    contentList.push(item);
                }
            }
        }

        // 2. Fetch points transactions to know which items have received reel_approval points
        const pointsAwardedSet = new Set();
        try {
            const txRows = await dbQuery('influencer_points_transactions', 'select=reference_id,transaction_type,description', { useAdmin: true });
            if (Array.isArray(txRows)) {
                txRows.forEach(tx => {
                    if (tx.reference_id && (tx.transaction_type === 'reel_approval' || (tx.description && tx.description.includes('Reel approval bonus')))) {
                        pointsAwardedSet.add(tx.reference_id);
                    }
                });
            }
        } catch (e) { }

        const local = readLocalStore();
        (local.points_transactions || []).forEach(pt => {
            if (pt.reference_id && (pt.transaction_type === 'reel_approval' || (pt.description && pt.description.includes('Reel approval bonus')))) {
                pointsAwardedSet.add(pt.reference_id);
            }
        });

        // 3. Map and enrich rows
        let formattedList = contentList.map(item => {
            const url = item.url || item.instagram_permalink || item.content_url || '';
            const rawType = item.content_type || 'post';
            const detectedType = detectContentType(url, rawType);
            const isReel = detectedType === 'reel';

            const rawStatus = item.status || item.verification_status || 'Submitted';
            const normalizedStatus = normalizeContentStatus(rawStatus) || 'Submitted';
            const verificationStatusUpper = normalizedStatus.toUpperCase().replace(/ /g, '_');

            const views = Number(item.views_count ?? item.views ?? 0);
            const likes = Number(item.likes_count ?? item.likes ?? 0);
            const comments = Number(item.comments_count ?? item.comments ?? 0);
            const shares = Number(item.shares_count ?? item.shares ?? 0);
            const engagement = likes + comments + shares;
            const engagementRate = views > 0 ? Number(((engagement / views) * 100).toFixed(1)) : 0;

            return {
                id: item.id,
                influencer_id: item.influencer_id,
                customer_id: item.customer_id,
                creator_name: item.creator_name || item.influencer_name || 'Creator',
                creator_email: item.creator_email || '',
                platform: item.platform || 'instagram',
                content_type: detectedType,
                raw_content_type: rawType,
                is_reel: isReel,
                url: url,
                content_url: url,
                instagram_permalink: item.instagram_permalink || url,
                caption: item.caption || '',
                product_name: item.product_name || '',
                product_code: item.product_code || '',
                product_category: item.product_category || '',
                product_image: item.product_image || '',
                thumbnail_url: item.thumbnail_url || item.product_image || '',
                status: normalizedStatus,
                verification_status: verificationStatusUpper,
                rejection_reason: item.rejection_reason || null,
                views,
                likes,
                comments,
                shares,
                engagement_rate: engagementRate,
                instagram_media_id: item.instagram_media_id || null,
                instagram_media_type: item.instagram_media_type || (isReel ? 'VIDEO' : 'IMAGE'),
                instagram_account_id: item.instagram_account_id || null,
                last_synced_at: item.last_synced_at || null,
                insights_status: item.insights_status || 'not_connected',
                insights_error: item.insights_error || null,
                points_awarded: pointsAwardedSet.has(item.id),
                created_at: item.created_at || new Date().toISOString(),
                updated_at: item.updated_at || item.created_at || new Date().toISOString()
            };
        });

        // 4. Filtering
        if (status && status !== 'all') {
            const sClean = status.toLowerCase().replace(/_/g, ' ');
            formattedList = formattedList.filter(c => c.status.toLowerCase() === sClean);
        }

        if (type && type !== 'all') {
            const tClean = type.toLowerCase();
            if (tClean === 'reel' || tClean === 'reels') {
                formattedList = formattedList.filter(c => c.is_reel);
            } else if (tClean === 'post' || tClean === 'posts') {
                formattedList = formattedList.filter(c => !c.is_reel);
            }
        }

        if (influencer_id) {
            formattedList = formattedList.filter(c => c.influencer_id === influencer_id);
        }

        if (search && String(search).trim()) {
            const q = String(search).toLowerCase().trim();
            formattedList = formattedList.filter(c =>
                c.creator_name.toLowerCase().includes(q) ||
                c.creator_email.toLowerCase().includes(q) ||
                c.product_name.toLowerCase().includes(q) ||
                c.product_code.toLowerCase().includes(q) ||
                c.url.toLowerCase().includes(q)
            );
        }

        return res.json({
            success: true,
            count: formattedList.length,
            data: formattedList
        });
    } catch (err) {
        console.error('[Creator Content] handleAdminGetContentSubmissions error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/admin/creator-content
 * Inserts directly into public.creator_content
 */
export async function handleAdminCreateContentSubmission(req, res) {
    try {
        const body = req.body || {};
        const {
            influencer_id,
            influencer_name,
            creator_name,
            creator_email,
            platform = 'instagram',
            content_type = 'reel',
            content_url,
            url,
            product_name,
            product_code,
            product_image,
            thumbnail_url,
            views = 0,
            likes = 0,
            comments = 0,
            shares = 0
        } = body;

        const targetUrl = String(content_url || url || '').trim();
        if (!influencer_id) {
            return res.status(400).json({ success: false, error: { message: 'influencer_id is required.' } });
        }
        if (!targetUrl) {
            return res.status(400).json({ success: false, error: { message: 'Content URL is required.' } });
        }

        const detectedType = detectContentType(targetUrl, content_type);
        const nowIso = new Date().toISOString();

        const submission = {
            id: randomUUID(),
            influencer_id,
            creator_name: creator_name || influencer_name || 'Creator',
            creator_email: creator_email || null,
            platform: (platform || 'instagram').toLowerCase(),
            content_type: detectedType,
            url: targetUrl,
            instagram_permalink: targetUrl,
            product_name: product_name || null,
            product_code: product_code || null,
            product_image: product_image || null,
            thumbnail_url: thumbnail_url || product_image || null,
            status: 'Submitted',
            verification_status: 'SUBMITTED',
            instagram_sync_status: 'Awaiting Instagram sync',
            views: Number(views) || 0,
            views_count: Number(views) || 0,
            likes_count: Number(likes) || 0,
            comments_count: Number(comments) || 0,
            shares_count: Number(shares) || 0,
            insights_status: 'not_connected',
            created_at: nowIso,
            updated_at: nowIso
        };

        // Insert directly into public.creator_content
        try {
            await dbInsert('creator_content', submission, { useAdmin: true });
        } catch (dbErr) {
            console.error('[Creator Content] Failed inserting creator_content to DB:', dbErr.message);
        }

        // Keep local store fallback
        try {
            const local = readLocalStore();
            local.creator_content = local.creator_content || [];
            local.creator_content.unshift(submission);
            writeLocalStore(local);
        } catch (e) { }

        return res.status(201).json({
            success: true,
            message: 'Content submission recorded.',
            data: submission
        });
    } catch (err) {
        console.error('[Creator Content] handleAdminCreateContentSubmission error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * PATCH /api/admin/creator-content/:id/status
 * Updates status on public.creator_content
 * When status is 'Approved' and content is a Reel, awards 100 points idempotently.
 * When status is 'Rejected', rejection_reason is mandatory.
 */
export async function handleAdminUpdateContentStatus(req, res) {
    try {
        const { id } = req.params;
        const rawStatus = req.body?.verification_status || req.body?.status;
        const normalizedStatus = normalizeContentStatus(rawStatus);

        if (!normalizedStatus) {
            return res.status(400).json({
                success: false,
                error: { message: 'Status must be one of: Submitted, Under Review, Approved, Rejected' }
            });
        }

        const rejectionReason = (req.body?.rejection_reason || req.body?.reason || '').trim();

        if (normalizedStatus === 'Rejected' && !rejectionReason) {
            return res.status(400).json({
                success: false,
                error: { message: 'rejection_reason is required when rejecting content.' }
            });
        }

        // 1. Fetch existing item from Supabase public.creator_content
        let existingItem = null;
        try {
            const rows = await dbQuery('creator_content', `id=eq.${encodeURIComponent(id)}`, { useAdmin: true });
            if (Array.isArray(rows) && rows.length > 0) {
                existingItem = rows[0];
            }
        } catch (e) {
            console.error('[Creator Content] DB lookup failed:', e.message);
        }

        // Fallback to local store if not found in DB
        if (!existingItem) {
            const local = readLocalStore();
            existingItem = (local.creator_content || local.content_submissions || []).find(c => c.id === id);
        }

        if (!existingItem) {
            return res.status(404).json({
                success: false,
                error: { message: 'Creator content submission not found.' }
            });
        }

        const nowIso = new Date().toISOString();
        const reviewer = req.employee?.email || req.user?.email || 'Inventory Admin';
        const isReel = detectContentType(existingItem.url || existingItem.instagram_permalink, existingItem.content_type) === 'reel';

        let pointsResult = null;

        // 2. Prepare DB update payload
        const updatePayload = {
            status: normalizedStatus,
            updated_at: nowIso
        };

        if (normalizedStatus === 'Approved') {
            updatePayload.rejection_reason = null;
            if (isReel) {
                updatePayload.content_type = 'reel';
                // Award 100 points idempotently
                pointsResult = await awardReelApprovalPoints({
                    content_id: existingItem.id,
                    influencer_id: existingItem.influencer_id,
                    url: existingItem.url || existingItem.instagram_permalink,
                    reviewer
                });
            }
        } else if (normalizedStatus === 'Rejected') {
            updatePayload.rejection_reason = rejectionReason;
        } else if (normalizedStatus === 'Under Review') {
            updatePayload.rejection_reason = null;
        }

        // 3. Update Supabase public.creator_content
        let updatedRecord = null;
        try {
            const updateRes = await dbUpdate('creator_content', 'id', id, updatePayload, { useAdmin: true });
            updatedRecord = updateRes.data || { ...existingItem, ...updatePayload };
        } catch (dbErr) {
            if ((dbErr.code === '23514' || String(dbErr.message || '').includes('check constraint')) && normalizedStatus === 'Under Review') {
                try {
                    // Database check constraint permits ('Submitted', 'Approved', 'Rejected').
                    // Fallback to 'Submitted' in DB which satisfies constraint and causes Website to render '⧖ Under Review'
                    const fallbackRes = await dbUpdate('creator_content', 'id', id, { ...updatePayload, status: 'Submitted' }, { useAdmin: true });
                    updatedRecord = { ...(fallbackRes.data || existingItem), status: 'Under Review' };
                } catch (e2) {
                    updatedRecord = { ...existingItem, ...updatePayload };
                }
            } else {
                console.error('[Creator Content] Failed to update creator_content in DB:', dbErr.message);
                updatedRecord = { ...existingItem, ...updatePayload };
            }
        }

        // 4. Update local store cache for backward-compatibility
        try {
            const local = readLocalStore();
            local.creator_content = local.creator_content || [];
            const idx = local.creator_content.findIndex(c => c.id === id);
            if (idx >= 0) {
                local.creator_content[idx] = { ...local.creator_content[idx], ...updatePayload };
            } else {
                local.creator_content.unshift(updatedRecord);
            }
            if (local.content_submissions) {
                const subIdx = local.content_submissions.findIndex(c => c.id === id);
                if (subIdx >= 0) {
                    local.content_submissions[subIdx] = {
                        ...local.content_submissions[subIdx],
                        verification_status: normalizedStatus.toUpperCase().replace(/ /g, '_'),
                        status: normalizedStatus,
                        rejection_reason: updatePayload.rejection_reason,
                        updated_at: nowIso
                    };
                }
            }
            writeLocalStore(local);
        } catch (e) { }

        // 5. Log audit action
        try {
            await logCreatorAudit({
                action_type: normalizedStatus === 'Approved' ? 'APPROVE_CREATOR_CONTENT' : (normalizedStatus === 'Rejected' ? 'REJECT_CREATOR_CONTENT' : 'REVIEW_CREATOR_CONTENT'),
                influencer_id: existingItem.influencer_id,
                influencer_name: existingItem.creator_name || 'Creator',
                details: `Content ${id} status set to ${normalizedStatus}${normalizedStatus === 'Rejected' ? ` (Reason: ${rejectionReason})` : ''}${pointsResult?.points_awarded ? ` (+100 points awarded)` : ''}`,
                metadata: {
                    content_id: id,
                    url: existingItem.url || existingItem.instagram_permalink,
                    status: normalizedStatus,
                    rejection_reason: updatePayload.rejection_reason,
                    points_awarded: pointsResult?.points_awarded || 0,
                    already_awarded: pointsResult?.already_awarded || false,
                    reviewed_by: reviewer,
                    reviewed_at: nowIso
                },
                performed_by: reviewer
            });
        } catch (e) { }

        return res.json({
            success: true,
            message: `Content status updated to ${normalizedStatus}.`,
            data: {
                ...updatedRecord,
                status: normalizedStatus,
                verification_status: normalizedStatus.toUpperCase().replace(/ /g, '_'),
                points_awarded: pointsResult?.points_awarded || 0,
                already_awarded: Boolean(pointsResult?.already_awarded)
            }
        });
    } catch (err) {
        console.error('[Creator Content] handleAdminUpdateContentStatus error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

// ==============================================================================
// 3. TIERS & REWARD ENGINE RULES (CONFIGURABLE)
// ==============================================================================

export async function handleAdminGetTierRules(req, res) {
    try {
        const local = readLocalStore();
        const tiers = local.tier_configs || DEFAULT_TIER_CONFIGS;
        const rewardRules = local.reward_rules || DEFAULT_REWARD_RULES;

        return res.json({
            success: true,
            data: {
                tiers,
                reward_rules: rewardRules
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

export async function handleAdminUpdateTierRules(req, res) {
    try {
        const { tiers, reward_rules } = req.body || {};
        const local = readLocalStore();

        if (Array.isArray(tiers)) {
            local.tier_configs = tiers;
        }
        if (Array.isArray(reward_rules)) {
            local.reward_rules = reward_rules;
        }

        writeLocalStore(local);

        return res.json({
            success: true,
            message: 'Tier and reward configurations updated successfully.',
            data: {
                tiers: local.tier_configs || DEFAULT_TIER_CONFIGS,
                reward_rules: local.reward_rules || DEFAULT_REWARD_RULES
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

// ==============================================================================
// 4. UNIFIED ADMIN DASHBOARD SUMMARY
// ==============================================================================

export async function handleAdminGetDashboardSummary(req, res) {
    try {
        const local = readLocalStore();

        // 1. Fetch creators
        let creators = [];
        try {
            const dbRows = await dbQuery('influencers', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) creators = dbRows;
        } catch (e) { }
        if (creators.length === 0) creators = local.influencers || [];

        const totalCreators = creators.length;
        const activeCreators = creators.filter(c => (c.status || '').toLowerCase() === 'active').length;
        const pendingCreators = creators.filter(c => (c.status || '').toLowerCase() === 'pending').length;
        const inactiveCreators = creators.filter(c => ['inactive', 'suspended'].includes((c.status || '').toLowerCase())).length;

        // 2. Fetch attributions & clicks
        let attributions = [];
        try {
            const dbRows = await dbQuery('influencer_order_attributions', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) attributions = dbRows;
        } catch (e) { }
        if (attributions.length === 0) attributions = local.order_attributions || [];

        let clicks = [];
        try {
            const dbRows = await dbQuery('influencer_clicks', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) clicks = dbRows;
        } catch (e) { }
        if (clicks.length === 0) clicks = local.clicks || [];

        const totalClicks = clicks.length;
        const totalOrders = attributions.length;
        const totalSales = Number(attributions.reduce((s, a) => s + (Number(a.sales_amount) || 0), 0).toFixed(2));
        const totalCommission = Number(attributions.reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));

        const pendingCommission = Number(attributions.filter(a => a.status === 'pending').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));
        const approvedCommission = Number(attributions.filter(a => a.status === 'approved').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));
        const paidCommission = Number(attributions.filter(a => a.status === 'paid').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));

        // 3. Content performance
        let content = [];
        try {
            const dbContent = await dbQuery('creator_content', 'select=id,views,views_count,likes_count,comments_count,shares_count', { useAdmin: true });
            if (Array.isArray(dbContent) && dbContent.length > 0) {
                content = dbContent;
            }
        } catch (e) { }
        if (content.length === 0) content = local.creator_content || local.content_submissions || [];

        const totalContent = content.length;
        const totalViews = content.reduce((s, c) => s + (Number(c.views_count ?? c.views ?? 0)), 0);
        const totalEngagement = content.reduce((s, c) => s + (Number(c.likes_count ?? c.likes ?? 0) + Number(c.comments_count ?? c.comments ?? 0) + Number(c.shares_count ?? c.shares ?? 0)), 0);

        // Find top creator
        const creatorSalesMap = new Map();
        for (const attr of attributions) {
            const id = attr.influencer_id;
            creatorSalesMap.set(id, (creatorSalesMap.get(id) || 0) + (Number(attr.sales_amount) || 0));
        }
        let topCreatorId = null;
        let topSales = 0;
        for (const [id, sales] of creatorSalesMap.entries()) {
            if (sales > topSales) {
                topSales = sales;
                topCreatorId = id;
            }
        }
        const topCreatorObj = topCreatorId ? creators.find(c => (c.influencer_id || c.id) === topCreatorId) : null;
        const topCreator = topCreatorObj ? {
            influencer_id: topCreatorId,
            influencer_name: topCreatorObj.influencer_name || topCreatorObj.name,
            instagram_id: topCreatorObj.instagram_id,
            sales_amount: topSales
        } : null;

        // Top campaign
        const campaigns = local.campaigns || [];
        const topCampaign = campaigns.length > 0 ? {
            id: campaigns[0].id,
            campaign_name: campaigns[0].campaign_name,
            status: campaigns[0].status
        } : null;

        // 4. Payout summary
        let wallets = [];
        try {
            const dbRows = await dbQuery('influencer_wallets', '', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) wallets = dbRows;
        } catch (e) { }
        if (wallets.length === 0) wallets = local.wallets || [];

        let withdrawals = [];
        try {
            const dbRows = await dbQuery('influencer_withdrawals', '', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) withdrawals = dbRows;
        } catch (e) { }
        if (withdrawals.length === 0) withdrawals = local.withdrawals || [];

        const payableBalance = Number(wallets.reduce((s, w) => s + (Number(w.available_balance) || 0), 0).toFixed(2));
        const pendingPayout = Number(withdrawals.filter(w => ['requested', 'approved', 'processing'].includes(w.payout_status))
            .reduce((s, w) => s + (Number(w.amount) || 0), 0).toFixed(2));

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const paidThisMonth = Number(withdrawals.filter(w => w.payout_status === 'completed' && w.completed_at >= startOfMonth)
            .reduce((s, w) => s + (Number(w.amount) || 0), 0).toFixed(2));

        return res.json({
            success: true,
            data: {
                creator_overview: {
                    total_creators: totalCreators,
                    active_creators: activeCreators,
                    pending_creators: pendingCreators,
                    inactive_creators: inactiveCreators
                },
                affiliate_performance: {
                    total_clicks: totalClicks,
                    total_orders: totalOrders,
                    total_sales: totalSales,
                    total_attributed_sales: totalSales,
                    total_commission: totalCommission,
                    pending_commission: pendingCommission,
                    approved_commission: approvedCommission,
                    paid_commission: paidCommission
                },
                content_performance: {
                    total_content: totalContent,
                    total_views: totalViews,
                    total_engagement: totalEngagement,
                    top_creator: topCreator,
                    top_campaign: topCampaign
                },
                payout: {
                    payable: payableBalance,
                    payable_balance: payableBalance,
                    pending_payout: pendingPayout,
                    paid_this_month: paidThisMonth
                },
                payout_summary: {
                    payable: payableBalance,
                    payable_balance: payableBalance,
                    pending_payout: pendingPayout,
                    paid_this_month: paidThisMonth
                }
            }
        });
    } catch (err) {
        console.error('[Creator Dashboard] handleAdminGetDashboardSummary error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

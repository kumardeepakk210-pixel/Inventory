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
        } catch (e) {}

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
        } catch (e) {}

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
        } catch (e) {}

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
// 2. CONTENT SUBMISSIONS MANAGEMENT
// ==============================================================================

export async function handleAdminGetContentSubmissions(req, res) {
    try {
        const { status, influencer_id, campaign_id } = req.query || {};
        let contentList = [];

        try {
            const dbRows = await dbQuery('creator_content_submissions', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) {
                contentList = dbRows;
            }
        } catch (e) {}

        if (contentList.length === 0) {
            const local = readLocalStore();
            contentList = local.content_submissions || [];
        }

        if (status && status !== 'all') {
            const sUpper = status.toUpperCase().trim();
            contentList = contentList.filter(c => (c.verification_status || 'SUBMITTED').toUpperCase() === sUpper);
        }

        if (influencer_id) {
            contentList = contentList.filter(c => c.influencer_id === influencer_id);
        }

        if (campaign_id) {
            contentList = contentList.filter(c => c.campaign_id === campaign_id);
        }

        return res.json({
            success: true,
            count: contentList.length,
            data: contentList
        });
    } catch (err) {
        console.error('[Creator Content] handleAdminGetContentSubmissions error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

export async function handleAdminCreateContentSubmission(req, res) {
    try {
        const body = req.body || {};
        const {
            influencer_id,
            influencer_name,
            campaign_id = null,
            campaign_name = 'General Promotion',
            platform = 'Instagram',
            content_type = 'Reel',
            content_url,
            published_date,
            views = 0,
            likes = 0,
            comments = 0,
            shares = 0,
            saves = 0,
            verification_status = 'SUBMITTED'
        } = body;

        if (!influencer_id) {
            return res.status(400).json({ success: false, error: { message: 'influencer_id is required.' } });
        }

        if (!content_url || !String(content_url).trim()) {
            return res.status(400).json({ success: false, error: { message: 'content_url is required.' } });
        }

        const validStatus = CONTENT_STATUSES.includes(String(verification_status).toUpperCase())
            ? String(verification_status).toUpperCase()
            : 'SUBMITTED';

        const totalEngagements = (Number(likes) || 0) + (Number(comments) || 0) + (Number(shares) || 0) + (Number(saves) || 0);
        const calculatedViews = Number(views) || 0;
        const engagementRate = calculatedViews > 0
            ? Number(((totalEngagements / calculatedViews) * 100).toFixed(2))
            : 0;

        const nowIso = new Date().toISOString();
        const submission = {
            id: randomUUID(),
            influencer_id,
            influencer_name: influencer_name || 'Creator',
            campaign_id,
            campaign_name: campaign_name || 'General Promotion',
            platform: platform || 'Instagram',
            content_type: content_type || 'Reel',
            content_url: String(content_url).trim(),
            published_date: published_date || nowIso,
            views: calculatedViews,
            likes: Number(likes) || 0,
            comments: Number(comments) || 0,
            shares: Number(shares) || 0,
            saves: Number(saves) || 0,
            engagement_rate: engagementRate,
            verification_status: validStatus,
            instagram_sync_status: 'Awaiting Instagram sync', // Phase 11 requirement
            rejection_reason: null,
            created_at: nowIso,
            updated_at: nowIso
        };

        const local = readLocalStore();
        local.content_submissions = local.content_submissions || [];
        local.content_submissions.unshift(submission);
        writeLocalStore(local);

        try {
            await dbInsert('creator_content_submissions', submission, { useAdmin: true }).catch(() => null);
        } catch (e) {}

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

export async function handleAdminUpdateContentStatus(req, res) {
    try {
        const { id } = req.params;
        const statusVal = req.body?.verification_status || req.body?.status;

        if (!statusVal || !CONTENT_STATUSES.includes(String(statusVal).toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: { message: `verification_status must be one of: ${CONTENT_STATUSES.join(', ')}` }
            });
        }

        const validStatus = String(statusVal).toUpperCase();
        const { rejection_reason } = req.body || {};
        const local = readLocalStore();
        local.content_submissions = local.content_submissions || [];
        const item = local.content_submissions.find(c => c.id === id);

        if (!item) {
            return res.status(404).json({ success: false, error: { message: 'Content submission not found.' } });
        }

        const nowIso = new Date().toISOString();
        item.verification_status = validStatus;
        if (rejection_reason !== undefined) item.rejection_reason = rejection_reason;
        item.updated_at = nowIso;

        writeLocalStore(local);

        try {
            await dbUpdate('creator_content_submissions', 'id', id, {
                verification_status: validStatus,
                rejection_reason: item.rejection_reason,
                updated_at: nowIso
            }, { useAdmin: true }).catch(() => null);
        } catch (e) {}

        return res.json({
            success: true,
            message: `Content verification status set to ${validStatus}.`,
            data: item
        });
    } catch (err) {
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
        } catch (e) {}
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
        } catch (e) {}
        if (attributions.length === 0) attributions = local.order_attributions || [];

        let clicks = [];
        try {
            const dbRows = await dbQuery('influencer_clicks', 'order=created_at.desc', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) clicks = dbRows;
        } catch (e) {}
        if (clicks.length === 0) clicks = local.clicks || [];

        const totalClicks = clicks.length;
        const totalOrders = attributions.length;
        const totalSales = Number(attributions.reduce((s, a) => s + (Number(a.sales_amount) || 0), 0).toFixed(2));
        const totalCommission = Number(attributions.reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));

        const pendingCommission = Number(attributions.filter(a => a.status === 'pending').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));
        const approvedCommission = Number(attributions.filter(a => a.status === 'approved').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));
        const paidCommission = Number(attributions.filter(a => a.status === 'paid').reduce((s, a) => s + (Number(a.commission_amount) || 0), 0).toFixed(2));

        // 3. Content performance
        const content = local.content_submissions || [];
        const totalContent = content.length;
        const totalViews = content.reduce((s, c) => s + (Number(c.views) || 0), 0);
        const totalEngagement = content.reduce((s, c) => s + (Number(c.likes || 0) + Number(c.comments || 0) + Number(c.shares || 0)), 0);

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
        } catch (e) {}
        if (wallets.length === 0) wallets = local.wallets || [];

        let withdrawals = [];
        try {
            const dbRows = await dbQuery('influencer_withdrawals', '', { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) withdrawals = dbRows;
        } catch (e) {}
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

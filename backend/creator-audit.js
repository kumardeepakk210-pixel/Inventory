// ==============================================================================
// WISHRITE CREATOR CLUB — ADMIN AUDIT LOG
// Captures and serves audit trails for all sensitive Creator lifecycle events:
// - Creator activated
// - Creator deactivated
// - Commission changed
// - Commission approved
// - Commission cancelled
// - Refund processed
// - Payout requested
// - Payout approved
// - Payout paid
// - Reward issued
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { dbInsert, dbQuery } from './supabase-client.js';

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
        console.error('[Creator Audit] Failed to persist local store:', e.message);
    }
}

export const VALID_AUDIT_ACTIONS = [
    'creator_activated',
    'creator_deactivated',
    'commission_changed',
    'commission_approved',
    'commission_cancelled',
    'refund_processed',
    'payout_requested',
    'payout_approved',
    'payout_paid',
    'reward_issued'
];

/**
 * Log a Creator lifecycle action to the immutable audit trail
 */
export async function logCreatorAudit({
    action_type,
    influencer_id,
    influencer_name = '',
    details = '',
    metadata = {},
    performed_by = 'Inventory Admin'
}) {
    const entry = {
        id: randomUUID(),
        action_type,
        influencer_id,
        influencer_name: influencer_name || '',
        details: String(details || ''),
        metadata: metadata || {},
        performed_by: performed_by || 'Inventory Admin',
        created_at: new Date().toISOString()
    };

    // 1. Update local persistence
    try {
        const local = readLocalStore();
        local.creator_audit_logs = local.creator_audit_logs || [];
        local.creator_audit_logs.unshift(entry);
        // Keep last 1000 audit log entries in local store
        if (local.creator_audit_logs.length > 1000) {
            local.creator_audit_logs = local.creator_audit_logs.slice(0, 1000);
        }
        writeLocalStore(local);
    } catch (err) {
        console.warn('[Creator Audit] Local store write failed:', err.message);
    }

    // 2. Best-effort Supabase insert if table exists
    try {
        await dbInsert('creator_audit_logs', entry, { useAdmin: true }).catch(() => null);
    } catch (e) {
        // Safe no-op if table not yet migrated in Supabase
    }

    return entry;
}

/**
 * GET /api/admin/creator-audit-logs
 * Fetch and filter Creator audit trails
 */
export async function handleGetCreatorAuditLogs(req, res) {
    try {
        const { action_type, influencer_id, limit = 100 } = req.query || {};

        let logs = [];

        // Attempt Supabase query first
        try {
            let queryParams = 'order=created_at.desc';
            if (limit) queryParams += `&limit=${encodeURIComponent(limit)}`;
            if (action_type && action_type !== 'all') {
                queryParams += `&action_type=eq.${encodeURIComponent(action_type)}`;
            }
            if (influencer_id) {
                queryParams += `&influencer_id=eq.${encodeURIComponent(influencer_id)}`;
            }
            const dbRows = await dbQuery('creator_audit_logs', queryParams, { useAdmin: true });
            if (Array.isArray(dbRows) && dbRows.length > 0) {
                logs = dbRows;
            }
        } catch (e) {
            // Fallback to local store
        }

        if (logs.length === 0) {
            const local = readLocalStore();
            logs = local.creator_audit_logs || [];

            if (action_type && action_type !== 'all') {
                logs = logs.filter(l => l.action_type === action_type);
            }
            if (influencer_id) {
                logs = logs.filter(l => l.influencer_id === influencer_id);
            }
            logs = logs.slice(0, parseInt(limit, 10) || 100);
        }

        return res.json({
            success: true,
            count: logs.length,
            data: logs
        });
    } catch (err) {
        console.error('[Creator Audit] handleGetCreatorAuditLogs error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}


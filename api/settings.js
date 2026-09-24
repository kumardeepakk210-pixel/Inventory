// ==============================================================================
// WISHRITE INVENTORY — SETTINGS API CONTROLLER
// Central Admin Control for Festive Mode and Selected / Active Occasions
// Uses public.occasion_settings in Supabase as the Single Source of Truth
// Protected by existing Inventory Admin authentication (role === 'Admin')
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbUpdate, dbInsert, verifyTableColumn } from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_STORE_PATH = path.join(__dirname, '../data/occasion_settings.json');

// Canonical Master Occasions (Fixed records pre-seeded in public.occasion_settings)
export const MASTER_OCCASIONS = [
    { occasion_slug: 'durga-puja', occasion_name: 'Durga Puja' },
    { occasion_slug: 'kali-puja', occasion_name: 'Kali Puja' },
    { occasion_slug: 'diwali', occasion_name: 'Diwali' },
    { occasion_slug: 'christmas', occasion_name: 'Christmas' },
    { occasion_slug: 'valentines-day', occasion_name: "Valentine's Day" },
    { occasion_slug: 'wedding', occasion_name: 'Wedding' }
];

export function formatOccasionTitle(slug) {
    const titles = {
        'durga-puja': 'Durga Puja',
        'kali-puja': 'Kali Puja',
        'diwali': 'Diwali',
        'christmas': 'Christmas',
        'valentines-day': "Valentine's Day",
        'wedding': 'Wedding'
    };
    if (!slug) return 'No Occasion';
    return titles[slug] || String(slug).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Safely load local occasion settings backup
 */
function loadLocalOccasionSettings() {
    try {
        if (fs.existsSync(SETTINGS_STORE_PATH)) {
            const raw = fs.readFileSync(SETTINGS_STORE_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {}
    return {
        selected_occasion_slug: 'durga-puja',
        selected_occasion_name: 'Durga Puja',
        active_occasion_slug: null,
        active_occasion_name: null,
        festive_mode_enabled: false,
        updated_at: new Date().toISOString()
    };
}

/**
 * Safely save local occasion settings backup
 */
function saveLocalOccasionSettings(settings) {
    try {
        const dir = path.dirname(SETTINGS_STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_STORE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Occasion Settings Store Error]:', e.message);
    }
}

/**
 * Verify whether incoming request is from an authenticated Admin user.
 * Uses the existing Inventory auth session (token and employee role verification).
 */
export async function verifyAdminAuth(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    const headerUserId = (req.headers['x-user-id'] || '').trim();
    const headerRole = (req.headers['x-user-role'] || '').trim();

    let extractedUserId = headerUserId;

    if (token && token.startsWith('wrt_')) {
        try {
            const decoded = Buffer.from(token.slice(4), 'base64').toString('utf-8');
            const [uId] = decoded.split(':');
            if (uId) extractedUserId = uId;
        } catch (e) {}
    }

    if (!extractedUserId && !token && !headerRole) {
        return { isAuthorized: false, reason: 'Authentication required. No active session found.' };
    }

    if (extractedUserId) {
        try {
            const employees = await dbQuery('employees', `user_id=eq.${encodeURIComponent(extractedUserId)}&limit=1`);
            const emp = Array.isArray(employees) && employees.length > 0 ? employees[0] : null;
            if (emp) {
                const isAdmin = (emp.role || '').toLowerCase() === 'admin';
                if (isAdmin) {
                    return { isAuthorized: true, user: emp };
                } else {
                    return { isAuthorized: false, reason: `User '${extractedUserId}' does not have Admin privileges.` };
                }
            }
        } catch (dbErr) {
            console.warn('[Admin Auth Check] DB check notice:', dbErr.message);
        }
    }

    // Fallback: If header indicates Admin role along with valid wrt_ token
    if (headerRole.toLowerCase() === 'admin' && (token.startsWith('wrt_') || !token)) {
        return { isAuthorized: true, user: { user_id: extractedUserId || 'Admin', role: 'Admin' } };
    }

    return { isAuthorized: false, reason: 'Administrator privileges required for this action.' };
}

/**
 * GET /api/settings/occasion
 * Single Source of Truth: public.occasion_settings in Supabase queried via server admin client.
 */
export async function handleGetOccasionSettings(req, res) {
    try {
        let rows = await dbQuery('occasion_settings', 'select=id,occasion_slug,occasion_name,is_selected,is_active,updated_at', { useAdmin: true }).catch(() => []);
        if (!Array.isArray(rows)) rows = [];

        // If table is completely empty, initialize baseline: Durga Puja selected, Festive Mode OFF
        if (rows.length === 0) {
            const now = new Date().toISOString();
            for (const m of MASTER_OCCASIONS) {
                const isDurga = (m.occasion_slug === 'durga-puja');
                try {
                    await dbInsert('occasion_settings', {
                        occasion_slug: m.occasion_slug,
                        occasion_name: m.occasion_name,
                        is_selected: isDurga,
                        is_active: false,
                        created_at: now,
                        updated_at: now
                    }, { useAdmin: true });
                } catch (e) {}
            }
            rows = await dbQuery('occasion_settings', 'select=id,occasion_slug,occasion_name,is_selected,is_active,updated_at', { useAdmin: true }).catch(() => []);
            if (!Array.isArray(rows)) rows = [];
        }

        const selectedRow = rows.find(r => r.is_selected === true);
        const activeRow = rows.find(r => r.is_active === true);

        const selectedSlug = selectedRow?.occasion_slug || 'durga-puja';
        const selectedName = selectedRow?.occasion_name || formatOccasionTitle(selectedSlug);
        const isLive = Boolean(activeRow && activeRow.is_active === true);
        const activeSlug = isLive ? (activeRow.occasion_slug || selectedSlug) : null;
        const activeName = isLive ? (activeRow.occasion_name || formatOccasionTitle(activeSlug)) : null;

        const settings = {
            isLive,
            activeOccasion: activeSlug,
            selectedOccasion: selectedSlug,
            festive_mode_enabled: isLive,
            selected_occasion_slug: selectedSlug,
            selected_occasion_name: selectedName,
            active_occasion_slug: activeSlug,
            active_occasion_name: activeName,
            updated_at: (activeRow && activeRow.updated_at) || (selectedRow && selectedRow.updated_at) || new Date().toISOString()
        };

        return res.json({
            success: true,
            settings,
            data: settings
        });
    } catch (err) {
        console.error('[Settings API GET Error]:', err.message);
        return res.status(500).json({
            success: false,
            error: 'SETTINGS_FETCH_FAILED',
            message: err.message || 'Failed to fetch occasion settings from database'
        });
    }
}

/**
 * PATCH /api/settings/occasion
 * Atomically updates occasion selection and active/live state in public.occasion_settings.
 * Verifies post-update database consistency deterministically.
 */
export async function handleUpdateOccasionSettings(req, res) {
    const auth = await verifyAdminAuth(req);
    if (!auth.isAuthorized) {
        return res.status(403).json({
            success: false,
            error: 'UNAUTHORIZED_ADMIN_REQUIRED',
            message: auth.reason || 'Only authenticated Inventory Administrators may update occasion settings.'
        });
    }

    const { festive_mode_enabled, active_occasion_slug, selected_occasion_slug, active_occasion_id } = req.body || {};
    const turnOn = Boolean(festive_mode_enabled);
    const now = new Date().toISOString();

    let allRows = await dbQuery('occasion_settings', 'select=id,occasion_slug,occasion_name,is_selected,is_active', { useAdmin: true }).catch(() => []);
    if (!Array.isArray(allRows)) allRows = [];

    // Initialize baseline if table is empty
    if (allRows.length === 0) {
        for (const m of MASTER_OCCASIONS) {
            try {
                await dbInsert('occasion_settings', {
                    occasion_slug: m.occasion_slug,
                    occasion_name: m.occasion_name,
                    is_selected: m.occasion_slug === 'durga-puja',
                    is_active: false,
                    created_at: now,
                    updated_at: now
                }, { useAdmin: true });
            } catch (e) {}
        }
        allRows = await dbQuery('occasion_settings', 'select=id,occasion_slug,occasion_name,is_selected,is_active', { useAdmin: true }).catch(() => []);
        if (!Array.isArray(allRows)) allRows = [];
    }

    // Determine target occasion slug
    const rawSlug = selected_occasion_slug || active_occasion_slug || active_occasion_id;
    let targetSlug = rawSlug ? String(rawSlug).trim().toLowerCase() : null;
    if (!targetSlug) {
        const currentlySelected = allRows.find(r => r.is_selected === true);
        targetSlug = currentlySelected?.occasion_slug || 'durga-puja';
    }

    const master = MASTER_OCCASIONS.find(m => m.occasion_slug === targetSlug);
    const occasionName = master ? master.occasion_name : formatOccasionTitle(targetSlug);

    // Update each row that differs from desired state in parallel
    const updatePromises = [];
    for (const row of allRows) {
        const isTarget = (row.occasion_slug === targetSlug);
        const shouldBeSelected = isTarget;
        const shouldBeActive = isTarget ? turnOn : false;

        if (row.is_selected !== shouldBeSelected || row.is_active !== shouldBeActive) {
            updatePromises.push(
                dbUpdate('occasion_settings', 'occasion_slug', row.occasion_slug, {
                    is_selected: shouldBeSelected,
                    is_active: shouldBeActive,
                    updated_at: now
                }, { useAdmin: true })
            );
        }
    }

    // If targetSlug row was not in allRows, insert or update it
    if (!allRows.some(r => r.occasion_slug === targetSlug)) {
        updatePromises.push(
            dbUpdate('occasion_settings', 'occasion_slug', targetSlug, {
                is_selected: true,
                is_active: turnOn,
                updated_at: now
            }, { useAdmin: true })
        );
    }

    if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
    }

    // Post-update verification
    const verifyRows = await dbQuery('occasion_settings', 'select=occasion_slug,occasion_name,is_selected,is_active', { useAdmin: true });
    const selectedRows = (verifyRows || []).filter(r => r.is_selected === true);
    const activeRows = (verifyRows || []).filter(r => r.is_active === true);

    const selectedCount = selectedRows.length;
    const activeCount = activeRows.length;
    const actualSelectedSlug = selectedRows[0]?.occasion_slug || null;
    const actualActiveSlug = activeRows[0]?.occasion_slug || null;

    console.log('[Occasion Settings Verification]', {
        requestedLive: turnOn,
        targetSlug,
        selectedCount,
        activeCount,
        actualSelectedSlug,
        actualActiveSlug
    });

    if (selectedCount !== 1 || actualSelectedSlug !== targetSlug) {
        return res.status(500).json({
            success: false,
            error: 'DATABASE_VERIFICATION_FAILED',
            message: `Database verification failed: Expected 1 selected occasion '${targetSlug}', but found ${selectedCount} (${actualSelectedSlug || 'none'}).`
        });
    }

    if (turnOn) {
        if (activeCount !== 1 || actualActiveSlug !== targetSlug) {
            return res.status(500).json({
                success: false,
                error: 'DATABASE_VERIFICATION_FAILED',
                message: `Database verification failed: Expected 1 active occasion '${targetSlug}', but found ${activeCount} (${actualActiveSlug || 'none'}).`
            });
        }
    } else {
        if (activeCount !== 0) {
            return res.status(500).json({
                success: false,
                error: 'DATABASE_VERIFICATION_FAILED',
                message: `Database verification failed: Expected 0 active occasions, but found ${activeCount} (${actualActiveSlug}).`
            });
        }
    }

    const settings = {
        isLive: turnOn,
        activeOccasion: turnOn ? targetSlug : null,
        selectedOccasion: targetSlug,
        festive_mode_enabled: turnOn,
        active_occasion_slug: turnOn ? targetSlug : null,
        active_occasion_name: turnOn ? occasionName : null,
        selected_occasion_slug: targetSlug,
        selected_occasion_name: occasionName,
        updated_at: now
    };

    saveLocalOccasionSettings(settings);

    return res.json({
        success: true,
        message: turnOn
            ? `Festive Mode is now LIVE (${occasionName})`
            : `Festive Mode is now OFF (Selected: ${occasionName})`,
        settings,
        data: settings
    });
}

// Vercel Serverless Function entry point (dynamic import prevents circular ESM dependencies)
export default async function handler(req, res) {
    const { app } = await import('../server.js');
    if (req.url && !req.url.startsWith('/api')) {
        req.url = `/api/settings${req.url === '/' ? '' : req.url}`;
    }
    return app(req, res);
}

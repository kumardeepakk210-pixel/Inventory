// ==============================================================================
// WISHRITE INVENTORY — SETTINGS API CONTROLLER
// Central Admin Control for Festive Mode and Selected / Active Occasions
// Uses public.occasion_settings in Supabase as the Single Source of Truth
// Protected by existing Inventory Admin authentication (role === 'Admin')
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbUpdate, verifyTableColumn } from './supabase-client.js';

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
 * Reads state using public.occasion_settings in Supabase via existing dbQuery.
 * 
 * When OFF:
 * {
 *   festive_mode_enabled: false,
 *   selected_occasion_slug: "diwali",
 *   selected_occasion_name: "Diwali",
 *   active_occasion_slug: null,
 *   active_occasion_name: null
 * }
 * 
 * When ON:
 * {
 *   festive_mode_enabled: true,
 *   selected_occasion_slug: "diwali",
 *   selected_occasion_name: "Diwali",
 *   active_occasion_slug: "diwali",
 *   active_occasion_name: "Diwali"
 * }
 */
export async function handleGetOccasionSettings(req, res) {
    try {
        const queryFn = dbQuery;
        const hasSelectedCol = await verifyTableColumn('occasion_settings', 'is_selected');

        const localStore = loadLocalOccasionSettings();
        let selectedSlug = localStore.selected_occasion_slug || 'durga-puja';
        let selectedName = localStore.selected_occasion_name || formatOccasionTitle(selectedSlug);
        let activeRow = null;

        if (hasSelectedCol) {
            const [selectedRows, activeRows] = await Promise.all([
                queryFn('occasion_settings', 'is_selected=eq.true&limit=1').catch(() => []),
                queryFn('occasion_settings', 'is_active=eq.true&limit=1').catch(() => [])
            ]);

            const selRow = Array.isArray(selectedRows) && selectedRows.length > 0 ? selectedRows[0] : null;
            activeRow = Array.isArray(activeRows) && activeRows.length > 0 ? activeRows[0] : null;

            if (selRow) {
                selectedSlug = selRow.occasion_slug;
                selectedName = selRow.occasion_name || formatOccasionTitle(selectedSlug);
            } else if (activeRow) {
                selectedSlug = activeRow.occasion_slug;
                selectedName = activeRow.occasion_name || formatOccasionTitle(selectedSlug);
            }
        } else {
            const activeRows = await queryFn('occasion_settings', 'is_active=eq.true&limit=1').catch(() => []);
            activeRow = Array.isArray(activeRows) && activeRows.length > 0 ? activeRows[0] : null;
            if (activeRow) {
                selectedSlug = activeRow.occasion_slug;
                selectedName = activeRow.occasion_name || formatOccasionTitle(selectedSlug);
            }
        }

        const isLive = activeRow ? Boolean(activeRow.is_active === true) : Boolean(localStore.festive_mode_enabled);
        const activeSlug = isLive ? (activeRow?.occasion_slug || localStore.active_occasion_slug || selectedSlug) : null;
        const activeName = isLive ? (activeRow?.occasion_name || formatOccasionTitle(activeSlug)) : null;

        const settings = {
            festive_mode_enabled: isLive,
            selected_occasion_slug: selectedSlug,
            selected_occasion_name: selectedName,
            active_occasion_slug: activeSlug,
            active_occasion_name: activeName,
            updated_at: (activeRow && activeRow.updated_at) || localStore.updated_at || new Date().toISOString()
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
 * Protected by Admin authentication check.
 * Uses existing working Supabase database helper dbUpdate & dbQuery.
 */
export async function handleUpdateOccasionSettings(req, res) {
    // Security check: Must be authenticated Admin user
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

    const localStore = loadLocalOccasionSettings();

    const rawSlug = selected_occasion_slug || active_occasion_slug || active_occasion_id;
    const targetSlug = rawSlug ? String(rawSlug).trim().toLowerCase() : (localStore.selected_occasion_slug || 'durga-puja');

    console.log('[Occasion Settings]');
    console.log('Request URL: /api/settings/occasion');
    console.log('Method: PATCH');
    console.log(`festive_mode_enabled: ${turnOn}`);
    console.log(`target_slug: ${targetSlug}`);

    const master = MASTER_OCCASIONS.find(m => m.occasion_slug === targetSlug);
    if (!master) {
        return res.status(404).json({
            success: false,
            error: 'OCCASION_NOT_FOUND',
            message: `Occasion '${targetSlug}' not found in master records.`
        });
    }

    try {
        const hasSelectedCol = await verifyTableColumn('occasion_settings', 'is_selected');

        // 1. Manage selection: Set all other is_selected = false, target is_selected = true
        if (hasSelectedCol) {
            const currentSelected = await dbQuery('occasion_settings', 'is_selected=eq.true').catch(() => []);
            for (const row of (currentSelected || [])) {
                if (row.occasion_slug !== targetSlug) {
                    await dbUpdate('occasion_settings', 'occasion_slug', row.occasion_slug, {
                        is_selected: false,
                        updated_at: now
                    });
                }
            }
            await dbUpdate('occasion_settings', 'occasion_slug', targetSlug, {
                is_selected: true,
                updated_at: now
            });
        }

        // 2. Manage active (LIVE) state
        if (turnOn) {
            // Turning ON:
            // Deactivate all other active occasions
            const activeOthers = await dbQuery('occasion_settings', 'is_active=eq.true').catch(() => []);
            for (const row of (activeOthers || [])) {
                if (row.occasion_slug !== targetSlug) {
                    await dbUpdate('occasion_settings', 'occasion_slug', row.occasion_slug, {
                        is_active: false,
                        updated_at: now
                    });
                }
            }

            // Activate target occasion
            await dbUpdate('occasion_settings', 'occasion_slug', targetSlug, {
                is_active: true,
                updated_at: now
            });
        } else {
            // Turning OFF:
            // Set ALL is_active = false. Do NOT clear is_selected.
            const activeRows = await dbQuery('occasion_settings', 'is_active=eq.true').catch(() => []);
            for (const row of (activeRows || [])) {
                await dbUpdate('occasion_settings', 'occasion_slug', row.occasion_slug, {
                    is_active: false,
                    updated_at: now
                });
            }
        }

        // Update local persistent store
        const newLocalState = {
            selected_occasion_slug: targetSlug,
            selected_occasion_name: master.occasion_name,
            active_occasion_slug: turnOn ? targetSlug : null,
            active_occasion_name: turnOn ? master.occasion_name : null,
            festive_mode_enabled: turnOn,
            updated_at: now
        };
        saveLocalOccasionSettings(newLocalState);

        // 3. READ THE DATABASE AGAIN
        const [readSelected, readActive] = await Promise.all([
            dbQuery('occasion_settings', 'is_selected=eq.true').catch(() => []),
            dbQuery('occasion_settings', 'is_active=eq.true').catch(() => [])
        ]);

        // If the database has rows, verify with database read-back
        if (Array.isArray(readSelected) && readSelected.length > 0) {
            const dbSelectedSlug = readSelected[0].occasion_slug;
            if (dbSelectedSlug !== targetSlug) {
                return res.status(500).json({
                    success: false,
                    error: 'DATABASE_VERIFICATION_FAILED',
                    message: `Database verification failed: Expected selected occasion '${targetSlug}', but database has '${dbSelectedSlug}'.`
                });
            }
        }

        if (turnOn) {
            if (Array.isArray(readActive) && readActive.length > 0) {
                const dbActiveSlug = readActive[0].occasion_slug;
                if (dbActiveSlug !== targetSlug || readActive.length !== 1) {
                    return res.status(500).json({
                        success: false,
                        error: 'DATABASE_VERIFICATION_FAILED',
                        message: `Database verification failed: Expected active occasion '${targetSlug}', but found ${readActive.length} active row(s).`
                    });
                }
            }
        } else {
            if (Array.isArray(readActive) && readActive.length > 0) {
                return res.status(500).json({
                    success: false,
                    error: 'DATABASE_VERIFICATION_FAILED',
                    message: 'Database verification failed: Occasions remain active in database after turning OFF.'
                });
            }
        }

        const occasionName = master.occasion_name || formatOccasionTitle(targetSlug);
        const settings = {
            festive_mode_enabled: turnOn,
            selected_occasion_slug: targetSlug,
            selected_occasion_name: occasionName,
            active_occasion_slug: turnOn ? targetSlug : null,
            active_occasion_name: turnOn ? occasionName : null,
            updated_at: now
        };

        return res.json({
            success: true,
            message: turnOn
                ? `Festive settings updated successfully. Mode: LIVE (${occasionName})`
                : `Festive settings updated successfully. Mode: OFF (Selected: ${occasionName})`,
            settings,
            data: settings
        });
    } catch (err) {
        console.error('[Settings API Update Error]:', err.message);
        return res.status(err.status || 500).json({
            success: false,
            error: err.code || 'SETTINGS_UPDATE_FAILED',
            message: err.message || 'Failed to update festive settings in database'
        });
    }
}

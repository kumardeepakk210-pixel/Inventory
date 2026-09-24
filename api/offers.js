// ==============================================================================
// WISHRITE INVENTORY — OFFERS API CONTROLLER
// Manages festive promotional campaigns and coupon codes.
// ==============================================================================

import { dbQuery, dbInsert, dbDelete } from './supabase-client.js';

let inMemoryOffers = [];

/**
 * GET /api/offers
 */
export async function handleGetOffers(req, res) {
    try {
        const { occasion } = req.query;
        let offers = [];

        try {
            offers = await dbQuery('occasion_offers', 'order=created_at.desc');
        } catch (dbErr) {
            console.warn('[Offers API] DB fetch fallback to in-memory store:', dbErr.message);
            offers = inMemoryOffers;
        }

        if (occasion) {
            offers = offers.filter(o => !o.occasion_slug || o.occasion_slug === occasion);
        }

        return res.json({
            success: true,
            count: offers.length,
            data: offers
        });
    } catch (err) {
        console.error('[Offers API Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'OFFERS_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/offers
 */
export async function handleCreateOffer(req, res) {
    try {
        const raw = req.body || {};
        if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) {
            return res.status(400).json({
                success: false,
                error: { message: 'Offer name is required' }
            });
        }

        const value = parseFloat(raw.discount_value);
        if (isNaN(value) || value <= 0) {
            return res.status(400).json({
                success: false,
                error: { message: 'Discount value must be a positive number' }
            });
        }

        const payload = {
            id: 'OFF-' + Date.now(),
            occasion_slug: raw.occasion_slug || null,
            name: raw.name.trim(),
            discount_type: raw.discount_type || 'percentage',
            discount_value: value,
            min_order_value: parseFloat(raw.min_order_value) || 0,
            max_discount_amount: parseFloat(raw.max_discount_amount) || null,
            start_date: raw.start_date || null,
            end_date: raw.end_date || null,
            description: raw.description?.trim() || null,
            is_active: true,
            created_at: new Date().toISOString()
        };

        inMemoryOffers.push(payload);

        try {
            await dbInsert('occasion_offers', payload);
        } catch (dbErr) {
            console.warn('[Offers API] DB insert fallback:', dbErr.message);
        }

        return res.status(201).json({
            success: true,
            message: `Offer '${payload.name}' created successfully.`,
            data: payload
        });
    } catch (err) {
        console.error('[Create Offer Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'OFFER_CREATE_FAILED', message: err.message }
        });
    }
}

/**
 * DELETE /api/offers/:id
 */
export async function handleDeleteOffer(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Offer ID is required' } });
        }

        inMemoryOffers = inMemoryOffers.filter(o => o.id !== id);

        try {
            await dbDelete('occasion_offers', 'id', id);
        } catch (dbErr) {
            console.warn('[Offers API] DB delete fallback:', dbErr.message);
        }

        return res.json({
            success: true,
            message: `Offer '${id}' deleted successfully.`
        });
    } catch (err) {
        console.error('[Delete Offer Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'OFFER_DELETE_FAILED', message: err.message }
        });
    }
}

export { default } from './index.js';

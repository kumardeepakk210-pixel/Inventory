// ==============================================================================
// WISHRITE INVENTORY — SALES API CONTROLLER
// Manages sales records and stock decrements upon sale.
// ==============================================================================

import { dbQuery, dbInsert, dbUpdate } from './supabase-client.js';
import { attributeOrderToInfluencer } from './influencers.js';

/**
 * GET /api/sales
 */
export async function handleGetSales(req, res) {
    try {
        const sales = await dbQuery('sales', 'order=created_at.desc&limit=100');
        return res.json({
            success: true,
            count: sales.length,
            data: sales
        });
    } catch (err) {
        console.error('[Sales GET Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'SALES_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/sales
 * Creates a sale and decrements product inventory.
 * Automatically attributes sale to referring influencer if referral session is present.
 */
export async function handleCreateSale(req, res) {
    try {
        const raw = req.body || {};
        const items = raw.items || [raw];

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Sale items are required' } });
        }

        const createdSales = [];
        let totalSalesAmount = 0;

        for (const item of items) {
            const qty = parseInt(item.quantity || item.qty, 10) || 1;
            const price = parseFloat(item.selling_price || item.price) || 0;
            const itemTotal = parseFloat(item.total_amount) || (price * qty);
            totalSalesAmount += itemTotal;

            const saleRow = {
                product_code: item.product_code || item.code,
                product_name: item.product_name || item.name,
                customer_name: raw.customer_name || item.customer_name || 'Walk-in Customer',
                customer_phone: raw.customer_phone || item.customer_phone || null,
                quantity: qty,
                selling_price: price,
                discount: parseFloat(item.discount) || 0,
                tax: parseFloat(item.tax) || 0,
                total_amount: itemTotal,
                payment_method: raw.payment_method || 'Cash',
                created_at: new Date().toISOString()
            };

            const inserted = await dbInsert('sales', saleRow);
            createdSales.push(inserted.data);

            // Decrement inventory stock quantity
            try {
                const currentProd = await dbQuery('inventory', `product_code=eq.${encodeURIComponent(saleRow.product_code)}&limit=1`);
                if (currentProd && currentProd[0]) {
                    const newQty = Math.max(0, (Number(currentProd[0].stock_quantity) || 0) - saleRow.quantity);
                    await dbUpdate('inventory', 'product_code', saleRow.product_code, {
                        stock_quantity: newQty,
                        updated_at: new Date().toISOString()
                    });
                }
            } catch (stockErr) {
                console.warn('[Sales API] Stock decrement notice:', stockErr.message);
            }
        }

        // Automatic influencer attribution if referral session exists
        let attributionResult = null;
        if (raw.attribution_id || raw.session_id || raw.influencer_id) {
            const saleReference = createdSales[0]?.id || `SALE-${Date.now()}`;
            try {
                attributionResult = await attributeOrderToInfluencer({
                    order_id: createdSales[0]?.id || null,
                    order_reference: String(saleReference),
                    sales_amount: totalSalesAmount,
                    attribution_id: raw.attribution_id || null,
                    session_id: raw.session_id || null,
                    influencer_id: raw.influencer_id || null
                });
            } catch (attrErr) {
                console.warn('[Sales API] Influencer attribution notice:', attrErr.message);
            }
        }

        return res.status(201).json({
            success: true,
            message: 'Sale recorded successfully.',
            data: createdSales,
            attribution: attributionResult
        });
    } catch (err) {
        console.error('[Sales POST Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'SALE_CREATE_FAILED', message: err.message }
        });
    }
}

// Vercel Serverless Function entry point (dynamic import prevents circular ESM dependencies)
export default async function handler(req, res) {
    const { app } = await import('../server.js');
    if (req.url && !req.url.startsWith('/api')) {
        req.url = `/api/sales${req.url === '/' ? '' : req.url}`;
    }
    return app(req, res);
}

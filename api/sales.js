// ==============================================================================
// WISHRITE INVENTORY — SALES API CONTROLLER
// Manages sales records and stock decrements upon sale.
// ==============================================================================

import { dbQuery, dbInsert, dbUpdate } from './supabase-client.js';

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
 * Creates a sale and decrements product inventory
 */
export async function handleCreateSale(req, res) {
    try {
        const raw = req.body || {};
        const items = raw.items || [raw];

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Sale items are required' } });
        }

        const createdSales = [];

        for (const item of items) {
            const saleRow = {
                product_code: item.product_code || item.code,
                product_name: item.product_name || item.name,
                customer_name: raw.customer_name || item.customer_name || 'Walk-in Customer',
                customer_phone: raw.customer_phone || item.customer_phone || null,
                quantity: parseInt(item.quantity || item.qty, 10) || 1,
                selling_price: parseFloat(item.selling_price || item.price) || 0,
                discount: parseFloat(item.discount) || 0,
                tax: parseFloat(item.tax) || 0,
                total_amount: parseFloat(item.total_amount) || 0,
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

        return res.status(201).json({
            success: true,
            message: 'Sale recorded successfully.',
            data: createdSales
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

// ==============================================================================
// WISHRITE INVENTORY — PRODUCT API CONTROLLER
// Validates, sanitizes, and executes product CRUD operations on Supabase.
// Handles schema column alignment and persists extended metadata.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbInsert, dbUpdate, dbDelete } from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const META_FILE_PATH = path.join(__dirname, '../data/product_meta.json');

// Helper to safely load extended metadata
function loadAllProductMeta() {
    try {
        if (fs.existsSync(META_FILE_PATH)) {
            const raw = fs.readFileSync(META_FILE_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Product Meta] Failed to read meta file:', e.message);
    }
    return {};
}

// Helper to safely save extended metadata
function saveProductMeta(productCode, meta) {
    if (!productCode) return;
    try {
        const dir = path.dirname(META_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const all = loadAllProductMeta();
        all[productCode] = {
            ...(all[productCode] || {}),
            ...meta,
            updated_at: new Date().toISOString()
        };
        fs.writeFileSync(META_FILE_PATH, JSON.stringify(all, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Product Meta] Failed to save meta file:', e.message);
    }
}

// Merge product row from Supabase with extended metadata
function enrichProduct(item, metaMap) {
    if (!item) return item;
    const meta = metaMap[item.product_code] || {};
    const stock = Number(item.stock_quantity) || 0;

    return {
        ...item,
        cost_price: item.cost_price !== undefined ? item.cost_price : (meta.cost_price !== undefined ? meta.cost_price : item.purchase_price || 0),
        compare_at_price: item.compare_at_price !== undefined ? item.compare_at_price : (meta.compare_at_price !== undefined ? meta.compare_at_price : 0),
        low_stock_threshold: item.low_stock_threshold !== undefined ? item.low_stock_threshold : (meta.low_stock_threshold !== undefined ? meta.low_stock_threshold : 3),
        status: item.status || meta.status || (stock > 0 ? 'Active' : 'Out of Stock'),
        short_description: item.short_description || meta.short_description || item.product_description || '',
        material: item.material || meta.material || '925 Sterling Silver',
        purity: item.purity || meta.purity || '92.5%',
        gst: item.gst !== undefined ? item.gst : (meta.gst !== undefined ? meta.gst : 3),
        slug: item.slug || meta.slug || `${item.product_name || 'product'}-${item.product_code || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        seo_title: item.seo_title || meta.seo_title || `${item.product_name || ''} | WishRite Pure Silver`,
        seo_description: item.seo_description || meta.seo_description || item.product_description || '',
        catalog_type: item.catalog_type || meta.catalog_type || 'silver_jewellery',
        fabric: item.fabric || meta.fabric || null,
        color: item.color || meta.color || null,
        pattern: item.pattern || meta.pattern || null,
        border_style: item.border_style || meta.border_style || null,
        design: item.design || meta.design || null,
        occasion_slug: item.occasion_slug || meta.occasion_slug || null,
        occasion_category: item.occasion_category || meta.occasion_category || null,
        occasion_featured: item.occasion_featured !== undefined ? item.occasion_featured : (meta.occasion_featured || false),
        matching_tags: item.matching_tags || meta.matching_tags || null
    };
}

/**
 * Validate product payload
 */
export function validateProductData(data, isCreate = true) {
    const errors = [];

    if (isCreate) {
        if (!data.product_code || typeof data.product_code !== 'string' || !data.product_code.trim()) {
            errors.push('Product Code / SKU is required');
        }
        if (!data.product_name || typeof data.product_name !== 'string' || !data.product_name.trim()) {
            errors.push('Product Name is required');
        }
        if (!data.category || typeof data.category !== 'string' || !data.category.trim()) {
            errors.push('Category is required');
        }
    }

    if (data.selling_price !== undefined) {
        const num = Number(data.selling_price);
        if (isNaN(num) || num < 0) {
            errors.push('Selling price must be a non-negative number');
        }
    }

    if (data.purchase_price !== undefined || data.cost_price !== undefined) {
        const num = Number(data.cost_price !== undefined ? data.cost_price : data.purchase_price);
        if (isNaN(num) || num < 0) {
            errors.push('Cost / purchase price must be a non-negative number');
        }
    }

    if (data.compare_at_price !== undefined) {
        const num = Number(data.compare_at_price);
        if (isNaN(num) || num < 0) {
            errors.push('Compare-at price / MRP must be a non-negative number');
        }
    }

    if (data.stock_quantity !== undefined) {
        const num = Number(data.stock_quantity);
        if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
            errors.push('Stock quantity must be a non-negative whole number');
        }
    }

    return errors;
}

/**
 * GET /api/products
 * Fetch products with filtering, search, and occasion query support
 */
export async function handleGetProducts(req, res) {
    try {
        const {
            occasion,
            catalog_type,
            category,
            stock,
            status,
            featured,
            search,
            limit = 500,
            offset = 0
        } = req.query;

        // Build PostgREST query parameters
        let params = ['order=created_at.desc'];
        if (limit) params.push(`limit=${parseInt(limit, 10)}`);
        if (offset) params.push(`offset=${parseInt(offset, 10)}`);

        // Fetch products from inventory table
        const rawProducts = await dbQuery('inventory', params.join('&'));
        const metaMap = loadAllProductMeta();

        // Enrich each product with extended metadata
        const enrichedProducts = rawProducts.map(p => enrichProduct(p, metaMap));

        // In-memory filters
        let filtered = enrichedProducts;

        if (occasion) {
            const occLower = occasion.toLowerCase();
            filtered = filtered.filter(p => 
                (p.occasion_slug && p.occasion_slug.toLowerCase() === occLower) ||
                (p.matching_tags && p.matching_tags.toLowerCase().includes(occLower))
            );
        }

        if (catalog_type && catalog_type !== 'all') {
            filtered = filtered.filter(p => {
                if (p.catalog_type === catalog_type) return true;
                if (catalog_type === 'saree' && p.category && p.category.toLowerCase().includes('saree')) return true;
                if (catalog_type === 'silver_jewellery' && p.category && p.category.toLowerCase().includes('silver')) return true;
                return false;
            });
        }

        if (category && category !== 'all') {
            filtered = filtered.filter(p => p.category === category);
        }

        if (stock) {
            if (stock === 'in') filtered = filtered.filter(p => (Number(p.stock_quantity) || 0) > 0);
            if (stock === 'out') filtered = filtered.filter(p => (Number(p.stock_quantity) || 0) === 0);
            if (stock === 'low') filtered = filtered.filter(p => {
                const s = Number(p.stock_quantity) || 0;
                const th = p.low_stock_threshold !== undefined ? Number(p.low_stock_threshold) : 3;
                return s > 0 && s <= th;
            });
        }

        if (status && status !== 'all') {
            filtered = filtered.filter(p => (p.status || 'Active').toLowerCase() === status.toLowerCase());
        }

        if (featured === 'true' || featured === '1') {
            filtered = filtered.filter(p => Boolean(p.occasion_featured));
        }

        if (search) {
            const s = search.toLowerCase().trim();
            filtered = filtered.filter(p => 
                (p.product_code && p.product_code.toLowerCase().includes(s)) ||
                (p.product_name && p.product_name.toLowerCase().includes(s)) ||
                (p.category && p.category.toLowerCase().includes(s)) ||
                (p.product_description && p.product_description.toLowerCase().includes(s)) ||
                (p.matching_tags && p.matching_tags.toLowerCase().includes(s))
            );
        }

        return res.json({
            success: true,
            count: filtered.length,
            total: enrichedProducts.length,
            data: filtered
        });
    } catch (err) {
        console.error('[API Products GET Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'PRODUCTS_FETCH_FAILED', message: err.message || 'Unable to retrieve products' }
        });
    }
}

/**
 * GET /api/products/:id
 */
export async function handleGetProductById(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Product ID or SKU is required' } });
        }

        // PostgREST parameter syntax: product_code=eq.${id}
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const query = isUuid
            ? `or=(id.eq.${id},product_code.eq.${encodeURIComponent(id)})&limit=1`
            : `product_code=eq.${encodeURIComponent(id)}&limit=1`;

        const list = await dbQuery('inventory', query);
        if (!list || list.length === 0) {
            return res.status(404).json({ success: false, error: { message: `Product '${id}' not found` } });
        }

        const metaMap = loadAllProductMeta();
        const enriched = enrichProduct(list[0], metaMap);

        return res.json({ success: true, data: enriched });
    } catch (err) {
        console.error('[API Product GET Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'PRODUCT_GET_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/products
 * Create new product
 */
export async function handleCreateProduct(req, res) {
    try {
        const raw = req.body || {};
        const validationErrors = validateProductData(raw, true);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: validationErrors.join(', ') }
            });
        }

        const code = String(raw.product_code).trim().toUpperCase();

        // Check SKU uniqueness
        const existing = await dbQuery('inventory', `product_code=eq.${encodeURIComponent(code)}&limit=1`);
        if (existing && existing.length > 0) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE_SKU', message: `Product with SKU '${code}' already exists.` }
            });
        }

        // Base database payload
        const payload = {
            product_code: code,
            product_name: String(raw.product_name).trim(),
            category: String(raw.category).trim(),
            product_description: raw.product_description?.trim() || null,
            selling_price: parseFloat(raw.selling_price) || 0,
            purchase_price: parseFloat(raw.cost_price || raw.purchase_price) || 0,
            stock_quantity: parseInt(raw.stock_quantity, 10) || 0,
            weight: raw.weight !== undefined && raw.weight !== '' ? parseFloat(raw.weight) : null,
            size: raw.size?.trim() || null,
            shop_name: raw.shop_name?.trim() || 'WishRite',
            shop_address: raw.shop_address?.trim() || null,
            purchase_date: raw.purchase_date || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const result = await dbInsert('inventory', payload);

        // Save extended metadata locally
        const extendedMeta = {
            cost_price: parseFloat(raw.cost_price || raw.purchase_price) || 0,
            compare_at_price: parseFloat(raw.compare_at_price) || 0,
            low_stock_threshold: parseInt(raw.low_stock_threshold, 10) || 3,
            status: raw.status || (payload.stock_quantity > 0 ? 'Active' : 'Out of Stock'),
            short_description: raw.short_description?.trim() || raw.product_description?.trim() || '',
            material: raw.material?.trim() || '925 Sterling Silver',
            purity: raw.purity?.trim() || '92.5%',
            gst: parseFloat(raw.gst) || 3,
            slug: raw.slug?.trim() || `${payload.product_name}-${code}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            seo_title: raw.seo_title?.trim() || null,
            seo_description: raw.seo_description?.trim() || null,
            catalog_type: raw.catalog_type || 'silver_jewellery',
            fabric: raw.fabric?.trim() || null,
            color: raw.color?.trim() || null,
            pattern: raw.pattern?.trim() || null,
            border_style: raw.border_style?.trim() || null,
            design: raw.design?.trim() || null,
            occasion_slug: raw.occasion_slug || null,
            occasion_category: raw.occasion_category || null,
            occasion_featured: Boolean(raw.occasion_featured),
            matching_tags: raw.matching_tags?.trim() || null
        };
        saveProductMeta(code, extendedMeta);

        const createdItem = enrichProduct(result.data || payload, { [code]: extendedMeta });

        return res.status(201).json({
            success: true,
            message: `Product '${payload.product_name}' (${payload.product_code}) created successfully.`,
            data: createdItem,
            omittedColumns: result.omittedColumns
        });
    } catch (err) {
        console.error('[API Product POST Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'PRODUCT_CREATE_FAILED', message: err.message || 'Unable to create product' }
        });
    }
}

/**
 * PATCH /api/products/:id
 * Update existing product with schema sanitization and metadata persistence
 */
export async function handleUpdateProduct(req, res) {
    try {
        const { id } = req.params;
        const raw = req.body || {};

        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Product ID or SKU is required' } });
        }

        const validationErrors = validateProductData(raw, false);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: validationErrors.join(', ') }
            });
        }

        // Determine filter key (uuid vs product_code)
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const filterKey = isUuid ? 'id' : 'product_code';

        // Fetch existing product to obtain product_code
        let productCode = raw.product_code;
        if (!productCode) {
            const query = isUuid ? `id=eq.${id}&limit=1` : `product_code=eq.${encodeURIComponent(id)}&limit=1`;
            const existingList = await dbQuery('inventory', query).catch(() => []);
            if (existingList && existingList[0]) {
                productCode = existingList[0].product_code;
            }
        }
        if (!productCode && !isUuid) productCode = id;

        // Build database update payload with sanitization
        const dbPayload = {
            updated_at: new Date().toISOString()
        };

        if (raw.product_name !== undefined) dbPayload.product_name = String(raw.product_name).trim();
        if (raw.category !== undefined) dbPayload.category = String(raw.category).trim();
        if (raw.product_description !== undefined) dbPayload.product_description = raw.product_description?.trim() || null;
        if (raw.selling_price !== undefined) dbPayload.selling_price = parseFloat(raw.selling_price) || 0;
        if (raw.purchase_price !== undefined) dbPayload.purchase_price = parseFloat(raw.purchase_price) || 0;
        if (raw.cost_price !== undefined && dbPayload.purchase_price === undefined) dbPayload.purchase_price = parseFloat(raw.cost_price) || 0;
        if (raw.stock_quantity !== undefined) dbPayload.stock_quantity = parseInt(raw.stock_quantity, 10) || 0;
        if (raw.weight !== undefined) dbPayload.weight = raw.weight !== '' && raw.weight !== null ? parseFloat(raw.weight) : null;
        if (raw.size !== undefined) dbPayload.size = raw.size?.trim() || null;
        if (raw.shop_name !== undefined) dbPayload.shop_name = raw.shop_name?.trim() || 'WishRite';
        if (raw.shop_address !== undefined) dbPayload.shop_address = raw.shop_address?.trim() || null;
        if (raw.purchase_date !== undefined) dbPayload.purchase_date = raw.purchase_date || null;

        // Execute database update
        const result = await dbUpdate('inventory', filterKey, id, dbPayload);

        // Update persistent extended metadata
        if (productCode) {
            const metaUpdate = {};
            if (raw.cost_price !== undefined) metaUpdate.cost_price = parseFloat(raw.cost_price) || 0;
            if (raw.compare_at_price !== undefined) metaUpdate.compare_at_price = parseFloat(raw.compare_at_price) || 0;
            if (raw.low_stock_threshold !== undefined) metaUpdate.low_stock_threshold = parseInt(raw.low_stock_threshold, 10) || 3;
            if (raw.status !== undefined) metaUpdate.status = raw.status;
            if (raw.short_description !== undefined) metaUpdate.short_description = raw.short_description?.trim() || '';
            if (raw.material !== undefined) metaUpdate.material = raw.material?.trim() || '925 Sterling Silver';
            if (raw.purity !== undefined) metaUpdate.purity = raw.purity?.trim() || '92.5%';
            if (raw.gst !== undefined) metaUpdate.gst = parseFloat(raw.gst) || 3;
            if (raw.slug !== undefined) metaUpdate.slug = raw.slug?.trim() || null;
            if (raw.seo_title !== undefined) metaUpdate.seo_title = raw.seo_title?.trim() || null;
            if (raw.seo_description !== undefined) metaUpdate.seo_description = raw.seo_description?.trim() || null;
            if (raw.catalog_type !== undefined) metaUpdate.catalog_type = raw.catalog_type;
            if (raw.fabric !== undefined) metaUpdate.fabric = raw.fabric?.trim() || null;
            if (raw.color !== undefined) metaUpdate.color = raw.color?.trim() || null;
            if (raw.pattern !== undefined) metaUpdate.pattern = raw.pattern?.trim() || null;
            if (raw.border_style !== undefined) metaUpdate.border_style = raw.border_style?.trim() || null;
            if (raw.design !== undefined) metaUpdate.design = raw.design?.trim() || null;
            if (raw.occasion_slug !== undefined) metaUpdate.occasion_slug = raw.occasion_slug;
            if (raw.occasion_category !== undefined) metaUpdate.occasion_category = raw.occasion_category;
            if (raw.occasion_featured !== undefined) metaUpdate.occasion_featured = Boolean(raw.occasion_featured);
            if (raw.matching_tags !== undefined) metaUpdate.matching_tags = raw.matching_tags?.trim() || null;

            saveProductMeta(productCode, metaUpdate);
        }

        // Fetch fresh product from database to verify persistence
        const freshList = await dbQuery('inventory', `${filterKey}=eq.${encodeURIComponent(id)}&limit=1`).catch(() => []);
        const metaMap = loadAllProductMeta();
        const enriched = enrichProduct(freshList[0] || result.data || { ...raw, product_code: productCode }, metaMap);

        return res.json({
            success: true,
            message: `Product '${productCode || id}' updated successfully.`,
            data: enriched,
            omittedColumns: result.omittedColumns
        });
    } catch (err) {
        console.error('[API Product PATCH Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'PRODUCT_UPDATE_FAILED', message: err.message || 'Unable to update product' }
        });
    }
}

/**
 * DELETE /api/products/:id
 */
export async function handleDeleteProduct(req, res) {
    try {
        const { id } = req.params;
        const { hardDelete } = req.query;

        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Product ID or SKU is required' } });
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const filterKey = isUuid ? 'id' : 'product_code';

        if (hardDelete === 'true') {
            await dbDelete('inventory', filterKey, id);
            return res.json({ success: true, message: `Product '${id}' permanently deleted.` });
        } else {
            // Default soft archive
            const metaMap = loadAllProductMeta();
            saveProductMeta(id, { status: 'Archived' });
            return res.json({ success: true, message: `Product '${id}' archived successfully.` });
        }
    } catch (err) {
        console.error('[API Product DELETE Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'PRODUCT_DELETE_FAILED', message: err.message || 'Unable to delete product' }
        });
    }
}

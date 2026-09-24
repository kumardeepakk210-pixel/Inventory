// ==============================================================================
// WISHRITE INVENTORY — OCCASIONS & OCCASION INVENTORY API CONTROLLER
// Central Admin Control Center for public.occasion_inventory & public.occasion_settings
// Customer Website Compatibility Guaranteed: Reads & writes existing tables
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbInsert, dbUpdate, dbDelete } from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OCCASIONS_STORE_PATH = path.join(__dirname, '../data/occasions_store.json');
const OCCASION_PRODUCTS_STORE_PATH = path.join(__dirname, '../data/occasion_products_store.json');

// Standard supported occasions (Section T)
export const DEFAULT_OCCASIONS = [
    {
        slug: 'durga-puja',
        name: 'Durga Puja',
        hero_eyebrow: 'Divine Radiance',
        hero_heading: 'Durga Puja Royal Collection',
        hero_english_heading: 'Divine Festive Elegance',
        hero_description: 'Pure 925 Hallmarked Silver Jewellery & Royal Festive Weaves for Sharadotsav.',
        hero_cta_text: 'Explore Durga Puja Edits',
        badge_text: 'FESTIVE EDIT',
        theme_bg: '#5E3435',
        countdown_enabled: true,
        countdown_target: '2026-10-18T00:00:00+05:30',
        seo_title: 'Durga Puja Silver Jewellery & Sarees | WishRite',
        seo_description: 'Celebrate Durga Puja with divine pure silver jewellery and royal weaves from WishRite.'
    },
    {
        slug: 'kali-puja',
        name: 'Kali Puja',
        hero_eyebrow: 'Divine Power & Elegance',
        hero_heading: 'Kali Puja Sparkle & Radiance',
        hero_english_heading: 'Auspicious Silver Creations',
        hero_description: 'Auspicious Silver and Divine Weaves crafted to honour the festival of lights.',
        hero_cta_text: 'Discover Kali Puja Jewels',
        badge_text: 'DIVINE COLLECTION',
        theme_bg: '#1e1b4b',
        countdown_enabled: false,
        seo_title: 'Kali Puja Silver Jewellery | WishRite Pure Silver',
        seo_description: 'Explore auspicious silver jewellery for Kali Puja celebrations.'
    },
    {
        slug: 'diwali',
        name: 'Diwali',
        hero_eyebrow: 'Festival of Lights',
        hero_heading: 'Diwali Grand Festivities',
        hero_english_heading: 'Laxmi Puja Auspicious Silver',
        hero_description: 'Pure 925 Silver Gifts, Coins, Utensils & Handcrafted Jewellery for prosperity.',
        hero_cta_text: 'Shop Diwali Splendour',
        badge_text: 'PROSPERITY EDIT',
        theme_bg: '#78350f',
        countdown_enabled: true,
        countdown_target: '2026-11-08T00:00:00+05:30',
        seo_title: 'Diwali Pure Silver Gifts & Jewellery | WishRite',
        seo_description: 'Celebrate Diwali with authentic hallmarked silver jewellery, coins, and gifts.'
    },
    {
        slug: 'christmas',
        name: 'Christmas',
        hero_eyebrow: 'Holiday Sparkle',
        hero_heading: 'Christmas & Winter Glamour',
        hero_english_heading: 'Holiday Elegance & Joy',
        hero_description: 'Timeless luxury and sparkling gifts to celebrate joy and wonder.',
        hero_cta_text: 'Explore Holiday Gifts',
        badge_text: 'HOLIDAY SPECIAL',
        theme_bg: '#14532d',
        countdown_enabled: false,
        seo_title: 'Christmas Silver Jewellery Gifts | WishRite',
        seo_description: 'Timeless luxury silver jewellery gifts for Christmas and the holiday season.'
    },
    {
        slug: 'valentines-day',
        name: "Valentine's Day",
        hero_eyebrow: 'Forever Love',
        hero_heading: 'The Love & Elegance Edit',
        hero_english_heading: 'Heartfelt Keepsakes',
        hero_description: 'Romantic Silver Jewellery and Keepsakes designed to celebrate everlasting love.',
        hero_cta_text: 'Explore Romantic Gifts',
        badge_text: 'LOVE COLLECTION',
        theme_bg: '#831843',
        countdown_enabled: false,
        seo_title: "Valentine's Day Silver Jewellery | WishRite",
        seo_description: 'Find romantic silver rings, pendants, and bracelets for your special one.'
    },
    {
        slug: 'wedding',
        name: 'Wedding',
        hero_eyebrow: 'The Royal Trousseau',
        hero_heading: 'Bridal & Trousseau Collection',
        hero_english_heading: 'Regal Wedding Splendour',
        hero_description: 'Kanjivaram Silk Sarees, Kundan Sets & Hallmarked 925 Silver Bridal Elegance.',
        hero_cta_text: 'Shop Bridal Edit',
        badge_text: 'BRIDAL EXCLUSIVE',
        theme_bg: '#581c87',
        countdown_enabled: false,
        seo_title: 'Wedding & Bridal Silver Jewellery | WishRite',
        seo_description: 'Royal bridal silver jewellery and wedding gifts crafted with perfection.'
    },
    {
        slug: 'holi',
        name: 'Holi',
        hero_eyebrow: 'Colors of Celebration',
        hero_heading: 'Vibrant Festive Hues',
        hero_english_heading: 'Joyful Spring Expressions',
        hero_description: 'Celebratory collections crafted to shine through vibrant festive moments.',
        hero_cta_text: 'Explore Holi Specials',
        badge_text: 'SPRING FESTIVAL',
        theme_bg: '#047857',
        countdown_enabled: false,
        seo_title: 'Holi Festive Silver Jewellery | WishRite',
        seo_description: 'Shine this Holi with vibrant handcrafted silver pieces.'
    },
    {
        slug: 'eid',
        name: 'Eid',
        hero_eyebrow: 'Crescent Moon Splendour',
        hero_heading: 'Eid Celebrations Collection',
        hero_english_heading: 'Blessings & Grace',
        hero_description: 'Fine filigree silver, chandbali earrings, and festive statements for Eid.',
        hero_cta_text: 'Shop Eid Collection',
        badge_text: 'EID EDIT',
        theme_bg: '#065f46',
        countdown_enabled: false,
        seo_title: 'Eid Silver Jewellery & Gifts | WishRite',
        seo_description: 'Celebrate Eid with fine filigree silver jewellery and timeless designs.'
    },
    {
        slug: 'other',
        name: 'Special Occasion',
        hero_eyebrow: 'Exclusive Edits',
        hero_heading: 'Special Celebrations Edit',
        hero_english_heading: 'Curated Elegance',
        hero_description: 'Handcrafted luxury pieces curated for unforgettable moments.',
        hero_cta_text: 'Explore Collection',
        badge_text: 'SPECIAL EDIT',
        theme_bg: '#334155',
        countdown_enabled: false,
        seo_title: 'Special Celebrations Jewellery | WishRite',
        seo_description: 'Curated luxury silver jewellery for life’s special celebrations.'
    }
];

function loadLocalOccasions() {
    try {
        if (fs.existsSync(OCCASIONS_STORE_PATH)) {
            const raw = fs.readFileSync(OCCASIONS_STORE_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {}
    return [...DEFAULT_OCCASIONS];
}

function saveLocalOccasions(list) {
    try {
        const dir = path.dirname(OCCASIONS_STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(OCCASIONS_STORE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Occasions Store Error]:', e.message);
    }
}

function loadLocalOccasionProducts() {
    try {
        if (fs.existsSync(OCCASION_PRODUCTS_STORE_PATH)) {
            const raw = fs.readFileSync(OCCASION_PRODUCTS_STORE_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {}
    return [];
}

function saveLocalOccasionProducts(list) {
    try {
        const dir = path.dirname(OCCASION_PRODUCTS_STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(OCCASION_PRODUCTS_STORE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Occasion Products Store Error]:', e.message);
    }
}

/**
 * GET /api/occasions
 */
export async function handleGetOccasions(req, res) {
    try {
        const occasions = loadLocalOccasions();
        return res.json({
            success: true,
            count: occasions.length,
            data: occasions
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASIONS_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * GET /api/occasions/active
 */
export async function handleGetActiveOccasion(req, res) {
    try {
        let activeSlug = 'durga-puja';
        let isLive = false;

        try {
            const rows = await dbQuery('occasion_settings', 'is_active=eq.true&limit=1');
            if (rows && rows[0]) {
                activeSlug = rows[0].occasion_slug || activeSlug;
                isLive = true;
            }
        } catch (e) {}

        const occasions = loadLocalOccasions();
        const active = occasions.find(o => o.slug === activeSlug) || occasions[0];

        return res.json({
            success: true,
            data: {
                ...active,
                is_live: isLive
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'ACTIVE_OCCASION_FAILED', message: err.message }
        });
    }
}

/**
 * POST /api/occasions
 * Update occasion rich hero, countdown, background configuration
 */
export async function handleSaveOccasion(req, res) {
    try {
        const raw = req.body || {};
        const slug = (raw.slug || req.params.id || '').toLowerCase().trim();
        if (!slug) {
            return res.status(400).json({ success: false, error: { message: 'Occasion slug is required' } });
        }

        const list = loadLocalOccasions();
        const idx = list.findIndex(o => o.slug === slug);
        const updated = {
            slug,
            name: raw.name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            hero_eyebrow: raw.hero_eyebrow || null,
            hero_heading: raw.hero_heading || null,
            hero_english_heading: raw.hero_english_heading || null,
            hero_description: raw.hero_description || null,
            hero_cta_text: raw.hero_cta_text || 'Explore Festive Edits',
            hero_image_url: raw.hero_image_url || null,
            bg_artwork_url: raw.bg_artwork_url || null,
            bg_artwork_opacity: raw.bg_artwork_opacity !== undefined ? Number(raw.bg_artwork_opacity) : 0.15,
            bg_artwork_position: raw.bg_artwork_position || 'center',
            countdown_enabled: Boolean(raw.countdown_enabled),
            countdown_target: raw.countdown_target || null,
            badge_text: raw.badge_text || null,
            theme_bg: raw.theme_bg || '#5E3435',
            seo_title: raw.seo_title || null,
            seo_description: raw.seo_description || null,
            updated_at: new Date().toISOString()
        };

        if (idx >= 0) {
            list[idx] = { ...list[idx], ...updated };
        } else {
            list.push(updated);
        }

        saveLocalOccasions(list);

        return res.json({
            success: true,
            message: `Occasion '${updated.name}' configuration saved successfully.`,
            data: updated
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASION_SAVE_FAILED', message: err.message }
        });
    }
}

// ==============================================================================
// OCCASION PRODUCTS CRUD (public.occasion_inventory)
// ==============================================================================

/**
 * GET /api/occasions/products
 * Fetch products from public.occasion_inventory
 */
export async function handleGetOccasionProducts(req, res) {
    try {
        const { occasion_slug, category, type, stock, search } = req.query;

        let dbProducts = [];
        try {
            dbProducts = await dbQuery('occasion_inventory', 'order=created_at.desc');
        } catch (dbErr) {
            console.warn('[Occasion Products API] DB read notice:', dbErr.message);
        }

        // Merge with local persistent store if DB has 0 items
        const localProducts = loadLocalOccasionProducts();
        const combined = Array.isArray(dbProducts) && dbProducts.length > 0 ? dbProducts : localProducts;

        let filtered = combined;

        if (occasion_slug && occasion_slug !== 'all') {
            filtered = filtered.filter(p => p.occasion_slug === occasion_slug);
        }

        if (category && category !== 'all') {
            filtered = filtered.filter(p => {
                if (p.category === category) return true;
                if (category === 'Festive Sarees' && p.category && p.category.toLowerCase().includes('saree')) return true;
                if (category === 'Statement Jewellery' && p.category && (p.category.toLowerCase().includes('jewel') || p.category.toLowerCase().includes('statement'))) return true;
                if (category === 'Silver Pairings' && p.category && p.category.toLowerCase().includes('silver')) return true;
                return false;
            });
        }

        if (stock) {
            if (stock === 'in') filtered = filtered.filter(p => (Number(p.stock_quantity) || 0) > 0);
            if (stock === 'out') filtered = filtered.filter(p => (Number(p.stock_quantity) || 0) === 0);
            if (stock === 'low') filtered = filtered.filter(p => {
                const s = Number(p.stock_quantity) || 0;
                return s > 0 && s <= 3;
            });
        }

        if (search) {
            const s = search.toLowerCase().trim();
            filtered = filtered.filter(p => 
                (p.product_code && p.product_code.toLowerCase().includes(s)) ||
                (p.product_name && p.product_name.toLowerCase().includes(s)) ||
                (p.category && p.category.toLowerCase().includes(s)) ||
                (p.fabric && p.fabric.toLowerCase().includes(s))
            );
        }

        return res.json({
            success: true,
            count: filtered.length,
            total: combined.length,
            data: filtered
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASION_PRODUCTS_FETCH_FAILED', message: err.message }
        });
    }
}

/**
 * GET /api/occasions/counts
 * Returns verified counts for categories: All Festive, Festive Sarees, Statement Jewellery, Silver Pairings
 */
export async function handleGetOccasionCounts(req, res) {
    try {
        let dbProducts = [];
        try {
            dbProducts = await dbQuery('occasion_inventory', '');
        } catch (e) {}

        const localProducts = loadLocalOccasionProducts();
        const items = Array.isArray(dbProducts) && dbProducts.length > 0 ? dbProducts : localProducts;

        const counts = {
            all: items.length,
            sarees: 0,
            statement_jewellery: 0,
            silver_pairings: 0,
            in_stock: 0,
            low_stock: 0,
            out_of_stock: 0
        };

        items.forEach(item => {
            const cat = (item.category || '').toLowerCase();
            const stock = Number(item.stock_quantity) || 0;

            if (cat.includes('saree')) counts.sarees++;
            else if (cat.includes('jewel') || cat.includes('statement') || cat.includes('kundan')) counts.statement_jewellery++;
            else if (cat.includes('silver')) counts.silver_pairings++;
            else counts.statement_jewellery++;

            if (stock === 0) counts.out_of_stock++;
            else if (stock <= 3) counts.low_stock++;
            else counts.in_stock++;
        });

        return res.json({
            success: true,
            data: counts
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/occasions/products
 * Create product in public.occasion_inventory
 */
export async function handleCreateOccasionProduct(req, res) {
    try {
        const raw = req.body || {};
        if (!raw.product_code || !raw.product_name) {
            return res.status(400).json({
                success: false,
                error: { message: 'Product Code (SKU) and Product Name are required' }
            });
        }

        const code = String(raw.product_code).trim().toUpperCase();
        const payload = {
            product_code: code,
            product_name: String(raw.product_name).trim(),
            product_description: raw.product_description?.trim() || null,
            category: String(raw.category || 'Festive Sarees').trim(),
            fabric: raw.fabric?.trim() || null,
            pattern: raw.pattern?.trim() || null,
            weight: raw.weight ? parseFloat(raw.weight) : null,
            selling_price: parseFloat(raw.selling_price) || 0,
            purchase_price: parseFloat(raw.cost_price || raw.purchase_price) || 0,
            discount: parseFloat(raw.discount) || 0,
            stock_quantity: parseInt(raw.stock_quantity, 10) || 0,
            occasion_slug: raw.occasion_slug || 'durga-puja',
            status: raw.status || ((parseInt(raw.stock_quantity, 10) || 0) > 0 ? 'Active' : 'Out of Stock'),
            is_featured: Boolean(raw.is_featured),
            purchase_date: raw.purchase_date || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        let result = null;
        try {
            result = await dbInsert('occasion_inventory', payload);
        } catch (dbErr) {
            console.warn('[Occasion Product POST] DB insert notice:', dbErr.message);
        }

        // Always save to local store as backup
        const list = loadLocalOccasionProducts();
        list.unshift(result?.data || payload);
        saveLocalOccasionProducts(list);

        return res.status(201).json({
            success: true,
            message: `Occasion product '${payload.product_name}' (${payload.product_code}) created successfully.`,
            data: result?.data || payload
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASION_PRODUCT_CREATE_FAILED', message: err.message }
        });
    }
}

/**
 * PATCH /api/occasions/products/:id
 * Update product in public.occasion_inventory
 */
export async function handleUpdateOccasionProduct(req, res) {
    try {
        const { id } = req.params;
        const raw = req.body || {};

        if (!id) {
            return res.status(400).json({ success: false, error: { message: 'Product ID or SKU is required' } });
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const filterKey = isUuid ? 'id' : 'product_code';

        const updatePayload = {
            ...raw,
            updated_at: new Date().toISOString()
        };

        let result = null;
        try {
            result = await dbUpdate('occasion_inventory', filterKey, id, updatePayload);
        } catch (dbErr) {
            console.warn('[Occasion Product PATCH] DB update notice:', dbErr.message);
        }

        // Update local store
        const list = loadLocalOccasionProducts();
        const idx = list.findIndex(p => p.id === id || p.product_code === id);
        if (idx >= 0) {
            list[idx] = { ...list[idx], ...updatePayload };
            saveLocalOccasionProducts(list);
        }

        return res.json({
            success: true,
            message: `Occasion product '${id}' updated successfully.`,
            data: result?.data || updatePayload
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASION_PRODUCT_UPDATE_FAILED', message: err.message }
        });
    }
}

/**
 * DELETE /api/occasions/products/:id
 */
export async function handleDeleteOccasionProduct(req, res) {
    try {
        const { id } = req.params;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const filterKey = isUuid ? 'id' : 'product_code';

        try {
            await dbDelete('occasion_inventory', filterKey, id);
        } catch (dbErr) {
            console.warn('[Occasion Product DELETE] DB notice:', dbErr.message);
        }

        const list = loadLocalOccasionProducts();
        const filtered = list.filter(p => p.id !== id && p.product_code !== id);
        saveLocalOccasionProducts(filtered);

        return res.json({ success: true, message: `Occasion product '${id}' deleted successfully.` });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'OCCASION_PRODUCT_DELETE_FAILED', message: err.message }
        });
    }
}

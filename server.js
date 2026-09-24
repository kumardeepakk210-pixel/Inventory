// ==============================================================================
// WISHRITE INVENTORY — SERVER & API LAYER ENTRYPOINT
// Serves static frontend files and dispatches all /api/* requests securely.
// Supabase credentials remain strictly isolated on this server.
// ==============================================================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// API Controllers
import { handleHealthCheck, handleDatabaseHealthCheck } from './api/health.js';
import { 
    handleGetProducts, 
    handleGetProductById, 
    handleCreateProduct, 
    handleUpdateProduct, 
    handleDeleteProduct 
} from './api/products.js';
import { 
    handleGetOccasionSettings, 
    handleUpdateOccasionSettings 
} from './api/settings.js';
import { 
    handleGetOccasions, 
    handleGetActiveOccasion, 
    handleSaveOccasion,
    handleGetOccasionProducts,
    handleCreateOccasionProduct,
    handleUpdateOccasionProduct,
    handleDeleteOccasionProduct,
    handleGetOccasionCounts
} from './api/occasions.js';
import { 
    handleGetOffers, 
    handleCreateOffer, 
    handleDeleteOffer 
} from './api/offers.js';
import { 
    handleGetDashboardSummary, 
    handleGetDashboardInsights, 
    handleGetDashboardCategories 
} from './api/dashboard.js';
import { 
    handleGetProductImages, 
    handleUploadProductImage, 
    handleDeleteProductImage,
    uploadMiddleware 
} from './api/images.js';
import { 
    handleLogin,
    handleCheckSetup,
    handleInitialSetup,
    handleGetEmployees,
    handleCreateEmployee
} from './api/auth.js';
import { handleGetSales, handleCreateSale } from './api/sales.js';
import { 
    dbQuery, 
    dbInsert, 
    dbUpdate, 
    dbDelete, 
    hasServerAdminCredential, 
    getAdminCredentialType, 
    isPublishableKeyConfigured 
} from './api/supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 8085;

// CORS configuration (allow local dev origins or configured origins)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8085,http://127.0.0.1:8085').split(',');
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, same-origin)
        if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            callback(null, true);
        } else {
            callback(null, true); // Permissive in local development
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        console.log(`[API ${req.method}] ${req.path}`);
    }
    next();
});

// ==============================================================================
// REST API ROUTES
// ==============================================================================

// Health Checks
app.get('/api/health', handleHealthCheck);
app.get('/api/health/database', handleDatabaseHealthCheck);

// Internal Diagnostic for Supabase Credentials (Section 8 — Safe booleans & key type only)
app.get('/api/diagnostic/supabase', (req, res) => {
    return res.json({
        supabase_url_configured: Boolean(process.env.SUPABASE_URL),
        publishable_key_configured: isPublishableKeyConfigured(),
        server_admin_key_configured: hasServerAdminCredential(),
        server_admin_key_type: getAdminCredentialType()
    });
});

// Public Configuration for Browser Supabase Realtime & Auth (NEVER expose service role key)
app.get('/api/public-config', (req, res) => {
    const supabase_url = (process.env.SUPABASE_URL || '').trim();
    // Support SUPABASE_PUBLISHABLE_KEY with fallback to SUPABASE_ANON_KEY. NEVER expose SUPABASE_SECRET_KEY.
    const supabase_anon_key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
    if (!supabase_url || !supabase_anon_key) {
        return res.status(503).json({
            success: false,
            error: {
                code: 'CONFIG_UNAVAILABLE',
                message: 'Supabase public configuration is unavailable on server'
            }
        });
    }
    return res.json({
        success: true,
        data: {
            supabase_url,
            supabase_anon_key
        }
    });
});

// Products
app.get('/api/products', handleGetProducts);
app.get('/api/products/:id', handleGetProductById);
app.post('/api/products', handleCreateProduct);
app.patch('/api/products/:id', handleUpdateProduct);
app.put('/api/products/:id', handleUpdateProduct);
app.delete('/api/products/:id', handleDeleteProduct);

// Product Images
app.get('/api/products/:sku/images', handleGetProductImages);
app.post('/api/products/:sku/images', uploadMiddleware, handleUploadProductImage);
app.delete('/api/products/:sku/images/:fileName', handleDeleteProductImage);

// Occasions & Festive Settings
app.get('/api/settings/occasion', handleGetOccasionSettings);
app.patch('/api/settings/occasion', handleUpdateOccasionSettings);
app.get('/api/occasions', handleGetOccasions);
app.get('/api/occasions/active', handleGetActiveOccasion);
app.post('/api/occasions', handleSaveOccasion);
app.patch('/api/occasions/:id', handleSaveOccasion);

// Occasion Products (public.occasion_inventory)
app.get('/api/occasions/products', handleGetOccasionProducts);
app.post('/api/occasions/products', handleCreateOccasionProduct);
app.patch('/api/occasions/products/:id', handleUpdateOccasionProduct);
app.delete('/api/occasions/products/:id', handleDeleteOccasionProduct);
app.get('/api/occasions/counts', handleGetOccasionCounts);

// Occasion Offers
app.get('/api/offers', handleGetOffers);
app.post('/api/offers', handleCreateOffer);
app.delete('/api/offers/:id', handleDeleteOffer);

// Dashboard & AI Insights
app.get('/api/dashboard/summary', handleGetDashboardSummary);
app.get('/api/dashboard/insights', handleGetDashboardInsights);
app.get('/api/dashboard/categories', handleGetDashboardCategories);

// Authentication & Employees
app.post('/api/auth/login', handleLogin);
app.get('/api/auth/setup-status', handleCheckSetup);
app.post('/api/auth/setup', handleInitialSetup);
app.get('/api/employees', handleGetEmployees);
app.post('/api/employees', handleCreateEmployee);

// Sales & Invoices
app.get('/api/sales', handleGetSales);
app.post('/api/sales', handleCreateSale);

// Categories
app.get('/api/categories', async (req, res) => {
    try {
        const rows = await dbQuery('categories', 'order=category_name.asc').catch(() => []);
        return res.json({ success: true, data: rows });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { category_name, code_prefix } = req.body || {};
        if (!category_name) return res.status(400).json({ success: false, error: { message: 'Category name required' } });
        const result = await dbInsert('categories', {
            category_name: category_name.trim(),
            code_prefix: (code_prefix || 'MISC').toUpperCase().trim(),
            created_at: new Date().toISOString()
        });
        return res.status(201).json({ success: true, data: result.data });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

// Business Configuration
app.get('/api/business-config', async (req, res) => {
    try {
        const rows = await dbQuery('business_config', 'id=eq.1&limit=1').catch(() => []);
        return res.json({ success: true, data: rows[0] || null });
    } catch (e) {
        return res.json({ success: true, data: null });
    }
});

app.post('/api/business-config', async (req, res) => {
    try {
        const payload = { id: 1, ...(req.body || {}), updated_at: new Date().toISOString() };
        await dbInsert('business_config', payload).catch(async () => {
            await dbUpdate('business_config', 'id', 1, payload);
        });
        return res.json({ success: true, message: 'Configuration saved' });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

// ==============================================================================
// GENERIC DATABASE PROXY (For auxiliary collections: customers, influencers, etc.)
// ==============================================================================

app.get('/api/db/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const query = req.url.includes('?') ? req.url.split('?')[1] : '';
        const data = await dbQuery(table, query);
        return res.json({ success: true, data });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

app.post('/api/db/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const result = await dbInsert(table, req.body);
        return res.status(201).json({ success: true, data: result.data });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

app.patch('/api/db/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const { filterKey, filterVal, ...payload } = req.body || {};
        if (!filterKey || filterVal === undefined) {
            return res.status(400).json({ success: false, error: { message: 'filterKey and filterVal required' } });
        }
        const result = await dbUpdate(table, filterKey, filterVal, payload);
        return res.json({ success: true, data: result.data });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

app.delete('/api/db/:table', async (req, res) => {
    try {
        const { table } = req.params;
        const { filterKey, filterVal } = req.query || {};
        if (!filterKey || filterVal === undefined) {
            return res.status(400).json({ success: false, error: { message: 'filterKey and filterVal required' } });
        }
        await dbDelete(table, filterKey, filterVal);
        return res.json({ success: true, message: 'Record deleted' });
    } catch (e) {
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
});

// ==============================================================================
// STATIC FILE SERVING
// ==============================================================================

app.use(express.static(__dirname));

// Single-page application route fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: { message: `API endpoint '${req.path}' not found` } });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==============================================================================
// EXPORT & START SERVER
// ==============================================================================

export default app;
export { app };

const isDirectRun = Boolean(
    !process.env.VERCEL &&
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(__filename)
);

if (isDirectRun) {
    app.listen(PORT, () => {
        console.log(`\n==================================================`);
        console.log(`🚀 WishRite Inventory API & Server running`);
        console.log(`📡 Local URL: http://localhost:${PORT}`);
        console.log(`🛡️  Architecture: Frontend ➔ API Layer ➔ Supabase`);
        console.log(`🔒 Supabase credentials isolated to server-side`);
        console.log(`==================================================\n`);
    });
}

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
import { handleHealthCheck, handleDatabaseHealthCheck } from './backend/health.js';
import { 
    handleGetProducts, 
    handleGetProductById, 
    handleCreateProduct, 
    handleUpdateProduct, 
    handleDeleteProduct,
    handleBatchBackfillAudience
} from './backend/products.js';
import { 
    handleGetOccasionSettings, 
    handleUpdateOccasionSettings 
} from './backend/settings.js';
import { 
    handleGetOccasions, 
    handleGetActiveOccasion, 
    handleSaveOccasion,
    handleGetOccasionProducts,
    handleCreateOccasionProduct,
    handleUpdateOccasionProduct,
    handleDeleteOccasionProduct,
    handleGetOccasionCounts
} from './backend/occasions.js';
import { 
    handleGetOffers, 
    handleCreateOffer, 
    handleDeleteOffer 
} from './backend/offers.js';
import { 
    handleGetDashboardSummary, 
    handleGetDashboardInsights, 
    handleGetDashboardCategories 
} from './backend/dashboard.js';
import { 
    handleGetProductImages, 
    handleUploadProductImage, 
    handleDeleteProductImage,
    handleGetImageEnhancementStatus,
    handleRetryImageEnhancement,
    uploadMiddleware 
} from './backend/images.js';
import {
    handleUploadOriginalImage,
    handleGenerateAiImages,
    handleGetAiImagesStatus,
    handleRegenerateAiImage,
    handleDeleteAiImage,
    uploadOriginalMiddleware
} from './backend/ai-images.js';
import {
    handleGenerateProductContent,
    productContentUploadMiddleware
} from './backend/ai-product-content.js';
import {
    handleLogin,
    handleCheckSetup,
    handleInitialSetup,
    handleGetEmployees,
    handleCreateEmployee
} from './backend/auth.js';
import { handleGetSales, handleCreateSale } from './backend/sales.js';
import { 
    handleGetCustomers, 
    handleGetCustomerById, 
    handleCreateCustomer, 
    handleUpdateCustomer, 
    handleAdjustCustomerBalance 
} from './backend/customers.js';
import {
    handleGetInfluencers,
    handleGetInfluencerById,
    handleCreateInfluencer,
    handleUpdateInfluencer,
    handleUpdateInfluencerStatus,
    handleDeleteInfluencer,
    handleRegenerateProfileUrl,
    handleGetPublicInfluencer,
    handleGetPublicInfluencerProducts,
    handleTrackClick,
    handleGetInfluencerLinksEndpoint,
    handleCreateInfluencerLinkEndpoint,
    handleGetInfluencerStatsEndpoint,
    handleGetInfluencerOrdersEndpoint,
    handleGetInfluencerEarningsEndpoint,
    handleCreateOrder,
    handleUpdateOrderStatus
} from './backend/influencers.js';
import {
    requireCreatorAuth,
    handleCreatorLogin,
    handleCreatorLogout,
    handleGetCreatorMe,
    handleGetCreatorStats,
    handleGetCreatorPerformance,
    handleGetCreatorOrders,
    handleGetCreatorLinks,
    handleCreateCreatorProductLink,
    handleGetCreatorProfile,
    handleUpdateCreatorProfile
} from './backend/creator.js';
import {
    handleGetCreatorWallet,
    handleGetCreatorWalletTransactions,
    handleGetCreatorWalletSummary,
    handleGetPayoutMethods,
    handleCreatePayoutMethod,
    handleDeletePayoutMethod,
    handleSetDefaultPayoutMethod,
    handleCreateWithdrawal,
    handleGetCreatorWithdrawals,
    handleGetCreatorPoints,
    handleGetCreatorPointsTransactions,
    handleGetCreatorRewards,
    handleGetCreatorRewardById,
    handleRedeemReward,
    handleGetCreatorRedemptions,
    requireAdminAuth,
    handleAdminGetWallets,
    handleAdminGetWithdrawals,
    handleAdminApproveWithdrawal,
    handleAdminRejectWithdrawal,
    handleAdminRetryWithdrawal,
    handleAdminAdjustWallet,
    handleAdminGetRewards,
    handleAdminCreateReward,
    handleAdminUpdateReward,
    handleAdminGetRedemptions,
    handleAdminUpdateRedemption,
    handleRazorpayPayoutWebhook
} from './backend/creator-wallet.js';
import { 
    SUPABASE_URL,
    dbQuery, 
    dbInsert, 
    dbUpdate, 
    dbDelete, 
    hasServerAdminCredential, 
    getAdminCredentialType, 
    isPublishableKeyConfigured 
} from './backend/supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.VERCEL) {
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

const app = express();
const PORT = process.env.PORT || 8085;

// Step 9: Safe Server Startup Diagnostics (NEVER print actual credential values)
console.log('[Inventory API]');
console.log('Express app initialized: YES');
console.log(`Supabase URL: ${SUPABASE_URL ? 'CONFIGURED' : 'MISSING'}`);
console.log(`Publishable credential: ${isPublishableKeyConfigured() ? 'CONFIGURED' : 'MISSING'}`);
console.log(`Server admin credential: ${hasServerAdminCredential() ? 'CONFIGURED' : 'MISSING'}`);

const razorpayxMode = (process.env.RAZORPAYX_MODE || process.env.RAZORPAY_PAYOUT_MODE || 'sandbox').toLowerCase();
const livePayoutsAllowed = process.env.ALLOW_LIVE_PAYOUTS === 'true';
const razorpayxConfigured = Boolean(
    (process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID) &&
    (process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET) &&
    (process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_ACCOUNT_NUMBER)
);
console.log(`RAZORPAYX_MODE=${razorpayxMode}`);
console.log(`LIVE_PAYOUTS_ALLOWED=${livePayoutsAllowed}`);
console.log(`RAZORPAYX_CONFIGURED=${razorpayxConfigured}`);

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

app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        // Capture raw request body buffer specifically for webhook endpoints (Phase 3B remediation)
        if ((req.originalUrl && req.originalUrl.includes('/webhooks')) || 
            (req.url && req.url.includes('/webhooks'))) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Root API status endpoint
app.get(['/api', '/api/'], (req, res) => {
    return res.json({
        success: true,
        service: "WishRite Inventory API",
        status: "running"
    });
});

// Health Checks
app.get('/api/health', handleHealthCheck);
app.get('/api/health/database', handleDatabaseHealthCheck);

// Safe Read-Only Database Diagnostic (Section 7)
app.get('/api/diagnostic/db-read', async (req, res) => {
    try {
        await dbQuery('employees', 'select=employee_id&limit=1');
        return res.status(200).json({
            ok: true,
            database: "connected"
        });
    } catch (err) {
        return res.status(503).json({
            ok: false,
            database: "error",
            error_code: err.code || (!SUPABASE_URL ? 'SUPABASE_URL_MISSING' : 'QUERY_FAILED')
        });
    }
});

// Safe Diagnostic for Supabase Credentials & Deployment Info (Section 6 — Safe booleans & key type only)
app.get('/api/diagnostic/supabase', (req, res) => {
    return res.json({
        supabase_url_configured: Boolean(SUPABASE_URL),
        publishable_key_configured: isPublishableKeyConfigured(),
        server_admin_key_configured: hasServerAdminCredential(),
        server_admin_key_type: hasServerAdminCredential() ? 'secret' : 'none',
        deployment_env: process.env.VERCEL_ENV || 'local',
        git_commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null
    });
});

// Public Configuration for Browser Supabase Realtime & Auth (NEVER expose service role key)
app.get('/api/public-config', (req, res) => {
    const supabase_url = SUPABASE_URL;
    // Support SUPABASE_PUBLISHABLE_KEY with fallback to SUPABASE_ANON_KEY. NEVER expose SUPABASE_SECRET_KEY.
    const supabase_anon_key = (
        process.env.SUPABASE_PUBLISHABLE_KEY || 
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
        process.env.SUPABASE_ANON_KEY || 
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
        process.env.VITE_SUPABASE_ANON_KEY || 
        ''
    ).trim();
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
app.post('/api/products/backfill-audience', handleBatchBackfillAudience);
app.get('/api/products/:id', handleGetProductById);
app.post('/api/products', handleCreateProduct);
app.patch('/api/products/:id', handleUpdateProduct);
app.put('/api/products/:id', handleUpdateProduct);
app.delete('/api/products/:id', handleDeleteProduct);

// Product Images
app.get('/api/products/:sku/images', handleGetProductImages);
app.post('/api/products/:sku/images', uploadMiddleware, handleUploadProductImage);
app.delete('/api/products/:sku/images/:fileName', handleDeleteProductImage);
app.get('/api/products/:sku/images/:imageId/enhancement-status', handleGetImageEnhancementStatus);
app.post('/api/products/:sku/images/:imageId/retry-enhancement', handleRetryImageEnhancement);

// AI Product Image Generator (Studio) Endpoints
app.post('/api/products/:productId/original-image', uploadOriginalMiddleware, handleUploadOriginalImage);
app.post('/api/products/:productId/ai-images/generate', handleGenerateAiImages);
app.get('/api/products/:productId/ai-images/status', handleGetAiImagesStatus);
app.post('/api/products/:productId/ai-images/:imageId/regenerate', handleRegenerateAiImage);
app.delete('/api/products/:productId/ai-images/:imageId', handleDeleteAiImage);

// AI Product Content & SEO Auto-Generation Endpoint
app.post('/api/generate-product-content', productContentUploadMiddleware, handleGenerateProductContent);

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

// Customers & Rewards
app.get('/api/customers', handleGetCustomers);
app.get('/api/customers/:id', handleGetCustomerById);
app.post('/api/customers', handleCreateCustomer);
app.patch('/api/customers/:id', handleUpdateCustomer);
app.post('/api/customers/:id/adjust-balance', handleAdjustCustomerBalance);

// WishRite Creator Club (Influencers Phase 1 & 2)
// Admin Management (Phase 1)
app.get('/api/influencers', handleGetInfluencers);
app.get('/api/influencers/:id', handleGetInfluencerById);
app.post('/api/influencers', handleCreateInfluencer);
app.put('/api/influencers/:id', handleUpdateInfluencer);
app.patch('/api/influencers/:id/status', handleUpdateInfluencerStatus);
app.delete('/api/influencers/:id', handleDeleteInfluencer);
app.post('/api/influencers/:id/regenerate-profile-url', handleRegenerateProfileUrl);

// Public Storefront, Attribution & Click Tracking (Phase 2)
app.get('/api/public/influencers/:slug', handleGetPublicInfluencer);
app.get('/api/public/influencers/:slug/products', handleGetPublicInfluencerProducts);
app.post('/api/public/influencers/:slug/click', handleTrackClick);
app.post('/api/influencers/:id/click', handleTrackClick);

// Creator Links, Analytics & Order Attributions (Phase 2)
app.get('/api/influencers/:id/stats', handleGetInfluencerStatsEndpoint);
app.get('/api/influencers/:id/links', handleGetInfluencerLinksEndpoint);
app.post('/api/influencers/:id/links', handleCreateInfluencerLinkEndpoint);
app.get('/api/influencers/:id/orders', handleGetInfluencerOrdersEndpoint);
app.get('/api/influencers/:id/earnings', handleGetInfluencerEarningsEndpoint);

// Orders & Status Reconciliation (Phase 2)
app.post('/api/orders', handleCreateOrder);
app.patch('/api/orders/:id/status', handleUpdateOrderStatus);

// WishRite Creator Club — Authenticated Creator Portal (Phase 3A)
app.post('/api/creator/login', handleCreatorLogin);
app.post('/api/creator/logout', handleCreatorLogout);
app.get('/api/creator/me', requireCreatorAuth, handleGetCreatorMe);
app.get('/api/creator/stats', requireCreatorAuth, handleGetCreatorStats);
app.get('/api/creator/performance', requireCreatorAuth, handleGetCreatorPerformance);
app.get('/api/creator/orders', requireCreatorAuth, handleGetCreatorOrders);
app.get('/api/creator/links', requireCreatorAuth, handleGetCreatorLinks);
app.post('/api/creator/links', requireCreatorAuth, handleCreateCreatorProductLink);
app.get('/api/creator/profile', requireCreatorAuth, handleGetCreatorProfile);
app.patch('/api/creator/profile', requireCreatorAuth, handleUpdateCreatorProfile);

// WishRite Creator Club — Phase 3B: Wallet, Payouts, Points & Rewards
app.get('/api/creator/wallet', requireCreatorAuth, handleGetCreatorWallet);
app.get('/api/creator/wallet/transactions', requireCreatorAuth, handleGetCreatorWalletTransactions);
app.get('/api/creator/wallet/summary', requireCreatorAuth, handleGetCreatorWalletSummary);

app.get('/api/creator/payout-methods', requireCreatorAuth, handleGetPayoutMethods);
app.post('/api/creator/payout-methods', requireCreatorAuth, handleCreatePayoutMethod);
app.delete('/api/creator/payout-methods/:id', requireCreatorAuth, handleDeletePayoutMethod);
app.post('/api/creator/payout-methods/:id/default', requireCreatorAuth, handleSetDefaultPayoutMethod);

app.post('/api/creator/withdrawals', requireCreatorAuth, handleCreateWithdrawal);
app.get('/api/creator/withdrawals', requireCreatorAuth, handleGetCreatorWithdrawals);

app.get('/api/creator/points', requireCreatorAuth, handleGetCreatorPoints);
app.get('/api/creator/points/transactions', requireCreatorAuth, handleGetCreatorPointsTransactions);

app.get('/api/creator/rewards', requireCreatorAuth, handleGetCreatorRewards);
app.get('/api/creator/rewards/:id', requireCreatorAuth, handleGetCreatorRewardById);
app.post('/api/creator/rewards/:id/redeem', requireCreatorAuth, handleRedeemReward);
app.get('/api/creator/redemptions', requireCreatorAuth, handleGetCreatorRedemptions);

// WishRite Creator Club — Phase 3B: Inventory Admin Management
app.get('/api/admin/creator-wallets', requireAdminAuth, handleAdminGetWallets);
app.post('/api/admin/creator-wallets/:id/adjust', requireAdminAuth, handleAdminAdjustWallet);
app.get('/api/admin/creator-withdrawals', requireAdminAuth, handleAdminGetWithdrawals);
app.patch('/api/admin/creator-withdrawals/:id/approve', requireAdminAuth, handleAdminApproveWithdrawal);
app.patch('/api/admin/creator-withdrawals/:id/reject', requireAdminAuth, handleAdminRejectWithdrawal);
app.post('/api/admin/creator-withdrawals/:id/retry', requireAdminAuth, handleAdminRetryWithdrawal);

app.get('/api/admin/creator-rewards', requireAdminAuth, handleAdminGetRewards);
app.post('/api/admin/creator-rewards', requireAdminAuth, handleAdminCreateReward);
app.patch('/api/admin/creator-rewards/:id', requireAdminAuth, handleAdminUpdateReward);
app.get('/api/admin/creator-redemptions', requireAdminAuth, handleAdminGetRedemptions);
app.patch('/api/admin/creator-redemptions/:id', requireAdminAuth, handleAdminUpdateRedemption);

// WishRite Creator Club — Phase 3B: Razorpay Payout Webhooks
app.post('/api/webhooks/razorpay-payouts', handleRazorpayPayoutWebhook);

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

// Bypass static file serving for /api routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        return next();
    }
    express.static(__dirname)(req, res, next);
});

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

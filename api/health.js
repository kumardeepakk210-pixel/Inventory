// ==============================================================================
// WISHRITE INVENTORY — HEALTH CHECK API CONTROLLER
// Validates API operational status and database connection health.
// ==============================================================================

import { dbQuery } from './supabase-client.js';

/**
 * GET /api/health
 * Step 5: Minimal standalone health endpoint (MUST NOT call Supabase)
 */
export function handleHealthCheck(req, res) {
    return res.status(200).json({
        ok: true,
        service: "inventory-api",
        runtime: "vercel"
    });
}

/**
 * GET /api/health/database
 */
export async function handleDatabaseHealthCheck(req, res) {
    try {
        const start = Date.now();
        const testRows = await dbQuery('inventory', 'select=id&limit=1');
        const latencyMs = Date.now() - start;

        return res.json({
            success: true,
            service: "WishRite Inventory API",
            database: "connected",
            latency_ms: latencyMs,
            status: "healthy",
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        return res.status(503).json({
            success: false,
            service: "WishRite Inventory API",
            database: "disconnected",
            error: {
                message: "Unable to reach database service"
            },
            status: "degraded",
            timestamp: new Date().toISOString()
        });
    }
}

// Standalone Vercel Serverless Function entry point
export default function handler(req, res) {
    return handleHealthCheck(req, res);
}

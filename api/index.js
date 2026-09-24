// ==============================================================================
// WISHRITE INVENTORY — VERCEL SERVERLESS ENTRYPOINT
// Exposes the existing Express application as a Vercel Serverless Function.
// Supports all /api/* routes seamlessly in production.
// ==============================================================================

import app from '../server.js';

export default function handler(req, res) {
    // If request URL was rewritten by Vercel without the /api prefix,
    // ensure /api is preserved so Express route matching succeeds.
    if (req.url && !req.url.startsWith('/api')) {
        req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
    return app(req, res);
}

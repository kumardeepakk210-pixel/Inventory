// ==============================================================================
// WISHRITE INVENTORY — VERCEL SERVERLESS ENTRYPOINT
// Exposes the existing Express application as a Vercel Serverless Function.
// Supports all /api/* routes seamlessly in production.
// ==============================================================================

import { app } from '../server.js';

export default function handler(req, res) {
    if (req.url && req.url.startsWith('/api/index.js')) {
        req.url = req.url.replace('/api/index.js', '/api') || '/api';
    }
    return app(req, res);
}

export { app };

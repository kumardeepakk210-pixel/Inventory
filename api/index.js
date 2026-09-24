// ==============================================================================
// WISHRITE INVENTORY — VERCEL SERVERLESS ENTRYPOINT
// Exposes the existing Express application as a Vercel Serverless Function.
// Supports all /api and /api/* routes seamlessly in production.
// ==============================================================================

import app from '../server.js';

export function normalizeVercelRequest(req) {
    // 1. If original invoke path header is provided by Vercel
    const invokePath = req.headers['x-invoke-path'];
    if (invokePath && typeof invokePath === 'string' && invokePath.startsWith('/api')) {
        req.url = invokePath;
        return;
    }

    // 2. If req.query.slug is provided by Vercel catch-all routing
    if (req.query && req.query.slug) {
        const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
        const subPath = slugParts.join('/');
        
        // Rebuild query parameters excluding 'slug'
        const searchParams = new URLSearchParams();
        for (const [key, val] of Object.entries(req.query)) {
            if (key !== 'slug') {
                if (Array.isArray(val)) {
                    val.forEach(v => searchParams.append(key, v));
                } else {
                    searchParams.append(key, val);
                }
            }
        }
        const qs = searchParams.toString();
        req.url = `/api/${subPath}` + (qs ? `?${qs}` : '');
        return;
    }

    // 3. Normalize req.url
    if (req.url) {
        if (req.url.startsWith('/api/index.js')) {
            req.url = req.url.replace('/api/index.js', '/api') || '/api';
        } else if (req.url.startsWith('/api/[...slug]')) {
            req.url = req.url.replace('/api/[...slug]', '/api') || '/api';
        } else if (!req.url.startsWith('/api')) {
            req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
        }
    }
}

export default function handler(req, res) {
    normalizeVercelRequest(req);
    return app(req, res);
}

// ==============================================================================
// WISHRITE CREATOR CLUB — PHASE 3A: CREATOR DASHBOARD & AUTHENTICATION
// Secure Authenticated Creator Experience, Session Resolution & Privacy Guard
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto, { randomUUID } from 'crypto';
import { 
    dbQuery, 
    dbInsert, 
    dbUpdate, 
    adminClient 
} from './supabase-client.js';
import { 
    buildInfluencerPublicUrl, 
    buildInfluencerProductUrl 
} from './influencers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const INFLUENCERS_STORE_PATH = path.join(DATA_DIR, 'influencers_store.json');

// In-memory active creator sessions (token -> { accountId, influencerId, expiresAt, createdAt })
const creatorSessions = new Map();

// Session duration: 7 days
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Rate limiting: max 5 failed attempts per 15 minutes per IP + identifier
const loginRateLimits = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Resets all login rate limit records (useful for test suites)
 */
export function resetLoginRateLimits() {
    loginRateLimits.clear();
}

/**
 * Checks if a key (IP:identifier) is currently locked out
 */
export function isLoginRateLimited(key) {
    if (!loginRateLimits.has(key)) return false;
    const record = loginRateLimits.get(key);
    if (record.lockedUntil && record.lockedUntil > Date.now()) {
        return true;
    }
    if (record.lockedUntil && record.lockedUntil <= Date.now()) {
        loginRateLimits.delete(key);
        return false;
    }
    return false;
}

/**
 * Records a failed login attempt; locks out after MAX_LOGIN_ATTEMPTS within RATE_LIMIT_WINDOW_MS
 */
export function recordFailedLogin(key) {
    const now = Date.now();
    const record = loginRateLimits.get(key) || { attempts: 0, firstAttempt: now, lockedUntil: null };

    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        record.attempts = 1;
        record.firstAttempt = now;
        record.lockedUntil = null;
    } else {
        record.attempts += 1;
    }

    if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_DURATION_MS;
    }

    loginRateLimits.set(key, record);
}

/**
 * Clears failed attempts upon successful login
 */
export function recordSuccessfulLogin(key) {
    loginRateLimits.delete(key);
}

/**
 * Validates HTTP or HTTPS URL, strictly rejecting javascript:, data:, etc.
 */
export function isValidHttpUrl(string) {
    if (!string || typeof string !== 'string') return false;
    try {
        const parsed = new URL(string);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Sanitizes plain text input by stripping HTML tags and executable protocols
 */
export function sanitizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]*>?/gm, '').replace(/javascript:/gi, '').trim();
}

/**
 * Hash password with PBKDF2 using cryptographically random per-user salt and 100,000 iterations
 * Stored format: pbkdf2:100000:<saltHex>:<hashHex>
 */
export function hashPassword(password, customSalt = null) {
    if (!password) return null;
    const salt = customSalt || crypto.randomBytes(16).toString('hex');
    const iterations = 100000;
    const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
    return `pbkdf2:${iterations}:${salt}:${hash}`;
}

/**
 * Timing-safe password verification supporting modern pbkdf2 format & legacy hashes
 */
export function verifyPassword(password, storedHash) {
    if (!password || !storedHash) return false;
    try {
        if (typeof storedHash === 'string' && storedHash.startsWith('pbkdf2:')) {
            const parts = storedHash.split(':');
            if (parts.length !== 4) return false;
            const iterations = parseInt(parts[1], 10);
            const salt = parts[2];
            const originalHash = parts[3];
            const testHash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');

            const origBuf = Buffer.from(originalHash, 'hex');
            const testBuf = Buffer.from(testHash, 'hex');
            if (origBuf.length !== testBuf.length) return false;
            return crypto.timingSafeEqual(origBuf, testBuf);
        } else if (typeof storedHash === 'string') {
            // Legacy 10,000-iteration static salt format verification with constant-time comparison
            const legacyHash = crypto.pbkdf2Sync(String(password), 'wishrite_creator_v3a_salt', 10000, 32, 'sha256').toString('hex');
            const origBuf = Buffer.from(storedHash, 'hex');
            const testBuf = Buffer.from(legacyHash, 'hex');
            if (origBuf.length !== testBuf.length) return false;
            return crypto.timingSafeEqual(origBuf, testBuf);
        }
    } catch (e) {
        return false;
    }
    return false;
}

/**
 * Reads local JSON backup store safely
 */
function readLocalStore() {
    if (process.env.NODE_ENV === 'test') {
        try {
            if (fs.existsSync(INFLUENCERS_STORE_PATH)) {
                const raw = fs.readFileSync(INFLUENCERS_STORE_PATH, 'utf-8');
                const data = JSON.parse(raw);
                return {
                    influencers: data.influencers || [],
                    accounts: data.accounts || [],
                    links: data.links || [],
                    stats: data.stats || [],
                    clicks: data.clicks || [],
                    attributions: data.attributions || [],
                    order_attributions: data.order_attributions || []
                };
            }
        } catch (e) {
            console.warn('[Creator API] Could not read influencers_store.json:', e.message);
        }
    }
    return {
        influencers: [],
        accounts: [],
        links: [],
        stats: [],
        clicks: [],
        attributions: [],
        order_attributions: []
    };
}

/**
 * Writes to local JSON backup store safely (test only)
 */
function writeLocalStore(store) {
    if (process.env.NODE_ENV !== 'test') return;
    try {
        fs.writeFileSync(INFLUENCERS_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Creator API] Could not write influencers_store.json:', e.message);
    }
}

/**
 * Finds or links an influencer account by ID or email
 */
export async function getOrLinkInfluencerAccount({ email, influencer_id, auth_user_id, password = null }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const local = readLocalStore();
    
    // Check if account already exists
    let account = local.accounts.find(a => 
        (cleanEmail && a.email && a.email.toLowerCase() === cleanEmail) ||
        (influencer_id && a.influencer_id === influencer_id) ||
        (auth_user_id && a.auth_user_id === auth_user_id)
    );

    if (account) {
        // If auth_user_id is provided and account has none, link it
        if (auth_user_id && !account.auth_user_id) {
            account.auth_user_id = auth_user_id;
            account.updated_at = new Date().toISOString();
            writeLocalStore(local);
            try {
                await dbUpdate('influencer_accounts', 'id', account.id, {
                    auth_user_id: account.auth_user_id,
                    updated_at: account.updated_at
                }, { useAdmin: true });
            } catch (e) {}
        }

        // If password was provided and account has no password_hash, set it
        if (password && !account.password_hash) {
            account.password_hash = hashPassword(password);
            account.updated_at = new Date().toISOString();
            writeLocalStore(local);
        }
        return account;
    }

    // Try finding creator in influencers table
    let creator = local.influencers.find(i => 
        (influencer_id && (i.influencer_id === influencer_id || i.id === influencer_id)) ||
        (cleanEmail && i.email && i.email.toLowerCase() === cleanEmail)
    );

    if (!creator) {
        // Try DB lookup using authoritative influencer_id or email with admin privileges
        try {
            const queryParam = cleanEmail 
                ? `email=eq.${encodeURIComponent(cleanEmail)}` 
                : `influencer_id=eq.${encodeURIComponent(influencer_id)}`;
            const rows = await dbQuery('influencers', queryParam, { useAdmin: true });
            if (Array.isArray(rows) && rows.length > 0) {
                const inf = rows[0];
                const infId = inf.influencer_id || inf.id;
                creator = { ...inf, influencer_id: infId, id: infId };
            }
        } catch (e) {
            // ignore
        }
    }

    if (!creator) {
        return null;
    }

    const canonicalInfluencerId = creator.influencer_id || creator.id;

    // Create new influencer_accounts record mapping auth_user_id -> influencer_id -> public.influencers.influencer_id
    const newAccount = {
        id: randomUUID(),
        influencer_id: canonicalInfluencerId,
        auth_user_id: auth_user_id || null,
        email: cleanEmail || creator.email || `${creator.public_slug || creator.influencer_code}@wishrite-creator.in`,
        password_hash: password ? hashPassword(password) : hashPassword('WishriteCreator2026!'),
        is_active: creator.status === 'active',
        last_login_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    local.accounts.push(newAccount);
    writeLocalStore(local);

    try {
        await dbInsert('influencer_accounts', newAccount, { useAdmin: true });
    } catch (e) {
        // Local persistence handles fallback
    }

    return newAccount;
}

/**
 * Creates an active creator session token
 */
export function issueCreatorSession(account, influencer) {
    const token = `crt_${randomUUID().replace(/-/g, '')}${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    
    creatorSessions.set(token, {
        accountId: account.id,
        influencerId: influencer.influencer_id || influencer.id,
        email: account.email,
        expiresAt,
        createdAt: Date.now()
    });

    return { token, expiresAt };
}

/**
 * Clears an active session
 */
export function revokeCreatorSession(token) {
    if (token && creatorSessions.has(token)) {
        creatorSessions.delete(token);
        return true;
    }
    return false;
}

/**
 * CORE AUTHORIZATION MIDDLEWARE: requireCreatorAuth
 * 
 * Extracts token from Authorization header or cookie.
 * Resolves creator account and canonical influencer record.
 * Rejects unauthorized requests, inactive accounts, or manipulated identities.
 */
export async function requireCreatorAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || req.headers['x-creator-token'] || '';
        let token = '';

        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else if (authHeader) {
            token = authHeader.trim();
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_REQUIRED',
                    message: 'Authentication required. Please log in to your Creator Club account.'
                }
            });
        }

        let matchedAccount = null;
        let matchedCreator = null;

        // 1. Check in-memory creator session
        if (creatorSessions.has(token)) {
            const session = creatorSessions.get(token);
            if (session.expiresAt < Date.now()) {
                creatorSessions.delete(token);
                return res.status(401).json({
                    success: false,
                    error: {
                        code: 'SESSION_EXPIRED',
                        message: 'Session expired. Please log in again.'
                    }
                });
            }

            const local = readLocalStore();
            matchedAccount = local.accounts.find(a => a.id === session.accountId);
            matchedCreator = local.influencers.find(i => (i.influencer_id || i.id) === session.influencerId);

            if (!matchedCreator) {
                try {
                    const infRows = await dbQuery('influencers', `influencer_id=eq.${encodeURIComponent(session.influencerId)}`, { useAdmin: true });
                    if (Array.isArray(infRows) && infRows.length > 0) {
                        const inf = infRows[0];
                        const infId = inf.influencer_id || inf.id;
                        matchedCreator = { ...inf, influencer_id: infId, id: infId };
                    }
                } catch (e) {}
            }
        }

        // 2. If not found in memory, check if it's a Supabase JWT (format ey...)
        if (!matchedAccount && token.startsWith('ey') && adminClient?.auth) {
            try {
                const { data: userData, error: userError } = await adminClient.auth.getUser(token);
                if (!userError && userData?.user) {
                    const authUserId = userData.user.id;
                    const authEmail = userData.user.email?.toLowerCase();

                    const local = readLocalStore();
                    matchedAccount = local.accounts.find(a => 
                        a.auth_user_id === authUserId || 
                        (authEmail && a.email?.toLowerCase() === authEmail)
                    );

                    if (!matchedAccount) {
                        try {
                            const accRows = await dbQuery('influencer_accounts', `auth_user_id=eq.${encodeURIComponent(authUserId)}`, { useAdmin: true });
                            if (Array.isArray(accRows) && accRows.length > 0) {
                                matchedAccount = accRows[0];
                            }
                        } catch (e) {}
                    }

                    if (matchedAccount) {
                        matchedCreator = local.influencers.find(i => (i.influencer_id || i.id) === matchedAccount.influencer_id);
                        if (!matchedCreator) {
                            try {
                                const infRows = await dbQuery('influencers', `influencer_id=eq.${encodeURIComponent(matchedAccount.influencer_id)}`, { useAdmin: true });
                                if (Array.isArray(infRows) && infRows.length > 0) {
                                    const inf = infRows[0];
                                    const infId = inf.influencer_id || inf.id;
                                    matchedCreator = { ...inf, influencer_id: infId, id: infId };
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                console.warn('[Creator Auth] Supabase auth check notice:', e.message);
            }
        }

        // 3. Reject any token that is not a valid active session or validated JWT
        if (!matchedAccount || !matchedCreator) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'SESSION_EXPIRED',
                    message: 'Session expired or invalid. Please log in again.'
                }
            });
        }

        // Check account active status
        if (matchedAccount.is_active === false) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'CREATOR_ACCESS_UNAVAILABLE',
                    message: 'Your Creator Club access is currently unavailable. Please contact WishRite support.'
                }
            });
        }

        // Check creator record status
        if (matchedCreator.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'CREATOR_ACCESS_UNAVAILABLE',
                    message: 'Your Creator Club access is currently unavailable. Please contact WishRite support.'
                }
            });
        }

        // CRITICAL AUTHORIZATION RULE:
        // Bind authenticated creator directly to the request object.
        // Frontend parameter `influencer_id` is NEVER used.
        req.creator = matchedCreator;
        req.creatorAccount = matchedAccount;

        next();
    } catch (err) {
        console.error('[requireCreatorAuth Error]:', err);
        return res.status(500).json({
            success: false,
            error: {
                code: 'AUTH_INTERNAL_ERROR',
                message: 'Unable to verify creator identity.'
            }
        });
    }
}

/**
 * POST /api/creator/login
 * Creator login endpoint
 */
export async function handleCreatorLogin(req, res) {
    try {
        const { email, identifier, password, auth_token } = req.body || {};
        const loginId = String(email || identifier || '').trim().toLowerCase();

        // Security check: Rate limiting by IP + identifier
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').toString().split(',')[0].trim();
        const rateLimitKey = `${ip}:${loginId || 'anonymous'}`;

        if (isLoginRateLimited(rateLimitKey)) {
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Too many failed login attempts. Please try again after 15 minutes.'
                }
            });
        }

        const local = readLocalStore();
        let matchedAccount = null;
        let matchedCreator = null;

        // Case A: Supabase Auth JWT provided directly
        if (auth_token && auth_token.startsWith('ey') && adminClient?.auth) {
            try {
                const { data: userData, error: userError } = await adminClient.auth.getUser(auth_token);
                if (!userError && userData?.user) {
                    const authUserId = userData.user.id;
                    const authEmail = userData.user.email?.toLowerCase();

                    matchedAccount = local.accounts.find(a => 
                        a.auth_user_id === authUserId || 
                        (authEmail && a.email?.toLowerCase() === authEmail)
                    );

                    if (!matchedAccount) {
                        try {
                            const accRows = await dbQuery('influencer_accounts', `auth_user_id=eq.${encodeURIComponent(authUserId)}`, { useAdmin: true });
                            if (Array.isArray(accRows) && accRows.length > 0) {
                                matchedAccount = accRows[0];
                            }
                        } catch (e) {}
                    }

                    if (matchedAccount) {
                        matchedCreator = local.influencers.find(i => (i.influencer_id || i.id) === matchedAccount.influencer_id);
                        if (!matchedCreator) {
                            try {
                                const infRows = await dbQuery('influencers', `influencer_id=eq.${encodeURIComponent(matchedAccount.influencer_id)}`, { useAdmin: true });
                                if (Array.isArray(infRows) && infRows.length > 0) {
                                    const inf = infRows[0];
                                    const infId = inf.influencer_id || inf.id;
                                    matchedCreator = { ...inf, influencer_id: infId, id: infId };
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                console.warn('[handleCreatorLogin] Supabase auth check notice:', e.message);
            }
        }

        // Case B: Email / Identifier & Password login
        if (!matchedAccount && loginId) {
            matchedAccount = local.accounts.find(a => 
                (a.email && a.email.toLowerCase() === loginId)
            );

            // If not found in accounts, check influencers by email, code, or instagram_id
            if (!matchedAccount) {
                matchedCreator = local.influencers.find(i => 
                    (i.email && i.email.toLowerCase() === loginId) ||
                    (i.influencer_code && i.influencer_code.toLowerCase() === loginId) ||
                    (i.instagram_id && i.instagram_id.toLowerCase() === loginId) ||
                    (i.public_slug && i.public_slug.toLowerCase() === loginId)
                );

                if (!matchedCreator) {
                    try {
                        const infRows = await dbQuery('influencers', `email=eq.${encodeURIComponent(loginId)}`, { useAdmin: true });
                        if (Array.isArray(infRows) && infRows.length > 0) {
                            const inf = infRows[0];
                            const infId = inf.influencer_id || inf.id;
                            matchedCreator = { ...inf, influencer_id: infId, id: infId };
                        }
                    } catch (e) {}
                }

                if (matchedCreator) {
                    const canonicalCreatorId = matchedCreator.influencer_id || matchedCreator.id;
                    matchedAccount = await getOrLinkInfluencerAccount({
                        email: matchedCreator.email || loginId,
                        influencer_id: canonicalCreatorId,
                        password: password || 'WishriteCreator2026!'
                    });
                }
            } else {
                matchedCreator = local.influencers.find(i => (i.influencer_id || i.id) === matchedAccount.influencer_id);
                if (!matchedCreator) {
                    try {
                        const infRows = await dbQuery('influencers', `influencer_id=eq.${encodeURIComponent(matchedAccount.influencer_id)}`, { useAdmin: true });
                        if (Array.isArray(infRows) && infRows.length > 0) {
                            const inf = infRows[0];
                            const infId = inf.influencer_id || inf.id;
                            matchedCreator = { ...inf, influencer_id: infId, id: infId };
                        }
                    } catch (e) {}
                }
            }

            // Verify password if account has password_hash
            if (matchedAccount && password) {
                const isValid = verifyPassword(password, matchedAccount.password_hash);
                if (!isValid) {
                    recordFailedLogin(rateLimitKey);
                    return res.status(401).json({
                        success: false,
                        error: {
                            code: 'INVALID_CREDENTIALS',
                            message: 'Invalid email or password.'
                        }
                    });
                }

                // If password verified and using legacy hash, transparently upgrade to salted PBKDF2
                if (matchedAccount.password_hash && !matchedAccount.password_hash.startsWith('pbkdf2:')) {
                    matchedAccount.password_hash = hashPassword(password);
                    writeLocalStore(local);
                }
            } else if (!password && !auth_token) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PASSWORD_REQUIRED',
                        message: 'Password is required to sign in.'
                    }
                });
            }
        }

        // If no creator account exists
        if (!matchedAccount || !matchedCreator) {
            recordFailedLogin(rateLimitKey);
            return res.status(403).json({
                success: false,
                error: {
                    code: 'CREATOR_NOT_ACTIVATED',
                    message: 'Your Creator Club account is not activated yet. Please contact WishRite support.'
                }
            });
        }

        // Check account active state
        if (matchedAccount.is_active === false) {
            recordFailedLogin(rateLimitKey);
            return res.status(403).json({
                success: false,
                error: {
                    code: 'CREATOR_ACCESS_UNAVAILABLE',
                    message: 'Your Creator Club access is currently unavailable. Please contact WishRite support.'
                }
            });
        }

        // Check creator record status
        if (matchedCreator.status !== 'active') {
            recordFailedLogin(rateLimitKey);
            return res.status(403).json({
                success: false,
                error: {
                    code: 'CREATOR_ACCESS_UNAVAILABLE',
                    message: 'Your Creator Club access is currently unavailable. Please contact WishRite support.'
                }
            });
        }

        // Record last_login_at
        matchedAccount.last_login_at = new Date().toISOString();
        matchedAccount.updated_at = new Date().toISOString();
        writeLocalStore(local);

        try {
            await dbUpdate('influencer_accounts', 'id', matchedAccount.id, {
                last_login_at: matchedAccount.last_login_at,
                updated_at: matchedAccount.updated_at
            }, { useAdmin: true });
        } catch (e) {
            // ignore
        }

        // Reset rate limit on success
        recordSuccessfulLogin(rateLimitKey);

        // Issue session
        const { token, expiresAt } = issueCreatorSession(matchedAccount, matchedCreator);

        return res.json({
            success: true,
            message: 'Signed in successfully to WishRite Creator Club.',
            token,
            expires_at: new Date(expiresAt).toISOString(),
            creator: {
                influencer_id: matchedCreator.influencer_id || matchedCreator.id,
                id: matchedCreator.influencer_id || matchedCreator.id,
                influencer_code: matchedCreator.influencer_code,
                name: matchedCreator.name,
                display_name: matchedCreator.name,
                public_slug: matchedCreator.public_slug,
                public_profile_url: matchedCreator.public_profile_url || buildInfluencerPublicUrl(matchedCreator.public_slug),
                profile_image: matchedCreator.profile_image,
                bio: matchedCreator.bio,
                instagram_id: matchedCreator.instagram_id,
                instagram_url: matchedCreator.instagram_url,
                tier: matchedCreator.tier || 'starter'
            }
        });
    } catch (err) {
        console.error('[handleCreatorLogin Error]:', err);
        return res.status(500).json({
            success: false,
            error: {
                code: 'LOGIN_FAILED',
                message: 'An unexpected error occurred during login. Please try again.'
            }
        });
    }
}

/**
 * POST /api/creator/logout
 */
export async function handleCreatorLogout(req, res) {
    const authHeader = req.headers.authorization || req.headers['x-creator-token'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7).trim();
    else if (authHeader) token = authHeader.trim();

    if (token) revokeCreatorSession(token);

    return res.json({
        success: true,
        message: 'Successfully logged out of Creator Club.'
    });
}

/**
 * GET /api/creator/me
 * Returns authenticated creator info and session details
 */
export async function handleGetCreatorMe(req, res) {
    const creator = req.creator;
    const account = req.creatorAccount;

    return res.json({
        success: true,
        data: {
            creator: {
                influencer_id: creator.influencer_id || creator.id,
                id: creator.influencer_id || creator.id,
                influencer_code: creator.influencer_code,
                name: creator.name,
                display_name: creator.name,
                public_slug: creator.public_slug,
                public_profile_url: creator.public_profile_url || buildInfluencerPublicUrl(creator.public_slug),
                profile_image: creator.profile_image,
                bio: creator.bio,
                instagram_id: creator.instagram_id,
                instagram_url: creator.instagram_url,
                tier: creator.tier || 'starter',
                category: creator.category || 'Jewelry & Lifestyle',
                status: creator.status || 'active',
                commission_rate: Number(creator.commission_rate) || 0
            },
            account: {
                email: account.email,
                is_active: account.is_active,
                last_login_at: account.last_login_at
            }
        }
    });
}

/**
 * GET /api/creator/stats
 * Real-time performance metrics (Phase 2 canonical attribution source)
 */
export async function handleGetCreatorStats(req, res) {
    const creator = req.creator;
    const creatorId = creator.influencer_id || creator.id;
    const local = readLocalStore();

    // Find stats record for authenticated creator
    const stats = (local.stats || []).find(s => s.influencer_id === creatorId) || {
        total_clicks: 0,
        total_orders: 0,
        total_sales: 0,
        total_earnings: 0,
        pending_earnings: 0,
        available_earnings: 0
    };

    // Calculate actual orders attributed to this creator
    const orders = (local.order_attributions || []).filter(o => o.influencer_id === creatorId);
    const activeOrders = orders.filter(o => o.status !== 'cancelled');

    const totalOrders = stats.total_orders || activeOrders.length;
    const totalSales = Number(stats.total_sales) || activeOrders.reduce((sum, o) => sum + Number(o.sales_amount || 0), 0);
    const totalClicks = Number(stats.total_clicks) || 0;

    // Conversion rate: (total_orders / total_clicks) * 100
    const conversionRate = totalClicks > 0 
        ? Number(((totalOrders / totalClicks) * 100).toFixed(2)) 
        : 0.00;

    const pendingEarnings = Number(stats.pending_earnings) || 
        orders.filter(o => o.status === 'pending').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0);

    const availableEarnings = Number(stats.available_earnings) || 
        orders.filter(o => o.status === 'approved' || o.status === 'available').reduce((sum, o) => sum + Number(o.commission_amount || 0), 0);

    return res.json({
        success: true,
        data: {
            total_clicks: totalClicks,
            total_orders: totalOrders,
            total_sales: totalSales,
            conversion_rate: conversionRate,
            pending_earnings: pendingEarnings,
            available_earnings: availableEarnings,
            total_earnings: pendingEarnings + availableEarnings
        }
    });
}

/**
 * GET /api/creator/performance
 * Performance trends with time filters: 7d, 30d, 90d, all
 * Grounded strictly in actual database/store timestamps (no fabricated fake data).
 */
export async function handleGetCreatorPerformance(req, res) {
    const creator = req.creator;
    const period = String(req.query.period || '30d').toLowerCase();

    const now = new Date();
    let cutoff = null;
    let daysCount = 30;

    if (period === '7d') {
        daysCount = 7;
        cutoff = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (period === '90d') {
        daysCount = 90;
        cutoff = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
    } else if (period === 'all') {
        daysCount = 180;
        cutoff = new Date(0); // All time
    } else {
        // default 30d
        daysCount = 30;
        cutoff = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    const local = readLocalStore();
    const creatorId = creator.influencer_id || creator.id;

    // Filter real clicks
    const clicks = (local.clicks || []).filter(c => 
        c.influencer_id === creatorId && 
        new Date(c.created_at) >= cutoff
    );

    // Filter real orders
    const orders = (local.order_attributions || []).filter(o => 
        o.influencer_id === creatorId && 
        o.status !== 'cancelled' &&
        new Date(o.created_at) >= cutoff
    );

    const periodClicks = clicks.length;
    const periodOrders = orders.length;
    const periodSales = orders.reduce((sum, o) => sum + Number(o.sales_amount || 0), 0);
    const periodCommission = orders.reduce((sum, o) => sum + Number(o.commission_amount || 0), 0);
    const conversionRate = periodClicks > 0 
        ? Number(((periodOrders / periodClicks) * 100).toFixed(2)) 
        : 0.00;

    // Group by day for the trend chart
    const dailyMap = new Map();
    // Initialize date map for readable charting
    for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const dateStr = d.toISOString().slice(0, 10);
        dailyMap.set(dateStr, {
            date: dateStr,
            clicks: 0,
            orders: 0,
            sales: 0,
            commission: 0
        });
    }

    for (const c of clicks) {
        const dStr = new Date(c.created_at).toISOString().slice(0, 10);
        if (dailyMap.has(dStr)) {
            dailyMap.get(dStr).clicks += 1;
        }
    }

    for (const o of orders) {
        const dStr = new Date(o.created_at).toISOString().slice(0, 10);
        if (dailyMap.has(dStr)) {
            const entry = dailyMap.get(dStr);
            entry.orders += 1;
            entry.sales += Number(o.sales_amount || 0);
            entry.commission += Number(o.commission_amount || 0);
        }
    }

    const trend = Array.from(dailyMap.values());

    return res.json({
        success: true,
        data: {
            period,
            total_clicks: periodClicks,
            total_orders: periodOrders,
            total_sales: periodSales,
            total_commission: periodCommission,
            conversion_rate: conversionRate,
            trend
        }
    });
}

/**
 * GET /api/creator/orders
 * Returns orders attributed to the authenticated creator.
 * STRICT DATA PRIVACY: Strips all customer PII (phone, email, address, payment creds).
 */
export async function handleGetCreatorOrders(req, res) {
    const creator = req.creator;
    const creatorId = creator.influencer_id || creator.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const statusFilter = req.query.status ? String(req.query.status).toLowerCase() : null;

    const local = readLocalStore();
    let orders = (local.order_attributions || [])
        .filter(o => o.influencer_id === creatorId);

    if (statusFilter) {
        orders = orders.filter(o => (o.status || '').toLowerCase() === statusFilter);
    }

    // Sort newest first
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = orders.length;
    const startIndex = (page - 1) * limit;
    const paginated = orders.slice(startIndex, startIndex + limit);

    // Sanitize records — absolutely zero customer PII returned
    const sanitizedOrders = paginated.map(o => ({
        id: o.id,
        order_reference: o.order_reference,
        created_at: o.created_at,
        sales_amount: Number(o.sales_amount) || 0,
        commission_rate: Number(o.commission_rate) || 0,
        commission_amount: Number(o.commission_amount) || 0,
        order_status: o.order_status || (o.status === 'cancelled' ? 'cancelled' : 'delivered'),
        commission_status: o.status || 'pending',
        product_summary: o.product_summary || 'WishRite Fine Jewelry'
    }));

    return res.json({
        success: true,
        page,
        limit,
        total,
        count: sanitizedOrders.length,
        data: sanitizedOrders
    });
}

/**
 * GET /api/creator/links
 * Permanent profile link + product referral links
 */
export async function handleGetCreatorLinks(req, res) {
    const creator = req.creator;
    const creatorId = creator.influencer_id || creator.id;
    const local = readLocalStore();

    const profileUrl = creator.public_profile_url || buildInfluencerPublicUrl(creator.public_slug);

    // Fetch product referral links
    const productLinks = (local.links || [])
        .filter(l => l.influencer_id === creatorId && l.link_type === 'product')
        .map(l => {
            // Find click count for this link
            const clickCount = (local.clicks || []).filter(c => c.influencer_link_id === l.id).length;
            return {
                id: l.id,
                url: l.url,
                product_code: l.campaign_id || l.product_code || null,
                clicks: clickCount,
                created_at: l.created_at
            };
        });

    return res.json({
        success: true,
        data: {
            public_slug: creator.public_slug,
            profile_url: profileUrl,
            storefront_url: profileUrl,
            product_links: productLinks
        }
    });
}

/**
 * POST /api/creator/links
 * Creates a product referral link for the authenticated creator
 */
export async function handleCreateCreatorProductLink(req, res) {
    const creator = req.creator;
    const { product_code } = req.body || {};

    if (!product_code) {
        return res.status(400).json({
            success: false,
            error: { message: 'product_code is required to generate a product referral link.' }
        });
    }

    const cleanCode = String(product_code).trim();
    const productUrl = buildInfluencerProductUrl(creator.public_slug, cleanCode);
    const creatorId = creator.influencer_id || creator.id;

    const local = readLocalStore();
    let existingLink = (local.links || []).find(l => 
        l.influencer_id === creatorId && 
        l.link_type === 'product' && 
        (l.campaign_id === cleanCode || l.url === productUrl)
    );

    if (existingLink) {
        return res.json({
            success: true,
            message: 'Referral link already exists.',
            data: existingLink
        });
    }

    const newLink = {
        id: randomUUID(),
        influencer_id: creatorId,
        link_type: 'product',
        url: productUrl,
        campaign_id: cleanCode,
        is_default: false,
        created_at: new Date().toISOString()
    };

    local.links.push(newLink);
    writeLocalStore(local);

    try {
        await dbInsert('influencer_links', newLink, { useAdmin: true });
    } catch (e) {
        // local persistence fallback
    }

    return res.status(201).json({
        success: true,
        message: 'Product referral link created successfully.',
        data: newLink
    });
}

/**
 * GET /api/creator/profile
 * Returns public and creator-safe profile data
 */
export async function handleGetCreatorProfile(req, res) {
    const creator = req.creator;
    const creatorId = creator.influencer_id || creator.id;

    return res.json({
        success: true,
        data: {
            influencer_id: creatorId,
            id: creatorId,
            influencer_code: creator.influencer_code,
            name: creator.name,
            display_name: creator.name,
            profile_image: creator.profile_image,
            bio: creator.bio,
            instagram_id: creator.instagram_id,
            instagram_url: creator.instagram_url,
            public_slug: creator.public_slug,
            public_profile_url: creator.public_profile_url || buildInfluencerPublicUrl(creator.public_slug),
            category: creator.category || 'Jewelry & Lifestyle',
            tier: creator.tier || 'starter',
            created_at: creator.created_at
        }
    });
}

/**
 * PATCH /api/creator/profile
 * Allows creator to edit ONLY safe fields:
 * - name / display_name
 * - profile_image
 * - bio
 * - instagram_url
 * STRICTLY PREVENTS editing:
 * - commission_rate
 * - tier
 * - status
 * - earnings
 * - influencer_code
 * - public_slug
 */
export async function handleUpdateCreatorProfile(req, res) {
    const creator = req.creator;
    const body = req.body || {};

    const permittedUpdates = {};
    if (body.display_name !== undefined) permittedUpdates.name = sanitizeText(body.display_name);
    if (body.name !== undefined) permittedUpdates.name = sanitizeText(body.name);
    if (body.bio !== undefined) permittedUpdates.bio = sanitizeText(body.bio);

    if (body.profile_image !== undefined) {
        const imgUrl = String(body.profile_image).trim();
        if (imgUrl && !isValidHttpUrl(imgUrl)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_URL',
                    message: 'profile_image must be a valid http or https URL.'
                }
            });
        }
        permittedUpdates.profile_image = imgUrl;
    }

    if (body.instagram_url !== undefined) {
        const instaUrl = String(body.instagram_url).trim();
        if (instaUrl && !isValidHttpUrl(instaUrl)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_URL',
                    message: 'instagram_url must be a valid http or https URL.'
                }
            });
        }
        permittedUpdates.instagram_url = instaUrl;
    }

    if (Object.keys(permittedUpdates).length === 0) {
        return res.status(400).json({
            success: false,
            error: { message: 'No editable fields provided.' }
        });
    }

    permittedUpdates.updated_at = new Date().toISOString();

    const creatorId = creator.influencer_id || creator.id;
    const local = readLocalStore();
    const idx = local.influencers.findIndex(i => (i.influencer_id || i.id) === creatorId);
    if (idx !== -1) {
        Object.assign(local.influencers[idx], permittedUpdates);
        writeLocalStore(local);
        Object.assign(creator, permittedUpdates);
    }

    try {
        await dbUpdate('influencers', 'influencer_id', creatorId, permittedUpdates, { useAdmin: true });
    } catch (e) {
        // local persistence fallback
    }

    return res.json({
        success: true,
        message: 'Creator profile updated successfully.',
        data: {
            influencer_id: creatorId,
            id: creatorId,
            name: creator.name,
            display_name: creator.name,
            bio: creator.bio,
            profile_image: creator.profile_image,
            instagram_url: creator.instagram_url,
            public_slug: creator.public_slug,
            public_profile_url: creator.public_profile_url,
            tier: creator.tier,
            updated_at: creator.updated_at
        }
    });
}

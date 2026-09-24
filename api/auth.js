// ==============================================================================
// WISHRITE INVENTORY — AUTH API CONTROLLER
// Authenticates employees and manages server-side roles.
// ==============================================================================

import { dbQuery } from './supabase-client.js';

/**
 * POST /api/auth/login
 */
export async function handleLogin(req, res) {
    try {
        const { user_id, pin } = req.body || {};

        if (!user_id || !pin) {
            return res.status(400).json({
                success: false,
                error: { message: 'User ID and PIN/Password are required' }
            });
        }

        const cleanUserId = String(user_id).trim();
        const cleanPin = String(pin).trim();

        // Query employees table for this user_id
        let employees;
        try {
            employees = await dbQuery('employees', `user_id=eq.${encodeURIComponent(cleanUserId)}&limit=1`);
        } catch (dbErr) {
            console.error('[Auth API] Database unavailable during login:', dbErr.message);
            return res.status(503).json({
                success: false,
                error: {
                    code: 'AUTH_DATABASE_UNAVAILABLE',
                    message: 'Database unavailable. Unable to verify credentials.'
                }
            });
        }

        const emp = Array.isArray(employees) && employees[0];
        if (!emp) {
            return res.status(401).json({
                success: false,
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid User ID or PIN' }
            });
        }

        // Verify Password or PIN (matches stored password or pin)
        const storedPwd = emp.password ? String(emp.password).trim() : '';
        const storedPin = emp.pin ? String(emp.pin).trim() : '';
        if (storedPwd !== cleanPin && storedPin !== cleanPin) {
            return res.status(401).json({
                success: false,
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid User ID or Password' }
            });
        }

        // Generate sanitized user payload (NEVER return PIN or Password)
        const userProfile = {
            id: emp.employee_id,
            employee_id: emp.employee_id,
            user_id: emp.user_id,
            first_name: emp.first_name,
            last_name: emp.last_name || '',
            role: emp.role || 'Staff',
            phone_number: emp.phone_number || '',
            email_id: emp.email_id || '',
            address: emp.address || '',
            city: emp.city || '',
            state: emp.state || '',
            country: emp.country || 'India',
            shop_name: 'WishRite',
            is_active: emp.is_active !== false
        };

        return res.json({
            success: true,
            message: `Welcome back, ${userProfile.first_name}!`,
            data: {
                user: userProfile,
                token: 'wrt_' + Buffer.from(`${userProfile.user_id}:${Date.now()}`).toString('base64')
            }
        });
    } catch (err) {
        console.error('[Auth Login Error]:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'AUTH_FAILED', message: err.message || 'Authentication failed' }
        });
    }
}

/**
 * GET /api/auth/setup-status
 * CASE 1: Query succeeds and count = 0 -> 200 { success: true, data: { count: 0, has_admin: false } }
 * CASE 2: Query succeeds and count > 0 -> 200 { success: true, data: { count: N, has_admin: true } }
 * CASE 3: DB query fails -> 503 { success: false, error: { code: "AUTH_DATABASE_UNAVAILABLE", message: "..." } }
 */
export async function handleCheckSetup(req, res) {
    try {
        const rows = await dbQuery('employees', 'select=employee_id&limit=10');
        const count = Array.isArray(rows) ? rows.length : 0;
        return res.status(200).json({
            success: true,
            data: {
                count,
                has_admin: count > 0
            }
        });
    } catch (err) {
        console.error('[Auth API] Setup status check failed:', err.message);
        return res.status(503).json({
            success: false,
            error: {
                code: 'AUTH_DATABASE_UNAVAILABLE',
                message: 'Unable to verify existing Inventory users.'
            }
        });
    }
}

/**
 * POST /api/auth/setup
 * Only allowed if employees table is genuinely empty
 */
export async function handleInitialSetup(req, res) {
    try {
        // Verify database is truly empty before allowing initial setup
        const existing = await dbQuery('employees', 'select=employee_id&limit=1');
        if (Array.isArray(existing) && existing.length > 0) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'SETUP_DISABLED',
                    message: 'System is already initialized with existing employees. Master setup is disabled.'
                }
            });
        }

        const { first_name, last_name, user_id, pin, phone_number } = req.body || {};
        if (!first_name || !user_id || !pin) {
            return res.status(400).json({ success: false, error: { message: 'Missing required setup fields' } });
        }
        const payload = {
            first_name: String(first_name).trim(),
            last_name: String(last_name || '').trim(),
            user_id: String(user_id).trim(),
            pin: String(pin).trim(),
            password: String(pin).trim(),
            role: 'Admin',
            phone_number: String(phone_number || '').trim(),
            created_at: new Date().toISOString()
        };
        const { dbInsert } = await import('./supabase-client.js');
        const result = await dbInsert('employees', payload);
        return res.status(201).json({ success: true, message: 'Admin account created successfully', data: result.data });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * GET /api/employees
 */
export async function handleGetEmployees(req, res) {
    try {
        const rows = await dbQuery('employees', 'select=employee_id,user_id,first_name,last_name,role,phone_number,email_id,address,city,state,country,created_at&order=created_at.desc');
        const sanitized = (rows || []).map(r => ({
            ...r,
            id: r.employee_id,
            is_active: true
        }));
        return res.json({ success: true, data: sanitized });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

/**
 * POST /api/employees
 */
export async function handleCreateEmployee(req, res) {
    try {
        const { first_name, last_name, user_id, pin, role, phone_number, email_id, address, city, state, country } = req.body || {};
        if (!first_name || !user_id || !pin) {
            return res.status(400).json({ success: false, error: { message: 'Missing required fields' } });
        }
        const payload = {
            first_name: String(first_name).trim(),
            last_name: String(last_name || '').trim(),
            user_id: String(user_id).trim(),
            pin: String(pin).trim(),
            password: String(pin).trim(),
            role: String(role || 'Staff').trim(),
            phone_number: String(phone_number || '').trim(),
            email_id: String(email_id || '').trim(),
            address: String(address || '').trim(),
            city: String(city || '').trim(),
            state: String(state || '').trim(),
            country: String(country || 'India').trim(),
            created_at: new Date().toISOString()
        };
        const { dbInsert } = await import('./supabase-client.js');
        const result = await dbInsert('employees', payload);
        return res.status(201).json({ success: true, message: 'Employee added successfully', data: result.data });
    } catch (err) {
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
}

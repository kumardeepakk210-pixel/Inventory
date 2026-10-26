// ==============================================================================
// WISHRITE INVENTORY — CUSTOMERS API CONTROLLER
// Handles Customer Directory, Lifetime Purchases, Wallet Balances, WishRite Points
// Aggregates data from public.customers, public.sales, and balance metadata.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQuery, dbInsert, dbUpdate } from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const CUSTOMERS_META_PATH = path.join(DATA_DIR, 'customers_meta.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create data dir:', e.message);
    }
}

/**
 * Load persisted customer metadata (wallet balances, points, notes, adjustments) - test only
 */
function loadCustomersMeta() {
    if (process.env.NODE_ENV === 'test') {
        try {
            if (fs.existsSync(CUSTOMERS_META_PATH)) {
                const raw = fs.readFileSync(CUSTOMERS_META_PATH, 'utf-8');
                return JSON.parse(raw) || {};
            }
        } catch (e) {
            console.warn('Could not read customers_meta.json in test:', e.message);
        }
    }
    return {};
}

/**
 * Save customer metadata - test only
 */
function saveCustomersMeta(data) {
    if (process.env.NODE_ENV !== 'test') return false;
    try {
        fs.writeFileSync(CUSTOMERS_META_PATH, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('Could not save customers_meta.json in test:', e.message);
        return false;
    }
}

/**
 * Normalizes phone numbers for matching (digits only, last 10 digits)
 */
function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * GET /api/customers
 * Returns all consolidated customers with lifetime purchased amount,
 * wallet balance, Wishrite points balance, contact details, and recent orders.
 */
export async function handleGetCustomers(req, res) {
    try {
        const { search, min_purchased, has_wallet, has_points, sort } = req.query || {};

        // 1. Fetch DB customers
        const dbCustomers = await dbQuery('customers', 'order=created_at.desc').catch(err => {
            console.warn('[Customers API] dbQuery customers failed:', err.message);
            return [];
        });

        // 2. Fetch sales to aggregate lifetime purchases
        const sales = await dbQuery('sales').catch(err => {
            console.warn('[Customers API] dbQuery sales failed:', err.message);
            return [];
        });

        // 3. Fetch orders if available
        const orders = await dbQuery('orders').catch(() => []);

        // 4. Load metadata overrides (balances, points)
        const metaStore = loadCustomersMeta();

        // 5. Build lookup map keyed by normalized phone, email, or customer id
        const customerMap = new Map();

        // Helper to get or create customer record in map
        function getOrCreateEntry(key, defaultData = {}) {
            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    id: defaultData.id || `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    customer_name: defaultData.customer_name || 'Valued Customer',
                    customer_phone: defaultData.customer_phone || '',
                    customer_email: defaultData.customer_email || '',
                    customer_address: defaultData.customer_address || '',
                    customer_city: defaultData.customer_city || '',
                    customer_state: defaultData.customer_state || '',
                    customer_pin: defaultData.customer_pin || '',
                    customer_country: defaultData.customer_country || 'India',
                    total_purchased_amount: 0,
                    total_orders_count: 0,
                    wallet_balance: 0,
                    points_balance: 0,
                    recent_orders: [],
                    last_purchase_date: null,
                    created_at: defaultData.created_at || new Date().toISOString(),
                    source: defaultData.source || 'sales'
                });
            }
            return customerMap.get(key);
        }

        // Index registered customers from DB
        (dbCustomers || []).forEach(cust => {
            const normPhone = normalizePhone(cust.customer_phone);
            const key = normPhone || (cust.customer_email ? cust.customer_email.toLowerCase().trim() : cust.id);

            const meta = metaStore[cust.id] || (normPhone ? metaStore[normPhone] : null) || {};

            const entry = getOrCreateEntry(key, {
                id: cust.id,
                customer_name: cust.customer_name,
                customer_phone: cust.customer_phone,
                customer_email: cust.customer_email,
                customer_address: cust.customer_address,
                customer_city: cust.customer_city,
                customer_state: cust.customer_state,
                customer_pin: cust.customer_pin,
                customer_country: cust.customer_country,
                created_at: cust.created_at,
                source: 'registered'
            });

            // Set DB or meta balances
            entry.wallet_balance = Number(cust.wallet_balance ?? meta.wallet_balance ?? 0);
            entry.points_balance = Number(cust.points_balance ?? cust.wishrite_points ?? meta.points_balance ?? 0);
            if (cust.customer_name) entry.customer_name = cust.customer_name;
            if (cust.customer_email && !entry.customer_email) entry.customer_email = cust.customer_email;
            if (cust.customer_city && !entry.customer_city) entry.customer_city = cust.customer_city;
            if (cust.customer_state && !entry.customer_state) entry.customer_state = cust.customer_state;
        });

        // Aggregate Sales into customers
        (sales || []).forEach(sale => {
            const normPhone = normalizePhone(sale.customer_phone);
            const key = normPhone || (sale.customer_email ? sale.customer_email.toLowerCase().trim() : (sale.customer_name || 'Walk-in'));

            const entry = getOrCreateEntry(key, {
                customer_name: sale.customer_name || 'Walk-in Customer',
                customer_phone: sale.customer_phone || '',
                customer_email: sale.customer_email || '',
                customer_address: sale.customer_address || '',
                customer_city: sale.customer_city || '',
                customer_state: sale.customer_state || '',
                customer_pin: sale.customer_pin || '',
                customer_country: sale.customer_country || 'India',
                created_at: sale.sale_date || sale.created_at,
                source: 'sales'
            });

            // Calculate revenue for this item
            const qty = Number(sale.quantity || 1);
            const price = Number(sale.selling_price || 0);
            const disc = Number(sale.discount || 0);
            const lineTotal = Math.max(0, (price * qty) - disc);

            entry.total_purchased_amount += lineTotal;
            entry.total_orders_count += 1;

            const saleDate = sale.sale_date || sale.created_at;
            if (saleDate && (!entry.last_purchase_date || new Date(saleDate) > new Date(entry.last_purchase_date))) {
                entry.last_purchase_date = saleDate;
            }

            // Save in recent orders list (up to 10)
            if (entry.recent_orders.length < 10) {
                entry.recent_orders.push({
                    id: sale.id,
                    type: 'POS Sale',
                    product_name: sale.product_name,
                    product_code: sale.product_code,
                    category: sale.category,
                    quantity: qty,
                    amount: lineTotal,
                    date: saleDate
                });
            }

            // Apply meta overrides if not registered
            const meta = metaStore[entry.id] || (normPhone ? metaStore[normPhone] : null) || {};
            if (meta.wallet_balance !== undefined) entry.wallet_balance = Number(meta.wallet_balance);
            if (meta.points_balance !== undefined) entry.points_balance = Number(meta.points_balance);
        });

        // Aggregate Orders if available and not redundant
        (orders || []).forEach(ord => {
            const normPhone = normalizePhone(ord.customer_phone);
            const key = normPhone || (ord.customer_email ? ord.customer_email.toLowerCase().trim() : ord.id);

            const entry = getOrCreateEntry(key, {
                customer_name: ord.customer_name || 'Online Customer',
                customer_phone: ord.customer_phone || '',
                customer_email: ord.customer_email || '',
                created_at: ord.created_at,
                source: 'online_order'
            });

            const amount = Number(ord.grand_total || ord.total_amount || 0);
            entry.total_purchased_amount += amount;
            entry.total_orders_count += 1;

            const ordDate = ord.created_at;
            if (ordDate && (!entry.last_purchase_date || new Date(ordDate) > new Date(entry.last_purchase_date))) {
                entry.last_purchase_date = ordDate;
            }
        });

        // Convert Map to array
        let customerList = Array.from(customerMap.values());

        // Apply filters
        if (search) {
            const q = String(search).toLowerCase().trim();
            customerList = customerList.filter(c =>
                (c.customer_name && c.customer_name.toLowerCase().includes(q)) ||
                (c.customer_phone && c.customer_phone.includes(q)) ||
                (c.customer_email && c.customer_email.toLowerCase().includes(q)) ||
                (c.customer_city && c.customer_city.toLowerCase().includes(q))
            );
        }

        if (min_purchased) {
            const min = Number(min_purchased);
            if (!isNaN(min)) {
                customerList = customerList.filter(c => c.total_purchased_amount >= min);
            }
        }

        if (has_wallet === 'true') {
            customerList = customerList.filter(c => c.wallet_balance > 0);
        } else if (has_wallet === 'false') {
            customerList = customerList.filter(c => c.wallet_balance === 0);
        }

        if (has_points === 'true') {
            customerList = customerList.filter(c => c.points_balance > 0);
        } else if (has_points === 'false') {
            customerList = customerList.filter(c => c.points_balance === 0);
        }

        // Sorting
        if (sort === 'purchased_desc') {
            customerList.sort((a, b) => b.total_purchased_amount - a.total_purchased_amount);
        } else if (sort === 'purchased_asc') {
            customerList.sort((a, b) => a.total_purchased_amount - b.total_purchased_amount);
        } else if (sort === 'wallet_desc') {
            customerList.sort((a, b) => b.wallet_balance - a.wallet_balance);
        } else if (sort === 'points_desc') {
            customerList.sort((a, b) => b.points_balance - a.points_balance);
        } else if (sort === 'name_asc') {
            customerList.sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''));
        } else {
            // Default: Most recent purchase or creation
            customerList.sort((a, b) => {
                const dateA = new Date(a.last_purchase_date || a.created_at || 0).getTime();
                const dateB = new Date(b.last_purchase_date || b.created_at || 0).getTime();
                return dateB - dateA;
            });
        }

        // Calculate summary metrics
        const summary = {
            total_customers: customerList.length,
            total_purchased: customerList.reduce((acc, c) => acc + (c.total_purchased_amount || 0), 0),
            total_wallet_balance: customerList.reduce((acc, c) => acc + (c.wallet_balance || 0), 0),
            total_points_balance: customerList.reduce((acc, c) => acc + (c.points_balance || 0), 0)
        };

        return res.json({
            success: true,
            data: customerList,
            summary
        });
    } catch (e) {
        console.error('[Customers API] handleGetCustomers error:', e);
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
}

/**
 * GET /api/customers/:id
 * Retrieve individual customer details
 */
export async function handleGetCustomerById(req, res) {
    try {
        const { id } = req.params;
        const metaStore = loadCustomersMeta();

        let customer = null;
        const dbCusts = await dbQuery('customers', `id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => []);
        if (dbCusts && dbCusts.length > 0) {
            customer = dbCusts[0];
        }

        // Fetch sales for this customer
        let salesFilter = '';
        if (customer && customer.customer_phone) {
            salesFilter = `customer_phone=eq.${encodeURIComponent(customer.customer_phone)}`;
        } else if (customer && customer.customer_email) {
            salesFilter = `customer_email=eq.${encodeURIComponent(customer.customer_email)}`;
        }

        const sales = salesFilter ? await dbQuery('sales', `${salesFilter}&order=sale_date.desc`).catch(() => []) : [];
        const normPhone = customer ? normalizePhone(customer.customer_phone) : '';
        const meta = metaStore[id] || (normPhone ? metaStore[normPhone] : null) || {};

        const totalPurchased = sales.reduce((acc, s) => {
            const qty = Number(s.quantity || 1);
            const price = Number(s.selling_price || 0);
            const disc = Number(s.discount || 0);
            return acc + Math.max(0, (price * qty) - disc);
        }, 0);

        const result = {
            id: customer ? customer.id : id,
            customer_name: customer ? customer.customer_name : 'Customer',
            customer_phone: customer ? customer.customer_phone : '',
            customer_email: customer ? customer.customer_email : '',
            customer_address: customer ? customer.customer_address : '',
            customer_city: customer ? customer.customer_city : '',
            customer_state: customer ? customer.customer_state : '',
            customer_pin: customer ? customer.customer_pin : '',
            customer_country: customer ? customer.customer_country : 'India',
            wallet_balance: Number(customer?.wallet_balance ?? meta.wallet_balance ?? 0),
            points_balance: Number(customer?.points_balance ?? meta.points_balance ?? 0),
            total_purchased_amount: totalPurchased,
            total_orders_count: sales.length,
            sales_history: sales,
            audit_trail: meta.audit_trail || []
        };

        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('[Customers API] handleGetCustomerById error:', e);
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
}

/**
 * POST /api/customers
 * Create a new customer profile
 */
export async function handleCreateCustomer(req, res) {
    try {
        const {
            customer_name,
            customer_phone,
            customer_email,
            customer_address,
            customer_city,
            customer_state,
            customer_pin,
            customer_country,
            wallet_balance,
            points_balance
        } = req.body || {};

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Customer name is required' } });
        }

        const payload = {
            customer_name: customer_name.trim(),
            customer_phone: customer_phone ? String(customer_phone).trim() : null,
            customer_email: customer_email ? String(customer_email).trim() : null,
            customer_address: customer_address || null,
            customer_city: customer_city || null,
            customer_state: customer_state || null,
            customer_pin: customer_pin || null,
            customer_country: customer_country || 'India',
            created_at: new Date().toISOString()
        };

        let result = await dbInsert('customers', payload).catch(err => {
            console.warn('[Customers API] dbInsert error, using fallback:', err.message);
            return null;
        });

        const customerId = result?.data?.id || `cust_${Date.now()}`;
        const finalCustomer = result?.data || { id: customerId, ...payload };

        // Save initial balance if provided
        const metaStore = loadCustomersMeta();
        const normPhone = normalizePhone(payload.customer_phone);

        const initialMeta = {
            wallet_balance: Number(wallet_balance || 0),
            points_balance: Number(points_balance || 0),
            updated_at: new Date().toISOString(),
            audit_trail: [
                {
                    date: new Date().toISOString(),
                    action: 'CREATE_CUSTOMER',
                    note: 'Customer profile registered'
                }
            ]
        };

        metaStore[customerId] = initialMeta;
        if (normPhone) metaStore[normPhone] = initialMeta;
        saveCustomersMeta(metaStore);

        return res.status(201).json({
            success: true,
            data: {
                ...finalCustomer,
                wallet_balance: initialMeta.wallet_balance,
                points_balance: initialMeta.points_balance
            }
        });
    } catch (e) {
        console.error('[Customers API] handleCreateCustomer error:', e);
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
}

/**
 * PATCH /api/customers/:id
 * Update customer profile details
 */
export async function handleUpdateCustomer(req, res) {
    try {
        const { id } = req.params;
        const updates = req.body || {};

        const allowedFields = [
            'customer_name', 'customer_phone', 'customer_email',
            'customer_address', 'customer_city', 'customer_state',
            'customer_pin', 'customer_country', 'wallet_balance', 'points_balance'
        ];

        const payload = {};
        allowedFields.forEach(f => {
            if (updates[f] !== undefined) payload[f] = updates[f];
        });

        let updatedData = null;
        if (Object.keys(payload).length > 0) {
            const dbRes = await dbUpdate('customers', 'id', id, payload).catch(err => {
                console.warn('[Customers API] dbUpdate error:', err.message);
                return null;
            });
            updatedData = dbRes?.data;
        }

        // Update balances in meta store if in test mode
        const metaStore = loadCustomersMeta();
        const normPhone = updates.customer_phone ? normalizePhone(updates.customer_phone) : null;
        const currentMeta = metaStore[id] || (normPhone ? metaStore[normPhone] : {}) || {};

        if (updates.wallet_balance !== undefined) {
            currentMeta.wallet_balance = Math.max(0, Number(updates.wallet_balance));
        }
        if (updates.points_balance !== undefined) {
            currentMeta.points_balance = Math.max(0, Number(updates.points_balance));
        }
        currentMeta.updated_at = new Date().toISOString();

        if (process.env.NODE_ENV === 'test') {
            metaStore[id] = currentMeta;
            if (normPhone) metaStore[normPhone] = currentMeta;
            saveCustomersMeta(metaStore);
        }

        return res.json({
            success: true,
            data: {
                ...(updatedData || payload),
                id,
                wallet_balance: payload.wallet_balance ?? currentMeta.wallet_balance ?? 0,
                points_balance: payload.points_balance ?? currentMeta.points_balance ?? 0
            }
        });
    } catch (e) {
        console.error('[Customers API] handleUpdateCustomer error:', e);
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
}

/**
 * POST /api/customers/:id/adjust-balance
 * Adjust customer wallet balance or Wishrite reward points with audit note
 */
export async function handleAdjustCustomerBalance(req, res) {
    try {
        const { id } = req.params;
        const { wallet_delta, points_delta, note, admin_user } = req.body || {};

        // 1. Fetch current balances directly from Supabase customers table
        let currentWallet = 0;
        let currentPoints = 0;
        try {
            const dbCust = await dbQuery('customers', `id=eq.${encodeURIComponent(id)}&limit=1`);
            if (dbCust && dbCust[0]) {
                currentWallet = Number(dbCust[0].wallet_balance || 0);
                currentPoints = Number(dbCust[0].points_balance || 0);
            }
        } catch (dbErr) {
            console.warn('[Customers API] dbQuery customers notice:', dbErr.message);
        }

        const newWallet = Math.max(0, currentWallet + Number(wallet_delta || 0));
        const newPoints = Math.max(0, currentPoints + Number(points_delta || 0));

        const auditItem = {
            date: new Date().toISOString(),
            wallet_delta: Number(wallet_delta || 0),
            wallet_balance_after: newWallet,
            points_delta: Number(points_delta || 0),
            points_balance_after: newPoints,
            note: note || 'Admin balance adjustment',
            admin_user: admin_user || 'Admin'
        };

        // 2. Persist directly to Supabase customers table
        await dbUpdate('customers', 'id', id, {
            wallet_balance: newWallet,
            points_balance: newPoints,
            updated_at: new Date().toISOString()
        });

        // 3. Keep test meta store updated if running in test environment
        if (process.env.NODE_ENV === 'test') {
            const metaStore = loadCustomersMeta();
            const currentMeta = metaStore[id] || {};
            const auditTrail = currentMeta.audit_trail || [];
            auditTrail.unshift(auditItem);
            metaStore[id] = {
                ...currentMeta,
                wallet_balance: newWallet,
                points_balance: newPoints,
                audit_trail: auditTrail.slice(0, 50),
                updated_at: new Date().toISOString()
            };
            saveCustomersMeta(metaStore);
        }

        return res.json({
            success: true,
            message: 'Customer balances updated successfully',
            data: {
                id,
                wallet_balance: newWallet,
                points_balance: newPoints,
                audit: auditItem
            }
        });
    } catch (e) {
        console.error('[Customers API] handleAdjustCustomerBalance error:', e);
        return res.status(500).json({ success: false, error: { message: e.message } });
    }
}

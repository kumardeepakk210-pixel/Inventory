// ==============================================================================
// WISHRITE INVENTORY — CENTRALIZED FRONTEND API CLIENT
// Connects the browser UI to the server-side API layer.
// NEVER accesses Supabase directly from the browser.
// ==============================================================================

(function() {
    class WishRiteApiClient {
        constructor() {
            // Read public base URL from window.WISHRITE_CONFIG or fallback to relative '/api'
            this.baseUrl = (window.WISHRITE_CONFIG && window.WISHRITE_CONFIG.apiBaseUrl) || '/api';
        }

        /**
         * Generic HTTP Request Wrapper
         */
        async request(endpoint, options = {}) {
            const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            const url = `${this.baseUrl}${cleanEndpoint}`;

            let token = null;
            let user = null;
            try {
                if (typeof localStorage !== 'undefined') {
                    token = localStorage.getItem('wishrite_token');
                    const rawUser = localStorage.getItem('wishrite_user');
                    if (rawUser) user = JSON.parse(rawUser);
                }
            } catch (e) {}

            const headers = {
                'Accept': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                ...(user?.user_id ? { 'X-User-Id': user.user_id } : {}),
                ...(user?.role ? { 'X-User-Role': user.role } : {}),
                ...options.headers
            };

            if (options.body && !(options.body instanceof FormData)) {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(options.body);
            }

            try {
                const response = await fetch(url, {
                    ...options,
                    headers
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    const errorMsg = data?.error?.message || data?.message || response.statusText || 'API Request Failed';
                    const err = new Error(errorMsg);
                    err.status = response.status;
                    err.code = data?.error?.code;
                    err.details = data;
                    throw err;
                }

                return data;
            } catch (err) {
                console.error(`[WishRiteAPI Error ${options.method || 'GET'} ${url}]:`, err);
                throw err;
            }
        }

        get(endpoint, params = null) {
            let url = endpoint;
            if (params && typeof params === 'object') {
                const searchParams = new URLSearchParams();
                Object.entries(params).forEach(([k, v]) => {
                    if (v !== undefined && v !== null && v !== '') {
                        searchParams.append(k, v);
                    }
                });
                const q = searchParams.toString();
                if (q) url += (url.includes('?') ? '&' : '?') + q;
            }
            return this.request(url, { method: 'GET' });
        }

        post(endpoint, body) {
            return this.request(endpoint, { method: 'POST', body });
        }

        patch(endpoint, body) {
            return this.request(endpoint, { method: 'PATCH', body });
        }

        put(endpoint, body) {
            return this.request(endpoint, { method: 'PUT', body });
        }

        delete(endpoint) {
            return this.request(endpoint, { method: 'DELETE' });
        }

        // ==============================================================================
        // PRODUCT OPERATIONS
        // ==============================================================================

        async getProducts(filters = {}) {
            const res = await this.get('/products', filters);
            return res.data || [];
        }

        async getProduct(idOrSku) {
            const res = await this.get(`/products/${encodeURIComponent(idOrSku)}`);
            return res.data;
        }

        async saveProduct(payload, mode = 'create', idOrSku = null) {
            if (mode === 'create') {
                return await this.post('/products', payload);
            } else {
                const target = idOrSku || payload.product_code || payload.id;
                return await this.patch(`/products/${encodeURIComponent(target)}`, payload);
            }
        }

        async deleteProduct(idOrSku, hardDelete = false) {
            return await this.request(`/products/${encodeURIComponent(idOrSku)}${hardDelete ? '?hardDelete=true' : ''}`, {
                method: 'DELETE'
            });
        }

        // ==============================================================================
        // IMAGE OPERATIONS (Via Server-side Supabase Storage)
        // ==============================================================================

        async getProductImages(sku) {
            const res = await this.get(`/products/${encodeURIComponent(sku)}/images`);
            return res.data || [];
        }

        async uploadProductImage(sku, file, isPrimary = false) {
            const formData = new FormData();
            formData.append('image', file);
            if (isPrimary) formData.append('is_primary', 'true');

            return await this.request(`/products/${encodeURIComponent(sku)}/images`, {
                method: 'POST',
                body: formData
            });
        }

        async deleteProductImage(sku, fileName) {
            return await this.delete(`/products/${encodeURIComponent(sku)}/images/${encodeURIComponent(fileName)}`);
        }

        // ==============================================================================
        // OCCASIONS & FESTIVE SETTINGS
        // ==============================================================================

        async getOccasionSettings() {
            const res = await this.get('/settings/occasion');
            return res.settings || res.data || res;
        }

        async updateOccasionSettings(settings) {
            const res = await this.patch('/settings/occasion', settings);
            return res;
        }

        async getOccasions() {
            const res = await this.get('/occasions');
            return res.data || [];
        }

        async saveOccasionExperience(payload) {
            const res = await this.post('/occasions', payload);
            return res.data;
        }

        async getOccasionProducts(filters = {}) {
            const res = await this.get('/occasions/products', filters);
            return res.data || [];
        }

        async getOccasionCounts() {
            const res = await this.get('/occasions/counts');
            return res.data || {};
        }

        async saveOccasionProduct(payload, mode = 'create', idOrSku = null) {
            if (mode === 'create') {
                return await this.post('/occasions/products', payload);
            } else {
                const target = idOrSku || payload.product_code || payload.id;
                return await this.patch(`/occasions/products/${encodeURIComponent(target)}`, payload);
            }
        }

        async deleteOccasionProduct(idOrSku) {
            return await this.delete(`/occasions/products/${encodeURIComponent(idOrSku)}`);
        }

        // ==============================================================================
        // OFFERS & COUPONS
        // ==============================================================================

        async getOffers(occasionSlug = null) {
            const res = await this.get('/offers', occasionSlug ? { occasion: occasionSlug } : null);
            return res.data || [];
        }

        async createOffer(offerData) {
            const res = await this.post('/offers', offerData);
            return res.data;
        }

        async deleteOffer(id) {
            return await this.delete(`/offers/${encodeURIComponent(id)}`);
        }

        // ==============================================================================
        // DASHBOARD & AI INSIGHTS
        // ==============================================================================

        async getDashboardSummary() {
            const res = await this.get('/dashboard/summary');
            return res.data;
        }

        async getDashboardInsights() {
            const res = await this.get('/dashboard/insights');
            return res.data;
        }

        async getDashboardCategories() {
            const res = await this.get('/dashboard/categories');
            return res.data || [];
        }

        // ==============================================================================
        // AUTHENTICATION & EMPLOYEES
        // ==============================================================================

        async login(userId, pin) {
            return await this.post('/auth/login', { user_id: userId, pin });
        }

        async checkSetupStatus() {
            return await this.get('/auth/setup-status');
        }

        async initialSetup(payload) {
            return await this.post('/auth/setup', payload);
        }

        async getEmployees() {
            const res = await this.get('/employees');
            return res.data || [];
        }

        async createEmployee(payload) {
            return await this.post('/employees', payload);
        }

        async getPublicConfig() {
            const res = await this.get('/public-config');
            return res.data;
        }

        async checkDbHealth() {
            return await this.get('/health/database');
        }

        /**
         * Initialize the REAL Supabase JS Client for Realtime & Customer Auth
         * Uses public URL and public Anon Key strictly; never receives service-role key.
         */
        async initRealSupabaseClient() {
            try {
                if (window.realSupaClient) return window.realSupaClient;

                // Ensure Supabase JS library is loaded
                if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                    await new Promise((resolve, reject) => {
                        const existingScript = document.querySelector('script[src*="@supabase/supabase-js"]');
                        if (existingScript) {
                            existingScript.addEventListener('load', resolve, { once: true });
                            existingScript.addEventListener('error', reject, { once: true });
                            return;
                        }
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
                        script.async = true;
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error('Failed to load @supabase/supabase-js'));
                        document.head.appendChild(script);
                    });
                }

                // Fetch safe public config
                const config = await this.getPublicConfig();
                if (!config || !config.supabase_url || !config.supabase_anon_key) {
                    throw new Error('Supabase public config unavailable');
                }

                // Create REAL Supabase Client using public URL and anon key
                const realClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
                window.realSupaClient = realClient;

                // Wire up window.supaClient
                window.supaClient.channel = realClient.channel.bind(realClient);
                window.supaClient.removeChannel = realClient.removeChannel.bind(realClient);
                window.supaClient.getChannels = realClient.getChannels.bind(realClient);
                window.supaClient.auth = realClient.auth;
                window.supaClient.storage = realClient.storage;
                window.supaClient.nativeFrom = realClient.from.bind(realClient);

                console.log('[Supabase Client] Initialized real Supabase client for Realtime & Auth');
                return realClient;
            } catch (err) {
                console.warn('[Supabase Client] Could not initialize real Supabase client:', err.message);
                return null;
            }
        }

        // ==============================================================================
        // SALES & CATEGORIES
        // ==============================================================================

        async getSales() {
            const res = await this.get('/sales');
            return res.data || [];
        }

        async createSale(salePayload) {
            return await this.post('/sales', salePayload);
        }

        async getCategories() {
            const res = await this.get('/categories');
            return res.data || [];
        }

        async createCategory(categoryName, codePrefix) {
            return await this.post('/categories', { category_name: categoryName, code_prefix: codePrefix });
        }

        async getBusinessConfig() {
            const res = await this.get('/business-config');
            return res.data;
        }

        async saveBusinessConfig(config) {
            return await this.post('/business-config', config);
        }

        // ==============================================================================
        // HEALTH
        // ==============================================================================

        async checkHealth() {
            return await this.get('/health');
        }

        // ==============================================================================
        // GENERIC TABLE QUERY BUILDER
        // ==============================================================================

        table(tableName) {
            return new SupabaseTableQuery(this, tableName);
        }
    }

    /**
     * Query Builder adapting frontend queries to secure /api/db/:table endpoints
     */
    class SupabaseTableQuery {
        constructor(client, tableName) {
            this.client = client;
            this.tableName = tableName;
            this.filters = [];
            this.orderClause = '';
            this.limitVal = null;
            this.isSingle = false;
            this.action = 'select';
            this.payload = null;
        }

        select(fields = '*') {
            this.action = 'select';
            return this;
        }

        eq(col, val) {
            this.filters.push({ col, val });
            return this;
        }

        order(col, opts = {}) {
            const dir = opts.ascending === false ? 'desc' : 'asc';
            this.orderClause = `${col}.${dir}`;
            return this;
        }

        limit(n) {
            this.limitVal = n;
            return this;
        }

        single() {
            this.isSingle = true;
            return this;
        }

        maybeSingle() {
            this.isSingle = true;
            return this;
        }

        insert(data) {
            this.action = 'insert';
            this.payload = data;
            return this;
        }

        upsert(data) {
            this.action = 'insert';
            this.payload = data;
            return this;
        }

        update(data) {
            this.action = 'update';
            this.payload = data;
            return this;
        }

        delete() {
            this.action = 'delete';
            return this;
        }

        async execute() {
            try {
                if (this.action === 'select') {
                    // Route to specific optimized APIs when available
                    if (this.tableName === 'inventory') {
                        const products = await this.client.getProducts();
                        let filtered = products;
                        for (const f of this.filters) {
                            filtered = filtered.filter(item => String(item[f.col]) === String(f.val));
                        }
                        if (this.isSingle) {
                            return { data: filtered[0] || null, error: null };
                        }
                        return { data: filtered, error: null };
                    }
                    if (this.tableName === 'sales') {
                        const sales = await this.client.getSales();
                        return { data: sales, error: null };
                    }

                    // Auxiliary tables route to /api/db/:table
                    const params = {};
                    this.filters.forEach(f => { params[f.col] = `eq.${f.val}`; });
                    if (this.orderClause) params.order = this.orderClause;
                    if (this.limitVal) params.limit = this.limitVal;
                    
                    const res = await this.client.get(`/db/${this.tableName}`, params);
                    let rows = res.data || [];
                    if (this.isSingle) {
                        return { data: rows[0] || null, error: null };
                    }
                    return { data: rows, error: null };
                }

                if (this.action === 'insert') {
                    const res = await this.client.post(`/db/${this.tableName}`, this.payload);
                    return { data: res.data ? (Array.isArray(res.data) ? res.data : [res.data]) : [], error: null };
                }

                if (this.action === 'update') {
                    const primaryFilter = this.filters[0] || { col: 'id', val: 1 };
                    const res = await this.client.patch(`/db/${this.tableName}`, {
                        filterKey: primaryFilter.col,
                        filterVal: primaryFilter.val,
                        ...(this.payload || {})
                    });
                    return { data: res.data, error: null };
                }

                if (this.action === 'delete') {
                    const primaryFilter = this.filters[0] || { col: 'id', val: 0 };
                    await this.client.request(`/db/${this.tableName}?filterKey=${encodeURIComponent(primaryFilter.col)}&filterVal=${encodeURIComponent(primaryFilter.val)}`, {
                        method: 'DELETE'
                    });
                    return { data: true, error: null };
                }

                return { data: null, error: null };
            } catch (err) {
                return { data: null, error: { message: err.message, code: err.code || 'API_ERROR' } };
            }
        }

        // Make QueryBuilder thenable so it can be awaited directly
        then(resolve, reject) {
            return this.execute().then(resolve, reject);
        }
    }

    // Expose API Client Singleton
    window.WishRiteAPI = new WishRiteApiClient();
    window.apiClient = window.WishRiteAPI;

    // Supabase API Adapter (Routes Admin CRUD to API, Realtime/Auth to real Supabase client)
    window.supaClient = {
        from: (tableName) => window.WishRiteAPI.table(tableName),
        storage: {
            from: (bucket) => ({
                list: async (p, opts) => {
                    if (window.realSupaClient?.storage) return window.realSupaClient.storage.from(bucket).list(p, opts);
                    return { data: [{ name: 'ready' }], error: null };
                },
                getPublicUrl: (p) => {
                    if (window.realSupaClient?.storage) return window.realSupaClient.storage.from(bucket).getPublicUrl(p);
                    return { data: { publicUrl: p.startsWith('http') ? p : `/api/products/${encodeURIComponent(p)}/images` } };
                },
                upload: async (p, f, opts) => {
                    if (window.realSupaClient?.storage) return window.realSupaClient.storage.from(bucket).upload(p, f, opts);
                    return { data: { path: p }, error: null };
                },
                remove: async (paths) => {
                    if (window.realSupaClient?.storage) return window.realSupaClient.storage.from(bucket).remove(paths);
                    return { data: {}, error: null };
                }
            })
        },
        channel: function(channelName, opts) {
            if (window.realSupaClient?.channel) {
                return window.realSupaClient.channel(channelName, opts);
            }
            console.warn(`[Realtime] channel('${channelName}') requested before real Supabase client ready. Initializing...`);
            // Attempt auto-initialization in background
            window.WishRiteAPI.initRealSupabaseClient();
            throw new Error(`Realtime channel '${channelName}' cannot be opened: client is still connecting.`);
        },
        removeChannel: function(ch) {
            if (window.realSupaClient?.removeChannel) {
                return window.realSupaClient.removeChannel(ch);
            }
        },
        getChannels: function() {
            if (window.realSupaClient?.getChannels) {
                return window.realSupaClient.getChannels();
            }
            return [];
        },
        auth: {
            signInWithOtp: async (params) => {
                if (window.realSupaClient?.auth) return window.realSupaClient.auth.signInWithOtp(params);
                throw new Error("Supabase Auth client is not yet initialized.");
            },
            verifyOtp: async (params) => {
                if (window.realSupaClient?.auth) return window.realSupaClient.auth.verifyOtp(params);
                throw new Error("Supabase Auth client is not yet initialized.");
            },
            updateUser: async (attributes) => {
                if (window.realSupaClient?.auth) return window.realSupaClient.auth.updateUser(attributes);
                throw new Error("Supabase Auth client is not yet initialized.");
            }
        }
    };
})();

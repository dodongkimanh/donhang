// Mock Supabase client for demo/local testing without a real Supabase project

type Row = Record<string, unknown>

// ── In-memory store ──────────────────────────────────────────────────────────

const store: Record<string, Row[]> = {
  profiles: [],
  categories: [],
  suppliers: [],
  products: [],
  product_suppliers: [],
  inventory_transactions: [],
  supplier_payments: [],
  product_batches: [],
  customers: [],
  orders: [],
  order_items: [],
  order_notes: [],
  order_sources: [],
  attendance: [],
  routes: [],
  route_orders: [],
  stock_calls: [],
  stock_call_notes: [],
  auth_users: [],
}

// ── Sync product totals from product_suppliers ────────────────────────────────

function syncProductTotals(productId?: string) {
  const psList = store.product_suppliers as Row[]
  const products = store.products as Row[]

  const toSync = productId ? products.filter((p) => p.id === productId) : products
  toSync.forEach((product) => {
    const nccs = psList.filter((ps) => ps.product_id === product.id)
    if (nccs.length > 0) {
      const totalQty = nccs.reduce((s, ps) => s + ((ps.quantity as number) || 0), 0)
      const avgCost = nccs.reduce((s, ps) => s + ((ps.cost_price as number) || 0), 0) / nccs.length
      product.quantity = totalQty
      product.cost_price = Math.round(avgCost)
      // Use first NCC's barcode as product barcode if not manually set
      if (nccs[0]?.barcode) product.barcode = nccs[0].barcode as string
    }
  })
}

// ── Relationships (for join resolution) ──────────────────────────────────────

interface Relation {
  table: string
  foreignKey: string
  type: 'belongsTo' | 'hasMany'
}

const relations: Record<string, Record<string, Relation>> = {
  products: {
    category: { table: 'categories', foreignKey: 'category_id', type: 'belongsTo' },
    product_suppliers: { table: 'product_suppliers', foreignKey: 'product_id', type: 'hasMany' },
  },
  product_suppliers: {
    supplier: { table: 'suppliers', foreignKey: 'supplier_id', type: 'belongsTo' },
    product: { table: 'products', foreignKey: 'product_id', type: 'belongsTo' },
  },
  inventory_transactions: {
    product: { table: 'products', foreignKey: 'product_id', type: 'belongsTo' },
    profile: { table: 'profiles', foreignKey: 'created_by', type: 'belongsTo' },
    supplier: { table: 'suppliers', foreignKey: 'supplier_id', type: 'belongsTo' },
  },
  supplier_payments: {
    profile: { table: 'profiles', foreignKey: 'created_by', type: 'belongsTo' },
  },
  product_batches: {
    product: { table: 'products', foreignKey: 'product_id', type: 'belongsTo' },
    supplier: { table: 'suppliers', foreignKey: 'supplier_id', type: 'belongsTo' },
  },
  orders: {
    customer: { table: 'customers', foreignKey: 'customer_id', type: 'belongsTo' },
    employee: { table: 'profiles', foreignKey: 'employee_id', type: 'belongsTo' },
    items: { table: 'order_items', foreignKey: 'order_id', type: 'hasMany' },
    notes: { table: 'order_notes', foreignKey: 'order_id', type: 'hasMany' },
    source: { table: 'order_sources', foreignKey: 'source_id', type: 'belongsTo' },
  },
  order_notes: {
    profile: { table: 'profiles', foreignKey: 'created_by', type: 'belongsTo' },
  },
  order_items: {
    product: { table: 'products', foreignKey: 'product_id', type: 'belongsTo' },
    supplier: { table: 'suppliers', foreignKey: 'supplier_id', type: 'belongsTo' },
  },
  attendance: {
    employee: { table: 'profiles', foreignKey: 'employee_id', type: 'belongsTo' },
  },
  customers: {
    creator: { table: 'profiles', foreignKey: 'created_by', type: 'belongsTo' },
  },
  routes: {
    route_orders: { table: 'route_orders', foreignKey: 'route_id', type: 'hasMany' },
  },
  route_orders: {
    order: { table: 'orders', foreignKey: 'order_id', type: 'belongsTo' },
    route: { table: 'routes', foreignKey: 'route_id', type: 'belongsTo' },
  },
}

function resolveRow(tableName: string, row: Row, depth = 0): Row {
  if (depth >= 4) return row
  const tableRels = relations[tableName] ?? {}
  const result = { ...row }
  for (const [alias, rel] of Object.entries(tableRels)) {
    if (rel.type === 'belongsTo') {
      const fkValue = row[rel.foreignKey]
      const found = fkValue ? store[rel.table]?.find((r) => r.id === fkValue) : null
      result[alias] = found ? resolveRow(rel.table, found, depth + 1) : null
    } else if (rel.type === 'hasMany') {
      const related = store[rel.table]?.filter((r) => r[rel.foreignKey] === row.id) ?? []
      result[alias] = related.map((r) => resolveRow(rel.table, r, depth + 1))
    }
  }
  return result
}

function now() {
  return new Date().toISOString()
}

function uid() {
  return crypto.randomUUID()
}

// ── Query builder ─────────────────────────────────────────────────────────────

type Op = 'eq' | 'gte' | 'lte' | 'neq' | 'in'
interface Filter { field: string; op: Op; value: unknown }

class MockQueryBuilder {
  private tableName: string
  private _filters: Filter[] = []
  private _order?: { col: string; asc: boolean }
  private _limit?: number
  private _single = false
  private _maybeSingle = false
  private _head = false
  private _countMode = false

  private _operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private _writeData?: unknown
  private _selectAfterWrite = false
  private _upsertConflict?: string

  constructor(table: string) {
    this.tableName = table
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this._operation !== 'select') {
      this._selectAfterWrite = true
    }
    if (opts?.head) this._head = true
    if (opts?.count) this._countMode = true
    return this
  }

  insert(data: unknown): this {
    this._operation = 'insert'
    this._writeData = data
    return this
  }

  update(data: unknown): this {
    this._operation = 'update'
    this._writeData = data
    return this
  }

  delete(): this {
    this._operation = 'delete'
    return this
  }

  upsert(data: unknown, opts?: { onConflict?: string }): this {
    this._operation = 'upsert'
    this._writeData = data
    this._upsertConflict = opts?.onConflict
    return this
  }

  eq(field: string, value: unknown): this {
    this._filters.push({ field, op: 'eq', value })
    return this
  }

  gte(field: string, value: unknown): this {
    this._filters.push({ field, op: 'gte', value })
    return this
  }

  lte(field: string, value: unknown): this {
    this._filters.push({ field, op: 'lte', value })
    return this
  }

  neq(field: string, value: unknown): this {
    this._filters.push({ field, op: 'neq', value })
    return this
  }

  in(field: string, values: unknown[]): this {
    this._filters.push({ field, op: 'in', value: values })
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this._order = { col, asc: opts?.ascending ?? true }
    return this
  }

  limit(n: number): this {
    this._limit = n
    return this
  }

  single(): this { this._single = true; return this }
  maybeSingle(): this { this._maybeSingle = true; return this }

  then<T>(
    resolve: (val: { data: unknown; error: null; count?: number | null }) => T,
  ): Promise<T> {
    return Promise.resolve(this._execute()).then(resolve)
  }

  private _matchFilters(row: Row): boolean {
    return this._filters.every(({ field, op, value }) => {
      const v = row[field]
      if (op === 'eq') return v === value
      if (op === 'gte') return String(v) >= String(value)
      if (op === 'lte') return String(v) <= String(value)
      if (op === 'neq') return v !== value
      if (op === 'in') return Array.isArray(value) && value.includes(v)
      return true
    })
  }

  private _execute(): { data: unknown; error: null; count?: number | null } {
    const table = store[this.tableName]
    if (!table) return { data: null, error: null }

    // ── INSERT ──────────────────────────────────────
    if (this._operation === 'insert') {
      const insertOne = (payload: Row): Row => {
        const row: Row = {
          id: uid(),
          created_at: now(),
          updated_at: now(),
          ...payload,
        }
        table.push(row)
        return row
      }

      let inserted: Row | Row[]
      if (Array.isArray(this._writeData)) {
        inserted = (this._writeData as Row[]).map(insertOne)
      } else {
        inserted = insertOne(this._writeData as Row)
      }

      // Sync product totals when product_suppliers change
      if (this.tableName === 'product_suppliers') {
        const entries = Array.isArray(inserted) ? inserted : [inserted]
        entries.forEach((e) => syncProductTotals(e.product_id as string))
      }

      if (this._selectAfterWrite) {
        if (this._single || !Array.isArray(inserted)) {
          return { data: Array.isArray(inserted) ? inserted[0] : inserted, error: null }
        }
        return { data: inserted, error: null }
      }
      return { data: null, error: null }
    }

    // ── UPDATE ──────────────────────────────────────
    if (this._operation === 'update') {
      const affected: string[] = []
      store[this.tableName] = table.map((row) => {
        if (this._matchFilters(row)) {
          if (this.tableName === 'product_suppliers') {
            affected.push(row.product_id as string)
          }
          return { ...row, ...(this._writeData as Row), updated_at: now() }
        }
        return row
      })
      affected.forEach((pid) => syncProductTotals(pid))
      return { data: null, error: null }
    }

    // ── DELETE ──────────────────────────────────────
    if (this._operation === 'delete') {
      const affected: string[] = []
      if (this.tableName === 'product_suppliers') {
        table.filter((row) => this._matchFilters(row)).forEach((row) => {
          affected.push(row.product_id as string)
        })
      }
      store[this.tableName] = table.filter((row) => !this._matchFilters(row))
      affected.forEach((pid) => syncProductTotals(pid))
      return { data: null, error: null }
    }

    // ── UPSERT ──────────────────────────────────────
    if (this._operation === 'upsert') {
      const conflictField = this._upsertConflict
      const upsertOne = (payload: Row): Row => {
        if (conflictField) {
          const conflictValue = payload[conflictField]
          const idx = table.findIndex((r) => r[conflictField] === conflictValue)
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...payload, updated_at: now() }
            return table[idx]
          }
        }
        const row: Row = { id: uid(), created_at: now(), ...payload }
        table.push(row)
        return row
      }
      if (Array.isArray(this._writeData)) {
        (this._writeData as Row[]).forEach(upsertOne)
      } else {
        upsertOne(this._writeData as Row)
      }
      return { data: null, error: null }
    }

    // ── SELECT ──────────────────────────────────────
    let rows = table.filter((row) => this._matchFilters(row))

    if (this._countMode && this._head) {
      return { data: null, error: null, count: rows.length }
    }

    // Resolve joins
    rows = rows.map((row) => resolveRow(this.tableName, row))

    // Order
    if (this._order) {
      const { col, asc } = this._order
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? '')
        const bv = String(b[col] ?? '')
        return asc ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }

    // Limit
    if (this._limit !== undefined) rows = rows.slice(0, this._limit)

    if (this._single || this._maybeSingle) {
      return { data: rows[0] ?? null, error: null }
    }

    return { data: rows, error: null }
  }
}

// ── Auth mock ─────────────────────────────────────────────────────────────────

interface AuthUser { id: string; email: string; password: string }
type AuthListener = (event: string, session: { user: { id: string; email: string } } | null) => void

const SESSION_KEY = '_mock_session'

function loadSession(): { user: { id: string; email: string } } | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') } catch { return null }
}
function saveSession(s: { user: { id: string; email: string } } | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

let _session: { user: { id: string; email: string } } | null = loadSession()
const _listeners: AuthListener[] = []

function _notify(event: string) {
  _listeners.forEach((fn) => fn(event, _session))
}

const mockAuth = {
  getSession: () =>
    Promise.resolve({ data: { session: _session }, error: null }),

  onAuthStateChange: (callback: AuthListener) => {
    _listeners.push(callback)
    setTimeout(() => callback(_session ? 'SIGNED_IN' : 'SIGNED_OUT', _session), 0)
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            const i = _listeners.indexOf(callback)
            if (i >= 0) _listeners.splice(i, 1)
          },
        },
      },
    }
  },

  signInWithPassword: ({ email, password }: { email: string; password: string }) => {
    const users = store.auth_users as unknown as AuthUser[]
    const user = users.find((u) => u.email === email && u.password === password)
    if (user) {
      _session = { user: { id: user.id, email: user.email } }
      saveSession(_session)
      _notify('SIGNED_IN')
      return Promise.resolve({ error: null })
    }
    return Promise.resolve({ error: { message: 'Email hoặc mật khẩu không đúng' } })
  },

  signOut: () => {
    _session = null
    saveSession(null)
    _notify('SIGNED_OUT')
    return Promise.resolve({ error: null })
  },

  signUp: ({ email, password }: { email: string; password: string }) => {
    const existing = (store.auth_users as unknown as AuthUser[]).find((u) => u.email === email)
    if (existing) return Promise.resolve({ data: { user: null }, error: { message: 'Email đã tồn tại' } })
    const id = uid()
    ;(store.auth_users as unknown as AuthUser[]).push({ id, email, password })
    return Promise.resolve({ data: { user: { id, email } }, error: null })
  },

  updateUser: ({ password }: { password: string }) => {
    if (!_session) return Promise.resolve({ data: {}, error: { message: 'Chưa đăng nhập' } })
    const users = store.auth_users as unknown as AuthUser[]
    const user = users.find((u) => u.id === (_session as { user: { id: string } }).user.id)
    if (user) user.password = password
    return Promise.resolve({ data: {}, error: null })
  },

  admin: {
    createUser: ({ email, password }: { email: string; password: string; email_confirm: boolean }) => {
      const id = uid()
      ;(store.auth_users as unknown as AuthUser[]).push({ id, email, password })
      return Promise.resolve({ data: { user: { id, email } }, error: null })
    },
    deleteUser: (_id: string) => Promise.resolve({ error: null }),
    updateUserById: (id: string, { password }: { password: string }) => {
      const users = store.auth_users as unknown as AuthUser[]
      const user = users.find((u) => u.id === id)
      if (user) user.password = password
      return Promise.resolve({ data: {}, error: null })
    },
  },
}

// ── Public mock client ────────────────────────────────────────────────────────

export const mockSupabase = {
  from: (table: string) => new MockQueryBuilder(table),
  auth: mockAuth,
}

// ── Seed data ─────────────────────────────────────────────────────────────────

export function seedDemoData() {
  const adminUserId = 'auth-admin-001'
  const empUserId = 'auth-emp-001'
  const acctUserId = 'auth-acct-001'

  const adminProfileId = 'profile-admin-001'
  const empProfileId = 'profile-emp-001'
  const acctProfileId = 'profile-acct-001'

  const warehouseUserId = 'auth-wh-001'
  const warehouseProfileId = 'profile-wh-001'

  // Auth users (email dạng @kimanh.com)
  store.auth_users = [
    { id: adminUserId,      email: 'admin@kimanh.com',    password: 'admin123' },
    { id: empUserId,        email: 'sale@kimanh.com',     password: '123456' },
    { id: acctUserId,       email: 'ketoan@kimanh.com',   password: '123456' },
    { id: warehouseUserId,  email: 'kho@kimanh.com',      password: '123456' },
  ]

  // Profiles
  store.profiles = [
    { id: adminProfileId,     user_id: adminUserId,     full_name: 'Admin Kim Ánh',   role: 'admin',      email: 'admin@kimanh.com',  phone: '0901234567', created_at: now(), updated_at: now() },
    { id: empProfileId,       user_id: empUserId,       full_name: 'Nhân Viên Sale',  role: 'sale',       email: 'sale@kimanh.com',   phone: '0912345678', created_at: now(), updated_at: now() },
    { id: acctProfileId,      user_id: acctUserId,      full_name: 'Kế Toán Kim Ánh', role: 'accountant', email: 'ketoan@kimanh.com', phone: '0923456789', created_at: now(), updated_at: now() },
    { id: warehouseProfileId, user_id: warehouseUserId, full_name: 'Nhân Viên Kho',   role: 'warehouse',  email: 'kho@kimanh.com',    phone: '0934567890', created_at: now(), updated_at: now() },
  ]

  // Categories
  const cat1 = uid(), cat2 = uid(), cat3 = uid()
  store.categories = [
    { id: cat1, name: 'Điện Tử', description: 'Thiết bị điện tử, điện thoại, máy tính', created_at: now(), updated_at: now() },
    { id: cat2, name: 'Thực Phẩm', description: 'Thực phẩm, đồ uống', created_at: now(), updated_at: now() },
    { id: cat3, name: 'Văn Phòng Phẩm', description: 'Dụng cụ văn phòng, học sinh', created_at: now(), updated_at: now() },
  ]

  // Suppliers
  const sup1 = uid(), sup2 = uid(), sup3 = uid()
  store.suppliers = [
    { id: sup1, name: 'NCC Công Nghệ Viễn Đông', phone: '02871234567', email: 'info@viendong.vn', address: 'KCN Sóng Thần, Bình Dương', note: 'Phân phối chính hãng Apple, Samsung', created_at: now(), updated_at: now() },
    { id: sup2, name: 'NCC Thực Phẩm Sạch Miền Tây', phone: '02761234567', email: 'mientay@supplier.vn', address: 'Tp. Cần Thơ', note: 'Thực phẩm sạch, nước uống các loại', created_at: now(), updated_at: now() },
    { id: sup3, name: 'NCC Văn Phòng Phẩm Bắc Hà', phone: '02431234567', email: 'bac.ha@office.vn', address: 'Hoàn Kiếm, Hà Nội', note: 'Bút bi, văn phòng phẩm, học sinh', created_at: now(), updated_at: now() },
  ]

  // Products (quantity/cost_price will be sync'd from product_suppliers below)
  const p1 = uid(), p2 = uid(), p3 = uid(), p4 = uid(), p5 = uid()
  store.products = [
    { id: p1, category_id: cat1, name: 'iPhone 15 Pro', product_code: '1001', barcode: '8931234567890', cost_price: 0, sale_price: 28000000, quantity: 0, unit: 'cái', description: 'Apple iPhone 15 Pro 256GB', image_url: null, images: [], created_at: now(), updated_at: now() },
    { id: p2, category_id: cat1, name: 'Samsung Galaxy S24', product_code: '1002', barcode: '8939876543210', cost_price: 0, sale_price: 21000000, quantity: 0, unit: 'cái', description: 'Samsung Galaxy S24 128GB', image_url: null, images: [], created_at: now(), updated_at: now() },
    { id: p3, category_id: cat2, name: 'Nước suối Lavie 1.5L', product_code: '2001', barcode: '8934567890123', cost_price: 0, sale_price: 12000, quantity: 0, unit: 'chai', description: 'Thùng 24 chai', image_url: null, images: [], created_at: now(), updated_at: now() },
    { id: p4, category_id: cat3, name: 'Bút bi Thiên Long', product_code: '3001', barcode: '8936789012345', cost_price: 0, sale_price: 5000, quantity: 0, unit: 'cái', description: 'Hộp 12 cái', image_url: null, images: [], created_at: now(), updated_at: now() },
    { id: p5, category_id: cat1, name: 'Laptop Dell XPS 15', product_code: '1003', barcode: '8935678901234', cost_price: 0, sale_price: 39000000, quantity: 0, unit: 'cái', description: 'Intel Core i7, 16GB RAM, 512GB SSD', image_url: null, images: [], created_at: now(), updated_at: now() },
  ]

  // Product-Supplier entries (per-NCC stock & barcode)
  store.product_suppliers = [
    // iPhone 15 Pro – 2 NCCs
    { id: uid(), product_id: p1, supplier_id: sup1, barcode: '8931234567890', cost_price: 25000000, quantity: 10, note: 'Hàng chính hãng FPT phân phối', created_at: now(), updated_at: now() },
    { id: uid(), product_id: p1, supplier_id: sup2, barcode: '8931234567891', cost_price: 24500000, quantity: 5, note: 'Hàng nhập từ Singapore, fullbox', created_at: now(), updated_at: now() },
    // Samsung Galaxy S24 – 1 NCC
    { id: uid(), product_id: p2, supplier_id: sup1, barcode: '8939876543210', cost_price: 18000000, quantity: 8, note: 'Samsung chính hãng Việt Nam', created_at: now(), updated_at: now() },
    // Nước Lavie – 1 NCC
    { id: uid(), product_id: p3, supplier_id: sup2, barcode: '8934567890123', cost_price: 8000, quantity: 200, note: 'Phân phối chính thức Lavie miền Nam', created_at: now(), updated_at: now() },
    // Bút bi Thiên Long – 1 NCC
    { id: uid(), product_id: p4, supplier_id: sup3, barcode: '8936789012345', cost_price: 3000, quantity: 500, note: '', created_at: now(), updated_at: now() },
    // Laptop Dell XPS 15 – 2 NCCs
    { id: uid(), product_id: p5, supplier_id: sup1, barcode: '8935678901234', cost_price: 35000000, quantity: 3, note: 'Dell chính hãng VN bảo hành', created_at: now(), updated_at: now() },
    { id: uid(), product_id: p5, supplier_id: sup3, barcode: '8935678901235', cost_price: 34000000, quantity: 2, note: 'Hàng xách tay Mỹ, bảo hành quốc tế', created_at: now(), updated_at: now() },
  ]

  // Sync product totals from product_suppliers
  syncProductTotals()

  // Order sources
  const src1 = uid(), src2 = uid(), src3 = uid(), src4 = uid(), src5 = uid()
  store.order_sources = [
    { id: src1, name: 'Hotline', created_at: now(), updated_at: now() },
    { id: src2, name: 'Khách cũ', created_at: now(), updated_at: now() },
    { id: src3, name: 'Facebook', created_at: now(), updated_at: now() },
    { id: src4, name: 'Zalo', created_at: now(), updated_at: now() },
    { id: src5, name: 'Giới thiệu', created_at: now(), updated_at: now() },
  ]

  // Customers
  const cust1 = uid(), cust2 = uid(), cust3 = uid()
  store.customers = [
    { id: cust1, name: 'Công Ty ABC', phone: '0281234567', email: 'abc@company.vn', address: '123 Nguyễn Huệ, Q1, TP.HCM', note: 'Khách hàng VIP', created_by: empProfileId, created_at: now(), updated_at: now() },
    { id: cust2, name: 'Nguyễn Thị Mai', phone: '0987654321', email: 'mai@gmail.com', address: '45 Lê Lợi, Đà Nẵng', note: '', created_by: empProfileId, created_at: now(), updated_at: now() },
    { id: cust3, name: 'Shop Điện Tử XYZ', phone: '0765432100', email: 'xyz@shop.vn', address: '78 Trần Phú, Hà Nội', note: 'Mua sỉ', created_by: acctProfileId, created_at: now(), updated_at: now() },
  ]

  // Helper to build dates relative to today
  function dAt(monthsBack: number, day: number): string {
    const d = new Date()
    d.setMonth(d.getMonth() - monthsBack)
    d.setDate(day)
    d.setHours(10, 0, 0, 0)
    return d.toISOString()
  }

  // Orders – tháng này, tháng trước, năm trước để biểu đồ có dữ liệu
  const ord1 = uid(), ord2 = uid(), ord3 = uid()
  const ord4 = uid(), ord5 = uid()
  const ord6 = uid(), ord7 = uid(), ord8 = uid(), ord9 = uid()
  const ord10 = uid(), ord11 = uid(), ord12 = uid(), ord13 = uid(), ord14 = uid(), ord15 = uid()
  store.orders = [
    // Tháng này (tuần 1)
    { id: ord1, order_number: 'DH260601001', customer_id: cust1, employee_id: empProfileId, status: 'completed', total_amount: 49000000, discount: 1000000, final_amount: 48000000, note: 'Giao hàng tận nơi', shipping_carrier: 'ghtk', shipping_code: 'GHTK123456789', source_id: src2, created_at: dAt(0, 3), updated_at: dAt(0, 3) },
    // Tháng này (tuần 2)
    { id: ord2, order_number: 'DH260601002', customer_id: cust2, employee_id: empProfileId, status: 'shipping', total_amount: 21000000, discount: 0, final_amount: 21000000, note: '', shipping_carrier: 'viettel', shipping_code: 'VTP987654321', source_id: src4, created_at: dAt(0, 10), updated_at: dAt(0, 10) },
    // Tháng này (tuần 1) – admin
    { id: ord3, order_number: 'DH260601003', customer_id: null, employee_id: adminProfileId, status: 'placed', total_amount: 39000000, discount: 0, final_amount: 39000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src1, created_at: dAt(0, 5), updated_at: dAt(0, 5) },
    // Tháng này (tuần 3) – nhân viên
    { id: ord4, order_number: 'DH260614001', customer_id: cust3, employee_id: empProfileId, status: 'completed', total_amount: 28000000, discount: 0, final_amount: 28000000, note: '', shipping_carrier: 'ghtk', shipping_code: '', source_id: src3, created_at: dAt(0, 17), updated_at: dAt(0, 17) },
    // Tháng này (tuần 4) – kế toán
    { id: ord5, order_number: 'DH260622001', customer_id: cust1, employee_id: acctProfileId, status: 'confirmed', total_amount: 14000000, discount: 0, final_amount: 14000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src5, created_at: dAt(0, 23), updated_at: dAt(0, 23) },

    // Tháng trước (tuần 1) – nhân viên
    { id: ord6, order_number: 'DH260503001', customer_id: cust2, employee_id: empProfileId, status: 'completed', total_amount: 56000000, discount: 0, final_amount: 56000000, note: '', shipping_carrier: 'viettel', shipping_code: '', source_id: src2, created_at: dAt(1, 6), updated_at: dAt(1, 6) },
    // Tháng trước (tuần 2) – admin
    { id: ord7, order_number: 'DH260510001', customer_id: cust3, employee_id: adminProfileId, status: 'completed', total_amount: 39000000, discount: 0, final_amount: 39000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src1, created_at: dAt(1, 12), updated_at: dAt(1, 12) },
    // Tháng trước (tuần 3) – kế toán
    { id: ord8, order_number: 'DH260518001', customer_id: cust1, employee_id: acctProfileId, status: 'completed', total_amount: 21000000, discount: 0, final_amount: 21000000, note: '', shipping_carrier: 'ghtk', shipping_code: '', source_id: src4, created_at: dAt(1, 19), updated_at: dAt(1, 19) },
    // Tháng trước (tuần 4) – nhân viên
    { id: ord9, order_number: 'DH260525001', customer_id: cust2, employee_id: empProfileId, status: 'returned', total_amount: 12000000, discount: 0, final_amount: 12000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src3, created_at: dAt(1, 26), updated_at: dAt(1, 26) },

    // Năm trước – tháng 1
    { id: ord10, order_number: 'DH250115001', customer_id: cust1, employee_id: empProfileId, status: 'completed', total_amount: 43000000, discount: 0, final_amount: 43000000, note: '', shipping_carrier: 'viettel', shipping_code: '', source_id: src2, created_at: dAt(17, 10), updated_at: dAt(17, 10) },
    // Năm trước – tháng 3
    { id: ord11, order_number: 'DH250315001', customer_id: cust3, employee_id: adminProfileId, status: 'completed', total_amount: 28000000, discount: 0, final_amount: 28000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src1, created_at: dAt(15, 8), updated_at: dAt(15, 8) },
    // Năm trước – tháng 5
    { id: ord12, order_number: 'DH250510001', customer_id: cust2, employee_id: acctProfileId, status: 'completed', total_amount: 35000000, discount: 0, final_amount: 35000000, note: '', shipping_carrier: 'ghtk', shipping_code: '', source_id: src5, created_at: dAt(13, 15), updated_at: dAt(13, 15) },
    // Năm trước – tháng 7
    { id: ord13, order_number: 'DH250710001', customer_id: cust1, employee_id: empProfileId, status: 'completed', total_amount: 62000000, discount: 0, final_amount: 62000000, note: '', shipping_carrier: 'viettel', shipping_code: '', source_id: src4, created_at: dAt(11, 12), updated_at: dAt(11, 12) },
    // Năm trước – tháng 9
    { id: ord14, order_number: 'DH250905001', customer_id: cust3, employee_id: empProfileId, status: 'cancelled', total_amount: 18000000, discount: 0, final_amount: 18000000, note: '', shipping_carrier: '', shipping_code: '', source_id: src3, created_at: dAt(9, 5), updated_at: dAt(9, 5) },
    // Năm trước – tháng 11
    { id: ord15, order_number: 'DH251110001', customer_id: cust2, employee_id: adminProfileId, status: 'completed', total_amount: 74000000, discount: 0, final_amount: 74000000, note: '', shipping_carrier: 'ghtk', shipping_code: '', source_id: src2, created_at: dAt(7, 18), updated_at: dAt(7, 18) },
  ]

  // Order items – mỗi đơn phải có items để total_amount nhất quán
  store.order_items = [
    // ord1: iPhone(28M) + Samsung(21M) = 49M, giảm 1M → 48M
    { id: uid(), order_id: ord1, product_id: p1, quantity: 1, unit_price: 28000000, discount: 0, subtotal: 28000000, supplier_id: sup1 },
    { id: uid(), order_id: ord1, product_id: p2, quantity: 1, unit_price: 21000000, discount: 0, subtotal: 21000000, supplier_id: sup1 },
    // ord2: Samsung = 21M
    { id: uid(), order_id: ord2, product_id: p2, quantity: 1, unit_price: 21000000, discount: 0, subtotal: 21000000, supplier_id: null },
    // ord3: Laptop Dell = 39M
    { id: uid(), order_id: ord3, product_id: p5, quantity: 1, unit_price: 39000000, discount: 0, subtotal: 39000000, supplier_id: null },
    // ord4: iPhone = 28M
    { id: uid(), order_id: ord4, product_id: p1, quantity: 1, unit_price: 28000000, discount: 0, subtotal: 28000000, supplier_id: null },
    // ord5: Samsung (giá thương lượng) = 14M
    { id: uid(), order_id: ord5, product_id: p2, quantity: 1, unit_price: 14000000, discount: 0, subtotal: 14000000, supplier_id: null },
    // ord6: 2x iPhone = 56M
    { id: uid(), order_id: ord6, product_id: p1, quantity: 2, unit_price: 28000000, discount: 0, subtotal: 56000000, supplier_id: null },
    // ord7: Laptop Dell = 39M
    { id: uid(), order_id: ord7, product_id: p5, quantity: 1, unit_price: 39000000, discount: 0, subtotal: 39000000, supplier_id: null },
    // ord8: Samsung = 21M
    { id: uid(), order_id: ord8, product_id: p2, quantity: 1, unit_price: 21000000, discount: 0, subtotal: 21000000, supplier_id: null },
    // ord9: Samsung (giá thương lượng) = 12M
    { id: uid(), order_id: ord9, product_id: p2, quantity: 1, unit_price: 12000000, discount: 0, subtotal: 12000000, supplier_id: null },
    // ord10: iPhone (giá đặc biệt) = 43M
    { id: uid(), order_id: ord10, product_id: p1, quantity: 1, unit_price: 43000000, discount: 0, subtotal: 43000000, supplier_id: null },
    // ord11: iPhone = 28M
    { id: uid(), order_id: ord11, product_id: p1, quantity: 1, unit_price: 28000000, discount: 0, subtotal: 28000000, supplier_id: null },
    // ord12: Laptop Dell (giá thương lượng) = 35M
    { id: uid(), order_id: ord12, product_id: p5, quantity: 1, unit_price: 35000000, discount: 0, subtotal: 35000000, supplier_id: null },
    // ord13: iPhone(28M) + Laptop(34M) = 62M
    { id: uid(), order_id: ord13, product_id: p1, quantity: 1, unit_price: 28000000, discount: 0, subtotal: 28000000, supplier_id: null },
    { id: uid(), order_id: ord13, product_id: p5, quantity: 1, unit_price: 34000000, discount: 0, subtotal: 34000000, supplier_id: null },
    // ord14: Samsung (giá thương lượng) = 18M
    { id: uid(), order_id: ord14, product_id: p2, quantity: 1, unit_price: 18000000, discount: 0, subtotal: 18000000, supplier_id: null },
    // ord15: Laptop(39M) + iPhone(35M) = 74M
    { id: uid(), order_id: ord15, product_id: p5, quantity: 1, unit_price: 39000000, discount: 0, subtotal: 39000000, supplier_id: null },
    { id: uid(), order_id: ord15, product_id: p1, quantity: 1, unit_price: 35000000, discount: 0, subtotal: 35000000, supplier_id: null },
  ]

  // Inventory transactions (linked to suppliers for traceability)
  store.inventory_transactions = [
    { id: uid(), product_id: p1, supplier_id: sup1, type: 'import', quantity: 10, unit_price: 25000000, note: 'Nhập iPhone từ Viễn Đông', created_by: adminProfileId, created_at: now() },
    { id: uid(), product_id: p1, supplier_id: sup2, type: 'import', quantity: 5, unit_price: 24500000, note: 'Nhập iPhone từ Singapore', created_by: acctProfileId, created_at: now() },
    { id: uid(), product_id: p2, supplier_id: sup1, type: 'import', quantity: 8, unit_price: 18000000, note: 'Nhập Samsung S24', created_by: acctProfileId, created_at: now() },
    { id: uid(), product_id: p3, supplier_id: sup2, type: 'import', quantity: 200, unit_price: 8000, note: 'Nhập nước Lavie 1.5L', created_by: acctProfileId, created_at: now() },
    { id: uid(), product_id: p5, supplier_id: sup1, type: 'import', quantity: 3, unit_price: 35000000, note: 'Nhập Dell XPS từ Viễn Đông', created_by: acctProfileId, created_at: now() },
    { id: uid(), product_id: p5, supplier_id: sup3, type: 'import', quantity: 2, unit_price: 34000000, note: 'Nhập Dell XPS xách tay Mỹ', created_by: acctProfileId, created_at: now() },
  ]

  // Routes (tuyến xe)
  const route1 = uid(), route2 = uid(), route3 = uid()
  store.routes = [
    { id: route1, name: 'Tuyến 1: Hà Nam - Hà Nội - Hòa Bình', description: 'Chạy thứ 2, 4, 6', sort_order: 1, created_at: now(), updated_at: now() },
    { id: route2, name: 'Tuyến 2: Thái Bình - Hưng Yên', description: 'Chạy thứ 3, 5', sort_order: 2, created_at: now(), updated_at: now() },
    { id: route3, name: 'Tuyến 3: Ninh Bình - Thanh Hóa', description: 'Chạy thứ 7', sort_order: 3, created_at: now(), updated_at: now() },
  ]

  // Route orders (xếp đơn vào tuyến)
  store.route_orders = [
    { id: uid(), route_id: route1, order_id: ord1, added_by: acctProfileId, created_at: now() },
    { id: uid(), route_id: route1, order_id: ord3, added_by: acctProfileId, created_at: now() },
    { id: uid(), route_id: route2, order_id: ord2, added_by: acctProfileId, created_at: now() },
    { id: uid(), route_id: route2, order_id: ord4, added_by: adminProfileId, created_at: now() },
    { id: uid(), route_id: route3, order_id: ord5, added_by: acctProfileId, created_at: now() },
  ]

  // ── Additional employees for attendance demo ──────────────────────────────
  const a01 = 'profile-att-001', a02 = 'profile-att-002', a03 = 'profile-att-003'
  const a04 = 'profile-att-004', a05 = 'profile-att-005', a06 = 'profile-att-006'
  const a07 = 'profile-att-007', a08 = 'profile-att-008', a09 = 'profile-att-009'
  const a10 = 'profile-att-010', a11 = 'profile-att-011'
  const _ts = now()
  const attEmps = [
    { id: a01, user_id: uid(), full_name: 'Chữ Thị Phương',   role: 'sale', phone: '0901000001', created_at: _ts, updated_at: _ts },
    { id: a02, user_id: uid(), full_name: 'Đặng Thanh Long',  role: 'sale', phone: '0901000002', created_at: _ts, updated_at: _ts },
    { id: a03, user_id: uid(), full_name: 'Đặng Thị Thơm',   role: 'sale', phone: '0901000003', created_at: _ts, updated_at: _ts },
    { id: a04, user_id: uid(), full_name: 'Đinh Văn Thiêm',   role: 'sale', phone: '0901000004', created_at: _ts, updated_at: _ts },
    { id: a05, user_id: uid(), full_name: 'Đỗ Thị Khánh',    role: 'sale', phone: '0901000005', created_at: _ts, updated_at: _ts },
    { id: a06, user_id: uid(), full_name: 'Hoàng Thị Thủy',  role: 'sale', phone: '0901000006', created_at: _ts, updated_at: _ts },
    { id: a07, user_id: uid(), full_name: 'Lê Trọng Hiếu',   role: 'sale', phone: '0901000007', created_at: _ts, updated_at: _ts },
    { id: a08, user_id: uid(), full_name: 'Lương Thế Vinh',  role: 'sale', phone: '0901000008', created_at: _ts, updated_at: _ts },
    { id: a09, user_id: uid(), full_name: 'Nguyễn Thị Hương', role: 'sale', phone: '0901000009', created_at: _ts, updated_at: _ts },
    { id: a10, user_id: uid(), full_name: 'Trần Bảo Yến',    role: 'sale', phone: '0901000010', created_at: _ts, updated_at: _ts },
    { id: a11, user_id: uid(), full_name: 'Trần Thị Linh',   role: 'sale', phone: '0901000011', created_at: _ts, updated_at: _ts },
  ]
  store.profiles = [...store.profiles, ...attEmps]

  // ── Attendance seed ────────────────────────────────────────────────────────
  const _td = new Date()
  const _yr = _td.getFullYear()
  const _mo = _td.getMonth()        // 0-based
  const _todayDay = _td.getDate()

  function _wd(day: number): string {
    return `${_yr}-${String(_mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  function _dt(day: number, h: number, m: number): string {
    return new Date(_yr, _mo, day, h, m, 0).toISOString()
  }

  // Collect workdays (Mon–Sat) from day 1 up to today, capped at 12
  const _wds: number[] = []
  const _cap = Math.min(_todayDay, 12)
  for (let d = 1; d <= _cap; d++) {
    if (new Date(_yr, _mo, d).getDay() !== 0) _wds.push(d)
  }
  const _prevDays = _wds.filter((d) => d < _todayDay)
  const _hasToday = _wds.includes(_todayDay) && new Date(_yr, _mo, _todayDay).getDay() !== 0

  // Build a single attendance record
  function _rec(empId: string, shift: string, day: number,
                ci: [number, number] | null, co: [number, number] | null): Row {
    return {
      id: uid(), employee_id: empId, shift, work_date: _wd(day),
      check_in:  ci ? _dt(day, ci[0], ci[1]) : null,
      check_out: co ? _dt(day, co[0], co[1]) : null,
      note: '', created_at: _ts,
    }
  }

  const ON_MI: [number, number] = [8, 30]
  const ON_MO: [number, number] = [11, 45]
  const ON_AI: [number, number] = [13, 30]
  const ON_AO: [number, number] = [17, 0]
  const LATE_I: [number, number] = [8, 48]
  const EARLY_O: [number, number] = [16, 40]

  // Patterns: for each employee an object telling which 0-based workday indices are anomalous
  const patterns: { id: string; late: number[]; absent: number[]; missingCo: number[]; earlyOut: number[] }[] = [
    { id: a01, late: [],     absent: [],     missingCo: [],  earlyOut: []  }, // Phương  – all on time
    { id: a02, late: [0],    absent: [],     missingCo: [2], earlyOut: []  }, // Thanh   – day1 late, day3 missing out
    { id: a03, late: [],     absent: [2],    missingCo: [],  earlyOut: []  }, // Thơm    – day3 absent
    { id: a04, late: [1],    absent: [],     missingCo: [],  earlyOut: [3] }, // Thiêm   – day2 late, day4 early out
    { id: a05, late: [],     absent: [],     missingCo: [],  earlyOut: []  }, // Khánh   – all on time
    { id: a06, late: [],     absent: [],     missingCo: [1], earlyOut: [4] }, // Thủy    – day2 missing, day5 early
    { id: a07, late: [0, 1], absent: [],     missingCo: [],  earlyOut: []  }, // Hiếu    – day1,2 late
    { id: a08, late: [],     absent: [2, 3], missingCo: [],  earlyOut: []  }, // Vinh    – day3,4 absent
    { id: a09, late: [],     absent: [3, 4], missingCo: [],  earlyOut: []  }, // Hương   – day4,5 absent
    { id: a10, late: [],     absent: [],     missingCo: [],  earlyOut: []  }, // Yến     – all on time
    { id: a11, late: [0],    absent: [],     missingCo: [],  earlyOut: [4] }, // Linh    – day1 late, day5 early
  ]

  const atts: Row[] = []

  patterns.forEach((p) => {
    _prevDays.forEach((day, idx) => {
      if (p.absent.includes(idx)) return
      const mi = p.late.includes(idx) ? LATE_I : ON_MI
      const ao = p.earlyOut.includes(idx) ? EARLY_O : ON_AO
      const moCo: [number, number] | null = p.missingCo.includes(idx) ? null : ON_MO
      const aoCo: [number, number] | null = p.missingCo.includes(idx) ? null : ao
      atts.push(_rec(p.id, 'morning', day, mi, moCo))
      atts.push(_rec(p.id, 'afternoon', day, ON_AI, aoCo))
    })
    // Today: morning complete, afternoon check-in only (in progress)
    if (_hasToday) {
      atts.push(_rec(p.id, 'morning', _todayDay, ON_MI, ON_MO))
      atts.push(_rec(p.id, 'afternoon', _todayDay, ON_AI, null))
    }
  })

  store.attendance = atts
}

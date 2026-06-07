export type UserRole = 'admin' | 'accountant' | 'sale' | 'warehouse'

export interface Profile {
  id: string
  user_id: string
  full_name: string
  role: UserRole
  phone?: string
  email?: string
  cmnd?: string
  address?: string
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  name: string
  description?: string
  image_url?: string
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  note?: string
  opening_balance?: number
  created_at: string
  updated_at: string
}

export interface ProductSupplier {
  id: string
  product_id: string
  supplier_id: string
  barcode: string        // mã vạch của NCC cho sản phẩm này
  cost_price: number     // giá nhập từ NCC này
  quantity: number       // tồn kho từ NCC này
  note?: string
  created_at: string
  updated_at: string
  supplier?: Supplier
}

export interface Product {
  id: string
  category_id: string
  name: string
  product_code: string   // Mã hàng: 4-6 chữ số, dễ nhớ
  barcode: string        // Mã vạch chung (sync từ NCC đầu tiên hoặc tự tạo)
  cost_price: number     // Giá vốn trung bình (sync từ NCCs, ẩn với NV)
  sale_price: number
  quantity: number       // Tổng tồn kho (sum từ NCCs)
  unit: string
  description?: string
  image_url?: string
  images?: string[]
  created_at: string
  updated_at: string
  category?: Category
  product_suppliers?: ProductSupplier[]
}

export type InventoryTransactionType = 'import' | 'export' | 'adjustment'

export interface InventoryTransaction {
  id: string
  batch_id?: string | null  // groups multiple items saved in the same session
  product_id: string
  supplier_id?: string   // NCC được chọn khi nhập/xuất kho
  type: InventoryTransactionType
  quantity: number
  unit_price: number
  note?: string
  created_by: string
  created_at: string
  product?: Product
  profile?: Profile
  supplier?: Supplier
}

export interface SupplierPayment {
  id: string
  supplier_id: string
  amount: number
  note?: string | null
  payment_date: string   // DATE: YYYY-MM-DD
  created_by: string
  created_at: string
  profile?: Profile
}

export interface ProductBatch {
  id: string
  product_id: string
  supplier_id?: string | null
  import_price: number
  quantity: number
  remaining_qty: number
  import_date: string  // YYYY-MM-DD
  created_at: string
}

export interface Customer {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  note?: string
  created_by?: string
  created_at: string
  updated_at: string
  creator?: Profile
}

export interface OrderSource {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export type OrderStatus =
  | 'placed'             // Đặt Đơn
  | 'confirmed'          // Xác Nhận Đơn
  | 'packing'            // Xuất Kho Đang Đóng Gói
  | 'shipping'           // Đang Vận Chuyển
  | 'completed'          // Hoàn Thành
  | 'returned'           // Hoàn
  | 'returned_received'  // Đã Hoàn Về
  | 'partial_return'     // Đổi Trả 1 Phần
  | 'cancelled'          // Khách Hủy
  | 'draft'              // Đơn Nháp (chỉ nhân viên tạo mới thấy)

export interface OrderNote {
  id: string
  order_id: string
  content: string
  created_by: string
  created_at: string
  profile?: Profile
}

export interface Order {
  id: string
  order_number: string
  customer_id?: string
  employee_id: string
  status: OrderStatus
  total_amount: number
  discount: number
  final_amount: number
  note?: string
  shipping_carrier?: string   // Đơn vị vận chuyển
  shipping_code?: string      // Mã vận đơn
  source_id?: string          // Nguồn đơn
  created_at: string
  updated_at: string
  customer?: Customer
  employee?: Profile
  items?: OrderItem[]
  notes?: OrderNote[]
  source?: OrderSource
  return_tickets?: ReturnTicket[]
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  unit_price: number
  discount: number
  subtotal: number
  supplier_id?: string   // NCC được chọn để xuất kho
  cost_price?: number | null  // FIFO cost per unit, set at packing time
  product?: Product
  supplier?: Supplier
}

export interface Route {
  id: string
  name: string
  description?: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ReturnTicketItem {
  order_item_id?: string
  product_id?: string
  name: string
  quantity: number
  unit_price: number
}

export interface ReturnTicket {
  id: string
  ticket_number: string
  order_id: string
  returned_items: ReturnTicketItem[]
  exchange_items: ReturnTicketItem[]
  returned_amount: number
  exchange_amount: number
  customer_paid: number
  reason?: string
  note?: string
  created_by?: string
  created_at: string
}

export interface RouteOrder {
  id: string
  route_id: string
  order_id: string
  added_by?: string
  created_at: string
  route?: Route
  order?: Order
  adder?: Profile
}

export interface StockCall {
  id: string
  order_id: string
  warehouse_note?: string
  dismissed: boolean
  created_at: string
}

export type AttendanceShift = 'morning' | 'afternoon'

export interface Attendance {
  id: string
  employee_id: string
  shift: AttendanceShift
  work_date: string     // YYYY-MM-DD
  check_in?: string     // ISO timestamp (optional)
  check_out?: string    // ISO timestamp (optional)
  note?: string
  created_at: string
  employee?: Pick<Profile, 'id' | 'full_name' | 'role'>
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>
      }
      categories: {
        Row: Category
        Insert: Omit<Category, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Category, 'id' | 'created_at'>>
      }
      suppliers: {
        Row: Supplier
        Insert: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Supplier, 'id' | 'created_at'>>
      }
      products: {
        Row: Product
        Insert: Omit<Product, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Product, 'id' | 'created_at'>>
      }
      product_suppliers: {
        Row: ProductSupplier
        Insert: Omit<ProductSupplier, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<ProductSupplier, 'id' | 'created_at'>>
      }
      inventory_transactions: {
        Row: InventoryTransaction
        Insert: Omit<InventoryTransaction, 'id' | 'created_at'>
        Update: Partial<Omit<InventoryTransaction, 'id' | 'created_at'>>
      }
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Customer, 'id' | 'created_at'>>
      }
      orders: {
        Row: Order
        Insert: Omit<Order, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Order, 'id' | 'created_at'>>
      }
      order_items: {
        Row: OrderItem
        Insert: Omit<OrderItem, 'id'>
        Update: Partial<Omit<OrderItem, 'id'>>
      }
      attendance: {
        Row: Attendance
        Insert: Omit<Attendance, 'id' | 'created_at' | 'employee'>
        Update: Partial<Omit<Attendance, 'id' | 'created_at' | 'employee'>>
      }
      order_sources: {
        Row: OrderSource
        Insert: Omit<OrderSource, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<OrderSource, 'id' | 'created_at'>>
      }
    }
  }
}

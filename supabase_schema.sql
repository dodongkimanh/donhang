-- ============================================================
-- CRM ĐƠN HÀNG - Supabase Schema
-- Chạy file này trong Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- BẢNG PROFILES (thông tin nhân viên)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  full_name text not null,
  role text not null check (role in ('admin', 'accountant', 'employee')) default 'employee',
  phone text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG CATEGORIES (danh mục hàng hóa)
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  image_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG SUPPLIERS (nhà cung cấp)
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  email text,
  address text,
  note text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG PRODUCTS (hàng hóa)
-- ============================================================
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  product_code text unique not null,          -- Mã hàng: 4–6 chữ số, dễ nhớ
  barcode text unique not null,               -- Mã vạch: CODE128, quét được
  cost_price numeric(15,2) default 0 not null,
  sale_price numeric(15,2) default 0 not null,
  quantity integer default 0 not null,
  unit text default 'cái' not null,
  description text,
  image_url text,                         -- ảnh chính (images[0])
  images jsonb default '[]'::jsonb,       -- mảng tất cả ảnh sản phẩm
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG PRODUCT_SUPPLIERS (hàng hóa theo nhà cung cấp)
-- ============================================================
create table if not exists public.product_suppliers (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.products(id) on delete cascade not null,
  supplier_id uuid references public.suppliers(id) on delete cascade not null,
  barcode text not null,                    -- mã vạch của NCC cho sản phẩm này
  cost_price numeric(15,2) default 0 not null,  -- giá nhập từ NCC
  quantity integer default 0 not null,          -- tồn kho từ NCC này
  note text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (product_id, supplier_id)
);

-- Trigger: sync products.quantity và cost_price từ product_suppliers
create or replace function sync_product_totals()
returns trigger as $$
declare
  v_product_id uuid;
  v_total_qty integer;
  v_avg_cost numeric;
  v_first_barcode text;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  select
    coalesce(sum(quantity), 0),
    coalesce(avg(cost_price), 0),
    (select barcode from public.product_suppliers
     where product_id = v_product_id
     order by created_at asc limit 1)
  into v_total_qty, v_avg_cost, v_first_barcode
  from public.product_suppliers
  where product_id = v_product_id;

  update public.products
  set
    quantity = v_total_qty,
    cost_price = round(v_avg_cost),
    barcode = coalesce(v_first_barcode, barcode)
  where id = v_product_id;

  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger sync_product_totals_on_change
  after insert or update or delete on public.product_suppliers
  for each row execute function sync_product_totals();

-- ============================================================
-- BẢNG INVENTORY_TRANSACTIONS (nhập/xuất kho)
-- ============================================================
create table if not exists public.inventory_transactions (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.products(id) on delete cascade not null,
  supplier_id uuid references public.suppliers(id) on delete set null,  -- NCC được chọn
  type text not null check (type in ('import', 'export')),
  quantity integer not null check (quantity > 0),
  unit_price numeric(15,2) default 0 not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG CUSTOMERS (khách hàng)
-- ============================================================
create table if not exists public.customers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  email text,
  address text,
  note text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG ORDERS (đơn hàng)
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text unique not null,
  customer_id uuid references public.customers(id) on delete set null,
  employee_id uuid references public.profiles(id) on delete set null not null,
  status text not null check (status in ('pending', 'processing', 'completed', 'cancelled')) default 'pending',
  total_amount numeric(15,2) default 0 not null,
  discount numeric(15,2) default 0 not null,
  final_amount numeric(15,2) default 0 not null,
  note text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- BẢNG ORDER_ITEMS (chi tiết đơn hàng)
-- ============================================================
create table if not exists public.order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references public.orders(id) on delete cascade not null,
  product_id uuid references public.products(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(15,2) not null,
  discount numeric(15,2) default 0 not null,
  subtotal numeric(15,2) not null,
  supplier_id uuid references public.suppliers(id) on delete set null  -- NCC được chọn xuất kho
);

-- ============================================================
-- BẢNG ATTENDANCE (chấm công)
-- ============================================================
create table if not exists public.attendance (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references public.profiles(id) on delete cascade not null,
  check_in timestamptz not null,
  check_out timestamptz,
  note text,
  created_at timestamptz default now() not null
);

-- ============================================================
-- TRIGGER: tự động cập nhật updated_at
-- ============================================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at_column();

create trigger update_categories_updated_at
  before update on public.categories
  for each row execute function update_updated_at_column();

create trigger update_products_updated_at
  before update on public.products
  for each row execute function update_updated_at_column();

create trigger update_customers_updated_at
  before update on public.customers
  for each row execute function update_updated_at_column();

create trigger update_orders_updated_at
  before update on public.orders
  for each row execute function update_updated_at_column();

-- NOTE: Tồn kho sản phẩm (products.quantity, cost_price) được tự động
-- tính từ bảng product_suppliers qua trigger sync_product_totals_on_change.
-- Khi nhập kho theo NCC: ứng dụng upsert vào product_suppliers,
-- trigger sẽ sync lại products. inventory_transactions chỉ là log lịch sử.

-- ============================================================
-- TRIGGER: tự động tạo profile khi user đăng ký
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.product_suppliers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.attendance enable row level security;

-- Helper function: lấy role của user hiện tại
create or replace function get_user_role()
returns text as $$
  select role from public.profiles where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- Helper function: lấy profile id của user hiện tại
create or replace function get_profile_id()
returns uuid as $$
  select id from public.profiles where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- PROFILES policies
create policy "Nhân viên xem được profile của mình"
  on public.profiles for select
  using (user_id = auth.uid() or get_user_role() in ('admin', 'accountant'));

create policy "Admin quản lý profiles"
  on public.profiles for all
  using (get_user_role() = 'admin');

-- SUPPLIERS policies (chỉ admin và kế toán quản lý, nhân viên không thấy NCC)
create policy "Admin và kế toán xem NCC"
  on public.suppliers for select
  using (get_user_role() in ('admin', 'accountant'));

create policy "Admin và kế toán quản lý NCC"
  on public.suppliers for all
  using (get_user_role() in ('admin', 'accountant'));

-- PRODUCT_SUPPLIERS policies
create policy "Admin và kế toán xem tồn kho theo NCC"
  on public.product_suppliers for select
  using (get_user_role() in ('admin', 'accountant'));

create policy "Admin và kế toán quản lý tồn kho NCC"
  on public.product_suppliers for all
  using (get_user_role() in ('admin', 'accountant'));

-- CATEGORIES policies
create policy "Mọi người xem được danh mục"
  on public.categories for select
  using (auth.uid() is not null);

create policy "Admin và kế toán quản lý danh mục"
  on public.categories for all
  using (get_user_role() in ('admin', 'accountant'));

-- PRODUCTS policies
create policy "Mọi người xem được sản phẩm"
  on public.products for select
  using (auth.uid() is not null);

create policy "Admin và kế toán quản lý sản phẩm"
  on public.products for all
  using (get_user_role() in ('admin', 'accountant'));

-- INVENTORY_TRANSACTIONS policies
create policy "Admin và kế toán xem giao dịch kho"
  on public.inventory_transactions for select
  using (get_user_role() in ('admin', 'accountant'));

create policy "Admin và kế toán tạo giao dịch kho"
  on public.inventory_transactions for insert
  with check (get_user_role() in ('admin', 'accountant'));

-- CUSTOMERS policies
create policy "Mọi người xem được khách hàng"
  on public.customers for select
  using (auth.uid() is not null);

create policy "Admin và kế toán quản lý khách hàng"
  on public.customers for all
  using (get_user_role() in ('admin', 'accountant'));

-- ORDERS policies
create policy "Admin và kế toán xem tất cả đơn hàng"
  on public.orders for select
  using (
    get_user_role() in ('admin', 'accountant')
    or employee_id = get_profile_id()
  );

create policy "Nhân viên tạo đơn hàng"
  on public.orders for insert
  with check (employee_id = get_profile_id());

create policy "Admin và kế toán chỉnh sửa đơn hàng"
  on public.orders for update
  using (get_user_role() in ('admin', 'accountant'));

create policy "Admin xóa đơn hàng"
  on public.orders for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ORDER_ITEMS policies
create policy "Xem order items theo quyền đơn hàng"
  on public.order_items for select
  using (
    get_user_role() in ('admin', 'accountant')
    or exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
      and orders.employee_id = get_profile_id()
    )
  );

create policy "Tạo order items"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
      and (orders.employee_id = get_profile_id() or get_user_role() in ('admin', 'accountant'))
    )
  );

create policy "Admin và kế toán quản lý order items"
  on public.order_items for all
  using (get_user_role() in ('admin', 'accountant'));

-- ATTENDANCE policies
create policy "Admin và kế toán xem tất cả chấm công"
  on public.attendance for select
  using (
    get_user_role() in ('admin', 'accountant')
    or employee_id = get_profile_id()
  );

create policy "Nhân viên tự chấm công của mình"
  on public.attendance for insert
  with check (employee_id = get_profile_id());

create policy "Nhân viên cập nhật chấm công của mình"
  on public.attendance for update
  using (
    employee_id = get_profile_id()
    or get_user_role() in ('admin', 'accountant')
  );

-- ============================================================
-- STORAGE BUCKETS (lưu trữ ảnh)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('categories', 'categories', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

-- Policy: mọi người có thể xem ảnh (bucket public)
create policy "Public read categories images"
  on storage.objects for select
  using (bucket_id = 'categories');

create policy "Public read products images"
  on storage.objects for select
  using (bucket_id = 'products');

-- Policy: chỉ admin và kế toán được upload/xóa ảnh danh mục và sản phẩm
create policy "Admin và kế toán upload ảnh"
  on storage.objects for insert
  with check (
    bucket_id in ('categories', 'products')
    and get_user_role() in ('admin', 'accountant')
  );

create policy "Admin và kế toán xóa ảnh"
  on storage.objects for delete
  using (
    bucket_id in ('categories', 'products')
    and get_user_role() in ('admin', 'accountant')
  );

-- ============================================================
-- BẢNG ROUTES (tuyến xe vận chuyển)
-- ============================================================
create table if not exists public.routes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  sort_order integer default 1 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create trigger update_routes_updated_at
  before update on public.routes
  for each row execute function update_updated_at_column();

-- ============================================================
-- BẢNG ROUTE_ORDERS (đơn hàng được xếp vào tuyến)
-- ============================================================
create table if not exists public.route_orders (
  id uuid primary key default uuid_generate_v4(),
  route_id uuid references public.routes(id) on delete cascade not null,
  order_id uuid references public.orders(id) on delete cascade not null unique,
  added_by uuid references public.profiles(id),
  warehouse_note text,
  created_at timestamptz default now() not null
);

-- RLS cho routes và route_orders
alter table public.routes enable row level security;
alter table public.route_orders enable row level security;

create policy "Mọi người xem được tuyến"
  on public.routes for select
  using (auth.uid() is not null);

create policy "Admin và kế toán quản lý tuyến"
  on public.routes for all
  using (get_user_role() in ('admin', 'accountant'));

create policy "Mọi người xem được xếp tuyến"
  on public.route_orders for select
  using (auth.uid() is not null);

create policy "Admin và kế toán quản lý xếp tuyến"
  on public.route_orders for all
  using (get_user_role() in ('admin', 'accountant'));

-- Dữ liệu tuyến mặc định
insert into public.routes (name, sort_order) values
  ('Tuyến 1: Hà Nam - Hà Nội - Hòa Bình', 1),
  ('Tuyến 2: Thái Bình - Hưng Yên', 2),
  ('Tuyến 3: Ninh Bình - Thanh Hóa', 3)
on conflict do nothing;

-- ============================================================
-- DỮ LIỆU MẪU: Tạo tài khoản admin đầu tiên
-- ============================================================
-- Sau khi chạy schema này, vào Supabase Auth > Users > Add User
-- rồi thêm vào bảng profiles với role = 'admin'
-- Hoặc dùng lệnh dưới (thay email/password):
--
-- insert into auth.users (email, encrypted_password, email_confirmed_at, role)
-- values ('admin@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated');

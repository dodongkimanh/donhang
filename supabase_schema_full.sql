-- ============================================================
-- CRM ĐƠN HÀNG - Full Schema v2
-- Chạy toàn bộ file này trong Supabase SQL Editor
-- Tương thích với codebase hiện tại (roles: admin/accountant/sale/warehouse)
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- update_updated_at_column (không phụ thuộc bảng nào)
-- ============================================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- PROFILES (nhân viên) -- phải tạo trước get_user_role()
-- ============================================================
create table if not exists public.profiles (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        references auth.users(id) on delete cascade not null unique,
  full_name    text        not null,
  role         text        not null check (role in ('admin', 'accountant', 'sale', 'warehouse')) default 'sale',
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at_column();

-- ============================================================
-- HELPER FUNCTIONS (phụ thuộc bảng profiles -- tạo sau)
-- ============================================================
create or replace function get_user_role()
returns text as $$
  select role from public.profiles where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

create or replace function get_profile_id()
returns uuid as $$
  select id from public.profiles where user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- ============================================================
-- CATEGORIES (danh mục)
-- ============================================================
create table if not exists public.categories (
  id           uuid        primary key default uuid_generate_v4(),
  name         text        not null,
  description  text,
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_categories_updated_at
  before update on public.categories
  for each row execute function update_updated_at_column();

-- ============================================================
-- SUPPLIERS (nhà cung cấp)
-- ============================================================
create table if not exists public.suppliers (
  id           uuid        primary key default uuid_generate_v4(),
  name         text        not null,
  phone        text,
  email        text,
  address      text,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_suppliers_updated_at
  before update on public.suppliers
  for each row execute function update_updated_at_column();

-- ============================================================
-- PRODUCTS (hàng hóa)
-- ============================================================
create table if not exists public.products (
  id           uuid           primary key default uuid_generate_v4(),
  category_id  uuid           references public.categories(id) on delete set null,
  name         text           not null,
  product_code text           unique not null,
  barcode      text           unique not null,
  cost_price   numeric(15,2)  not null default 0,
  sale_price   numeric(15,2)  not null default 0,
  quantity     integer        not null default 0,
  unit         text           not null default 'cái',
  description  text,
  image_url    text,
  images       jsonb          not null default '[]'::jsonb,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);

create trigger update_products_updated_at
  before update on public.products
  for each row execute function update_updated_at_column();

-- ============================================================
-- PRODUCT_SUPPLIERS (hàng theo nhà cung cấp)
-- ============================================================
create table if not exists public.product_suppliers (
  id           uuid          primary key default uuid_generate_v4(),
  product_id   uuid          not null references public.products(id) on delete cascade,
  supplier_id  uuid          not null references public.suppliers(id) on delete cascade,
  barcode      text          not null,
  cost_price   numeric(15,2) not null default 0,
  quantity     integer       not null default 0,
  note         text,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  unique (product_id, supplier_id)
);

-- Trigger: sync products.quantity và cost_price (weighted average) từ product_suppliers
create or replace function sync_product_totals()
returns trigger as $$
declare
  v_product_id    uuid;
  v_total_qty     integer;
  v_avg_cost      numeric;
  v_first_barcode text;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  select
    coalesce(sum(quantity), 0),
    coalesce(
      case when sum(quantity) > 0
           then sum(cost_price * quantity)::numeric / sum(quantity)
           else avg(cost_price)
      end, 0),
    (select barcode from public.product_suppliers
     where product_id = v_product_id
     order by created_at asc limit 1)
  into v_total_qty, v_avg_cost, v_first_barcode
  from public.product_suppliers
  where product_id = v_product_id;

  update public.products
  set
    quantity   = v_total_qty,
    cost_price = round(v_avg_cost),
    barcode    = coalesce(v_first_barcode, barcode),
    updated_at = now()
  where id = v_product_id;

  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists sync_product_totals_on_change on public.product_suppliers;
create trigger sync_product_totals_on_change
  after insert or update or delete on public.product_suppliers
  for each row execute function sync_product_totals();

-- ============================================================
-- PRODUCT_BATCHES (lô hàng FIFO)
-- ============================================================
create table if not exists public.product_batches (
  id            uuid          primary key default gen_random_uuid(),
  product_id    uuid          not null references public.products(id) on delete cascade,
  supplier_id   uuid          references public.suppliers(id) on delete set null,
  import_price  numeric(15,2) not null default 0,
  quantity      integer       not null default 0,
  remaining_qty integer       not null default 0,
  import_date   date          not null default current_date,
  created_at    timestamptz   not null default now()
);

create index if not exists idx_product_batches_product_id
  on public.product_batches(product_id);
create index if not exists idx_product_batches_fifo
  on public.product_batches(product_id, import_date asc, created_at asc);

-- ============================================================
-- INVENTORY_TRANSACTIONS (nhập/xuất kho)
-- ============================================================
create table if not exists public.inventory_transactions (
  id           uuid          primary key default uuid_generate_v4(),
  batch_id     uuid,
  product_id   uuid          not null references public.products(id) on delete cascade,
  supplier_id  uuid          references public.suppliers(id) on delete set null,
  type         text          not null check (type in ('import', 'export', 'adjustment')),
  quantity     integer       not null check (quantity > 0),
  unit_price   numeric(15,2) not null default 0,
  note         text,
  created_by   uuid          references public.profiles(id) on delete set null,
  created_at   timestamptz   not null default now()
);

create index if not exists idx_inventory_transactions_product
  on public.inventory_transactions(product_id);

-- ============================================================
-- SUPPLIER_PAYMENTS (thanh toán NCC)
-- ============================================================
create table if not exists public.supplier_payments (
  id           uuid          primary key default gen_random_uuid(),
  supplier_id  uuid          not null references public.suppliers(id) on delete cascade,
  amount       numeric(15,2) not null check (amount > 0),
  note         text,
  payment_date date          not null default current_date,
  created_by   uuid          references public.profiles(id),
  created_at   timestamptz   not null default now()
);

create index if not exists idx_supplier_payments_supplier_id
  on public.supplier_payments(supplier_id);

-- ============================================================
-- CUSTOMERS (khách hàng)
-- ============================================================
create table if not exists public.customers (
  id           uuid        primary key default uuid_generate_v4(),
  name         text        not null,
  phone        text,
  email        text,
  address      text,
  note         text,
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_customers_updated_at
  before update on public.customers
  for each row execute function update_updated_at_column();

-- ============================================================
-- ORDER_SOURCES (nguồn đơn hàng)
-- ============================================================
create table if not exists public.order_sources (
  id           uuid        primary key default uuid_generate_v4(),
  name         text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_order_sources_updated_at
  before update on public.order_sources
  for each row execute function update_updated_at_column();

-- ============================================================
-- ORDERS (đơn hàng)
-- ============================================================
create table if not exists public.orders (
  id                uuid          primary key default uuid_generate_v4(),
  order_number      text          unique not null,
  customer_id       uuid          references public.customers(id) on delete set null,
  employee_id       uuid          not null references public.profiles(id) on delete set null,
  status            text          not null default 'placed'
    check (status in (
      'placed', 'confirmed', 'packing', 'shipping',
      'completed', 'returned', 'returned_received',
      'partial_return', 'cancelled', 'draft'
    )),
  total_amount      numeric(15,2) not null default 0,
  discount          numeric(15,2) not null default 0,
  final_amount      numeric(15,2) not null default 0,
  note              text,
  shipping_carrier  text,
  shipping_code     text,
  source_id         uuid          references public.order_sources(id) on delete set null,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists idx_orders_employee on public.orders(employee_id);
create index if not exists idx_orders_status   on public.orders(status);
create index if not exists idx_orders_created  on public.orders(created_at desc);

create trigger update_orders_updated_at
  before update on public.orders
  for each row execute function update_updated_at_column();

-- ============================================================
-- ORDER_ITEMS (chi tiết đơn hàng)
-- ============================================================
create table if not exists public.order_items (
  id           uuid          primary key default uuid_generate_v4(),
  order_id     uuid          not null references public.orders(id) on delete cascade,
  product_id   uuid          references public.products(id) on delete set null,
  quantity     integer       not null check (quantity > 0),
  unit_price   numeric(15,2) not null,
  discount     numeric(15,2) not null default 0,
  subtotal     numeric(15,2) not null,
  supplier_id  uuid          references public.suppliers(id) on delete set null,
  cost_price   numeric(15,2)
);

create index if not exists idx_order_items_order on public.order_items(order_id);

-- ============================================================
-- ORDER_NOTES (ghi chú đơn hàng)
-- ============================================================
create table if not exists public.order_notes (
  id           uuid        primary key default uuid_generate_v4(),
  order_id     uuid        not null references public.orders(id) on delete cascade,
  content      text        not null,
  created_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_order_notes_order on public.order_notes(order_id);

-- ============================================================
-- ATTENDANCE (chấm công)
-- ============================================================
create table if not exists public.attendance (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  shift        text        not null check (shift in ('morning', 'afternoon')),
  work_date    date        not null,
  check_in     timestamptz,
  check_out    timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  unique (employee_id, shift, work_date)
);

create index if not exists idx_attendance_employee_date
  on public.attendance(employee_id, work_date);

-- ============================================================
-- RETURN_TICKETS (phiếu đổi trả)
-- ============================================================
create table if not exists public.return_tickets (
  id              uuid          primary key default gen_random_uuid(),
  ticket_number   text          unique not null,
  order_id        uuid          not null references public.orders(id) on delete cascade,
  returned_items  jsonb         not null default '[]'::jsonb,
  exchange_items  jsonb         not null default '[]'::jsonb,
  returned_amount numeric(15,2) not null default 0,
  exchange_amount numeric(15,2) not null default 0,
  customer_paid   numeric(15,2) not null default 0,
  reason          text,
  note            text,
  created_by      uuid          references auth.users(id),
  created_at      timestamptz   not null default now()
);

create index if not exists idx_return_tickets_order on public.return_tickets(order_id);

-- ============================================================
-- ROUTES (tuyến vận chuyển)
-- ============================================================
create table if not exists public.routes (
  id           uuid        primary key default uuid_generate_v4(),
  name         text        not null,
  description  text,
  sort_order   integer     not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger update_routes_updated_at
  before update on public.routes
  for each row execute function update_updated_at_column();

-- ============================================================
-- ROUTE_ORDERS (đơn hàng trong tuyến)
-- ============================================================
create table if not exists public.route_orders (
  id           uuid        primary key default uuid_generate_v4(),
  route_id     uuid        not null references public.routes(id) on delete cascade,
  order_id     uuid        not null references public.orders(id) on delete cascade unique,
  added_by     uuid        references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- STOCK_CALLS (gọi hàng kho)
-- ============================================================
create table if not exists public.stock_calls (
  id             uuid        primary key default uuid_generate_v4(),
  order_id       uuid        not null references public.orders(id) on delete cascade unique,
  warehouse_note text,
  dismissed      boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- TRIGGER: tự động tạo profile khi user đăng ký
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'sale'),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles              enable row level security;
alter table public.categories            enable row level security;
alter table public.suppliers             enable row level security;
alter table public.products              enable row level security;
alter table public.product_suppliers     enable row level security;
alter table public.product_batches       enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.supplier_payments     enable row level security;
alter table public.customers             enable row level security;
alter table public.order_sources         enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_notes           enable row level security;
alter table public.attendance            enable row level security;
alter table public.return_tickets        enable row level security;
alter table public.routes                enable row level security;
alter table public.route_orders          enable row level security;
alter table public.stock_calls           enable row level security;

-- Xóa toàn bộ policy cũ để tránh xung đột khi chạy lại
do $$ declare r record; begin
  for r in (select policyname, tablename from pg_policies where schemaname = 'public') loop
    execute 'drop policy if exists "' || r.policyname || '" on public.' || r.tablename;
  end loop;
end $$;

-- ── PROFILES ──────────────────────────────────────────────────────────────────
create policy "profiles_select"
  on public.profiles for select
  using (user_id = auth.uid() or get_user_role() in ('admin', 'accountant'));

create policy "profiles_insert_admin"
  on public.profiles for insert
  with check (get_user_role() = 'admin');

create policy "profiles_update_admin"
  on public.profiles for update
  using (get_user_role() = 'admin' or user_id = auth.uid());

create policy "profiles_delete_admin"
  on public.profiles for delete
  using (get_user_role() = 'admin');

-- ── CATEGORIES ────────────────────────────────────────────────────────────────
create policy "categories_select"
  on public.categories for select
  using (auth.uid() is not null);

create policy "categories_all_edit"
  on public.categories for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── SUPPLIERS ─────────────────────────────────────────────────────────────────
create policy "suppliers_select"
  on public.suppliers for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "suppliers_all_edit"
  on public.suppliers for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── PRODUCTS ──────────────────────────────────────────────────────────────────
create policy "products_select"
  on public.products for select
  using (auth.uid() is not null);

create policy "products_all_edit"
  on public.products for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── PRODUCT_SUPPLIERS ─────────────────────────────────────────────────────────
create policy "product_suppliers_select"
  on public.product_suppliers for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "product_suppliers_all_edit"
  on public.product_suppliers for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── PRODUCT_BATCHES ───────────────────────────────────────────────────────────
create policy "product_batches_select"
  on public.product_batches for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "product_batches_insert"
  on public.product_batches for insert
  with check (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "product_batches_update"
  on public.product_batches for update
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "product_batches_delete"
  on public.product_batches for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── INVENTORY_TRANSACTIONS ────────────────────────────────────────────────────
create policy "inventory_select"
  on public.inventory_transactions for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "inventory_insert"
  on public.inventory_transactions for insert
  with check (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "inventory_delete"
  on public.inventory_transactions for delete
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── SUPPLIER_PAYMENTS ─────────────────────────────────────────────────────────
create policy "supplier_payments_select"
  on public.supplier_payments for select
  using (get_user_role() in ('admin', 'accountant'));

create policy "supplier_payments_insert"
  on public.supplier_payments for insert
  with check (get_user_role() in ('admin', 'accountant'));

create policy "supplier_payments_delete"
  on public.supplier_payments for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── CUSTOMERS ─────────────────────────────────────────────────────────────────
create policy "customers_select"
  on public.customers for select
  using (auth.uid() is not null);

create policy "customers_insert"
  on public.customers for insert
  with check (auth.uid() is not null);

create policy "customers_update"
  on public.customers for update
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "customers_delete"
  on public.customers for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── ORDER_SOURCES ─────────────────────────────────────────────────────────────
create policy "order_sources_select"
  on public.order_sources for select
  using (auth.uid() is not null);

create policy "order_sources_all_edit"
  on public.order_sources for all
  using (get_user_role() in ('admin', 'accountant'));

-- ── ORDERS ────────────────────────────────────────────────────────────────────
create policy "orders_select"
  on public.orders for select
  using (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or employee_id = get_profile_id()
  );

create policy "orders_insert"
  on public.orders for insert
  with check (employee_id = get_profile_id());

create policy "orders_update"
  on public.orders for update
  using (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or employee_id = get_profile_id()
  );

create policy "orders_delete"
  on public.orders for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── ORDER_ITEMS ───────────────────────────────────────────────────────────────
create policy "order_items_select"
  on public.order_items for select
  using (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.employee_id = get_profile_id()
    )
  );

create policy "order_items_insert"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (
          orders.employee_id = get_profile_id()
          or get_user_role() in ('admin', 'accountant', 'warehouse')
        )
    )
  );

create policy "order_items_update"
  on public.order_items for update
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "order_items_delete"
  on public.order_items for delete
  using (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.employee_id = get_profile_id()
    )
  );

-- ── ORDER_NOTES ───────────────────────────────────────────────────────────────
create policy "order_notes_select"
  on public.order_notes for select
  using (auth.uid() is not null);

create policy "order_notes_insert"
  on public.order_notes for insert
  with check (auth.uid() is not null);

create policy "order_notes_delete"
  on public.order_notes for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── ATTENDANCE ────────────────────────────────────────────────────────────────
create policy "attendance_select"
  on public.attendance for select
  using (
    get_user_role() in ('admin', 'accountant')
    or employee_id = get_profile_id()
  );

create policy "attendance_insert"
  on public.attendance for insert
  with check (
    employee_id = get_profile_id()
    or get_user_role() in ('admin', 'accountant')
  );

create policy "attendance_update"
  on public.attendance for update
  using (
    employee_id = get_profile_id()
    or get_user_role() in ('admin', 'accountant')
  );

create policy "attendance_delete"
  on public.attendance for delete
  using (get_user_role() in ('admin', 'accountant'));

-- ── RETURN_TICKETS ────────────────────────────────────────────────────────────
create policy "return_tickets_select"
  on public.return_tickets for select
  using (auth.uid() is not null);

create policy "return_tickets_insert"
  on public.return_tickets for insert
  with check (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "return_tickets_update"
  on public.return_tickets for update
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── ROUTES ────────────────────────────────────────────────────────────────────
create policy "routes_select"
  on public.routes for select
  using (auth.uid() is not null);

create policy "routes_all_edit"
  on public.routes for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── ROUTE_ORDERS ──────────────────────────────────────────────────────────────
create policy "route_orders_select"
  on public.route_orders for select
  using (auth.uid() is not null);

create policy "route_orders_all_edit"
  on public.route_orders for all
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ── STOCK_CALLS ───────────────────────────────────────────────────────────────
create policy "stock_calls_select"
  on public.stock_calls for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "stock_calls_upsert"
  on public.stock_calls for insert
  with check (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "stock_calls_update"
  on public.stock_calls for update
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('categories', 'categories', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

drop policy if exists "Public read categories images" on storage.objects;
drop policy if exists "Public read products images"   on storage.objects;
drop policy if exists "Admin và kế toán upload ảnh"   on storage.objects;
drop policy if exists "Admin và kế toán xóa ảnh"      on storage.objects;
drop policy if exists "Staff upload images"            on storage.objects;
drop policy if exists "Staff delete images"            on storage.objects;

create policy "Public read categories images"
  on storage.objects for select
  using (bucket_id = 'categories');

create policy "Public read products images"
  on storage.objects for select
  using (bucket_id = 'products');

create policy "Staff upload images"
  on storage.objects for insert
  with check (
    bucket_id in ('categories', 'products')
    and get_user_role() in ('admin', 'accountant', 'warehouse')
  );

create policy "Staff delete images"
  on storage.objects for delete
  using (
    bucket_id in ('categories', 'products')
    and get_user_role() in ('admin', 'accountant', 'warehouse')
  );

-- ============================================================
-- DỮ LIỆU MẶC ĐỊNH
-- ============================================================
insert into public.routes (name, sort_order) values
  ('Tuyến 1: Hà Nam - Hà Nội - Hòa Bình', 1),
  ('Tuyến 2: Thái Bình - Hưng Yên', 2),
  ('Tuyến 3: Ninh Bình - Thanh Hóa', 3)
on conflict do nothing;

insert into public.order_sources (name) values
  ('Facebook'),
  ('Zalo'),
  ('Website'),
  ('Điện thoại'),
  ('Khách vãng lai')
on conflict do nothing;

-- ============================================================
-- HƯỚNG DẪN TẠO TÀI KHOẢN ADMIN
-- ============================================================
-- 1. Supabase Dashboard > Authentication > Users > Add User
--    Email: admin@kimanh.com  |  Password: admin123  |  Bật Auto Confirm
-- 2. Trigger tự tạo profile với role='sale'
-- 3. Table Editor > profiles > tìm user > đổi role='admin', full_name='Đồ Đồng Kim Ánh'
-- ============================================================

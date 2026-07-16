-- Migration: order_status_history
-- Lưu lịch sử thay đổi trạng thái đơn hàng (ai đổi, từ trạng thái nào sang trạng thái nào, lúc nào)

create table if not exists public.order_status_history (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references public.orders(id) on delete cascade not null,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz default now() not null
);

create index idx_order_status_history_order on public.order_status_history(order_id);
create index idx_order_status_history_time on public.order_status_history(changed_at desc);

alter table public.order_status_history enable row level security;

create policy "Allow all for authenticated" on public.order_status_history
  for all using (auth.role() = 'authenticated');

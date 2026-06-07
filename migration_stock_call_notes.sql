-- Bảng ghi chú kho dạng chat cho tính năng gọi hàng
create table if not exists public.stock_call_notes (
  id          uuid        primary key default uuid_generate_v4(),
  order_id    uuid        not null references public.orders(id) on delete cascade,
  content     text        not null,
  author_name text        not null,
  created_at  timestamptz not null default now()
);

alter table public.stock_call_notes enable row level security;

create policy "stock_call_notes_select"
  on public.stock_call_notes for select
  using (get_user_role() in ('admin', 'accountant', 'warehouse'));

create policy "stock_call_notes_insert"
  on public.stock_call_notes for insert
  with check (get_user_role() in ('admin', 'accountant', 'warehouse'));

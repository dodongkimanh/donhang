-- Migration: inventory_edit_history
-- Lưu lịch sử chỉnh sửa phiếu nhập/xuất kho

create table if not exists public.inventory_edit_history (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid references public.inventory_transactions(id) on delete cascade not null,
  field_name text not null,
  old_value text,
  new_value text,
  edited_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz default now() not null
);

create index idx_edit_history_tx on public.inventory_edit_history(transaction_id);
create index idx_edit_history_time on public.inventory_edit_history(edited_at desc);

alter table public.inventory_edit_history enable row level security;

create policy "Allow all for authenticated" on public.inventory_edit_history
  for all using (auth.role() = 'authenticated');

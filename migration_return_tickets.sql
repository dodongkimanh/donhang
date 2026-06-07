-- ── Phiếu đổi trả / hoàn hàng ───────────────────────────────────────────────
-- Mỗi đơn hàng có thể có nhiều phiếu đổi trả
-- returned_items: hàng khách trả về (lấy từ order_items gốc)
-- exchange_items: hàng mới gửi cho khách (sản phẩm thay thế)

create table if not exists public.return_tickets (
  id              uuid        primary key default gen_random_uuid(),
  ticket_number   text        unique not null,
  order_id        uuid        not null references public.orders(id) on delete cascade,
  returned_items  jsonb       not null default '[]'::jsonb,
  -- [{order_item_id?, name, quantity, unit_price}]
  exchange_items  jsonb       not null default '[]'::jsonb,
  -- [{product_id?, name, quantity, unit_price}]
  returned_amount numeric(15,2) not null default 0,
  exchange_amount numeric(15,2) not null default 0,
  customer_paid   numeric(15,2) not null default 0,
  reason          text,
  note            text,
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

alter table public.return_tickets enable row level security;

create policy "Authenticated can view return_tickets"
  on public.return_tickets for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert return_tickets"
  on public.return_tickets for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update return_tickets"
  on public.return_tickets for update
  using (auth.role() = 'authenticated');

-- Thêm cột manually_added vào stock_calls
-- Cho phép admin/kế toán gọi hàng thủ công cho đơn không thiếu tồn kho

alter table public.stock_calls
  add column if not exists manually_added boolean not null default false;

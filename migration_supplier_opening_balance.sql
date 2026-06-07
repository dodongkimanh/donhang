-- Thêm cột nợ đầu kỳ vào bảng suppliers
-- Dùng để ghi nhận số nợ đã tồn tại trước khi dùng hệ thống

alter table public.suppliers
  add column if not exists opening_balance numeric not null default 0;

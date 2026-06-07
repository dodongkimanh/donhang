-- Thêm cột warehouse_note vào bảng route_orders
-- Cột này dùng để kế toán/admin ghi chú riêng cho kho khi xếp tuyến

alter table public.route_orders
  add column if not exists warehouse_note text;

-- Lưu tên người ghi chú kho và thời điểm ghi vào stock_calls

alter table public.stock_calls
  add column if not exists warehouse_note_by_name text,
  add column if not exists warehouse_note_at timestamptz;

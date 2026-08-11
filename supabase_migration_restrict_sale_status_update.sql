-- Migration: siết quyền UPDATE đơn hàng của nhân viên sale
-- Vấn đề: policy "orders_update" cũ cho phép nhân viên (employee_id = get_profile_id())
-- cập nhật đơn của mình sang BẤT KỲ trạng thái nào, kể cả 'confirmed' — cho phép
-- nhân viên sale tự xác nhận đơn của chính mình (kể cả gọi thẳng Supabase API,
-- không chỉ qua giao diện). Migration này thêm điều kiện chặt hơn:
--   - USING: nhân viên chỉ được sửa đơn hiện đang ở trạng thái draft/placed của mình
--   - WITH CHECK: trạng thái mới (nếu do nhân viên đặt) chỉ được là draft/placed/cancelled
-- Admin/accountant/warehouse không bị ảnh hưởng — vẫn full quyền như cũ.

drop policy if exists "orders_update" on public.orders;
drop policy if exists "Admin và kế toán chỉnh sửa đơn hàng" on public.orders;

create policy "orders_update"
  on public.orders for update
  using (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or (employee_id = get_profile_id() and status in ('draft', 'placed'))
  )
  with check (
    get_user_role() in ('admin', 'accountant', 'warehouse')
    or (employee_id = get_profile_id() and status in ('draft', 'placed', 'cancelled'))
  );

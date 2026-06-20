-- Thêm cột is_locked vào bảng profiles để khóa tài khoản nhân viên nghỉ việc
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

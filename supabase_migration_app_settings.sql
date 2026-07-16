-- Migration: App Settings (shared config across all users)
-- Chạy trong Supabase SQL Editor

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Tất cả user đã đăng nhập đều đọc được
CREATE POLICY "authenticated_read_settings" ON app_settings
  FOR SELECT TO authenticated USING (true);

-- Chỉ admin mới được ghi
CREATE POLICY "admin_write_settings" ON app_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Migration: thêm CMND và Địa Chỉ vào bảng profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cmnd    text,
  ADD COLUMN IF NOT EXISTS address text;

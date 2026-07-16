-- Migration: Ẩn sản phẩm (Product Hidden) — idempotent, chạy lại an toàn

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS products_is_hidden_idx ON products(is_hidden);

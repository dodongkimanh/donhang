-- Migration: Sản phẩm yêu thích (Favorite Products) — idempotent, chạy lại an toàn

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS products_is_favorite_idx ON products(is_favorite);

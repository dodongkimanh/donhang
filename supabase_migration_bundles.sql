-- Migration: Bộ Sản Phẩm (Product Bundles) — idempotent, chạy lại an toàn

-- ── Bảng bộ sản phẩm ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_bundles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  bundle_code TEXT        NOT NULL UNIQUE,
  description TEXT,
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Thêm cột bundle_code nếu chưa có (cho bảng đã tạo từ lần trước)
ALTER TABLE product_bundles ADD COLUMN IF NOT EXISTS bundle_code TEXT;

-- Điền mã cho các dòng chưa có (dùng CTE vì window function không dùng được trong UPDATE)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM product_bundles
  WHERE bundle_code IS NULL
)
UPDATE product_bundles
SET bundle_code = 'B' || LPAD(numbered.rn::TEXT, 3, '0')
FROM numbered
WHERE product_bundles.id = numbered.id;

ALTER TABLE product_bundles ALTER COLUMN bundle_code SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'product_bundles' AND indexname = 'product_bundles_bundle_code_key'
  ) THEN
    ALTER TABLE product_bundles ADD CONSTRAINT product_bundles_bundle_code_key UNIQUE (bundle_code);
  END IF;
END $$;

-- ── Bảng sản phẩm con trong bộ ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bundle_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id  UUID    NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bundle_id, product_id)
);

-- ── Trigger updated_at ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_product_bundles_updated_at ON product_bundles;
CREATE TRIGGER set_product_bundles_updated_at
  BEFORE UPDATE ON product_bundles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_items     ENABLE ROW LEVEL SECURITY;

-- Xóa policy cũ nếu có rồi tạo lại
DROP POLICY IF EXISTS "authenticated_read_bundles"    ON product_bundles;
DROP POLICY IF EXISTS "authenticated_write_bundles"   ON product_bundles;
DROP POLICY IF EXISTS "authenticated_read_bundle_items"  ON bundle_items;
DROP POLICY IF EXISTS "authenticated_write_bundle_items" ON bundle_items;

CREATE POLICY "authenticated_read_bundles"
  ON product_bundles FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_bundles"
  ON product_bundles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_bundle_items"
  ON bundle_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_write_bundle_items"
  ON bundle_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

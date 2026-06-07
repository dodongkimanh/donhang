-- Bước 1: Đặt tạm thành UUID để tránh xung đột unique khi update
UPDATE products SET product_code = id::text;

-- Bước 2: Gán mã 4 số ngẫu nhiên, không trùng nhau
WITH candidates AS (
  SELECT generate_series(1000, 9999) AS code
),
shuffled_candidates AS (
  SELECT code, row_number() OVER (ORDER BY random()) AS rn
  FROM candidates
),
product_list AS (
  SELECT id, row_number() OVER (ORDER BY random()) AS rn
  FROM products
)
UPDATE products p
SET product_code = sc.code::text
FROM product_list pl
JOIN shuffled_candidates sc ON sc.rn = pl.rn
WHERE p.id = pl.id;

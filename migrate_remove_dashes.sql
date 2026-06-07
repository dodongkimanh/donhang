UPDATE products
SET name = trim(regexp_replace(name, '\s*-\s*', ' ', 'g'));

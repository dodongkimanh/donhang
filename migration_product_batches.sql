-- Migration: create product_batches table for FIFO cost tracking
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.product_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  import_price  NUMERIC(15,2) NOT NULL DEFAULT 0,
  quantity      INTEGER NOT NULL DEFAULT 0,
  remaining_qty INTEGER NOT NULL DEFAULT 0,
  import_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_batches_product_id
  ON public.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_fifo
  ON public.product_batches(product_id, import_date ASC, created_at ASC);

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read product_batches"
  ON public.product_batches FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert product_batches"
  ON public.product_batches FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update product_batches"
  ON public.product_batches FOR UPDATE
  USING (auth.role() = 'authenticated');

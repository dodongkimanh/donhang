-- Migration: create supplier_payments table for debt tracking
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  note          TEXT,
  payment_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id
  ON public.supplier_payments(supplier_id);

-- RLS: same access rules as other tables
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read supplier_payments"
  ON public.supplier_payments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert supplier_payments"
  ON public.supplier_payments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin can delete supplier_payments"
  ON public.supplier_payments FOR DELETE
  USING (auth.role() = 'authenticated');

-- Migration: add cost_price to order_items for FIFO profit tracking
-- Run this in Supabase SQL Editor

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2);

COMMENT ON COLUMN public.order_items.cost_price
  IS 'FIFO cost per unit at time of packing. NULL means not yet packed or no batch data.';

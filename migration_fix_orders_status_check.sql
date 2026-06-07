-- Fix orders_status_check constraint: expand allowed status values
-- Old constraint only had: 'pending', 'processing', 'completed', 'cancelled'
-- New statuses used by the app need to be included

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'draft',
    'placed',
    'confirmed',
    'packing',
    'shipping',
    'completed',
    'returned',
    'returned_received',
    'partial_return',
    'cancelled'
  ));

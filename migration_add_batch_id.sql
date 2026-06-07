-- Migration: add batch_id to inventory_transactions
-- Run this in Supabase SQL Editor (or via psql)
-- Each save session (single or bulk) shares one batch_id UUID

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

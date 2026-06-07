# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CRM Quản Lý Đơn Hàng** is a Vietnamese-language order management CRM system built with React, TypeScript, and Supabase.

- **Type:** Vite-based React SPA
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS with custom blue theme
- **Database:** Supabase PostgreSQL
- **State Management:** Zustand (auth) + React Query (server state)
- **Build Tool:** Vite 5

## Commands

```bash
npm run dev          # Start dev server at localhost:5173
npm run build        # tsc type check + Vite production build → dist/
npm run typecheck    # TypeScript check without emit
npm run lint         # ESLint
npm run preview      # Preview production build
```

## Architecture

### Source Layout

```
src/
├── types/index.ts          # All TypeScript types (Database, Order, Product, etc.)
├── lib/
│   ├── supabase.ts         # Supabase client (falls back to mockSupabase if no env vars)
│   └── mockSupabase.ts     # In-memory mock for demo mode
├── stores/
│   ├── authStore.ts        # Zustand: user, profile, loading
│   └── routePlanningStore.ts
├── hooks/useAuth.ts        # Auth operations + role flags (isAdmin, isAccountant, canEdit)
├── components/
│   ├── auth/               # LoginPage, ProtectedRoute
│   ├── layout/             # AppLayout, TopNav, Sidebar
│   └── ui/                 # Modal, ConfirmDialog, BarcodeScannerModal, etc.
├── pages/                  # 12 feature pages (Dashboard, Products, Orders, etc.)
└── utils/
    ├── format.ts           # formatCurrency (VND), fmtThousands, generateBarcode/ProductCode/OrderNumber
    ├── csvUtils.ts         # CSV import/export
    └── imageUpload.ts
```

### Database Schema (supabase_schema.sql)

Key tables: `profiles` (roles: admin/accountant/employee), `categories`, `suppliers`, `products`, `product_suppliers` (per-supplier cost/barcode/stock), `inventory_transactions`, `customers`, `orders`, `order_items`, `order_sources`, `attendance`, `return_tickets`, `routes`, `route_orders`, `stock_calls`, `supplier_payments`.

**Critical trigger:** `sync_product_totals()` auto-aggregates product total stock and average cost from `product_suppliers` whenever supplier stock changes.

### Auth & Permissions

- Supabase Auth (email/password) → `useAuthStore` → `useAuth()` hook
- Routes wrapped with `<ProtectedRoute>` supporting role-based access (e.g., `/inventory`, `/employees` are admin-only)
- `canEdit` flag controls write operations for non-admin roles
- **Demo mode:** App runs fully in-memory when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent

### Data Patterns

- React Query with `staleTime: 30000` for all server state
- Query keys follow `['tableName', ...filters]` convention
- Mutations invalidate related query keys on success
- All Supabase calls use the fluent `.select().eq().single()` chain pattern

### UI Patterns

- Modal-based CRUD forms throughout — use existing `<Modal>` wrapper
- `<ConfirmDialog>` for all destructive actions
- `react-hot-toast` for notifications (top-right)
- `lucide-react` for all icons
- Layout: TopNav fixed at top → page content needs `pt-14`
- Mobile: tables need `overflow-x-auto`, forms use `grid-cols-1 sm:grid-cols-2`

### Path Alias

Use `@/` for all internal imports (e.g., `@/components/ui/Modal`, `@/hooks/useAuth`).

### Key Utilities (src/utils/format.ts)

- `formatCurrency(n)` → Vietnamese Dong display
- `fmtThousands(n)` → dot-separated input (1.000.000)
- `generateBarcode()` → 13-digit EAN (prefix 893)
- `generateProductCode()` → 4–6 digit code
- `generateOrderNumber()` → `DH` + YYMMDD + random (e.g., DH2602260001)

## Environment

Copy `.env.example` → `.env.local` and set:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

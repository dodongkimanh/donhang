import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, ArrowDownCircle, AlertTriangle,
  Truck, Copy, Search, X, ArrowLeft, CheckCircle2, ChevronDown,
  TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, generateBarcode, fmtThousands } from '@/utils/format'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Product, Supplier, ProductSupplier } from '@/types'
import toast from 'react-hot-toast'

// ── Searchable product combobox ───────────────────────────────────────────────

type ProductOption = Pick<Product, 'id' | 'name' | 'product_code' | 'unit'>

function ProductSearchSelect({
  value,
  onChange,
  products,
}: {
  value: string
  onChange: (id: string) => void
  products: ProductOption[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = products.find((p) => p.id === value)

  const filtered = products
    .filter((p) => {
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return p.name.toLowerCase().includes(q) || (p.product_code ?? '').toLowerCase().includes(q)
    })
    .slice(0, 50)

  function openDropdown() {
    setQuery('')
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function closeDropdown() {
    setOpen(false)
    setQuery('')
  }

  function toggleDropdown(e: React.MouseEvent) {
    e.preventDefault()   // prevent button from stealing focus (would trigger blur → closeDropdown)
    e.stopPropagation()
    if (open) closeDropdown()
    else openDropdown()
  }

  function handleSelect(p: ProductOption) {
    onChange(p.id)
    closeDropdown()
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onChange('')
    closeDropdown()
  }

  return (
    <div className="relative">
      {/* Combined input + buttons row */}
      <div
        className={`flex items-center border rounded-lg bg-white overflow-visible transition-colors ${
          open ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        {/* Left: search icon */}
        <Search size={13} className="flex-shrink-0 ml-2.5 text-gray-400 pointer-events-none" />

        {/* Input / selected display */}
        {!open && selected ? (
          /* Collapsed: show selected product */
          <div
            className="flex items-center gap-1.5 flex-1 px-2 py-2 min-w-0 cursor-pointer"
            onClick={openDropdown}
          >
            <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded flex-shrink-0">
              #{selected.product_code}
            </span>
            <span className="flex-1 truncate text-sm text-gray-900 font-medium">{selected.name}</span>
          </div>
        ) : (
          /* Open: text search input */
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(closeDropdown, 200)}
            placeholder="Nhập mã hàng hoặc tên..."
            className="flex-1 px-2 py-2 text-sm outline-none bg-transparent min-w-0"
          />
        )}

        {/* Right buttons */}
        <div className="flex items-center flex-shrink-0 gap-0.5 pr-1">
          {selected && !open && (
            <button
              type="button"
              onMouseDown={handleClear}
              title="Xóa lựa chọn"
              className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            onMouseDown={toggleDropdown}
            title="Mở danh sách sản phẩm"
            className="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
          >
            <ChevronDown size={15} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl mt-0.5 max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">Không tìm thấy sản phẩm</div>
          ) : (
            <>
              {query.trim() === '' && (
                <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-0">
                  {products.length} sản phẩm — nhập để lọc nhanh
                </div>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={() => handleSelect(p)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-blue-50 transition-colors ${p.id === value ? 'bg-blue-50' : ''}`}
                >
                  <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded flex-shrink-0 min-w-[3.5rem] text-center">
                    #{p.product_code}
                  </span>
                  <span className="flex-1 truncate text-gray-900">{p.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{p.unit}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Row type ──────────────────────────────────────────────────────────────────

interface BulkRow {
  _key: string
  product_id: string
  supplier_id: string
  quantity: string
  unit_price: string
  old_price: string
  note: string
}

function makeRow(): BulkRow {
  return { _key: Math.random().toString(36).slice(2), product_id: '', supplier_id: '', quantity: '', unit_price: '', old_price: '', note: '' }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
  products: Pick<Product, 'id' | 'name' | 'product_code' | 'unit' | 'cost_price' | 'sale_price'>[]
  suppliers: Supplier[]
  profileId: string
}

// ── Full-page component ───────────────────────────────────────────────────────

export function BulkImportPage({ onBack, products, suppliers, profileId }: Props) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<BulkRow[]>([makeRow()])
  const [confirmBackOpen, setConfirmBackOpen] = useState(false)

  const { data: allPs = [] } = useQuery({
    queryKey: ['product-suppliers-bulk'],
    queryFn: async () => {
      const { data } = await supabase.from('product_suppliers').select('*, supplier:suppliers(*)')
      return (data ?? []) as ProductSupplier[]
    },
  })

  function requestBack() {
    const dirty = rows.some((r) => r.product_id || r.quantity || r.unit_price)
    if (dirty) setConfirmBackOpen(true)
    else onBack()
  }

  function updateRow(key: string, patch: Partial<BulkRow>) {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  }
  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r._key !== key) : prev))
  }
  function duplicateRow(key: string) {
    const src = rows.find((r) => r._key === key)
    if (!src) return
    const dup: BulkRow = { ...src, _key: Math.random().toString(36).slice(2), quantity: '', note: '' }
    setRows((prev) => {
      const idx = prev.findIndex((r) => r._key === key)
      const next = [...prev]; next.splice(idx + 1, 0, dup); return next
    })
  }
  function handleProductChange(key: string, product_id: string) {
    updateRow(key, { product_id, supplier_id: '', unit_price: '', old_price: '' })
  }
  function handleNccChange(key: string, supplier_id: string, product_id: string) {
    const existing = allPs.find((ps) => ps.product_id === product_id && ps.supplier_id === supplier_id)
    const oldPrice = existing ? existing.cost_price.toString() : ''
    updateRow(key, { supplier_id, unit_price: oldPrice, old_price: oldPrice })
  }
  function isValid(r: BulkRow) {
    return !!r.product_id && !!r.supplier_id && !!r.quantity && parseInt(r.quantity) > 0
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const batchId = crypto.randomUUID()
      // Ghi lại các thay đổi đã thực hiện để rollback nếu cần
      const rollbackOps: Array<() => Promise<void>> = []

      try {
        for (const row of rows.filter(isValid)) {
          const qty = parseInt(row.quantity)
          const price = parseFloat(row.unit_price) || 0
          const existing = allPs.find((ps) => ps.product_id === row.product_id && ps.supplier_id === row.supplier_id)

          if (existing) {
            const { error } = await supabase
              .from('product_suppliers')
              .update({ quantity: existing.quantity + qty, cost_price: price })
              .eq('id', existing.id)
            if (error) throw error
            rollbackOps.push(() =>
              supabase.from('product_suppliers').update({ quantity: existing.quantity, cost_price: existing.cost_price }).eq('id', existing.id).then(() => {})
            )
          } else {
            const { data: newPs, error } = await supabase.from('product_suppliers').insert({
              product_id: row.product_id, supplier_id: row.supplier_id,
              barcode: generateBarcode(), cost_price: price, quantity: qty,
            }).select('id').single()
            if (error) throw error
            if (newPs) rollbackOps.push(() => supabase.from('product_suppliers').delete().eq('id', newPs.id).then(() => {}))
          }

          const { data: txn, error: txnErr } = await supabase.from('inventory_transactions').insert({
            product_id: row.product_id, supplier_id: row.supplier_id,
            type: 'import', quantity: qty, unit_price: price,
            note: row.note || null, created_by: profileId,
            batch_id: batchId,
          }).select('id').single()
          if (txnErr) throw txnErr
          if (txn) rollbackOps.push(() => supabase.from('inventory_transactions').delete().eq('id', txn.id).then(() => {}))

          const { data: batch, error: batchErr } = await supabase.from('product_batches').insert({
            product_id: row.product_id,
            supplier_id: row.supplier_id || null,
            import_price: price,
            quantity: qty,
            remaining_qty: qty,
            import_date: new Date().toISOString().split('T')[0],
          }).select('id').single()
          if (batchErr) throw batchErr
          if (batch) rollbackOps.push(() => supabase.from('product_batches').delete().eq('id', batch.id).then(() => {}))
        }
      } catch (err) {
        // Best-effort rollback các thao tác đã commit
        await Promise.allSettled(rollbackOps.reverse().map((fn) => fn()))
        throw err
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      queryClient.invalidateQueries({ queryKey: ['product-suppliers-bulk'] })
      queryClient.invalidateQueries({ queryKey: ['product-suppliers-inv'] })
      toast.success(`Nhập kho thành công ${rows.filter(isValid).length} dòng`)
      onBack()
    },
    onError: () => toast.error('Có lỗi xảy ra khi lưu'),
  })

  const validCount = rows.filter(isValid).length
  const invalidCount = rows.length - validCount
  const totalCost = rows.reduce((s, r) => s + (parseFloat(r.unit_price) || 0) * (parseInt(r.quantity) || 0), 0)

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={requestBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ArrowLeft size={15} /> Quay lại
          </button>
          <div className="h-5 w-px bg-gray-300" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Nhập Hàng Loạt Theo NCC</h1>
            <p className="text-sm text-gray-500 mt-0.5">{rows.length} dòng · {validCount} hợp lệ</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, makeRow()])}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Plus size={15} /> Thêm dòng
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={validCount === 0 || saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <CheckCircle2 size={16} />
            {saveMutation.isPending ? 'Đang lưu...' : `Nhập Kho${validCount > 0 ? ` (${validCount} dòng)` : ''}`}
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Desktop table — overflow: visible so combobox dropdowns aren't clipped */}
        <div className="hidden md:block" style={{ overflowX: 'visible' }}>
          <table className="w-full text-sm" style={{ overflow: 'visible' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-8">#</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">
                  Sản Phẩm <span className="text-gray-400 normal-case font-normal">(mã / tên)</span>
                  <span className="text-red-400 ml-0.5">*</span>
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3 w-52">
                  Nhà Cung Cấp <span className="text-red-400">*</span>
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3 w-28">
                  Số Lượng <span className="text-red-400">*</span>
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3 w-36">
                  Giá Cũ (VNĐ)
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3 w-40">
                  Giá Nhập Mới (VNĐ)
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Ghi Chú</th>
                <th className="px-3 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, idx) => {
                const psForProduct = allPs.filter((ps) => ps.product_id === row.product_id)
                const existingNcc = psForProduct.find((ps) => ps.supplier_id === row.supplier_id)
                const rowValid = isValid(row)

                return (
                  <tr
                    key={row._key}
                    className={`transition-colors ${rowValid ? 'bg-green-50/30' : 'hover:bg-gray-50/50'}`}
                  >
                    {/* Row number */}
                    <td className="px-4 py-2.5 text-xs text-gray-400 font-medium">{idx + 1}</td>

                    {/* Sản phẩm */}
                    <td className="px-3 py-2">
                      <ProductSearchSelect
                        value={row.product_id}
                        onChange={(id) => handleProductChange(row._key, id)}
                        products={products}
                      />
                    </td>

                    {/* NCC */}
                    <td className="px-3 py-2">
                      <select
                        value={row.supplier_id}
                        onChange={(e) => handleNccChange(row._key, e.target.value, row.product_id)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">-- Chọn NCC --</option>
                        {suppliers.map((s) => {
                          const linked = psForProduct.find((ps) => ps.supplier_id === s.id)
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name}{linked ? ` (tồn: ${linked.quantity})` : ''}
                            </option>
                          )
                        })}
                      </select>
                      {existingNcc && row.quantity && parseInt(row.quantity) > 0 && (
                        <p className="text-xs text-indigo-600 mt-0.5 flex items-center gap-1 px-0.5">
                          <Truck size={10} />
                          {existingNcc.quantity} → {existingNcc.quantity + (parseInt(row.quantity) || 0)}
                        </p>
                      )}
                      {row.supplier_id && !existingNcc && (
                        <p className="text-xs text-blue-500 mt-0.5 px-0.5">NCC mới cho SP này</p>
                      )}
                    </td>

                    {/* Số lượng */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fmtThousands(row.quantity)}
                        onChange={(e) => updateRow(row._key, { quantity: e.target.value.replace(/\D/g, '') })}
                        placeholder="0"
                        className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </td>

                    {/* Giá cũ (readonly) */}
                    <td className="px-3 py-2">
                      {existingNcc ? (
                        <div className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 select-none">
                          {fmtThousands(row.old_price) || '—'}
                        </div>
                      ) : (
                        <div className="w-full px-2.5 py-2 text-sm text-gray-300 text-center select-none">—</div>
                      )}
                    </td>

                    {/* Giá nhập mới */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fmtThousands(row.unit_price)}
                        onChange={(e) => updateRow(row._key, { unit_price: e.target.value.replace(/\D/g, '') })}
                        placeholder="0"
                        className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      {(() => {
                        const newP = parseFloat(row.unit_price)
                        const oldP = parseFloat(row.old_price)
                        if (!row.unit_price || !row.old_price || isNaN(newP) || isNaN(oldP)) {
                          if (row.unit_price && row.quantity && parseInt(row.quantity) > 0) {
                            return <p className="text-xs text-gray-400 mt-0.5 px-0.5">= {formatCurrency(newP * (parseInt(row.quantity) || 0))}</p>
                          }
                          return null
                        }
                        if (newP < oldP) {
                          const pct = Math.round(((oldP - newP) / oldP) * 100)
                          return (
                            <p className="text-xs text-green-600 mt-0.5 px-0.5 flex items-center gap-0.5 font-medium">
                              <TrendingDown size={11} /> Giảm {pct}%
                            </p>
                          )
                        }
                        if (newP > oldP) {
                          const pct = Math.round(((newP - oldP) / oldP) * 100)
                          return (
                            <p className="text-xs text-orange-500 mt-0.5 px-0.5 flex items-center gap-0.5 font-medium">
                              <TrendingUp size={11} /> Tăng {pct}%
                            </p>
                          )
                        }
                        return (
                          <p className="text-xs text-gray-400 mt-0.5 px-0.5 flex items-center gap-0.5">
                            <Minus size={11} /> Bằng giá cũ
                          </p>
                        )
                      })()}
                    </td>

                    {/* Ghi chú */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.note}
                        onChange={(e) => updateRow(row._key, { note: e.target.value })}
                        placeholder="Ghi chú..."
                        className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => duplicateRow(row._key)}
                          title="Nhân đôi dòng"
                          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(row._key)}
                          disabled={rows.length === 1}
                          title="Xóa dòng"
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {rows.map((row, idx) => {
            const psForProduct = allPs.filter((ps) => ps.product_id === row.product_id)
            const existingNcc = psForProduct.find((ps) => ps.supplier_id === row.supplier_id)
            const rowValid = isValid(row)
            return (
              <div key={row._key} className={`p-4 space-y-2.5 ${rowValid ? 'bg-green-50/30' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-400">Dòng {idx + 1}</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => duplicateRow(row._key)}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg">
                      <Copy size={13} />
                    </button>
                    <button type="button" onClick={() => removeRow(row._key)} disabled={rows.length === 1}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Sản Phẩm *</label>
                  <ProductSearchSelect value={row.product_id} onChange={(id) => handleProductChange(row._key, id)} products={products} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Nhà Cung Cấp *</label>
                  <select
                    value={row.supplier_id}
                    onChange={(e) => handleNccChange(row._key, e.target.value, row.product_id)}
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">-- Chọn NCC --</option>
                    {suppliers.map((s) => {
                      const linked = psForProduct.find((ps) => ps.supplier_id === s.id)
                      return <option key={s.id} value={s.id}>{s.name}{linked ? ` (tồn: ${linked.quantity})` : ''}</option>
                    })}
                  </select>
                  {existingNcc && <p className="text-xs text-indigo-600 mt-0.5">Tồn: {existingNcc.quantity}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Số Lượng *</label>
                    <input type="text" inputMode="numeric" value={fmtThousands(row.quantity)}
                      onChange={(e) => updateRow(row._key, { quantity: e.target.value.replace(/\D/g, '') })}
                      placeholder="0" className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {existingNcc && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Giá Cũ</label>
                      <div className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 select-none">
                        {fmtThousands(row.old_price) || '—'}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Giá Nhập Mới</label>
                  <input type="text" inputMode="numeric" value={fmtThousands(row.unit_price)}
                    onChange={(e) => updateRow(row._key, { unit_price: e.target.value.replace(/\D/g, '') })}
                    placeholder="0" className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                  {(() => {
                    const newP = parseFloat(row.unit_price)
                    const oldP = parseFloat(row.old_price)
                    if (!row.unit_price || !row.old_price || isNaN(newP) || isNaN(oldP)) return null
                    if (newP < oldP) {
                      const pct = Math.round(((oldP - newP) / oldP) * 100)
                      return <p className="text-xs text-green-600 mt-0.5 flex items-center gap-0.5 font-medium"><TrendingDown size={11} /> Giảm {pct}%</p>
                    }
                    if (newP > oldP) {
                      const pct = Math.round(((newP - oldP) / oldP) * 100)
                      return <p className="text-xs text-orange-500 mt-0.5 flex items-center gap-0.5 font-medium"><TrendingUp size={11} /> Tăng {pct}%</p>
                    }
                    return <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-0.5"><Minus size={11} /> Bằng giá cũ</p>
                  })()}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Ghi Chú</label>
                  <input type="text" value={row.note} onChange={(e) => updateRow(row._key, { note: e.target.value })}
                    placeholder="Ghi chú..." className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            )
          })}
        </div>

        {/* Add row footer inside table */}
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, makeRow()])}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Plus size={14} />
            Thêm dòng
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="flex flex-wrap items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-3 text-sm shadow-sm">
        <div className="flex items-center gap-2 text-green-700">
          <ArrowDownCircle size={16} />
          <span className="font-semibold">{validCount} dòng sẽ được nhập</span>
        </div>
        {totalCost > 0 && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            <span className="text-gray-600">
              Tổng giá trị nhập: <span className="font-bold text-gray-900">{formatCurrency(totalCost)}</span>
            </span>
          </>
        )}
        {invalidCount > 0 && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            <span className="flex items-center gap-1.5 text-orange-600">
              <AlertTriangle size={14} />
              {invalidCount} dòng chưa đủ thông tin sẽ bị bỏ qua
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={requestBack}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            Hủy
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={validCount === 0 || saveMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold"
          >
            <CheckCircle2 size={15} />
            {saveMutation.isPending ? 'Đang lưu...' : `Nhập Kho (${validCount} dòng)`}
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmBackOpen}
        onClose={() => setConfirmBackOpen(false)}
        onConfirm={onBack}
        title="Thoát mà không lưu?"
        message="Bạn có dữ liệu nhập chưa được lưu. Bạn có chắc muốn thoát không?"
        confirmLabel="Thoát"
      />
    </div>
  )
}

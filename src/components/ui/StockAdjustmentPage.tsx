import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Save, AlertTriangle, CheckCircle2, Search,
  TrendingUp, TrendingDown, SlidersHorizontal, ClipboardList,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtThousands } from '@/utils/format'
import type { Product, ProductSupplier, Supplier } from '@/types'
import type { CheckResult } from '@/components/ui/StockCheckPage'
import toast from 'react-hot-toast'

interface AdjRow {
  product_id: string
  product_name: string
  product_code: string
  supplier_id: string
  supplier_name: string
  ps_id: string
  system_qty: number
  actual_qty: string
}

interface Props {
  onBack: () => void
  products: Product[]
  suppliers: Supplier[]
  profileId: string
  checkResult?: CheckResult  // kết quả từ Phiếu Kiểm Kho
}

export function StockAdjustmentPage({ onBack, products, profileId, checkResult }: Props) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [showChangedOnly, setShowChangedOnly] = useState(false)

  // Nếu có checkResult → chỉ hiện hàng bị lệch từ phiếu kiểm kho
  // Nếu không → hiện tất cả hàng đang tồn > 0
  const allRows = useMemo<AdjRow[]>(() => {
    if (checkResult) {
      return checkResult.items.map((item) => ({
        product_id:   item.product_id,
        product_name: item.product_name,
        product_code: item.product_code,
        supplier_id:  item.supplier_id,
        supplier_name: item.supplier_name,
        ps_id:        item.ps_id,
        system_qty:   item.system_qty,
        actual_qty:   String(item.scanned_qty), // pre-fill bằng số đã quét
      }))
    }

    const rows: AdjRow[] = []
    for (const product of products) {
      const nccs: ProductSupplier[] = product.product_suppliers ?? []
      if (nccs.length === 0) {
        if ((product.quantity ?? 0) <= 0) continue
        rows.push({
          product_id: product.id,
          product_name: product.name,
          product_code: product.product_code,
          supplier_id: '',
          supplier_name: '(Không có NCC)',
          ps_id: '',
          system_qty: product.quantity,
          actual_qty: '',
        })
      } else {
        for (const ps of nccs) {
          if ((ps.quantity ?? 0) <= 0) continue
          rows.push({
            product_id: product.id,
            product_name: product.name,
            product_code: product.product_code,
            supplier_id: ps.supplier_id,
            supplier_name: ps.supplier?.name ?? ps.supplier_id,
            ps_id: ps.id ?? '',
            system_qty: ps.quantity,
            actual_qty: '',
          })
        }
      }
    }
    return rows
  }, [products, checkResult])

  const [rows, setRows] = useState<AdjRow[]>(() => allRows)

  function setActual(idx: number, value: string) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, actual_qty: value } : r))
  }

  const changedRows = rows.filter((r) => {
    const actual = parseInt(r.actual_qty)
    return r.actual_qty !== '' && !isNaN(actual) && actual !== r.system_qty
  })

  const q = search.toLowerCase()
  const displayRows = rows.filter((r) => {
    const matchSearch = !q || r.product_name.toLowerCase().includes(q) || r.product_code.includes(q)
    if (!matchSearch) return false
    if (showChangedOnly) {
      const actual = parseInt(r.actual_qty)
      return r.actual_qty !== '' && !isNaN(actual) && actual !== r.system_qty
    }
    return true
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (changedRows.length === 0) throw new Error('Không có thay đổi')
      const adjNote = note
        ? `Cân bằng kho: ${note}`
        : `Cân bằng kho ${new Date().toLocaleDateString('vi-VN')}`
      for (const row of changedRows) {
        const actual = parseInt(row.actual_qty)
        const diff = actual - row.system_qty
        if (row.ps_id) {
          const { error } = await supabase.from('product_suppliers').update({ quantity: actual }).eq('id', row.ps_id)
          if (error) throw error
        }
        const { error } = await supabase.from('inventory_transactions').insert({
          product_id: row.product_id,
          supplier_id: row.supplier_id || null,
          type: 'adjustment',
          quantity: Math.abs(diff),
          unit_price: 0,
          note: `${adjNote} | Trước: ${row.system_qty} → Sau: ${actual} (${diff > 0 ? '+' : ''}${diff})`,
          created_by: profileId,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      toast.success(`Đã cân bằng ${changedRows.length} dòng thành công`)
      onBack()
    },
    onError: (err: Error) => toast.error(err.message || 'Có lỗi xảy ra'),
  })

  const increaseCount = changedRows.filter((r) => parseInt(r.actual_qty) > r.system_qty).length
  const decreaseCount = changedRows.filter((r) => parseInt(r.actual_qty) < r.system_qty).length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SlidersHorizontal size={18} className="text-orange-500 flex-shrink-0" />
          <h1 className="text-base font-semibold text-gray-900">Phiếu Cân Bằng Kho</h1>
          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Chỉ Admin</span>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || changedRows.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Save size={15} />
          {saveMutation.isPending ? 'Đang lưu...' : `Lưu (${changedRows.length})`}
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {checkResult ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-start gap-2">
            <ClipboardList size={16} className="flex-shrink-0 mt-0.5 text-blue-500" />
            <span>
              Dựa trên <strong>Phiếu Kiểm Kho</strong> ngày {checkResult.date} — có <strong>{checkResult.items.length} mặt hàng lệch</strong>.
              Số liệu đã quét đã được điền sẵn. Kiểm tra lại và điều chỉnh nếu cần, sau đó bấm Lưu.
            </span>
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-800 flex items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-orange-500" />
            <span>Nhập số lượng <strong>thực tế</strong> vào cột Thực Tế. Hệ thống sẽ điều chỉnh tồn kho. Dòng để trống sẽ <strong>giữ nguyên</strong>.</span>
          </div>
        )}

        {/* Ghi chú + tìm kiếm */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Ghi chú phiếu</label>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Kiểm kho tháng 6, sau sự kiện khuyến mãi..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
            />
          </div>
          <div className="sm:w-64">
            <label className="block text-xs font-medium text-gray-500 mb-1">Tìm sản phẩm</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Tên hoặc mã hàng..."
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Chips */}
        {changedRows.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600 font-medium">Thay đổi:</span>
            {increaseCount > 0 && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                <TrendingUp size={12} /> +{increaseCount} tăng
              </span>
            )}
            {decreaseCount > 0 && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                <TrendingDown size={12} /> {decreaseCount} giảm
              </span>
            )}
            <button
              onClick={() => setShowChangedOnly((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                showChangedOnly ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {showChangedOnly ? 'Đang lọc dòng lệch' : 'Xem dòng lệch'}
            </button>
            <span className="text-xs text-gray-400 ml-auto">{displayRows.length} / {rows.length} dòng</span>
          </div>
        )}

        {/* Bảng */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left font-semibold text-gray-500 text-xs uppercase px-4 py-3">Sản Phẩm</th>
                  <th className="text-left font-semibold text-gray-500 text-xs uppercase px-4 py-3">Nhà Cung Cấp</th>
                  <th className="text-right font-semibold text-gray-500 text-xs uppercase px-4 py-3">Tồn HT</th>
                  <th className="text-center font-semibold text-orange-500 text-xs uppercase px-4 py-3">Thực Tế</th>
                  <th className="text-right font-semibold text-gray-500 text-xs uppercase px-4 py-3">Chênh Lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayRows.map((row, idx) => {
                  const globalIdx = rows.indexOf(row)
                  const actual = parseInt(row.actual_qty)
                  const hasActual = row.actual_qty !== '' && !isNaN(actual)
                  const diff = hasActual ? actual - row.system_qty : null
                  const isChanged = diff !== null && diff !== 0
                  return (
                    <tr key={`${row.product_id}-${row.supplier_id}-${idx}`}
                      className={isChanged ? 'bg-orange-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{row.product_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{row.product_code}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.supplier_name}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{row.system_qty}</td>
                      <td className="px-4 py-3">
                        <input
                          type="text" inputMode="numeric"
                          value={fmtThousands(row.actual_qty)}
                          onChange={(e) => setActual(globalIdx, e.target.value.replace(/\D/g, ''))}
                          placeholder={String(row.system_qty)}
                          className={`w-24 mx-auto block text-center px-2 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ${
                            isChanged ? 'border-orange-400 bg-orange-50 focus:ring-orange-300' : 'border-gray-300 focus:ring-blue-400'
                          }`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {diff === null ? <span className="text-gray-300 text-xs">—</span>
                          : diff === 0 ? <span className="text-gray-400 text-xs flex items-center justify-end gap-1"><CheckCircle2 size={12} /> Khớp</span>
                          : diff > 0 ? <span className="text-green-600 font-semibold text-sm flex items-center justify-end gap-1"><TrendingUp size={14} /> +{diff}</span>
                          : <span className="text-red-600 font-semibold text-sm flex items-center justify-end gap-1"><TrendingDown size={14} /> {diff}</span>
                        }
                      </td>
                    </tr>
                  )
                })}
                {displayRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-12 text-gray-400">
                    <CheckCircle2 size={32} className="mx-auto mb-2 opacity-30" />
                    <p>{showChangedOnly ? 'Chưa có dòng nào thay đổi' : 'Không tìm thấy sản phẩm'}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-100">
            {displayRows.map((row, idx) => {
              const globalIdx = rows.indexOf(row)
              const actual = parseInt(row.actual_qty)
              const diff = row.actual_qty !== '' && !isNaN(actual) ? actual - row.system_qty : null
              return (
                <div key={`${row.product_id}-${row.supplier_id}-${idx}`} className={`p-4 ${diff !== null && diff !== 0 ? 'bg-orange-50/40' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{row.product_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{row.product_code}</p>
                    </div>
                    {diff !== null && diff !== 0 && (
                      <span className={`text-sm font-bold ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>{diff > 0 ? '+' : ''}{diff}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">Tồn HT: <strong>{row.system_qty}</strong></span>
                    <div className="flex-1" />
                    <label className="text-xs text-gray-500">Thực tế:</label>
                    <input type="number" min="0" value={row.actual_qty}
                      onChange={(e) => setActual(globalIdx, e.target.value)}
                      placeholder={String(row.system_qty)}
                      className={`w-20 text-center px-2 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ${
                        diff !== null && diff !== 0 ? 'border-orange-400 bg-orange-50' : 'border-gray-300 focus:ring-blue-400'
                      }`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {changedRows.length > 0 && (
          <div className="sticky bottom-4 bg-white border border-orange-200 shadow-lg rounded-2xl px-4 py-3 flex items-center gap-4">
            <div className="flex-1 text-sm">
              <span className="font-semibold text-orange-700">{changedRows.length} dòng</span>
              <span className="text-gray-500"> sẽ được điều chỉnh</span>
              {increaseCount > 0 && <span className="text-green-600 ml-2">↑{increaseCount}</span>}
              {decreaseCount > 0 && <span className="text-red-600 ml-2">↓{decreaseCount}</span>}
            </div>
            <button
              onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              <Save size={15} />
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu Phiếu'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  ArrowLeft, ScanLine, Search, CheckCircle2, TrendingUp, TrendingDown,
  ClipboardList, Eye, EyeOff, RotateCcw, FileText, SlidersHorizontal,
} from 'lucide-react'
import type { Product, ProductSupplier } from '@/types'
import toast from 'react-hot-toast'

interface CheckRow {
  product_id: string
  product_name: string
  product_code: string
  supplier_id: string
  supplier_name: string
  ps_id: string
  system_qty: number
  scanned_qty: number
}

export interface CheckResult {
  date: string
  items: CheckRow[]
}

interface Props {
  onBack: () => void
  products: Product[]
  onComplete?: (result: CheckResult) => void
}

export function StockCheckPage({ onBack, products, onComplete }: Props) {
  const [scanInput, setScanInput] = useState('')
  const [search, setSearch] = useState('')
  const [hideMatched, setHideMatched] = useState(true)
  const [isDone, setIsDone] = useState(false)  // chuyển sang màn báo cáo
  const scanRef = useRef<HTMLInputElement>(null)

  // Chỉ lấy sản phẩm đang có tồn
  const allRows = useMemo<CheckRow[]>(() => {
    const rows: CheckRow[] = []
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
          scanned_qty: 0,
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
            scanned_qty: 0,
          })
        }
      }
    }
    return rows
  }, [products])

  const [rows, setRows] = useState<CheckRow[]>(() => allRows)

  // Bản đồ mã vạch → {product_id, supplier_id}
  const barcodeMap = useMemo(() => {
    const map: Record<string, { product_id: string; supplier_id: string }> = {}
    for (const product of products) {
      if (product.barcode) map[product.barcode.trim()] = { product_id: product.id, supplier_id: '' }
      if (product.product_code) map[product.product_code.trim()] = { product_id: product.id, supplier_id: '' }
      for (const ps of product.product_suppliers ?? []) {
        if (ps.barcode) map[ps.barcode.trim()] = { product_id: product.id, supplier_id: ps.supplier_id }
      }
    }
    return map
  }, [products])

  useEffect(() => { scanRef.current?.focus() }, [])

  function handleScan(barcode: string) {
    const trimmed = barcode.trim()
    if (!trimmed) return
    const key = barcodeMap[trimmed]
    if (!key) {
      toast.error(`Không tìm thấy: "${trimmed}"`, { duration: 2000 })
      return
    }
    setRows((prev) => {
      const idx = prev.findIndex((r) =>
        r.product_id === key.product_id &&
        (key.supplier_id === '' || r.supplier_id === key.supplier_id)
      )
      if (idx === -1) return prev
      const row = prev[idx]
      const next = row.scanned_qty + 1
      const matched = next === row.system_qty
      toast.success(
        `${row.product_name}: ${next}${matched ? ' ✓ Khớp!' : ''}`,
        { duration: 1200, id: `scan-${row.product_id}-${row.supplier_id}` }
      )
      return prev.map((r, i) => i === idx ? { ...r, scanned_qty: next } : r)
    })
  }

  function handleScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleScan(scanInput)
      setScanInput('')
    }
  }

  function resetRow(idx: number) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, scanned_qty: 0 } : r))
  }

  // Thống kê
  const scannedRows  = rows.filter((r) => r.scanned_qty > 0)
  const matchedRows  = rows.filter((r) => r.scanned_qty > 0 && r.scanned_qty === r.system_qty)
  const lechRows     = rows.filter((r) => r.scanned_qty > 0 && r.scanned_qty !== r.system_qty)
  const notScanned   = rows.filter((r) => r.scanned_qty === 0)

  const q = search.toLowerCase()
  const displayRows = rows.filter((r) => {
    if (q && !r.product_name.toLowerCase().includes(q) && !r.product_code.includes(q)) return false
    if (hideMatched && r.scanned_qty > 0 && r.scanned_qty === r.system_qty) return false
    return true
  })

  // ── Màn báo cáo ──
  if (isDone) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button onClick={() => setIsDone(false)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
            <ArrowLeft size={18} />
          </button>
          <FileText size={18} className="text-blue-500 flex-shrink-0" />
          <div className="flex-1">
            <h1 className="text-base font-semibold text-gray-900">Báo Cáo Kiểm Kho</h1>
            <p className="text-xs text-gray-400">{new Date().toLocaleString('vi-VN')}</p>
          </div>
          {onComplete && lechRows.length > 0 && (
            <button
              onClick={() => onComplete({ date: new Date().toLocaleString('vi-VN'), items: lechRows })}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold flex-shrink-0"
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Gửi Admin Cân Bằng</span>
              <span className="text-xs">({lechRows.length})</span>
            </button>
          )}
        </div>

        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Tóm tắt */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Tổng SP có tồn', value: rows.length, color: 'bg-blue-50 text-blue-700' },
              { label: 'Đã quét', value: scannedRows.length, color: 'bg-gray-50 text-gray-700' },
              { label: 'Khớp', value: matchedRows.length, color: 'bg-green-50 text-green-700' },
              { label: 'Lệch', value: lechRows.length, color: 'bg-red-50 text-red-700' },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-3 text-center ${s.color}`}>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Danh sách lệch */}
          {lechRows.length > 0 && (
            <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <span className="text-sm font-semibold text-red-700">Hàng Lệch Số Lượng ({lechRows.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Sản Phẩm</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-4 py-2.5">Tồn HT</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-4 py-2.5">Đã Quét</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-4 py-2.5">Chênh Lệch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lechRows.map((r) => {
                      const diff = r.scanned_qty - r.system_qty
                      return (
                        <tr key={`${r.product_id}-${r.supplier_id}`} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{r.product_name}</p>
                            <p className="text-xs text-gray-400 font-mono">{r.product_code}</p>
                            <p className="text-xs text-gray-400">{r.supplier_name}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700 font-medium">{r.system_qty}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">{r.scanned_qty}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-bold text-sm ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Chưa quét */}
          {notScanned.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-600">Chưa Quét ({notScanned.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {notScanned.map((r) => (
                      <tr key={`${r.product_id}-${r.supplier_id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{r.product_name}</p>
                          <p className="text-xs text-gray-400 font-mono">{r.product_code}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">Tồn HT: {r.system_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {lechRows.length === 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-8 text-center">
              <CheckCircle2 size={40} className="mx-auto mb-2 text-green-500" />
              <p className="font-semibold text-green-700">Tất cả hàng đã quét đều khớp!</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Màn quét ──
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
          <ArrowLeft size={18} />
        </button>
        <ClipboardList size={18} className="text-blue-500 flex-shrink-0" />
        <h1 className="text-base font-semibold text-gray-900 flex-1">Phiếu Kiểm Kho</h1>
        <button
          onClick={() => setIsDone(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          <FileText size={15} />
          Xem Báo Cáo
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Ô quét */}
        <div className="bg-white rounded-xl border-2 border-blue-400 p-3 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
            <ScanLine size={22} className="text-blue-500" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-blue-600 mb-1">Quét Mã Vạch</label>
            <input
              ref={scanRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScanKeyDown}
              placeholder="Đặt con trỏ vào đây rồi quét mã vạch..."
              className="w-full px-3 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-blue-50/30 placeholder:text-blue-300 font-mono"
              autoComplete="off"
            />
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-xs text-gray-400">Đã quét</div>
            <div className="text-2xl font-bold text-blue-600">{scannedRows.length}</div>
            {lechRows.length > 0 && <div className="text-xs text-red-500 font-medium">{lechRows.length} lệch</div>}
          </div>
        </div>

        {/* Thanh tìm kiếm + toggle */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên hoặc mã hàng..."
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>
          <button
            onClick={() => setHideMatched((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0 ${
              hideMatched ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {hideMatched ? <EyeOff size={13} /> : <Eye size={13} />}
            {hideMatched ? `Ẩn ${matchedRows.length} đã khớp` : `Hiện đã khớp`}
          </button>
          <span className="text-xs text-gray-400">{displayRows.length}/{rows.length} dòng</span>
        </div>

        {/* Bảng */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left font-semibold text-gray-500 text-xs uppercase px-4 py-3">Sản Phẩm</th>
                  <th className="text-left font-semibold text-gray-500 text-xs uppercase px-4 py-3">NCC</th>
                  <th className="text-right font-semibold text-gray-500 text-xs uppercase px-4 py-3">Tồn HT</th>
                  <th className="text-right font-semibold text-blue-500 text-xs uppercase px-4 py-3">Đã Quét</th>
                  <th className="text-right font-semibold text-gray-500 text-xs uppercase px-4 py-3">Chênh Lệch</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayRows.map((row, idx) => {
                  const globalIdx = rows.indexOf(row)
                  const hasScanned = row.scanned_qty > 0
                  const diff = hasScanned ? row.scanned_qty - row.system_qty : null
                  const isMatch = diff === 0
                  const isOver  = diff !== null && diff > 0
                  const isUnder = diff !== null && diff < 0
                  return (
                    <tr key={`${row.product_id}-${row.supplier_id}-${idx}`}
                      className={isMatch ? 'bg-green-50/30' : isOver ? 'bg-blue-50/30' : isUnder ? 'bg-red-50/30' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{row.product_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{row.product_code}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.supplier_name}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{row.system_qty}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold text-base ${hasScanned ? 'text-gray-900' : 'text-gray-300'}`}>
                          {hasScanned ? row.scanned_qty : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {diff === null ? <span className="text-gray-200 text-xs">—</span>
                          : isMatch ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 size={13} /> Khớp</span>
                          : isOver  ? <span className="inline-flex items-center gap-1 text-blue-600 font-semibold text-sm"><TrendingUp size={14} /> +{diff}</span>
                          : <span className="inline-flex items-center gap-1 text-red-600 font-semibold text-sm"><TrendingDown size={14} /> {diff}</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        {hasScanned && (
                          <button onClick={() => resetRow(globalIdx)} className="p-1 text-gray-300 hover:text-red-400 rounded" title="Reset">
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {displayRows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                    <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400 opacity-60" />
                    <p className="text-green-600 font-medium">
                      {hideMatched && matchedRows.length > 0 ? `Tất cả ${matchedRows.length} mã đã khớp!` : 'Không tìm thấy'}
                    </p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-100">
            {displayRows.map((row, idx) => {
              const globalIdx = rows.indexOf(row)
              const diff = row.scanned_qty > 0 ? row.scanned_qty - row.system_qty : null
              return (
                <div key={`${row.product_id}-${row.supplier_id}-${idx}`} className="p-4">
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{row.product_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{row.product_code}</p>
                    </div>
                    {diff !== null && (
                      <span className={`text-sm font-bold ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500 text-xs">Tồn HT: <strong>{row.system_qty}</strong></span>
                    <span className="text-gray-500 text-xs">Đã quét: <strong className="text-gray-900">{row.scanned_qty || '—'}</strong></span>
                    {row.scanned_qty > 0 && (
                      <button onClick={() => resetRow(globalIdx)} className="ml-auto p-1 text-gray-300 hover:text-red-400">
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

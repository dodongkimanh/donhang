import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BarcodeScannerModal } from '@/components/ui/BarcodeScannerModal'
import {
  Scan, Search, Package, Building2, Calendar,
  AlertCircle, Clock, QrCode, ChevronRight
} from 'lucide-react'
import { formatDate, formatCurrency } from '@/utils/format'
import type { Product, InventoryTransaction, ProductSupplier } from '@/types'

interface LookupResult {
  product: Product & { category?: { id: string; name: string } }
  importTransactions: (InventoryTransaction & {
    supplier?: { id: string; name: string; phone?: string }
    profile?: { id: string; full_name: string }
  })[]
  productSuppliers: (ProductSupplier & {
    supplier?: { id: string; name: string; phone?: string; address?: string }
  })[]
}

export function BarcodeTrackerPage() {
  const [showScanner, setShowScanner] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastScanned, setLastScanned] = useState('')

  async function lookupBarcode(barcode: string) {
    const trimmed = barcode.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResult(null)
    setLastScanned(trimmed)

    try {
      // Tìm sản phẩm theo products.barcode trước
      let { data: product } = await supabase
        .from('products')
        .select('*, category:categories(id, name)')
        .eq('barcode', trimmed)
        .maybeSingle()

      // Nếu không tìm thấy, thử tìm qua product_suppliers.barcode
      if (!product) {
        const { data: ps } = await supabase
          .from('product_suppliers')
          .select('product_id')
          .eq('barcode', trimmed)
          .maybeSingle()

        if (ps?.product_id) {
          const { data: p } = await supabase
            .from('products')
            .select('*, category:categories(id, name)')
            .eq('id', ps.product_id)
            .maybeSingle()
          product = p
        }
      }

      if (!product) {
        setError(`Không tìm thấy sản phẩm với mã vạch: ${trimmed}`)
        setLoading(false)
        return
      }

      // Lấy lịch sử phiếu nhập
      const { data: transactions } = await supabase
        .from('inventory_transactions')
        .select('*, supplier:suppliers(id, name, phone), profile:profiles(id, full_name)')
        .eq('product_id', product.id)
        .eq('type', 'import')
        .order('created_at', { ascending: false })

      // Lấy tồn kho theo NCC
      const { data: productSuppliers } = await supabase
        .from('product_suppliers')
        .select('*, supplier:suppliers(id, name, phone, address)')
        .eq('product_id', product.id)
        .order('quantity', { ascending: false })

      setResult({
        product,
        importTransactions: transactions ?? [],
        productSuppliers: productSuppliers ?? [],
      })
    } catch {
      setError('Đã xảy ra lỗi khi tra cứu. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  function handleDetected(barcode: string) {
    setBarcodeInput(barcode)
    lookupBarcode(barcode)
  }

  function handleManualSearch() {
    lookupBarcode(barcodeInput)
  }

  function handleClear() {
    setResult(null)
    setError(null)
    setBarcodeInput('')
    setLastScanned('')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Tra Cứu Nguồn Gốc</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Quét mã vạch trên sản phẩm để xem thời gian nhập kho và nhà cung cấp
        </p>
      </div>

      {/* Ô quét / nhập mã */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setShowScanner(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Scan size={18} />
            Quét Mã Vạch
          </button>
          <div className="flex flex-1 gap-2">
            <input
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              placeholder="Hoặc nhập mã vạch rồi nhấn Enter..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleManualSearch}
              disabled={!barcodeInput.trim() || loading}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors disabled:opacity-40"
              title="Tìm kiếm"
            >
              <Search size={16} />
            </button>
            {(result || error) && (
              <button
                onClick={handleClear}
                className="px-3 py-2 text-gray-400 hover:text-gray-600 transition-colors text-sm"
                title="Xóa kết quả"
              >
                Xóa
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Đang tra cứu mã vạch <span className="font-mono text-gray-700">{lastScanned}</span>...</p>
        </div>
      )}

      {/* Lỗi không tìm thấy */}
      {error && !loading && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Không tìm thấy</p>
            <p className="text-sm mt-0.5 text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Kết quả */}
      {result && !loading && (
        <div className="space-y-4">

          {/* Thông tin sản phẩm */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
            <div className="flex gap-4">
              {result.product.image_url ? (
                <img
                  src={result.product.image_url}
                  alt={result.product.name}
                  className="w-20 h-20 rounded-lg object-cover flex-shrink-0 border border-gray-100"
                />
              ) : (
                <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package size={28} className="text-gray-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900 text-base sm:text-lg leading-tight">{result.product.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-gray-500">
                  <span>Mã hàng: <span className="font-mono text-gray-700">{result.product.product_code}</span></span>
                  <span className="flex items-center gap-1">
                    <QrCode size={12} />
                    <span className="font-mono text-gray-700">{result.product.barcode}</span>
                  </span>
                  {result.product.unit && <span>ĐVT: <span className="text-gray-700">{result.product.unit}</span></span>}
                  {result.product.category && (
                    <span>Danh mục: <span className="text-gray-700">{result.product.category.name}</span></span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-semibold">
                    Tồn kho: {result.product.quantity} {result.product.unit}
                  </span>
                  {result.importTransactions.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium">
                      <Calendar size={13} />
                      {result.importTransactions.length} lần nhập
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tồn kho theo nhà cung cấp */}
          {result.productSuppliers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                  <Building2 size={15} className="text-blue-600" />
                  Tồn Kho Theo Nhà Cung Cấp
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {result.productSuppliers.map((ps) => (
                  <div key={ps.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{ps.supplier?.name ?? '—'}</p>
                      {ps.supplier?.phone && (
                        <p className="text-xs text-gray-400 mt-0.5">{ps.supplier.phone}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-gray-900 text-sm">
                        {ps.quantity} <span className="font-normal text-gray-500">{result.product.unit}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">Giá nhập: {formatCurrency(ps.cost_price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lịch sử phiếu nhập */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                <Calendar size={15} className="text-green-600" />
                Lịch Sử Phiếu Nhập
              </h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {result.importTransactions.length} giao dịch
              </span>
            </div>

            {result.importTransactions.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Calendar size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Chưa có lịch sử nhập kho</p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-2.5 font-medium">Thời gian nhập</th>
                        <th className="px-5 py-2.5 font-medium">Nhà cung cấp</th>
                        <th className="px-5 py-2.5 font-medium text-right">Số lượng</th>
                        <th className="px-5 py-2.5 font-medium text-right">Đơn giá</th>
                        <th className="px-5 py-2.5 font-medium">Người nhập</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.importTransactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-gray-700 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Clock size={13} className="text-gray-400 flex-shrink-0" />
                              {formatDate(tx.created_at)}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {tx.supplier ? (
                              <div>
                                <p className="font-medium text-gray-800">{tx.supplier.name}</p>
                                {tx.supplier.phone && (
                                  <p className="text-xs text-gray-400">{tx.supplier.phone}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="font-semibold text-green-700">+{tx.quantity}</span>
                            <span className="text-gray-400 ml-1">{result.product.unit}</span>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-700 whitespace-nowrap">
                            {tx.unit_price > 0 ? formatCurrency(tx.unit_price) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-3 text-gray-600 text-sm">
                            {tx.profile?.full_name ?? <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {result.importTransactions.map((tx, idx) => (
                    <div key={tx.id} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                            <Clock size={11} />
                            {formatDate(tx.created_at)}
                          </div>
                          <p className="font-medium text-gray-800 text-sm">
                            {tx.supplier?.name ?? <span className="text-gray-400 font-normal">Không rõ NCC</span>}
                          </p>
                          {tx.supplier?.phone && (
                            <p className="text-xs text-gray-400 mt-0.5">{tx.supplier.phone}</p>
                          )}
                          {tx.profile?.full_name && (
                            <p className="text-xs text-gray-400 mt-0.5">Người nhập: {tx.profile.full_name}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-green-700 text-sm">+{tx.quantity} {result.product.unit}</p>
                          {tx.unit_price > 0 && (
                            <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(tx.unit_price)}</p>
                          )}
                        </div>
                      </div>
                      {idx < result.importTransactions.length - 1 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-gray-300">
                          <ChevronRight size={12} />
                          <span>Lần nhập trước</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Trạng thái mặc định khi chưa quét */}
      {!result && !error && !loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <QrCode size={36} className="text-gray-300" />
          </div>
          <p className="font-medium text-gray-500">Chưa có kết quả</p>
          <p className="text-sm mt-1">Bấm <span className="font-medium text-blue-500">Quét Mã Vạch</span> hoặc nhập mã vạch để tra cứu</p>
        </div>
      )}

      {showScanner && (
        <BarcodeScannerModal
          onDetected={handleDetected}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}

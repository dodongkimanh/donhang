import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Package, Barcode, Search, ScanLine,
  ImageIcon, Printer, RefreshCw, Tag, Upload, Download,
  ChevronDown, FileText, Star, Settings, HelpCircle, AlignJustify, Truck,
  Eye, EyeOff,
} from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ProductImagesEditor } from '@/components/ui/ProductImagesEditor'
import { ProductSuppliersEditor, type SupplierEntry } from '@/components/ui/ProductSuppliersEditor'
import { PrintLabelModal } from '@/components/ui/PrintLabel'
import { BarcodeScannerModal } from '@/components/ui/BarcodeScannerModal'
import { formatCurrency, formatDateOnly, generateBarcode, generateProductCode, fmtThousands } from '@/utils/format'
import { exportProductsCSV, downloadImportTemplate, parseCSV, mapCSVRow } from '@/utils/csvUtils'
import type { Product, Category, Supplier, ProductSupplier } from '@/types'
import toast from 'react-hot-toast'

// ── Barcode preview ───────────────────────────────────────────────────────────

// Barcode hợp lệ: chỉ gồm chữ số, dài 8–14 ký tự
function isBarcodeValid(barcode: string): boolean {
  return /^\d{8,14}$/.test(barcode)
}

function BarcodePreview({ barcode }: { barcode: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (svgRef.current && barcode) {
      try {
        JsBarcode(svgRef.current, barcode, { format: 'CODE128', width: 1.8, height: 55, displayValue: true, fontSize: 11, margin: 4 })
      } catch { /* ignore */ }
    }
  }, [barcode])
  return <svg ref={svgRef} />
}

// ── Product form types ────────────────────────────────────────────────────────

interface ProductForm {
  category_id: string
  name: string
  product_code: string
  barcode: string        // mã vạch chung (có thể sync từ NCC đầu tiên)
  sale_price: string
  unit: string
  description: string
  images: string[]
  supplierEntries: SupplierEntry[]
}

const defaultForm: ProductForm = {
  category_id: '', name: '', product_code: '', barcode: '',
  sale_price: '', unit: 'cái', description: '', images: [], supplierEntries: [],
}

// ── Import Modal ──────────────────────────────────────────────────────────────

function ImportModal({
  isOpen, onClose, categories, suppliers,
}: { isOpen: boolean; onClose: () => void; categories: Category[]; suppliers: Supplier[] }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ReturnType<typeof mapCSVRow>[]>([])
  const [importing, setImporting] = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text).map(mapCSVRow).filter(Boolean)
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  async function handleImport() {
    if (!rows.length) return
    setImporting(true)
    let success = 0, fail = 0

    // Group rows by product_code (or name fallback) — same code = same product, multiple suppliers
    const groups = new Map<string, NonNullable<typeof rows[number]>[]>()
    for (const row of rows) {
      if (!row) continue
      const key = row.product_code || row.name
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }

    for (const [, group] of groups) {
      const first = group[0]
      let categoryId: string | null = null
      if (first.category_name) {
        const match = categories.find((c) => c.name.toLowerCase() === first.category_name.toLowerCase())
        if (match) categoryId = match.id
      }
      const code = first.product_code || generateProductCode()
      const bc = first.barcode || generateBarcode()

      // upsert: nếu product_code đã tồn tại → cập nhật thay vì báo lỗi duplicate
      const { data: inserted, error } = await supabase.from('products').upsert(
        {
          product_code: code, barcode: bc, name: first.name,
          category_id: categoryId,
          sale_price: first.sale_price, cost_price: first.cost_price,
          quantity: first.quantity, unit: first.unit || 'cái',
          description: first.description || null,
        },
        { onConflict: 'product_code' }
      ).select('id').single()
      if (error) {
        console.error('Import product error:', error.message, first.name)
        fail++
        continue
      }

      // Upsert product_supplier per row (unique: product_id + supplier_id)
      for (const r of group) {
        const supplierId = r.supplier_name
          ? suppliers.find((s) => s.name.toLowerCase() === r.supplier_name.toLowerCase())?.id
          : selectedSupplierId || undefined
        if (supplierId && inserted?.id) {
          const { error: psErr } = await supabase.from('product_suppliers').upsert(
            {
              product_id: inserted.id,
              supplier_id: supplierId,
              barcode: r.barcode || bc,
              cost_price: r.cost_price,
              quantity: r.quantity,
              note: r.supplier_note || null,
            },
            { onConflict: 'product_id,supplier_id' }
          )
          if (psErr) console.error('Import supplier error:', psErr.message, first.name)
        }
      }
      success++
    }
    setImporting(false)
    queryClient.invalidateQueries({ queryKey: ['products'] })
    if (success > 0) {
      toast.success(`Nhập thành công ${success} sản phẩm${fail ? ` (lỗi ${fail}, xem Console)` : ''}`)
      setRows([])
      setSelectedSupplierId('')
      onClose()
    } else {
      toast.error(`Không nhập được sản phẩm nào (${fail} lỗi). Kiểm tra Console để biết chi tiết.`)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nhập Hàng Hóa Từ File" size="xl">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-medium mb-1">Định dạng file CSV:</p>
          <p className="text-xs text-blue-600">Các cột: <span className="font-mono">Mã hàng, Mã vạch, Tên hàng, Danh mục, Giá bán, Nhà cung cấp, Giá vốn, Tồn kho, Ghi chú NCC, Đơn vị, Mô tả</span></p>
          <p className="text-xs text-blue-500 mt-0.5">Nếu 1 sản phẩm có nhiều NCC, thêm nhiều hàng cùng <strong>Mã hàng</strong> với NCC khác nhau.</p>
          <button onClick={downloadImportTemplate} className="mt-2 text-blue-600 hover:underline text-xs flex items-center gap-1">
            <Download size={12} /> Tải file mẫu
          </button>
        </div>

        {/* Supplier selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nhà cung cấp <span className="text-gray-400 font-normal">(không bắt buộc)</span>
          </label>
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Không gắn nhà cung cấp --</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Chỉ dùng khi file không có cột "Nhà cung cấp". Nếu file đã có tên NCC thì bỏ qua.
          </p>
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl p-8 text-center cursor-pointer transition-colors"
        >
          <Upload size={32} className="mx-auto text-gray-400 mb-2" />
          <p className="text-gray-600 font-medium">Nhấn để chọn file CSV</p>
          <p className="text-xs text-gray-400 mt-1">Hỗ trợ file .csv (UTF-8)</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
        </div>

        {rows.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Xem trước {rows.length} sản phẩm:</p>
            <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-60">
              <table className="w-full text-xs min-w-[500px]">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['Mã hàng', 'Tên hàng', 'Nhà cung cấp', 'Giá vốn', 'Tồn kho'].map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, i) => row && (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-mono">{row.product_code || '(tự sinh)'}</td>
                      <td className="px-3 py-1.5 font-medium">{row.name}</td>
                      <td className="px-3 py-1.5 text-gray-500">{row.supplier_name || '-'}</td>
                      <td className="px-3 py-1.5">{formatCurrency(row.cost_price)}</td>
                      <td className="px-3 py-1.5">{row.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
          <button
            onClick={handleImport}
            disabled={!rows.length || importing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
          >
            <Upload size={16} />
            {importing ? 'Đang nhập...' : `Nhập ${rows.length} sản phẩm`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Product edit modal (isolated state to prevent full-page re-renders on typing) ──

interface EditModalProps {
  isOpen: boolean
  editingProduct: Product | null
  categories: Category[]
  suppliers: Supplier[]
  existingCodes: string[]
  existingSupplierEntries: ProductSupplier[]
  onSave: (form: ProductForm) => void
  onClose: () => void
  isPending: boolean
}

function ProductEditModal({
  isOpen, editingProduct, categories, suppliers,
  existingCodes, existingSupplierEntries, onSave, onClose, isPending,
}: EditModalProps) {
  const { canEdit } = useAuth()
  const [form, setForm] = useState<ProductForm>(defaultForm)
  const [activeTab, setActiveTab] = useState<'info' | 'suppliers'>('info')
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (editingProduct) {
      setForm({
        category_id: editingProduct.category_id,
        name: editingProduct.name,
        product_code: editingProduct.product_code,
        barcode: editingProduct.barcode,
        sale_price: editingProduct.sale_price.toString(),
        unit: editingProduct.unit,
        description: editingProduct.description ?? '',
        images: editingProduct.images?.length ? editingProduct.images : (editingProduct.image_url ? [editingProduct.image_url] : []),
        supplierEntries: [],
      })
    } else {
      setForm({ ...defaultForm, product_code: generateProductCode(existingCodes), barcode: generateBarcode(), supplierEntries: [] })
    }
    setActiveTab('info')
    setConfirmCloseOpen(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingProduct?.id])

  useEffect(() => {
    if (existingSupplierEntries.length > 0 && editingProduct && isOpen) {
      setForm((prev) => ({
        ...prev,
        supplierEntries: existingSupplierEntries.map((ps) => ({
          id: ps.id,
          supplier_id: ps.supplier_id,
          barcode: ps.barcode,
          cost_price: ps.cost_price.toString(),
          quantity: ps.quantity.toString(),
          note: ps.note ?? '',
        })),
      }))
    }
  }, [existingSupplierEntries]) // eslint-disable-line react-hooks/exhaustive-deps

  const formTotalQty = form.supplierEntries.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0)

  function requestClose() {
    const dirty = editingProduct !== null ||
      !!form.name.trim() || !!form.sale_price || !!form.description ||
      form.images.length > 0 || form.supplierEntries.length > 0 || !!form.category_id
    if (dirty) setConfirmCloseOpen(true)
    else onClose()
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={requestClose} title={editingProduct ? 'Chỉnh Sửa Sản Phẩm' : 'Thêm Sản Phẩm'} size="lg">
        <div className="flex border-b border-gray-200 mb-4 -mx-4 sm:-mx-6 px-4 sm:px-6 gap-1">
          <button type="button" onClick={() => setActiveTab('info')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'info' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Package size={14} /> Thông Tin
          </button>
          {canEdit && (
            <button type="button" onClick={() => setActiveTab('suppliers')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'suppliers' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Truck size={14} /> Nhà Cung Cấp
              {form.supplierEntries.length > 0 && (
                <span className="ml-1 text-xs bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full">{form.supplierEntries.length}</span>
              )}
            </button>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (activeTab === 'info') onSave(form) }}>
          {activeTab === 'info' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ảnh Sản Phẩm</label>
                <ProductImagesEditor
                  images={form.images}
                  onChange={(imgs) => setForm((prev) => ({ ...prev, images: imgs }))}
                  bucket="products" folder="products" maxImages={8}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên Sản Phẩm <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Nhập tên sản phẩm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Danh Mục</label>
                  <select value={form.category_id} onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Không có danh mục</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mã Hàng <span className="text-xs text-gray-400">(4–6 số)</span> <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">#</span>
                      <input type="text" value={form.product_code}
                        onChange={(e) => setForm((prev) => ({ ...prev, product_code: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        required minLength={4} maxLength={4}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono font-semibold" placeholder="1001" />
                    </div>
                    <button type="button" onClick={() => setForm((prev) => ({ ...prev, product_code: generateProductCode(existingCodes) }))}
                      className="px-2.5 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500" title="Tạo mã mới">
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Giá Bán (VNĐ) <span className="text-red-500">*</span></label>
                  <input type="text" inputMode="numeric" value={fmtThousands(form.sale_price)}
                    onChange={(e) => setForm((prev) => ({ ...prev, sale_price: e.target.value.replace(/\D/g, '') }))} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Đơn Vị</label>
                  <input type="text" value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="cái, hộp, kg..." />
                </div>
                {form.supplierEntries.length > 0 && (
                  <div className="sm:col-span-2">
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm">
                      <Truck size={15} className="text-green-600" />
                      <span className="text-green-700">Tồn kho tự động: <strong>{formTotalQty} {form.unit}</strong> từ {form.supplierEntries.length} NCC</span>
                    </div>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mô Tả</label>
                  <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
                {canEdit && (
                  <button type="button" onClick={() => setActiveTab('suppliers')}
                    className="px-4 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-sm font-medium flex items-center gap-1.5">
                    <Truck size={14} /> NCC ({form.supplierEntries.length})
                  </button>
                )}
                <button type="submit" disabled={isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium">
                  {isPending ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'suppliers' && canEdit && (
            <div className="space-y-4">
              <ProductSuppliersEditor
                entries={form.supplierEntries}
                onChange={(entries) => setForm((prev) => ({ ...prev, supplierEntries: entries }))}
                suppliers={suppliers} unit={form.unit}
              />
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
                <button type="button" onClick={() => setActiveTab('info')}
                  className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium">← Thông tin</button>
                <button type="button" onClick={() => onSave(form)} disabled={isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium">
                  {isPending ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        onConfirm={() => { setConfirmCloseOpen(false); onClose() }}
        title="Thoát mà không lưu?"
        message="Bạn có thay đổi chưa được lưu. Bạn có chắc muốn thoát không?"
        confirmLabel="Thoát"
      />
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const { canEdit, canDelete, isEmployee } = useAuth()
  const queryClient = useQueryClient()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null)
  const [printProduct, setPrintProduct] = useState<Product | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [viewProduct, setViewProduct] = useState<Product | null>(null)
  const [viewImgIdx, setViewImgIdx] = useState(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock' | 'low_stock'>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [createDropOpen, setCreateDropOpen] = useState(false)
  const [catDropOpen, setCatDropOpen] = useState(false)
  const [showFavOnly, setShowFavOnly] = useState(false)
  const [favIds, setFavIds] = useState<Set<string>>(new Set())
  const [revealedCost, setRevealedCost] = useState(false)
  const [revealedRatio, setRevealedRatio] = useState(false)

  useEffect(() => {
    if (!createDropOpen && !catDropOpen) return
    const handler = () => { setCreateDropOpen(false); setCatDropOpen(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [createDropOpen, catDropOpen])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').order('name')
      return (data ?? []) as Category[]
    },
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('*').order('name')
      return (data ?? []) as Supplier[]
    },
  })

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(*), product_suppliers(*, supplier:suppliers(*))')
        .order('name')
      if (error) throw error
      return (data ?? []) as Product[]
    },
  })

  const { data: existingSupplierEntries = [] } = useQuery({
    queryKey: ['product-suppliers', editingProduct?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('product_suppliers')
        .select('*, supplier:suppliers(*)')
        .eq('product_id', editingProduct!.id)
        .order('created_at')
      return (data ?? []) as ProductSupplier[]
    },
    enabled: !!editingProduct?.id && isModalOpen,
  })


  const { data: pendingQty = {} } = useQuery({
    queryKey: ['pending-qty-by-product'],
    queryFn: async () => {
      const { data: pendingOrders } = await supabase
        .from('orders')
        .select('id')
        .in('status', ['placed', 'confirmed'])

      if (!pendingOrders?.length) return {} as Record<string, number>

      const ids = (pendingOrders as { id: string }[]).map((o) => o.id)
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, quantity')
        .in('order_id', ids)

      const result: Record<string, number> = {}
      ;(items ?? []).forEach((item: { product_id: string; quantity: number }) => {
        result[item.product_id] = (result[item.product_id] ?? 0) + item.quantity
      })
      return result
    },
  })

  const availQty = (p: { id: string; quantity: number }) => Math.max(0, p.quantity - (pendingQty[p.id] ?? 0))

  const existingCodes = products.map((p) => p.product_code)

  const saveMutation = useMutation({
    mutationFn: async (values: ProductForm) => {
      // Calculate cost_price and quantity from supplier entries
      const totalQty = values.supplierEntries.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0)
      // Trung bình có trọng số theo số lượng từng NCC
      const weightedCostSum = values.supplierEntries.reduce((s, e) => s + (parseFloat(e.cost_price) || 0) * (parseInt(e.quantity) || 0), 0)
      const avgCost = totalQty > 0 ? weightedCostSum / totalQty : 0

      const productPayload = {
        category_id: values.category_id || undefined,
        name: values.name,
        product_code: values.product_code,
        barcode: values.supplierEntries[0]?.barcode || values.barcode || generateBarcode(),
        sale_price: parseFloat(values.sale_price) || 0,
        cost_price: Math.round(avgCost),
        quantity: totalQty,
        unit: values.unit,
        description: values.description || null,
        image_url: values.images[0] ?? null,
        images: values.images,
      }

      let productId = editingProduct?.id

      if (editingProduct) {
        const { error } = await supabase.from('products').update(productPayload).eq('id', editingProduct.id)
        if (error) throw error
      } else {
        const { data: orderData, error } = await supabase
          .from('products')
          .insert(productPayload)
          .select()
          .single()
        if (error) throw error
        productId = (orderData as { id: string }).id
      }

      if (!isEmployee && productId) {
        // Get current entries in DB
        const { data: existingInDB } = await supabase
          .from('product_suppliers')
          .select('id')
          .eq('product_id', productId)
        const existingDbIds = ((existingInDB ?? []) as { id: string }[]).map((e) => e.id)
        const keptIds = values.supplierEntries.filter((e) => e.id).map((e) => e.id!)

        // Delete removed entries
        const toDelete = existingDbIds.filter((id) => !keptIds.includes(id))
        for (const id of toDelete) {
          await supabase.from('product_suppliers').delete().eq('id', id)
        }

        // Insert / update entries
        for (const entry of values.supplierEntries) {
          const payload = {
            product_id: productId,
            supplier_id: entry.supplier_id,
            barcode: entry.barcode,
            cost_price: parseFloat(entry.cost_price) || 0,
            quantity: parseInt(entry.quantity) || 0,
            note: entry.note || null,
          }
          if (entry.id) {
            await supabase.from('product_suppliers').update(payload).eq('id', entry.id)
          } else {
            await supabase.from('product_suppliers').insert(payload)
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product-suppliers'] })
      toast.success(editingProduct ? 'Cập nhật thành công' : 'Thêm sản phẩm thành công')
      closeModal()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('product_suppliers').delete().eq('product_id', id)
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Đã xóa sản phẩm')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa sản phẩm'),
  })

  const deleteSelectedMutation = useMutation({
    mutationFn: async () => {
      let failed = 0
      for (const id of selectedIds) {
        await supabase.from('product_suppliers').delete().eq('product_id', id)
        const { error } = await supabase.from('products').delete().eq('id', id)
        if (error) failed++
      }
      if (failed > 0) throw new Error(`${failed} sản phẩm không thể xóa (đang được sử dụng trong đơn hàng)`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Đã xóa ${selectedIds.size} sản phẩm`)
      setSelectedIds(new Set())
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.error(err.message)
      setSelectedIds(new Set())
    },
  })

  function openAdd() {
    setEditingProduct(null)
    setIsModalOpen(true)
    setCreateDropOpen(false)
  }

  function openEdit(product: Product) {
    setEditingProduct(product)
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingProduct(null)
  }

  const toggleFav = useCallback((id: string) => {
    setFavIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  const countByCategory = products.reduce<Record<string, number>>((acc, p) => {
    acc[p.category_id] = (acc[p.category_id] ?? 0) + 1; return acc
  }, {})

  const LOW_STOCK_THRESHOLD = 5

  const filtered = products.filter((p) => {
    const matchCat = !selectedCategoryId || p.category_id === selectedCategoryId
    const matchFav = !showFavOnly || favIds.has(p.id)
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.product_code.includes(q) || p.barcode.includes(q)
    const avail = availQty(p)
    const matchStock =
      stockFilter === 'all' ? true
      : stockFilter === 'in_stock' ? avail > 0
      : stockFilter === 'out_of_stock' ? avail === 0
      : avail > 0 && avail <= LOW_STOCK_THRESHOLD
    return matchCat && matchFav && matchSearch && matchStock
  })

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))

  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((p) => p.id)))
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId)

  return (
    <div>
      {/* ══ TOP TOOLBAR ══════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900 mr-2">Hàng hóa</h1>

        <div className="relative flex-1 min-w-[160px] max-w-sm flex items-center">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Theo mã, tên hàng, mã vạch"
            className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            onClick={() => setScannerOpen(true)}
            title="Quét mã vạch"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            <ScanLine size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {canEdit && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setCreateDropOpen((v) => !v) }}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">Tạo mới</span>
                <ChevronDown size={14} />
              </button>
              {createDropOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 z-30 w-44 py-1 overflow-hidden">
                  <button onClick={openAdd} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50">
                    <Package size={15} className="text-blue-500" /> Thêm sản phẩm
                  </button>
                  <button onClick={() => { setCreateDropOpen(false); window.location.href = '#/categories' }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50">
                    <Tag size={15} className="text-purple-500" /> Thêm danh mục
                  </button>
                </div>
              )}
            </div>
          )}

          {canEdit && (
            <button
              onClick={() => setIsImportOpen(true)}
              className="hidden sm:flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-700"
            >
              <Upload size={15} />
              <span>Import file</span>
            </button>
          )}


          <button
            onClick={() => exportProductsCSV(filtered, categories)}
            title={stockFilter !== 'all' ? `Xuất ${filtered.length} sản phẩm theo bộ lọc hiện tại` : `Xuất tất cả ${filtered.length} sản phẩm`}
            className="hidden sm:flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-700"
          >
            <Download size={15} />
            <span>Xuất file{stockFilter !== 'all' ? ` (${filtered.length})` : ''}</span>
          </button>

          <div className="hidden sm:flex items-center border border-gray-300 rounded-lg overflow-hidden">
            <button className="p-2 hover:bg-gray-50 transition-colors text-gray-500" title="Tuỳ chỉnh cột">
              <AlignJustify size={16} />
            </button>
            <button className="p-2 hover:bg-gray-50 transition-colors text-gray-500 border-l border-gray-200" title="Cài đặt">
              <Settings size={16} />
            </button>
            <button className="p-2 hover:bg-gray-50 transition-colors text-gray-500 border-l border-gray-200" title="Trợ giúp">
              <HelpCircle size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Stock filter chips ── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(
          [
            { key: 'all', label: 'Tất cả tồn kho' },
            { key: 'in_stock', label: `Còn hàng (${products.filter((p) => availQty(p) > 0).length})` },
            { key: 'out_of_stock', label: `Hết hàng (${products.filter((p) => availQty(p) === 0).length})` },
            { key: 'low_stock', label: `Sắp hết ≤ ${LOW_STOCK_THRESHOLD} (${products.filter((p) => availQty(p) > 0 && availQty(p) <= LOW_STOCK_THRESHOLD).length})` },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStockFilter(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              stockFilter === key
                ? key === 'out_of_stock'
                  ? 'bg-red-500 text-white border-red-500'
                  : key === 'low_stock'
                    ? 'bg-orange-500 text-white border-orange-500'
                    : key === 'in_stock'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Selected actions bar */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-blue-800">Đã chọn {selectedIds.size} sản phẩm</span>
          <button onClick={() => deleteSelectedMutation.mutate()} className="text-xs text-red-600 hover:underline">Xóa đã chọn</button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 hover:underline">Bỏ chọn</button>
        </div>
      )}

      {/* ══ MOBILE: category dropdown ══════════════════════════════════════════ */}
      <div className="lg:hidden mb-4 relative z-10">
        <button
          onClick={(e) => { e.stopPropagation(); setCatDropOpen((v) => !v) }}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all duration-200 ${
            catDropOpen
              ? 'border-blue-500 bg-blue-50 shadow-md'
              : selectedCategoryId
                ? 'border-blue-400 bg-blue-600 text-white shadow-md'
                : 'border-gray-200 bg-white text-gray-700 shadow-sm'
          }`}
        >
          <div className="flex items-center gap-3">
            {selectedCategoryId ? (
              (() => {
                const cat = categories.find((c) => c.id === selectedCategoryId)
                return cat ? (
                  cat.image_url
                    ? <img src={cat.image_url} alt="" className="w-7 h-7 rounded-xl object-cover border border-white/30" />
                    : <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center"><Tag size={14} className="text-white" /></div>
                ) : null
              })()
            ) : (
              <div className={`w-7 h-7 rounded-xl flex items-center justify-center ${catDropOpen ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <Tag size={14} className={catDropOpen ? 'text-blue-600' : 'text-gray-500'} />
              </div>
            )}

            <div className="text-left">
              <p className={`text-sm font-semibold leading-tight ${catDropOpen ? 'text-blue-700' : selectedCategoryId ? 'text-white' : 'text-gray-900'}`}>
                {selectedCategoryId
                  ? categories.find((c) => c.id === selectedCategoryId)?.name ?? 'Danh mục'
                  : 'Tất Cả Danh Mục'}
              </p>
              <p className={`text-xs leading-tight ${catDropOpen ? 'text-blue-500' : selectedCategoryId ? 'text-blue-100' : 'text-gray-400'}`}>
                {filtered.length} sản phẩm · {categories.length} danh mục
              </p>
            </div>
          </div>

          <ChevronDown
            size={18}
            className={`transition-transform duration-200 ${catDropOpen ? 'rotate-180 text-blue-600' : selectedCategoryId ? 'text-white' : 'text-gray-400'}`}
          />
        </button>

        {catDropOpen && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedCategoryId(null); setSearch(''); setCatDropOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors ${
                !selectedCategoryId ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                !selectedCategoryId ? 'bg-blue-600' : 'bg-gray-100'
              }`}>
                <Package size={18} className={!selectedCategoryId ? 'text-white' : 'text-gray-400'} />
              </div>
              <div className="flex-1 text-left">
                <p className={`text-sm font-semibold ${!selectedCategoryId ? 'text-blue-700' : 'text-gray-800'}`}>Tất Cả</p>
                <p className="text-xs text-gray-400">{products.length} sản phẩm</p>
              </div>
              {!selectedCategoryId && (
                <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>

            <div className="h-px bg-gray-100 mx-4" />

            {categories.map((cat, idx) => {
              const isActive = selectedCategoryId === cat.id
              const count = countByCategory[cat.id] ?? 0
              return (
                <div key={cat.id}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedCategoryId(cat.id); setSearch(''); setCatDropOpen(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors ${
                      isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {cat.image_url ? (
                      <img src={cat.image_url} alt={cat.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-gray-100" />
                    ) : (
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-blue-600' : 'bg-gray-100'}`}>
                        <Tag size={17} className={isActive ? 'text-white' : 'text-gray-400'} />
                      </div>
                    )}

                    <div className="flex-1 text-left min-w-0">
                      <p className={`text-sm font-semibold truncate ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{cat.name}</p>
                      {cat.description ? (
                        <p className="text-xs text-gray-400 truncate">{cat.description}</p>
                      ) : (
                        <p className="text-xs text-gray-400">{count} sản phẩm</p>
                      )}
                    </div>

                    <span className={`text-xs px-2 py-1 rounded-xl font-semibold flex-shrink-0 ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {count}
                    </span>

                    {isActive && (
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                  {idx < categories.length - 1 && <div className="h-px bg-gray-50 mx-4" />}
                </div>
              )
            })}

            {categories.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">Chưa có danh mục nào</div>
            )}
          </div>
        )}
      </div>

      {/* ══ MAIN TWO-COLUMN ════════════════════════════════════════════════════ */}
      <div className="flex gap-4 items-start">

        {/* LEFT sidebar – desktop only */}
        <aside className="hidden lg:flex flex-col gap-3 w-48 flex-shrink-0 sticky top-[72px]">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200 flex flex-col" style={{ maxHeight: 'calc(100vh - 96px)' }}>
            <div className="flex items-center justify-between px-3 py-2.5 border-b bg-blue-600 flex-shrink-0">
              <span className="text-sm font-semibold text-white">Nhóm hàng</span>
              {canEdit && (
                <button onClick={() => { window.location.href = '/categories' }} className="text-xs text-blue-100 hover:text-white">Tạo mới</button>
              )}
            </div>
            <button
              onClick={() => { setSelectedCategoryId(null); setSearch('') }}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-l-2 flex-shrink-0 ${
                !selectedCategoryId ? 'bg-blue-50 text-blue-700 font-semibold border-blue-500' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-700 border-transparent'
              }`}
            >
              Tất Cả
            </button>
            <ul className="divide-y divide-gray-50 overflow-y-auto flex-1">
              {categories.map((cat) => {
                const isActive = selectedCategoryId === cat.id
                return (
                  <li key={cat.id}>
                    <button
                      onClick={() => { setSelectedCategoryId(cat.id); setSearch('') }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors border-l-2 ${
                        isActive ? 'bg-blue-50 text-blue-700 font-semibold border-blue-500' : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700 border-transparent'
                      }`}
                    >
                      {cat.image_url
                        ? <img src={cat.image_url} alt={cat.name} className="w-5 h-5 rounded object-cover flex-shrink-0" />
                        : <Tag size={12} className={isActive ? 'text-blue-500' : 'text-gray-400'} />
                      }
                      <span className="flex-1 truncate text-left">{cat.name}</span>
                      <span className={`text-xs px-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        {countByCategory[cat.id] ?? 0}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <button
            onClick={() => setShowFavOnly((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors ${
              showFavOnly ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Star size={14} fill={showFavOnly ? 'currentColor' : 'none'} />
            Yêu thích
          </button>
        </aside>

        {/* RIGHT: table */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
            <span>{filtered.length}/{products.length} sản phẩm{selectedCategory ? ` trong "${selectedCategory.name}"` : ''}</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-3 w-8">
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                          className="rounded border-gray-300 text-blue-600" />
                      </th>
                      <th className="px-2 py-3 w-8">
                        <Star size={14} className="text-gray-400 mx-auto" />
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3 w-12">Ảnh</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Mã hàng</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Tên hàng</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Danh mục</th>
                      {!isEmployee && (
                        <>
                          <th className="hidden md:table-cell text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">
                            <span className="inline-flex items-center gap-1 justify-end">
                              Giá vốn TB
                              <button
                                onClick={() => setRevealedCost((v) => !v)}
                                className="p-0.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
                                title={revealedCost ? 'Ẩn giá vốn' : 'Hiện giá vốn'}
                              >
                                {revealedCost ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </span>
                          </th>
                          <th className="hidden md:table-cell text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">
                            <span className="flex items-center gap-1 justify-center"><Truck size={11} />NCC</span>
                          </th>
                        </>
                      )}
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Giá bán</th>
                      {!isEmployee && (
                        <th className="hidden md:table-cell text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">
                          <span className="inline-flex items-center gap-1 justify-end">
                            Hệ số
                            <button
                              onClick={() => setRevealedRatio((v) => !v)}
                              className="p-0.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
                              title={revealedRatio ? 'Ẩn hệ số' : 'Hiện hệ số'}
                            >
                              {revealedRatio ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </span>
                        </th>
                      )}
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Tồn kho</th>
                      <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">
                        <span className="text-orange-600">Khách đặt</span>
                      </th>
                      <th className="hidden lg:table-cell text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3">Thời gian tạo</th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((product) => {
                      const pending = pendingQty[product.id] ?? 0
                      const isSelected = selectedIds.has(product.id)
                      const isFav = favIds.has(product.id)
                      const nccCount = product.product_suppliers?.length ?? 0
                      return (
                        <tr key={product.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                          <td className="px-3 py-3">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(product.id)}
                              className="rounded border-gray-300 text-blue-600" />
                          </td>
                          <td className="px-2 py-3">
                            <button onClick={() => toggleFav(product.id)} className="block mx-auto">
                              <Star size={14} className={isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'} />
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            {(() => {
                              const thumb = product.images?.[0] ?? product.image_url
                              return thumb ? (
                                <div className="relative w-9 h-9">
                                  <img src={thumb} alt="" className="w-9 h-9 rounded-lg object-cover border border-gray-100" />
                                  {(product.images?.length ?? 0) > 1 && (
                                    <span className="absolute -bottom-1 -right-1 text-[9px] bg-gray-700 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                                      {product.images!.length}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <ImageIcon size={14} className="text-gray-400" />
                                </div>
                              )
                            })()}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                              {product.product_code}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-gray-900 leading-tight">{product.name}</p>
                            {isBarcodeValid(product.barcode)
                              ? <p className="text-xs text-gray-400 font-mono mt-0.5">{product.barcode}</p>
                              : <p className="text-xs text-red-500 font-mono mt-0.5 flex items-center gap-1" title="Mã vạch bị lỗi — cần sửa lại">⚠ {product.barcode}</p>
                            }
                          </td>
                          <td className="px-3 py-2.5">
                            {product.category?.name
                              ? <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">{product.category.name}</span>
                              : <span className="text-gray-300 text-xs">--</span>
                            }
                          </td>
                          {!isEmployee && (
                            <>
                              <td className="hidden md:table-cell px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                                {revealedCost
                                  ? (product.cost_price > 0 ? formatCurrency(product.cost_price) : <span className="text-gray-300">--</span>)
                                  : <span className="text-gray-400 tracking-widest font-bold">••••••</span>
                                }
                              </td>
                              <td className="hidden md:table-cell px-3 py-2.5 text-center">
                                {nccCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                                    <Truck size={10} />
                                    {nccCount}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 text-xs">--</span>
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-2.5 text-right font-semibold text-green-600 whitespace-nowrap">
                            {formatCurrency(product.sale_price)}
                          </td>
                          {!isEmployee && (
                            <td className="hidden md:table-cell px-3 py-2.5 text-right whitespace-nowrap min-w-[80px]">
                              {revealedRatio
                                ? product.cost_price > 0
                                  ? (() => {
                                      const ratio = product.sale_price / product.cost_price
                                      return (
                                        <span className={`${ratio >= 2 ? 'text-green-600' : ratio >= 1.5 ? 'text-blue-600' : ratio >= 1 ? 'text-orange-500' : 'text-red-500'}`}>
                                          ~{ratio.toFixed(2).replace('.', ',')}
                                        </span>
                                      )
                                    })()
                                  : <span className="text-gray-300">--</span>
                                : <span className="text-gray-400 tracking-widest">••••</span>
                              }
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-right">
                            {(() => {
                              const avail = availQty(product)
                              return (
                                <>
                                  <span className={`font-semibold ${avail === 0 ? 'text-red-500' : avail <= 5 ? 'text-orange-500' : 'text-gray-900'}`}>
                                    {avail}
                                  </span>
                                  <span className="text-xs text-gray-400 ml-1">{product.unit}</span>
                                </>
                              )
                            })()}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {pending > 0
                              ? <span className="font-semibold text-orange-600">{pending}</span>
                              : <span className="text-gray-300">---</span>
                            }
                          </td>
                          <td className="hidden lg:table-cell px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                            {formatDateOnly(product.created_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setViewProduct(product); setViewImgIdx(0) }}
                                className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"
                                title="Xem sản phẩm"
                              >
                                <Eye size={15} />
                              </button>
                              {!isEmployee && (
                                <>
                                  <button onClick={() => setBarcodeProduct(product)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Mã vạch">
                                    <Barcode size={15} />
                                  </button>
                                  <button onClick={() => setPrintProduct(product)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="In tem">
                                    <Printer size={15} />
                                  </button>
                                </>
                              )}
                              {canEdit && (
                                <button onClick={() => openEdit(product)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                  <Pencil size={15} />
                                </button>
                              )}
                              {canDelete && (
                                <button onClick={() => setDeleteId(product.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={isEmployee ? 11 : 14} className="text-center py-16 text-gray-400">
                          <Package size={40} className="mx-auto mb-2 opacity-40" />
                          <p>Không tìm thấy sản phẩm</p>
                        </td>
                      </tr>
                    )}
                  </tbody>

                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td colSpan={6} className="px-3 py-2.5 text-xs text-gray-500 font-medium">
                          Tổng {filtered.length} sản phẩm
                        </td>
                        {!isEmployee && (
                          <>
                            <td className="hidden md:table-cell px-3 py-2.5 text-right text-xs font-bold text-gray-700 whitespace-nowrap">
                              {revealedCost
                                ? formatCurrency(filtered.reduce((s, p) => s + p.cost_price * (p.quantity + (pendingQty[p.id] ?? 0)), 0))
                                : <span className="text-gray-400 tracking-widest">••••••</span>
                              }
                            </td>
                            <td className="hidden md:table-cell" />
                          </>
                        )}
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-green-600 whitespace-nowrap">
                          {formatCurrency(filtered.reduce((s, p) => s + p.sale_price * (p.quantity + (pendingQty[p.id] ?? 0)), 0))}
                        </td>
                        {!isEmployee && <td className="hidden md:table-cell" />}
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-gray-700">
                          {filtered.filter((p) => p.quantity > 0).reduce((s, p) => s + p.quantity, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-orange-600">
                          {filtered.reduce((s, p) => s + (pendingQty[p.id] ?? 0), 0) || '---'}
                        </td>
                        <td className="hidden lg:table-cell" />
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ MODALS ════════════════════════════════════════════════════════════ */}

      {/* ── View-only product modal ── */}
      <Modal isOpen={!!viewProduct} onClose={() => setViewProduct(null)} title="Thông Tin Sản Phẩm" size="md">
        {viewProduct && (() => {
          const imgs = viewProduct.images?.length ? viewProduct.images : viewProduct.image_url ? [viewProduct.image_url] : []
          return (
            <div className="space-y-4">
              {/* Image carousel */}
              {imgs.length > 0 ? (
                <div className="relative">
                  <img
                    src={imgs[viewImgIdx]}
                    alt={viewProduct.name}
                    className="w-full h-64 object-contain rounded-xl border border-gray-100 bg-gray-50"
                  />
                  {imgs.length > 1 && (
                    <>
                      <button
                        onClick={() => setViewImgIdx((i) => (i - 1 + imgs.length) % imgs.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-1.5 shadow text-gray-600"
                      >
                        <ChevronDown size={16} className="-rotate-90" />
                      </button>
                      <button
                        onClick={() => setViewImgIdx((i) => (i + 1) % imgs.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-1.5 shadow text-gray-600"
                      >
                        <ChevronDown size={16} className="rotate-90" />
                      </button>
                      <div className="flex justify-center gap-1.5 mt-2">
                        {imgs.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setViewImgIdx(i)}
                            className={`w-2 h-2 rounded-full transition-colors ${i === viewImgIdx ? 'bg-blue-500' : 'bg-gray-300'}`}
                          />
                        ))}
                      </div>
                      <p className="text-center text-xs text-gray-400 mt-1">{viewImgIdx + 1} / {imgs.length}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-40 rounded-xl border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-gray-300">
                  <ImageIcon size={40} />
                </div>
              )}

              {/* Product name */}
              <div>
                <p className="font-bold text-gray-900 text-lg leading-tight">{viewProduct.name}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">#{viewProduct.product_code}</p>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Giá Bán</p>
                  <p className="font-bold text-green-600 text-sm">{formatCurrency(viewProduct.sale_price)}</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Tồn Kho</p>
                  <p className="font-bold text-blue-600 text-sm">{viewProduct.quantity.toLocaleString('vi-VN')}</p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Đơn Vị</p>
                  <p className="font-bold text-gray-700 text-sm">{viewProduct.unit}</p>
                </div>
              </div>

              {/* Notes */}
              {viewProduct.description && (
                <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1">Ghi Chú</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{viewProduct.description}</p>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* Barcode viewer */}
      <Modal isOpen={!!barcodeProduct} onClose={() => setBarcodeProduct(null)} title="Mã Vạch Sản Phẩm" size="sm">
        {barcodeProduct && (
          <div className="text-center space-y-3">
            {(barcodeProduct.images?.[0] ?? barcodeProduct.image_url) && (
              <img src={barcodeProduct.images?.[0] ?? barcodeProduct.image_url!} alt="" className="w-20 h-20 object-cover rounded-xl mx-auto border border-gray-200" />
            )}
            <div>
              <p className="font-semibold text-gray-900">{barcodeProduct.name}</p>
              <span className="inline-flex items-center gap-1 text-sm bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-mono font-semibold mt-1">
                Mã hàng: {barcodeProduct.product_code}
              </span>
            </div>
            {/* Main barcode */}
            {isBarcodeValid(barcodeProduct.barcode) ? (
              <>
                <div className="flex justify-center bg-white border border-gray-100 rounded-xl p-3">
                  <BarcodePreview barcode={barcodeProduct.barcode} />
                </div>
                <p className="text-xs text-gray-400 font-mono">{barcodeProduct.barcode}</p>
              </>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                <p className="font-semibold mb-1">⚠ Mã vạch bị lỗi</p>
                <p className="font-mono text-xs mb-2">{barcodeProduct.barcode}</p>
                <p className="text-xs text-red-600">Mã vạch bị hỏng do import từ file Excel đã chuyển số thành dạng khoa học. Vui lòng chỉnh sửa sản phẩm và nhập lại mã vạch đúng.</p>
              </div>
            )}
            {/* NCC barcodes */}
            {(barcodeProduct.product_suppliers?.length ?? 0) > 0 && (
              <div className="text-left border-t pt-3">
                <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1"><Truck size={11} /> Mã vạch theo NCC:</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {barcodeProduct.product_suppliers!.map((ps) => (
                    <div key={ps.id} className="flex items-center gap-3 text-xs bg-gray-50 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-700 truncate">{ps.supplier?.name ?? 'NCC'}</p>
                        <p className="font-mono text-gray-500">{ps.barcode}</p>
                      </div>
                      <div className="text-right text-gray-400 flex-shrink-0">
                        <p>{ps.quantity} {barcodeProduct.unit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => { setBarcodeProduct(null); setPrintProduct(barcodeProduct) }}
              className="flex items-center gap-2 mx-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
            >
              <Printer size={16} /> In Tem Nhãn
            </button>
          </div>
        )}
      </Modal>

      {/* Print label */}
      <PrintLabelModal product={printProduct} onClose={() => setPrintProduct(null)} />

      {/* Barcode scanner */}
      {scannerOpen && (
        <BarcodeScannerModal
          onDetected={(code) => setSearch(code)}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Import */}
      <ImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} categories={categories} suppliers={suppliers} />


      {/* Add / Edit product */}
      <ProductEditModal
        isOpen={isModalOpen}
        editingProduct={editingProduct}
        categories={categories}
        suppliers={suppliers}
        existingCodes={existingCodes}
        existingSupplierEntries={existingSupplierEntries}
        onSave={(form) => saveMutation.mutate(form)}
        onClose={closeModal}
        isPending={saveMutation.isPending}
      />

      <span style={{ display: 'none' }}><FileText size={1} /></span>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Xóa Sản Phẩm"
        message="Bạn có chắc muốn xóa sản phẩm này không?"
        confirmLabel="Xóa"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

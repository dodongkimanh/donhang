import { useState, useEffect, useRef, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowDownCircle, ArrowUpCircle, Truck, List, Printer, SlidersHorizontal, X, TrendingUp, TrendingDown, Minus, Trash2, Calendar, ChevronDown, ScanLine, UserCheck, RotateCcw, Pencil, Ban } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { BulkImportPage } from '@/components/ui/BulkImportModal'
import { PrintLabelModal, PrintBatchLabelModal, type BatchPrintItem } from '@/components/ui/PrintLabel'
import { StockAdjustmentPage } from '@/components/ui/StockAdjustmentPage'
import { StockCheckPage, type CheckResult } from '@/components/ui/StockCheckPage'
import { formatCurrency, formatDate, generateBarcode, fmtThousands } from '@/utils/format'
import type { InventoryTransaction, Product, Supplier, ProductSupplier } from '@/types'
import toast from 'react-hot-toast'

interface TransactionForm {
  product_id: string
  supplier_id: string
  type: 'import' | 'export'
  quantity: string
  unit_price: string
  note: string
}

const defaultForm: TransactionForm = {
  product_id: '',
  supplier_id: '',
  type: 'import',
  quantity: '',
  unit_price: '',
  note: '',
}

interface ExportItem {
  key: string
  product_id: string
  product_name: string
  supplier_id: string
  supplier_name: string
  available_qty: number
  cost_price: number
  quantity: string
  unit_price: string
}

interface ExportRecipient {
  type: 'customer' | 'supplier_return'
  name: string
  phone: string
  address: string
  supplier_id: string
}

const defaultRecipient: ExportRecipient = {
  type: 'customer', name: '', phone: '', address: '', supplier_id: '',
}

export function InventoryPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkOpen, setIsBulkOpen] = useState(false)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<TransactionForm>(defaultForm)
  const [filterType, setFilterType] = useState<'all' | 'import' | 'export' | 'adjustment'>('all')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  function setThisMonth() {
    const d = new Date()
    setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
    setDateTo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  function setLastMonth() {
    const d = new Date()
    d.setDate(0) // last day of previous month
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    d.setDate(1) // first day of that month
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    setDateFrom(start)
    setDateTo(end)
  }
  const [printProductId, setPrintProductId] = useState<string | null>(null)
  const [printBatchKey, setPrintBatchKey] = useState<string | null>(null)
  const [isAdjustOpen, setIsAdjustOpen] = useState(false)
  const [isCheckOpen, setIsCheckOpen]   = useState(false)
  const [checkResult, setCheckResult]   = useState<CheckResult | null>(null)
  const [adjBatchKey, setAdjBatchKey] = useState<string | null>(null)
  const [detailTx, setDetailTx] = useState<InventoryTransaction | null>(null)
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [editBatchKey, setEditBatchKey] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')
  const [editItems, setEditItems] = useState<Array<{ id: string; quantity: string; unit_price: string; product_name: string; supplier_name: string }>>([])
  const [cancelConfirmKey, setCancelConfirmKey] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null)
  const [adjCancelReason, setAdjCancelReason] = useState('')
  const [adjCancelConfirm, setAdjCancelConfirm] = useState(false)
  const printAfterSaveRef = useRef(false)

  // Export multi-product state
  const [exportItems, setExportItems] = useState<ExportItem[]>([])
  const [exportRecipient, setExportRecipient] = useState<ExportRecipient>(defaultRecipient)
  const [barcodeInput, setBarcodeInput] = useState('')
  const barcodeRef = useRef<HTMLInputElement>(null)

  // All products (full — with product_suppliers for stock adjustment)
  const { data: products = [] } = useQuery({
    queryKey: ['products-simple'],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, product_code, cost_price, sale_price, unit, quantity, product_suppliers(*, supplier:suppliers(*))')
        .order('name')
      return (data ?? []) as Product[]
    },
  })

  // All suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('*').order('name')
      return (data ?? []) as Supplier[]
    },
  })

  // product_suppliers for selected product (loads when product is chosen)
  const { data: productSuppliers = [] } = useQuery({
    queryKey: ['product-suppliers-inv', form.product_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('product_suppliers')
        .select('*, supplier:suppliers(*)')
        .eq('product_id', form.product_id)
      return (data ?? []) as ProductSupplier[]
    },
    enabled: !!form.product_id && isModalOpen,
  })

  // When NCC selected: auto-fill unit_price from existing product_supplier
  useEffect(() => {
    if (!form.supplier_id || !form.product_id) return
    const existing = productSuppliers.find((ps) => ps.supplier_id === form.supplier_id)
    if (existing && form.type === 'import') {
      setForm((f) => ({ ...f, unit_price: existing.cost_price.toString() }))
    }
  }, [form.supplier_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // When product changes: reset supplier + price
  useEffect(() => {
    if (form.product_id) {
      setForm((f) => ({ ...f, supplier_id: '', unit_price: '' }))
    }
  }, [form.product_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // When type changes: reset supplier + price
  useEffect(() => {
    setForm((f) => ({ ...f, supplier_id: '', unit_price: '' }))
  }, [form.type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Transactions history
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['inventory-transactions', dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*, product:products(name, unit), profile:profiles(full_name), supplier:suppliers(name)')
        .gte('created_at', dateFrom + 'T00:00:00+07:00')
        .lte('created_at', dateTo + 'T23:59:59+07:00')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as InventoryTransaction[]
    },
  })

  // Fetch full product (with product_suppliers) when user wants to print
  const { data: printProduct = null } = useQuery({
    queryKey: ['product-for-print', printProductId],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('*, product_suppliers(*, supplier:suppliers(*))')
        .eq('id', printProductId!)
        .single()
      return data as Product | null
    },
    enabled: !!printProductId,
  })

  // ── Voucher grouping ──
  function toggleBatch(key: string) {
    setExpandedBatches((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function getTxGroupKey(tx: InventoryTransaction): string {
    if (tx.batch_id) return tx.batch_id
    // Fallback for pre-migration data: group by type+creator within same second
    const sec = Math.floor(new Date(tx.created_at).getTime() / 1000)
    return `${tx.type}-${tx.created_by}-${sec}`
  }

  // ── Helpers for adjustment batch parsing ──
  function batchKeyOf(t: InventoryTransaction): string {
    const note = t.note ?? ''
    const idx = note.indexOf(' | Trước:')
    return idx >= 0 ? note.substring(0, idx) : note
  }

  function parseTruoc(note: string | null | undefined): number | null {
    if (!note) return null
    const m = note.match(/Trước: (\d+) →/)
    return m ? parseInt(m[1]) : null
  }

  function parseSau(note: string | null | undefined): number | null {
    if (!note) return null
    const m = note.match(/→ Sau: (\d+)/)
    return m ? parseInt(m[1]) : null
  }

  // Rows in the selected adjustment voucher
  const adjVoucherRows = adjBatchKey
    ? transactions.filter((t) => t.type === 'adjustment' && batchKeyOf(t) === adjBatchKey)
    : []
  const adjCancelled = adjVoucherRows.some((t) => t.note?.includes('[ĐÃ HỦY]'))

  // Delete adjustment voucher: revert product_suppliers then remove transactions
  const deleteAdjMutation = useMutation({
    mutationFn: async (batchKey: string) => {
      const rows = transactions.filter((t) => t.type === 'adjustment' && batchKeyOf(t) === batchKey)
      for (const row of rows) {
        const alreadyCancelled = row.note?.includes('[ĐÃ HỦY]') ?? false
        const truoc = parseTruoc(row.note)
        if (!alreadyCancelled && truoc !== null && row.supplier_id && row.product_id) {
          // Restore product_suppliers.quantity to the "Trước" value (only if not already cancelled)
          const { data: psList } = await supabase
            .from('product_suppliers')
            .select('id')
            .eq('product_id', row.product_id)
            .eq('supplier_id', row.supplier_id)
          if (psList && psList.length > 0) {
            await supabase
              .from('product_suppliers')
              .update({ quantity: truoc })
              .eq('id', (psList[0] as { id: string }).id)
          }
        }
        await supabase.from('inventory_transactions').delete().eq('id', row.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success('Đã xóa phiếu cân bằng')
      setAdjBatchKey(null)
    },
    onError: () => toast.error('Có lỗi khi xóa phiếu'),
  })

  // Cancel adjustment voucher: revert stock + mark as cancelled in note
  const cancelAdjMutation = useMutation({
    mutationFn: async ({ batchKey, reason }: { batchKey: string; reason: string }) => {
      const rows = transactions.filter((t) => t.type === 'adjustment' && batchKeyOf(t) === batchKey)
      if (rows.some((r) => r.note?.includes('[ĐÃ HỦY]'))) throw new Error('Phiếu này đã được hủy')
      const cancelNote = reason.trim() ? ` | Lý do hủy: ${reason.trim()} | [ĐÃ HỦY]` : ' | [ĐÃ HỦY]'
      for (const row of rows) {
        const truoc = parseTruoc(row.note)
        if (truoc !== null && row.supplier_id && row.product_id) {
          const { data: psList } = await supabase
            .from('product_suppliers')
            .select('id')
            .eq('product_id', row.product_id)
            .eq('supplier_id', row.supplier_id)
          if (psList && psList.length > 0) {
            await supabase
              .from('product_suppliers')
              .update({ quantity: truoc })
              .eq('id', (psList[0] as { id: string }).id)
          }
        }
        await supabase.from('inventory_transactions')
          .update({ note: (row.note ?? '') + cancelNote })
          .eq('id', row.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success('Đã hủy phiếu cân bằng và hoàn nguyên tồn kho')
      setAdjBatchKey(null)
      setAdjCancelReason('')
      setAdjCancelConfirm(false)
    },
    onError: (e: Error) => toast.error(e.message || 'Có lỗi khi hủy phiếu'),
  })

  const saveMutation = useMutation({
    mutationFn: async (values: TransactionForm) => {
      if (!profile) throw new Error('Not authenticated')
      const qty = parseInt(values.quantity)
      const price = parseFloat(values.unit_price) || 0

      if (values.supplier_id) {
        // Find existing product_supplier for this product+NCC
        const existing = productSuppliers.find((ps) => ps.supplier_id === values.supplier_id)

        if (values.type === 'import') {
          if (existing) {
            // Update: add quantity, update cost_price
            const { error } = await supabase
              .from('product_suppliers')
              .update({ quantity: existing.quantity + qty, cost_price: price })
              .eq('id', existing.id)
            if (error) throw error
          } else {
            // Create new NCC link for this product
            const { error } = await supabase.from('product_suppliers').insert({
              product_id: values.product_id,
              supplier_id: values.supplier_id,
              barcode: generateBarcode(),
              cost_price: price,
              quantity: qty,
              note: values.note,
            })
            if (error) throw error
          }
        } else {
          // Export: deduct from NCC stock — không cho xuất vượt tồn
          if (existing) {
            if (qty > existing.quantity) throw new Error(`Xuất vượt tồn kho: chỉ còn ${existing.quantity} đơn vị`)
            const { error } = await supabase
              .from('product_suppliers')
              .update({ quantity: existing.quantity - qty })
              .eq('id', existing.id)
            if (error) throw error
          }
        }
      }

      // Insert history log
      const txBatchId = crypto.randomUUID()
      const { error } = await supabase.from('inventory_transactions').insert({
        product_id: values.product_id,
        supplier_id: values.supplier_id || null,
        type: values.type,
        quantity: qty,
        unit_price: price,
        note: values.note,
        created_by: profile.id,
        batch_id: txBatchId,
      })
      if (error) throw error

      // Create FIFO batch entry for import transactions
      if (values.type === 'import') {
        await supabase.from('product_batches').insert({
          product_id: values.product_id,
          supplier_id: values.supplier_id || null,
          import_price: price,
          quantity: qty,
          remaining_qty: qty,
          import_date: new Date().toISOString().split('T')[0],
        })
      }
    },
    onSuccess: (_, values) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      queryClient.invalidateQueries({ queryKey: ['product-suppliers-inv', values.product_id] })
      toast.success(values.type === 'import' ? 'Nhập kho thành công' : 'Xuất kho thành công')
      const shouldPrint = printAfterSaveRef.current
      printAfterSaveRef.current = false
      setIsModalOpen(false)
      setForm(defaultForm)
      if (shouldPrint && values.product_id) {
        setPrintProductId(values.product_id)
      }
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  // ── Barcode / code lookup for export ────────────────────────────────────────
  function handleBarcodeSearch(input: string) {
    const query = input.trim()
    if (!query) return

    let found: { product: Product; ps: ProductSupplier } | null = null

    for (const p of products) {
      if (found) break
      const pSups = (p.product_suppliers ?? []) as ProductSupplier[]

      // Tìm theo barcode trong product_suppliers
      for (const ps of pSups) {
        if (ps.barcode === query) {
          found = { product: p, ps }
          break
        }
      }
      if (found) break

      // Tìm theo product_code — ưu tiên NCC có hàng nhiều nhất
      if (p.product_code === query) {
        const withStock = pSups.filter((ps) => ps.quantity > 0)
        const ps = withStock.sort((a, b) => b.quantity - a.quantity)[0] ?? pSups[0]
        if (ps) {
          found = { product: p, ps }
        } else {
          // Không có NCC nào — chỉ cho phép tiếp tục nếu xuất cho khách hàng
          if (exportRecipient.type === 'supplier_return') {
            toast.error(`${p.name}: Chưa có nhà cung cấp nào trong kho`)
            setBarcodeInput('')
            barcodeRef.current?.focus()
            return
          }
          // Xuất cho khách: thêm trực tiếp không cần NCC
          const existingIdx = exportItems.findIndex((i) => i.product_id === p.id && !i.supplier_id)
          if (existingIdx >= 0) {
            setExportItems((prev) => prev.map((item, idx) =>
              idx === existingIdx ? { ...item, quantity: String(parseInt(item.quantity || '0') + 1) } : item
            ))
            toast.success(`+1 ${p.name}`)
          } else {
            setExportItems((prev) => [...prev, {
              key: crypto.randomUUID(),
              product_id: p.id,
              product_name: p.name,
              supplier_id: '',
              supplier_name: '',
              available_qty: p.quantity ?? 9999,
              cost_price: p.cost_price ?? 0,
              quantity: '1',
              unit_price: '',
            }])
            toast.success(`Đã thêm: ${p.name}`)
          }
          setBarcodeInput('')
          barcodeRef.current?.focus()
          return
        }
      }
    }

    if (!found) {
      toast.error(`Không tìm thấy sản phẩm: "${query}"`)
      setBarcodeInput('')
      barcodeRef.current?.focus()
      return
    }

    if (found.ps.quantity <= 0 && exportRecipient.type === 'supplier_return') {
      toast.error(`${found.product.name}: Hết hàng trong kho`)
      setBarcodeInput('')
      barcodeRef.current?.focus()
      return
    }

    const existingIdx = exportItems.findIndex(
      (i) => i.product_id === found!.product.id && i.supplier_id === found!.ps.supplier_id
    )

    if (existingIdx >= 0) {
      setExportItems((prev) => prev.map((item, idx) =>
        idx === existingIdx
          ? { ...item, quantity: String(Math.min(parseInt(item.quantity || '0') + 1, found!.ps.quantity)) }
          : item
      ))
      toast.success(`+1 ${found.product.name}`)
    } else {
      const sup = (found.ps as ProductSupplier & { supplier?: Supplier }).supplier
      setExportItems((prev) => [...prev, {
        key: crypto.randomUUID(),
        product_id: found!.product.id,
        product_name: found!.product.name,
        supplier_id: found!.ps.supplier_id,
        supplier_name: sup?.name ?? '—',
        available_qty: found!.ps.quantity,
        cost_price: found!.ps.cost_price ?? 0,
        quantity: '1',
        unit_price: '',
      }])
      toast.success(`Đã thêm: ${found.product.name}`)
    }

    setBarcodeInput('')
    barcodeRef.current?.focus()
  }

  // ── Export multi-product mutation ─────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Chưa đăng nhập')
      if (exportItems.length === 0) throw new Error('Chưa có sản phẩm')

      const batchId = crypto.randomUUID()
      const recipientText = exportRecipient.type === 'customer'
        ? [
            exportRecipient.name && `Người nhận: ${exportRecipient.name}`,
            exportRecipient.phone && `SĐT: ${exportRecipient.phone}`,
            exportRecipient.address && `ĐC: ${exportRecipient.address}`,
          ].filter(Boolean).join(' | ')
        : `Xuất trả NCC: ${suppliers.find((s) => s.id === exportRecipient.supplier_id)?.name ?? ''}`
      const noteStr = [recipientText, form.note].filter(Boolean).join(' | ')

      for (const item of exportItems) {
        const qty = parseInt(item.quantity) || 0
        if (qty <= 0) continue

        // Chỉ deduct kho NCC khi có supplier_id
        if (item.supplier_id) {
          const { data: ps } = await supabase
            .from('product_suppliers')
            .select('id, quantity')
            .eq('product_id', item.product_id)
            .eq('supplier_id', item.supplier_id)
            .single()
          const psData = ps as { id: string; quantity: number } | null
          if (!psData) throw new Error(`Không tìm thấy tồn kho: ${item.product_name}`)
          if (qty > psData.quantity) throw new Error(`${item.product_name}: Chỉ còn ${psData.quantity} trong kho`)

          const { error: stockErr } = await supabase
            .from('product_suppliers')
            .update({ quantity: psData.quantity - qty })
            .eq('id', psData.id)
          if (stockErr) throw stockErr
        }

        const { error: txErr } = await supabase.from('inventory_transactions').insert({
          product_id: item.product_id,
          supplier_id: item.supplier_id || null,
          type: 'export',
          quantity: qty,
          unit_price: parseFloat(item.unit_price) || 0,
          note: noteStr || null,
          created_by: profile.id,
          batch_id: batchId,
        })
        if (txErr) throw txErr
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success(`Xuất kho ${exportItems.length} sản phẩm thành công`)
      setIsModalOpen(false)
      setExportItems([])
      setExportRecipient(defaultRecipient)
      setBarcodeInput('')
      setForm(defaultForm)
    },
    onError: (e: Error) => toast.error(e.message || 'Có lỗi khi xuất kho'),
  })

  // ── Cancel import/export batch: reverse stock + mark note ────────────────────
  const cancelBatchMutation = useMutation({
    mutationFn: async ({ batchKey, reason }: { batchKey: string; reason: string }) => {
      const batchTxs = transactions.filter(
        (t) => t.type !== 'adjustment' && getTxGroupKey(t) === batchKey,
      )
      if (batchTxs.length === 0) throw new Error('Không tìm thấy phiếu')
      if (batchTxs.some((t) => t.note?.includes('[ĐÃ HỦY]'))) throw new Error('Phiếu này đã được hủy')
      const cancelNote = reason.trim() ? ` | Lý do hủy: ${reason.trim()} | [ĐÃ HỦY]` : ' | [ĐÃ HỦY]'
      for (const tx of batchTxs) {
        if (tx.supplier_id) {
          const { data: psList } = await supabase
            .from('product_suppliers')
            .select('id, quantity')
            .eq('product_id', tx.product_id)
            .eq('supplier_id', tx.supplier_id)
          if (psList && psList.length > 0) {
            const ps = psList[0] as { id: string; quantity: number }
            const newQty =
              tx.type === 'import'
                ? Math.max(0, ps.quantity - tx.quantity)
                : ps.quantity + tx.quantity
            await supabase.from('product_suppliers').update({ quantity: newQty }).eq('id', ps.id)
          }
        }
        await supabase.from('inventory_transactions')
          .update({ note: (tx.note ?? '') + cancelNote })
          .eq('id', tx.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success('Đã hủy phiếu và hoàn nguyên tồn kho')
      setCancelConfirmKey(null)
      setCancelReason('')
    },
    onError: (e: Error) => toast.error(e.message || 'Có lỗi khi hủy phiếu'),
  })

  // ── Delete import/export batch (admin): reverse stock if not cancelled + hard delete ──
  const deleteBatchMutation = useMutation({
    mutationFn: async (batchKey: string) => {
      const batchTxs = transactions.filter(
        (t) => t.type !== 'adjustment' && getTxGroupKey(t) === batchKey,
      )
      if (batchTxs.length === 0) throw new Error('Không tìm thấy phiếu')
      const alreadyCancelled = batchTxs.some((t) => t.note?.includes('[ĐÃ HỦY]'))
      if (!alreadyCancelled) {
        for (const tx of batchTxs) {
          if (tx.supplier_id) {
            const { data: psList } = await supabase
              .from('product_suppliers')
              .select('id, quantity')
              .eq('product_id', tx.product_id)
              .eq('supplier_id', tx.supplier_id)
            if (psList && psList.length > 0) {
              const ps = psList[0] as { id: string; quantity: number }
              const newQty =
                tx.type === 'import'
                  ? Math.max(0, ps.quantity - tx.quantity)
                  : ps.quantity + tx.quantity
              await supabase.from('product_suppliers').update({ quantity: newQty }).eq('id', ps.id)
            }
          }
        }
      }
      const firstBatchId = batchTxs[0].batch_id
      if (firstBatchId) {
        await supabase.from('inventory_transactions').delete().eq('batch_id', firstBatchId)
      } else {
        for (const tx of batchTxs) {
          await supabase.from('inventory_transactions').delete().eq('id', tx.id)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success('Đã xóa phiếu')
      setDeleteConfirmKey(null)
    },
    onError: (e: Error) => toast.error(e.message || 'Có lỗi khi xóa phiếu'),
  })

  // ── Edit import/export batch ──────────────────────────────────────────────────
  const editBatchMutation = useMutation({
    mutationFn: async ({
      batchKey,
      note,
      items,
    }: {
      batchKey: string
      note: string
      items: typeof editItems
    }) => {
      const batchTxs = transactions.filter(
        (t) => t.type !== 'adjustment' && getTxGroupKey(t) === batchKey,
      )
      const isMulti = batchTxs.length > 1
      for (const ei of items) {
        const tx = batchTxs.find((t) => t.id === ei.id)
        if (!tx) continue
        const newQty = !isMulti ? (parseInt(ei.quantity) || tx.quantity) : tx.quantity
        const newPrice = parseFloat(ei.unit_price) || tx.unit_price
        const delta = newQty - tx.quantity
        if (!isMulti && delta !== 0 && tx.supplier_id) {
          const { data: psList } = await supabase
            .from('product_suppliers')
            .select('id, quantity')
            .eq('product_id', tx.product_id)
            .eq('supplier_id', tx.supplier_id)
          if (psList && psList.length > 0) {
            const ps = psList[0] as { id: string; quantity: number }
            const adjQty =
              tx.type === 'import'
                ? Math.max(0, ps.quantity + delta)
                : Math.max(0, ps.quantity - delta)
            await supabase.from('product_suppliers').update({ quantity: adjQty }).eq('id', ps.id)
          }
        }
        if (tx.type === 'import' && tx.supplier_id && newPrice !== tx.unit_price) {
          await supabase
            .from('product_suppliers')
            .update({ cost_price: newPrice })
            .eq('product_id', tx.product_id)
            .eq('supplier_id', tx.supplier_id)
        }
        await supabase.from('inventory_transactions')
          .update({ quantity: newQty, unit_price: newPrice, note: note || null })
          .eq('id', tx.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products-simple'] })
      toast.success('Đã cập nhật phiếu thành công')
      setEditBatchKey(null)
    },
    onError: (e: Error) => toast.error(e.message || 'Có lỗi khi sửa phiếu'),
  })

  const [filterSupplier, setFilterSupplier] = useState<string>('all')

  const txBySupplier = filterSupplier === 'all'
    ? transactions
    : transactions.filter((t) => t.supplier_id === filterSupplier)

  const filtered = txBySupplier.filter((t) => filterType === 'all' || t.type === filterType)

  const importRows = txBySupplier.filter((t) => t.type === 'import')
  const exportRows = txBySupplier.filter((t) => t.type === 'export')
  const importTotal = importRows.reduce((sum, t) => sum + t.quantity * t.unit_price, 0)
  const exportTotal = exportRows.reduce((sum, t) => sum + t.quantity * t.unit_price, 0)

  // Suppliers shown in dropdown based on type
  const selectedProductNccs = productSuppliers
  const suppliersForImport = suppliers // all suppliers (can add new NCC for product)

  // Existing stock info for selected NCC
  const selectedNccInfo = selectedProductNccs.find((ps) => ps.supplier_id === form.supplier_id)
  const isNewNcc = !!form.supplier_id && !selectedNccInfo

  // ── Full-page bulk import view ──
  if (isBulkOpen && profile) {
    return (
      <BulkImportPage
        onBack={() => setIsBulkOpen(false)}
        products={products}
        suppliers={suppliers}
        profileId={profile.id}
      />
    )
  }

  // ── Phiếu Kiểm Kho (quét mã vạch) ──
  if (isCheckOpen) {
    return (
      <StockCheckPage
        onBack={() => setIsCheckOpen(false)}
        products={products}
        onComplete={(result) => {
          setCheckResult(result)
          setIsCheckOpen(false)
          setIsAdjustOpen(true)
        }}
      />
    )
  }

  // ── Phiếu Cân Bằng Kho (admin duyệt lệch từ kiểm kho) ──
  if (isAdjustOpen && profile) {
    return (
      <StockAdjustmentPage
        onBack={() => { setIsAdjustOpen(false); setCheckResult(null) }}
        products={products}
        suppliers={suppliers}
        profileId={profile.id}
        checkResult={checkResult ?? undefined}
      />
    )
  }

  function openEditBatch(batchKey: string) {
    const batchTxs = transactions.filter(
      (t) => t.type !== 'adjustment' && getTxGroupKey(t) === batchKey,
    )
    if (batchTxs.length === 0) return
    const sharedNote = (batchTxs[0].note ?? '').replace(/\s*\|\s*\[ĐÃ HỦY\]$/, '')
    setEditNote(sharedNote)
    setEditItems(
      batchTxs.map((tx) => ({
        id: tx.id,
        quantity: tx.quantity.toString(),
        unit_price: tx.unit_price.toString(),
        product_name: tx.product?.name ?? '—',
        supplier_name: tx.supplier?.name ?? '—',
      })),
    )
    setEditBatchKey(batchKey)
  }

  function closeTransactionModal() {
    setIsModalOpen(false)
    setForm(defaultForm)
    setExportItems([])
    setExportRecipient(defaultRecipient)
    setBarcodeInput('')
    setConfirmCloseOpen(false)
  }

  function requestCloseTransaction() {
    const dirty = !!form.product_id || !!form.quantity || !!form.unit_price || !!form.note || exportItems.length > 0
    if (dirty) setConfirmCloseOpen(true)
    else closeTransactionModal()
  }

  // Build grouped display items: adjustments stay per-row; import/export group by batch
  const displayItems = (() => {
    const seen = new Set<string>()
    const map = new Map<string, InventoryTransaction[]>()
    const order: string[] = []
    for (const tx of filtered) {
      if (tx.type === 'adjustment') {
        const adjKey = `adj-${tx.id}`
        map.set(adjKey, [tx])
        order.push(adjKey)
      } else {
        const key = getTxGroupKey(tx)
        if (!seen.has(key)) {
          seen.add(key)
          order.push(key)
          map.set(key, [])
        }
        map.get(key)!.push(tx)
      }
    }
    return order.map((key) => {
      const txs = map.get(key)!
      const first = txs[0]
      return {
        key,
        isAdj: first.type === 'adjustment',
        txs,
        first,
        totalQty: txs.reduce((s, t) => s + t.quantity, 0),
        totalValue: txs.reduce((s, t) => s + t.quantity * t.unit_price, 0),
        cancelled: txs.some((t) => t.note?.includes('[ĐÃ HỦY]')),
      }
    })
  })()

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nhập / Xuất Kho</h1>
          <p className="text-gray-500 mt-1">Lịch sử giao dịch kho theo nhà cung cấp</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Kiểm Kho: kế toán + kho + admin */}
          <button
            onClick={() => setIsCheckOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <List size={16} />
            <span className="hidden sm:inline">Kiểm Kho</span>
            <span className="sm:hidden">Kiểm Kho</span>
          </button>
          {/* Cân Bằng Kho: chỉ admin */}
          {profile?.role === 'admin' && (
            <button
              onClick={() => setIsAdjustOpen(true)}
              className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <SlidersHorizontal size={16} />
              <span className="hidden sm:inline">Cân Bằng Kho</span>
              <span className="sm:hidden">Cân Bằng</span>
            </button>
          )}
          <button
            onClick={() => setIsBulkOpen(true)}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <List size={16} />
            <span className="hidden sm:inline">Nhập Hàng Loạt</span>
            <span className="sm:hidden">Hàng Loạt</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Ghi Nhận
          </button>
        </div>
      </div>

      {/* Date + supplier filter */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button
          onClick={setThisMonth}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
        >
          Tháng này
        </button>
        <button
          onClick={setLastMonth}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Tháng trước
        </button>
        <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-lg px-2 py-1.5 flex-wrap">
          <Calendar size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm outline-none text-gray-700 bg-transparent"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm outline-none text-gray-700 bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-lg px-2 py-1.5">
          <Truck size={14} className="text-gray-400 flex-shrink-0" />
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="text-sm outline-none text-gray-700 bg-transparent pr-1"
          >
            <option value="all">Tất cả NCC</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Tổng Nhập Kho</p>
            {filterSupplier !== 'all' && (
              <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                <Truck size={10} /> {suppliers.find((s) => s.id === filterSupplier)?.name}
              </p>
            )}
            <p className="text-xl font-bold text-green-700 mt-0.5">{formatCurrency(importTotal)}</p>
            <p className="text-xs text-green-500 mt-0.5">{new Set(importRows.map(getTxGroupKey)).size} phiếu nhập</p>
          </div>
          <ArrowDownCircle size={36} className="text-green-200 flex-shrink-0" />
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Tổng Xuất Kho (Giá Vốn)</p>
            {filterSupplier !== 'all' && (
              <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                <Truck size={10} /> {suppliers.find((s) => s.id === filterSupplier)?.name}
              </p>
            )}
            <p className="text-xl font-bold text-red-700 mt-0.5">{formatCurrency(exportTotal)}</p>
            <p className="text-xs text-red-500 mt-0.5">{new Set(exportRows.map(getTxGroupKey)).size} phiếu xuất</p>
          </div>
          <ArrowUpCircle size={36} className="text-red-200 flex-shrink-0" />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'import', 'export', 'adjustment'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterType === t
                ? t === 'adjustment' ? 'bg-orange-500 text-white' : 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t === 'all' ? 'Tất Cả' : t === 'import' ? 'Nhập Kho' : t === 'export' ? 'Xuất Kho' : 'Cân Bằng'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1100 }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th style={{ width: 90 }} className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Loại</th>
                  <th style={{ width: 180 }} className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Sản Phẩm</th>
                  <th style={{ width: 130 }} className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Nhà Cung Cấp</th>
                  <th style={{ width: 70 }} className="text-right font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Số Lượng</th>
                  <th style={{ width: 100 }} className="text-right font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Đơn Giá</th>
                  <th className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Ghi Chú</th>
                  <th style={{ width: 120 }} className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Người GN</th>
                  <th style={{ width: 120 }} className="text-left font-semibold text-gray-500 uppercase text-xs tracking-wide px-4 py-3">Thời Gian</th>
                  <th style={{ width: 56 }} className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayItems.map((item) => {
                  // ── Adjustment: single row, click opens batch modal ──
                  if (item.isAdj) {
                    const t = item.first
                    return (
                      <tr key={item.key} className={`hover:bg-gray-50 cursor-pointer ${item.cancelled ? 'opacity-60' : ''}`} onClick={() => setAdjBatchKey(batchKeyOf(t))}>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 text-orange-500 text-sm font-medium">
                            <SlidersHorizontal size={15} /> Cân bằng
                          </span>
                          {item.cancelled && (
                            <span className="flex items-center gap-0.5 text-[11px] text-red-500 font-medium mt-0.5">
                              <Ban size={10} /> Đã hủy
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {t.product?.name ?? '-'}
                          {t.product?.unit && <span className="text-xs text-gray-400 ml-1">({t.product.unit})</span>}
                        </td>
                        <td className="px-4 py-3">
                          {t.supplier ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              <Truck size={10} /> {t.supplier.name}
                            </span>
                          ) : <span className="text-gray-400 text-xs">–</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700 font-medium">{t.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(t.unit_price)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-normal break-words">{t.note ?? '–'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{t.profile?.full_name ?? '–'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatDate(t.created_at)}</td>
                        <td className="px-4 py-3">
                          <button onClick={(e) => { e.stopPropagation(); setPrintProductId(t.product_id) }} title="In tem" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <Printer size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  }

                  // ── Import / Export voucher group ──
                  const { key, txs, first, totalQty, totalValue, cancelled } = item
                  const isExpanded = expandedBatches.has(key)
                  const isMulti = txs.length > 1
                  const supplierIds = [...new Set(txs.map((t) => t.supplier_id).filter(Boolean))]
                  const singleSupplier = supplierIds.length === 1
                    ? txs.find((t) => t.supplier_id === supplierIds[0])?.supplier
                    : null

                  return (
                    <Fragment key={key}>
                      {/* Voucher summary row */}
                      <tr
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/30' : ''} ${cancelled ? 'opacity-60' : ''}`}
                        onClick={() => toggleBatch(key)}
                      >
                        <td className="px-4 py-3">
                          {first.type === 'import' ? (
                            <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                              <ArrowDownCircle size={15} /> Nhập
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-red-600 text-sm font-medium">
                              <ArrowUpCircle size={15} /> Xuất
                            </span>
                          )}
                          {cancelled && (
                            <span className="flex items-center gap-0.5 text-[11px] text-red-500 font-medium mt-0.5">
                              <Ban size={10} /> Đã hủy
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {isMulti ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                              <List size={13} className="text-gray-400" />
                              {txs.length} sản phẩm
                            </span>
                          ) : (
                            <>
                              {first.product?.name ?? '-'}
                              {first.product?.unit && <span className="text-xs text-gray-400 ml-1">({first.product.unit})</span>}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {supplierIds.length === 0 ? (
                            <span className="text-gray-400 text-xs">–</span>
                          ) : singleSupplier ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              <Truck size={10} /> {singleSupplier.name}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                              <Truck size={10} /> {supplierIds.length} NCC
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700 font-medium">{totalQty}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {isMulti ? (
                            <div className="leading-tight">
                              <div className="text-[10px] text-gray-400 uppercase tracking-wide">tổng tiền</div>
                              <div className="font-medium">{formatCurrency(totalValue)}</div>
                            </div>
                          ) : formatCurrency(first.unit_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-normal break-words">{first.note ?? '–'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{first.profile?.full_name ?? '–'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatDate(first.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleBatch(key) }}
                              title={isExpanded ? 'Thu gọn' : 'Xem chi tiết'}
                              className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                            >
                              <ChevronDown size={15} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            {!isMulti ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setPrintProductId(first.product_id) }}
                                title="In tem sản phẩm"
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Printer size={15} />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setPrintBatchKey(key) }}
                                title="In tem tất cả sản phẩm"
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Printer size={15} />
                              </button>
                            )}
                            {!cancelled && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); openEditBatch(key) }}
                                  title="Sửa phiếu"
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCancelConfirmKey(key) }}
                                  title="Hủy phiếu"
                                  className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                                >
                                  <Ban size={14} />
                                </button>
                              </>
                            )}
                            {profile?.role === 'admin' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmKey(key) }}
                                title="Xóa phiếu (admin)"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded sub-rows */}
                      {isExpanded && txs.map((t) => (
                        <tr key={`sub-${t.id}`} className="bg-indigo-50/40 border-l-2 border-l-indigo-200">
                          <td className="pl-8 pr-2 py-2.5">
                            <div className="w-2 h-2 rounded-full bg-indigo-300 ml-1" />
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-800 font-medium">
                            {t.product?.name ?? '-'}
                            {t.product?.unit && <span className="text-xs text-gray-400 ml-1">({t.product.unit})</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {t.supplier ? (
                              <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                                <Truck size={10} /> {t.supplier.name}
                              </span>
                            ) : <span className="text-gray-400 text-xs">–</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 text-sm">{t.quantity}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 text-sm">{formatCurrency(t.unit_price)}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-400 whitespace-normal break-words">{t.note ?? '–'}</td>
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => setPrintProductId(t.product_id)}
                              title="In tem sản phẩm"
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Printer size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
                {displayItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      Chưa có giao dịch nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Edit Voucher Modal ── */}
      {editBatchKey !== null && (() => {
        const batchTxs = transactions.filter(
          (t) => t.type !== 'adjustment' && getTxGroupKey(t) === editBatchKey,
        )
        const isMulti = batchTxs.length > 1
        const editFirst = batchTxs[0]
        if (!editFirst) return null
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setEditBatchKey(null)} />
            <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Pencil size={17} className="text-blue-500" />
                  Sửa Phiếu {editFirst.type === 'import' ? 'Nhập' : 'Xuất'} Kho
                </h2>
                <button onClick={() => setEditBatchKey(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                {/* Single-product: full edit */}
                {!isMulti && editItems[0] && (
                  <>
                    <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Sản phẩm</p>
                        <p className="font-medium text-gray-900">{editFirst.product?.name ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Nhà cung cấp</p>
                        <p className="text-gray-700">{editFirst.supplier?.name ?? '—'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Số Lượng</label>
                        <input
                          type="text" inputMode="numeric"
                          value={fmtThousands(editItems[0].quantity)}
                          onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === 0 ? { ...it, quantity: e.target.value.replace(/\D/g, '') } : it))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Đơn Giá (VNĐ)</label>
                        <input
                          type="text" inputMode="numeric"
                          value={fmtThousands(editItems[0].unit_price)}
                          onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === 0 ? { ...it, unit_price: e.target.value.replace(/\D/g, '') } : it))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Multi-product: editable unit_price per item */}
                {isMulti && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase">Sản Phẩm / NCC</th>
                          <th className="text-right px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase w-16">SL</th>
                          <th className="text-right px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase w-36">Đơn Giá</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {editItems.map((ei, idx) => (
                          <tr key={ei.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-gray-900">{ei.product_name}</p>
                              <p className="text-xs text-gray-400">{ei.supplier_name}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{parseInt(ei.quantity).toLocaleString('vi-VN')}</td>
                            <td className="px-4 py-2.5">
                              <input
                                type="text" inputMode="numeric"
                                value={fmtThousands(ei.unit_price)}
                                onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_price: e.target.value.replace(/\D/g, '') } : it))}
                                className="w-full text-right px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú</label>
                  <textarea
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    placeholder="Ghi chú..."
                  />
                </div>
              </div>

              <div className="px-5 py-4 border-t bg-gray-50 flex justify-end gap-2 flex-shrink-0">
                <button onClick={() => setEditBatchKey(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100">
                  Đóng
                </button>
                <button
                  onClick={() => editBatchMutation.mutate({ batchKey: editBatchKey, note: editNote, items: editItems })}
                  disabled={editBatchMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Pencil size={14} />
                  {editBatchMutation.isPending ? 'Đang lưu...' : 'Lưu Thay Đổi'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Import / Export Transaction Detail Modal ── */}
      {detailTx !== null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetailTx(null)} />
          <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                {detailTx.type === 'import' ? (
                  <><ArrowDownCircle size={17} className="text-green-500" /> Chi Tiết Phiếu Nhập Kho</>
                ) : (
                  <><ArrowUpCircle size={17} className="text-red-500" /> Chi Tiết Phiếu Xuất Kho</>
                )}
              </h2>
              <button onClick={() => setDetailTx(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Type badge */}
              <div>
                {detailTx.type === 'import' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                    <ArrowDownCircle size={14} /> Nhập Kho
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-full text-sm font-semibold">
                    <ArrowUpCircle size={14} /> Xuất Kho
                  </span>
                )}
              </div>

              {/* Main info grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Sản phẩm</p>
                  <p className="font-semibold text-gray-900">{detailTx.product?.name ?? '—'}</p>
                  {detailTx.product?.unit && (
                    <p className="text-xs text-gray-400 mt-0.5">Đơn vị: {detailTx.product.unit}</p>
                  )}
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Nhà cung cấp</p>
                  {detailTx.supplier ? (
                    <p className="font-semibold text-indigo-700 flex items-center gap-1">
                      <Truck size={13} /> {detailTx.supplier.name}
                    </p>
                  ) : (
                    <p className="text-gray-400 text-sm">Không có</p>
                  )}
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Số lượng</p>
                  <p className="font-bold text-2xl text-gray-900">{detailTx.quantity}
                    <span className="text-sm font-normal text-gray-400 ml-1">{detailTx.product?.unit ?? ''}</span>
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Đơn giá</p>
                  <p className="font-semibold text-gray-900">{formatCurrency(detailTx.unit_price)}</p>
                  {detailTx.unit_price > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Thành tiền: <span className="font-medium text-gray-700">{formatCurrency(detailTx.unit_price * detailTx.quantity)}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Note */}
              {detailTx.note && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-yellow-600 font-medium mb-0.5">Ghi chú</p>
                  <p className="text-sm text-gray-700">{detailTx.note}</p>
                </div>
              )}

              {/* Meta */}
              <div className="flex flex-wrap gap-4 text-sm text-gray-500 border-t pt-3">
                <span>Người ghi nhận: <strong className="text-gray-800">{detailTx.profile?.full_name ?? '—'}</strong></span>
                <span>Thời gian: <strong className="text-gray-800">{formatDate(detailTx.created_at)}</strong></span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 flex justify-end flex-shrink-0">
              <button
                onClick={() => setDetailTx(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Adjustment Voucher Detail Modal ── */}
      {adjBatchKey !== null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAdjBatchKey(null)} />
          <div className="relative bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <SlidersHorizontal size={17} className="text-orange-500" />
                  Phiếu Cân Bằng Kho
                  {adjCancelled && (
                    <span className="text-xs text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <Ban size={10} /> Đã hủy
                    </span>
                  )}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">{adjBatchKey}</p>
              </div>
              <button onClick={() => setAdjBatchKey(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X size={18} />
              </button>
            </div>

            {/* Meta */}
            {adjVoucherRows[0] && (
              <div className="px-5 py-3 bg-gray-50 border-b flex flex-wrap gap-4 text-sm text-gray-600 flex-shrink-0">
                <span>Ngày: <strong className="text-gray-900">{formatDate(adjVoucherRows[0].created_at)}</strong></span>
                <span>Người thực hiện: <strong className="text-gray-900">{adjVoucherRows[0].profile?.full_name ?? '—'}</strong></span>
                <span className="text-orange-600 font-medium">{adjVoucherRows.length} sản phẩm điều chỉnh</span>
              </div>
            )}

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-200">
                  <tr>
                    <th className="text-left font-semibold text-gray-500 text-xs uppercase tracking-wide px-5 py-2.5">Sản Phẩm</th>
                    <th className="text-left font-semibold text-gray-500 text-xs uppercase tracking-wide px-4 py-2.5">NCC</th>
                    <th className="text-right font-semibold text-gray-500 text-xs uppercase tracking-wide px-4 py-2.5">Trước</th>
                    <th className="text-right font-semibold text-gray-500 text-xs uppercase tracking-wide px-4 py-2.5">Sau</th>
                    <th className="text-right font-semibold text-gray-500 text-xs uppercase tracking-wide px-4 py-2.5">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {adjVoucherRows.map((row) => {
                    const truoc = parseTruoc(row.note)
                    const sau = parseSau(row.note)
                    const diff = truoc !== null && sau !== null ? sau - truoc : null
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">
                          {row.product?.name ?? '—'}
                          {row.product?.unit && <span className="text-xs text-gray-400 ml-1">({row.product.unit})</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm">
                          {row.supplier?.name ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              <Truck size={10} /> {row.supplier.name}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 font-medium">{truoc ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-900 font-semibold">{sau ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {diff === null ? '—'
                          : diff === 0 ? <span className="text-gray-400 flex items-center justify-end gap-1"><Minus size={12} /> Khớp</span>
                          : diff > 0 ? (
                            <span className="flex items-center justify-end gap-1 text-green-600 font-semibold">
                              <TrendingUp size={14} /> +{diff}
                            </span>
                          ) : (
                            <span className="flex items-center justify-end gap-1 text-red-600 font-semibold">
                              <TrendingDown size={14} /> {diff}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
              <div className="flex gap-2">
                {!adjCancelled && !adjCancelConfirm && (
                  <button
                    onClick={() => { setAdjCancelReason(''); setAdjCancelConfirm(true) }}
                    className="flex items-center gap-1.5 px-3 py-2 text-orange-600 hover:bg-orange-50 border border-orange-300 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Ban size={14} />
                    Hủy Phiếu
                  </button>
                )}
                {adjCancelConfirm && (
                  <div className="flex-1 space-y-2">
                    <textarea
                      value={adjCancelReason}
                      onChange={(e) => setAdjCancelReason(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                      placeholder="Nhập lý do hủy phiếu... (bắt buộc)"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setAdjCancelConfirm(false); setAdjCancelReason('') }}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-100"
                      >
                        Không
                      </button>
                      <button
                        onClick={() => {
                          if (!adjCancelReason.trim()) { toast.error('Vui lòng nhập lý do hủy phiếu'); return }
                          cancelAdjMutation.mutate({ batchKey: adjBatchKey!, reason: adjCancelReason })
                        }}
                        disabled={cancelAdjMutation.isPending || !adjCancelReason.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        <Ban size={14} />
                        {cancelAdjMutation.isPending ? 'Đang hủy...' : 'Xác Nhận Hủy'}
                      </button>
                    </div>
                  </div>
                )}
                {profile?.role === 'admin' && (
                  <button
                    onClick={() => {
                      if (window.confirm('Xóa phiếu sẽ xóa hoàn toàn khỏi hệ thống. Tiếp tục?')) {
                        deleteAdjMutation.mutate(adjBatchKey!)
                      }
                    }}
                    disabled={deleteAdjMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 text-red-600 hover:bg-red-50 border border-red-300 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    <Trash2 size={14} />
                    {deleteAdjMutation.isPending ? 'Đang xóa...' : 'Xóa Phiếu'}
                  </button>
                )}
              </div>
              <button
                onClick={() => setAdjBatchKey(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print Label Modal ── */}
      <PrintLabelModal
        product={printProduct}
        onClose={() => setPrintProductId(null)}
      />

      {/* ── Print Batch Label Modal ── */}
      <PrintBatchLabelModal
        items={(() => {
          if (!printBatchKey) return null
          const batchTxs = transactions.filter(t => t.type !== 'adjustment' && getTxGroupKey(t) === printBatchKey)
          return batchTxs.reduce<BatchPrintItem[]>((acc, tx) => {
            const product = products.find(p => p.id === tx.product_id)
            if (product) acc.push({ product, quantity: tx.quantity, supplierId: tx.supplier_id })
            return acc
          }, [])
        })()}
        onClose={() => setPrintBatchKey(null)}
      />

      {/* ── Modal Ghi Nhận ── */}
      <Modal isOpen={isModalOpen} onClose={requestCloseTransaction} title="Ghi Nhận Nhập / Xuất Kho" size="xl">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.type === 'export') exportMutation.mutate()
            else saveMutation.mutate(form)
          }}
          className="space-y-4"
        >
          {/* Type selector */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="import" checked={form.type === 'import'}
                onChange={() => { setForm({ ...form, type: 'import' }); setExportItems([]) }} />
              <span className="text-sm text-green-700 font-semibold flex items-center gap-1">
                <ArrowDownCircle size={15} /> Nhập Kho
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="export" checked={form.type === 'export'}
                onChange={() => setForm({ ...form, type: 'export' })} />
              <span className="text-sm text-red-700 font-semibold flex items-center gap-1">
                <ArrowUpCircle size={15} /> Xuất Kho
              </span>
            </label>
          </div>

          {/* ═══ NHẬP KHO: single-product (unchanged) ═══ */}
          {form.type === 'import' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sản Phẩm <span className="text-red-500">*</span></label>
                <select
                  value={form.product_id}
                  onChange={(e) => setForm({ ...form, product_id: e.target.value, supplier_id: '', unit_price: '' })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="">-- Chọn sản phẩm --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {form.product_id && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nhà Cung Cấp (NCC) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.supplier_id}
                    onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  >
                    <option value="">-- Chọn NCC --</option>
                    {suppliersForImport.map((s) => {
                      const linked = selectedProductNccs.find((ps) => ps.supplier_id === s.id)
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name}{linked ? ` (Tồn: ${linked.quantity})` : ' — Thêm NCC mới'}
                        </option>
                      )
                    })}
                  </select>
                  {isNewNcc && (
                    <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                      <Truck size={11} /> NCC mới sẽ được liên kết. Mã vạch tự tạo (sửa trong Hàng Hóa).
                    </p>
                  )}
                  {selectedNccInfo && (
                    <p className="text-xs text-gray-500 mt-1">
                      Tồn hiện tại: <span className="font-bold text-gray-700">{selectedNccInfo.quantity}</span> — Giá nhập cũ: <span className="font-bold text-red-600">{formatCurrency(selectedNccInfo.cost_price)}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số Lượng <span className="text-red-500">*</span></label>
                  <input type="text" inputMode="numeric" value={fmtThousands(form.quantity)} required
                    onChange={(e) => setForm({ ...form, quantity: e.target.value.replace(/\D/g, '') })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Giá Nhập (VNĐ)</label>
                  <input type="text" inputMode="numeric" value={fmtThousands(form.unit_price)}
                    onChange={(e) => setForm({ ...form, unit_price: e.target.value.replace(/\D/g, '') })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm"
                  placeholder="VD: Hàng chính hãng, bảo hành 12 tháng..." />
              </div>

              <div className="flex gap-2 justify-end pt-1 flex-wrap">
                <button type="button" onClick={requestCloseTransaction} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
                <button type="button"
                  disabled={saveMutation.isPending || !form.product_id || !form.supplier_id || !form.quantity}
                  onClick={() => { printAfterSaveRef.current = true; saveMutation.mutate(form) }}
                  className="flex items-center gap-1.5 px-4 py-2 border border-blue-500 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  <Printer size={15} /> Lưu & In Tem
                </button>
                <button type="submit"
                  disabled={saveMutation.isPending || (!!form.product_id && !form.supplier_id)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg text-sm font-medium"
                >
                  {saveMutation.isPending ? 'Đang lưu...' : 'Nhập Kho'}
                </button>
              </div>
            </>
          )}

          {/* ═══ XUẤT KHO: multi-product + recipient ═══ */}
          {form.type === 'export' && (
            <>
              {/* Loại xuất */}
              <div className="flex gap-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={exportRecipient.type === 'customer'}
                    onChange={() => setExportRecipient((r) => ({ ...r, type: 'customer' }))} />
                  <span className="text-sm font-medium flex items-center gap-1.5 text-blue-700">
                    <UserCheck size={15} /> Xuất cho khách hàng
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={exportRecipient.type === 'supplier_return'}
                    onChange={() => setExportRecipient((r) => ({ ...r, type: 'supplier_return' }))} />
                  <span className="text-sm font-medium flex items-center gap-1.5 text-orange-700">
                    <RotateCcw size={15} /> Xuất trả nhà cung cấp
                  </span>
                </label>
              </div>

              {/* Thông tin người nhận */}
              {exportRecipient.type === 'customer' ? (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Thông Tin Người Nhận</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input placeholder="Tên người nhận" value={exportRecipient.name}
                      onChange={(e) => setExportRecipient((r) => ({ ...r, name: e.target.value }))}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
                    <input placeholder="Số điện thoại" value={exportRecipient.phone}
                      onChange={(e) => setExportRecipient((r) => ({ ...r, phone: e.target.value }))}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
                  </div>
                  <input placeholder="Địa chỉ giao hàng" value={exportRecipient.address}
                    onChange={(e) => setExportRecipient((r) => ({ ...r, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nhà Cung Cấp nhận hàng <span className="text-red-500">*</span></label>
                  <select value={exportRecipient.supplier_id}
                    onChange={(e) => setExportRecipient((r) => ({ ...r, supplier_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                    <option value="">-- Chọn nhà cung cấp --</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              {/* Quét mã vạch */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tìm Sản Phẩm <span className="text-xs text-gray-400 font-normal">(quét mã vạch hoặc nhập mã sản phẩm)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    ref={barcodeRef}
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeSearch(barcodeInput) } }}
                    placeholder="Quét mã vạch hoặc mã sản phẩm → Enter"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                    autoFocus
                  />
                  <button type="button" onClick={() => handleBarcodeSearch(barcodeInput)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 whitespace-nowrap">
                    <ScanLine size={15} /> Thêm
                  </button>
                </div>
              </div>

              {/* Danh sách sản phẩm xuất */}
              {exportItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                  <ScanLine size={28} className="mx-auto mb-2 opacity-30" />
                  Quét mã vạch hoặc nhập mã để thêm sản phẩm
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Sản Phẩm</th>
                        {exportRecipient.type === 'supplier_return' && (
                          <th className="text-left px-3 py-2 font-semibold text-gray-600 hidden sm:table-cell">NCC (Tồn)</th>
                        )}
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 w-24 text-orange-600">Giá Vốn</th>
                        <th className="text-center px-3 py-2 font-semibold text-gray-600 w-20">Số Lượng</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 w-28">Đơn Giá</th>
                        <th className="px-2 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {exportItems.map((item) => {
                        const qtyNum = parseInt(item.quantity) || 0
                        const overLimit = qtyNum > item.available_qty
                        return (
                          <tr key={item.key} className={overLimit ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-900 leading-snug">{item.product_name}</p>
                            </td>
                            {exportRecipient.type === 'supplier_return' && (
                              <td className="px-3 py-2 hidden sm:table-cell">
                                <span className="text-gray-500">{item.supplier_name}</span>
                                <span className="ml-1 text-green-600 font-medium">({item.available_qty})</span>
                              </td>
                            )}
                            <td className="px-3 py-2 text-right">
                              {item.cost_price > 0
                                ? <span className="font-medium text-orange-600">{formatCurrency(item.cost_price)}</span>
                                : <span className="text-gray-300">—</span>
                              }
                            </td>
                            <td className="px-3 py-2">
                              <input type="text" inputMode="numeric" value={item.quantity}
                                onChange={(e) => setExportItems((prev) => prev.map((i) =>
                                  i.key === item.key ? { ...i, quantity: e.target.value.replace(/\D/g, '') } : i
                                ))}
                                className={`w-full text-center px-2 py-1 border rounded text-xs outline-none focus:ring-1 focus:ring-blue-500 ${overLimit ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                              />
                              {overLimit && <p className="text-[10px] text-red-500 text-center mt-0.5">Vượt tồn</p>}
                            </td>
                            <td className="px-3 py-2">
                              <input type="text" inputMode="numeric"
                                value={fmtThousands(item.unit_price)}
                                onChange={(e) => setExportItems((prev) => prev.map((i) =>
                                  i.key === item.key ? { ...i, unit_price: e.target.value.replace(/\D/g, '') } : i
                                ))}
                                placeholder="0"
                                className="w-full text-right px-2 py-1 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <button type="button"
                                onClick={() => setExportItems((prev) => prev.filter((i) => i.key !== item.key))}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                                <X size={13} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 flex justify-between items-center text-xs">
                    <span className="text-gray-500">{exportItems.length} sản phẩm</span>
                    <span className="font-bold text-red-600">
                      Tổng: {formatCurrency(exportItems.reduce((s, i) => s + (parseInt(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0))}
                    </span>
                  </div>
                </div>
              )}

              {/* Ghi chú */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú</label>
                <input type="text" value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Ghi chú thêm..." />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={requestCloseTransaction} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
                <button type="submit"
                  disabled={
                    exportMutation.isPending ||
                    exportItems.length === 0 ||
                    exportItems.some((i) => (parseInt(i.quantity) || 0) > i.available_qty) ||
                    (exportRecipient.type === 'supplier_return' && !exportRecipient.supplier_id)
                  }
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium"
                >
                  {exportMutation.isPending ? 'Đang xuất...' : `Xuất Kho${exportItems.length > 0 ? ` (${exportItems.length} SP)` : ''}`}
                </button>
              </div>
            </>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        onConfirm={closeTransactionModal}
        title="Thoát mà không lưu?"
        message="Bạn có thay đổi chưa được lưu. Bạn có chắc muốn thoát không?"
        confirmLabel="Thoát"
      />

      {cancelConfirmKey !== null && (
        <Modal isOpen onClose={() => { setCancelConfirmKey(null); setCancelReason('') }} title="Hủy phiếu?" size="sm">
          <p className="text-gray-600 mb-3">Phiếu sẽ bị hủy và tồn kho sẽ được hoàn nguyên về trước khi có giao dịch này. Hành động này không thể khôi phục.</p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lý do hủy <span className="text-red-500">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none resize-none"
              placeholder="Nhập lý do hủy phiếu..."
              autoFocus
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setCancelConfirmKey(null); setCancelReason('') }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={() => {
                if (!cancelReason.trim()) { toast.error('Vui lòng nhập lý do hủy phiếu'); return }
                cancelBatchMutation.mutate({ batchKey: cancelConfirmKey, reason: cancelReason })
              }}
              disabled={cancelBatchMutation.isPending || !cancelReason.trim()}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {cancelBatchMutation.isPending ? 'Đang hủy...' : 'Hủy Phiếu'}
            </button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={deleteConfirmKey !== null}
        onClose={() => setDeleteConfirmKey(null)}
        onConfirm={() => { if (deleteConfirmKey) deleteBatchMutation.mutate(deleteConfirmKey) }}
        title="Xóa phiếu?"
        message="Phiếu sẽ bị xóa hoàn toàn khỏi hệ thống và tồn kho sẽ được hoàn nguyên (nếu chưa hủy). Hành động này không thể khôi phục."
        confirmLabel={deleteBatchMutation.isPending ? 'Đang xóa...' : 'Xóa'}
      />
    </div>
  )
}

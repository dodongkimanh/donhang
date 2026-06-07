import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Truck, CheckCircle, AlertTriangle, Search,
  Send, MessageSquare, ChevronDown, Pencil, Settings, UserPlus, X, ScanLine, Printer, MapPin, Eye, EyeOff, PhoneCall,
  RotateCcw, ArrowLeftRight, Receipt,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { VietnamAddressSelect } from '@/components/ui/VietnamAddressSelect'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusBadge, ORDER_STATUS_CONFIG } from '@/components/ui/StatusBadge'
import { formatCurrency, formatDate, formatDateOnly, fmtThousands } from '@/utils/format'
import type { Order, OrderNote, OrderStatus, OrderSource, Product, Customer, OrderItem, ProductSupplier, InventoryTransaction, ReturnTicket, ReturnTicketItem } from '@/types'
import { useRoutePlanningStore } from '@/stores/routePlanningStore'
import toast from 'react-hot-toast'

// ── Shipping carriers ─────────────────────────────────────────────────────────

const CARRIERS: { value: string; label: string; hasCode: boolean }[] = [
  { value: '',         label: '— Chọn ĐVVC —',          hasCode: false },
  { value: 'viettel',  label: 'Viettel Post',            hasCode: true  },
  { value: 'ghtk',     label: 'GHTK',                    hasCode: true  },
  { value: 'nhattin',  label: 'Nhất Tín',                hasCode: true  },
  { value: 'xeghep',   label: 'Gửi xe ghép',             hasCode: false },
  { value: 'xenha',    label: 'Xe nhà vận chuyển',       hasCode: false },
]

// ── Shipping + Note editor (inline, admin/accountant/kho only) ────────────────

interface ShippingEditorProps {
  order: Order
  canEdit: boolean
}

function ShippingNoteEditor({ order, canEdit }: ShippingEditorProps) {
  const queryClient = useQueryClient()
  const [carrier, setCarrier] = useState(order.shipping_carrier ?? '')
  const [code, setCode] = useState(order.shipping_code ?? '')

  const carrierInfo = CARRIERS.find((c) => c.value === carrier)

  const saveMutation = useMutation({
    mutationFn: async (data: { shipping_carrier: string; shipping_code: string }) => {
      const { error } = await supabase.from('orders').update(data).eq('id', order.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
    onError: () => toast.error('Lỗi khi lưu'),
  })

  function handleBlurSave() {
    if (
      carrier !== (order.shipping_carrier ?? '') ||
      code !== (order.shipping_code ?? '')
    ) {
      saveMutation.mutate({ shipping_carrier: carrier, shipping_code: code })
    }
  }

  if (!canEdit) {
    return (
      <div className="mt-1.5 space-y-0.5">
        {carrier && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-orange-500">{carrierInfo?.label ?? carrier}</span>
            {code && <span className="text-[10px] text-orange-400 font-mono">{code}</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      <select
        value={carrier}
        onChange={(e) => { setCarrier(e.target.value); if (!CARRIERS.find(c => c.value === e.target.value)?.hasCode) setCode('') }}
        onBlur={handleBlurSave}
        className="w-full text-[11px] px-1 py-0.5 border-0 outline-none bg-transparent text-orange-500 cursor-pointer"
      >
        {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>

      {carrier && carrierInfo?.hasCode && (
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={handleBlurSave}
          placeholder="Mã vận đơn..."
          className="w-full text-[11px] px-1 py-0.5 border-0 outline-none bg-transparent font-mono text-orange-400 placeholder:text-gray-300"
        />
      )}
    </div>
  )
}

// ── Status options ────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'draft',             label: 'Đơn Nháp' },
  { value: 'placed',            label: 'Đặt Đơn' },
  { value: 'confirmed',         label: 'Xác Nhận Đơn' },
  { value: 'packing',           label: 'Xuất Kho Đang Đóng Gói' },
  { value: 'shipping',          label: 'Đang Vận Chuyển' },
  { value: 'completed',         label: 'Hoàn Thành' },
  { value: 'returned',          label: 'Hoàn' },
  { value: 'returned_received', label: 'Đã Hoàn Về' },
  { value: 'partial_return',    label: 'Đổi Trả 1 Phần' },
  { value: 'cancelled',         label: 'Khách Hủy' },
]

// Luồng chuyển trạng thái hợp lệ — 'packing' chỉ được set qua xuất kho mã vạch
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft:             ['placed', 'cancelled'],
  placed:            ['confirmed', 'cancelled'],
  confirmed:         ['packing', 'placed', 'cancelled'],
  packing:           ['shipping', 'returned', 'partial_return'],
  shipping:          ['completed', 'returned', 'returned_received', 'partial_return'],
  completed:         ['returned', 'partial_return'],
  returned:          ['returned_received'],
  returned_received: [],
  partial_return:    ['completed', 'returned'],
  cancelled:         [],
}

// Chuẩn hóa SĐT: bỏ đầu 0 hoặc 84, lấy 9 số cuối
function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('84') && d.length >= 11) return d.slice(2)
  if (d.startsWith('0') && d.length >= 10) return d.slice(1)
  return d
}

// ── Inline Status Select ──────────────────────────────────────────────────────

function StatusSelect({ order, onUpdate }: { order: Order; onUpdate: (id: string, s: OrderStatus) => void }) {
  const cfg = ORDER_STATUS_CONFIG[order.status] ?? ORDER_STATUS_CONFIG['placed']
  const allowed = ALLOWED_TRANSITIONS[order.status] ?? []

  // Chỉ hiển thị trạng thái hiện tại + các trạng thái được phép chuyển sang
  const visibleOptions = STATUS_OPTIONS.filter(
    (o) => o.value === order.status || allowed.includes(o.value)
  )

  // Nếu không có trạng thái nào để chuyển (terminal state) → chỉ hiển thị badge
  if (allowed.length === 0) {
    return <StatusBadge status={order.status} />
  }

  return (
    <div className="relative block w-full">
      <select
        value={order.status}
        onChange={(e) => onUpdate(order.id, e.target.value as OrderStatus)}
        onClick={(e) => e.stopPropagation()}
        className={`appearance-none w-full pr-5 pl-2.5 py-0.5 rounded-full text-xs font-semibold border cursor-pointer outline-none focus:ring-2 focus:ring-offset-1 ${cfg.bg} ${cfg.color} ${cfg.border}`}
      >
        {visibleOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={10} className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none ${cfg.color}`} />
    </div>
  )
}

// ── Notes cell ────────────────────────────────────────────────────────────────

function NotesCell({ order, profileId, canAddNote }: { order: Order; profileId: string; canAddNote: boolean }) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(false)
  const notes: OrderNote[] = order.notes ?? []

  const addNote = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from('order_notes').insert({
        order_id: order.id,
        content,
        created_by: profileId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setInput('')
    },
    onError: () => toast.error('Không thể thêm ghi chú'),
  })

  const visible = expanded ? notes : notes.slice(0, 2)
  const hasMore = notes.length > 2

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {notes.length === 0 && !canAddNote && (
        <p className="text-xs text-gray-300 italic">Chưa có ghi chú</p>
      )}

      {visible.map((n) => (
        <div key={n.id} className="text-xs leading-snug">
          <span className="font-semibold text-indigo-600">{n.profile?.full_name ?? 'NV'}:</span>{' '}
          <span className="text-gray-700">{n.content}</span>
          <span className="text-gray-300 ml-1 whitespace-nowrap">{formatDate(n.created_at)}</span>
        </div>
      ))}

      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-blue-500 hover:underline"
        >
          {expanded ? 'Ẩn bớt' : `+${notes.length - 2} ghi chú`}
        </button>
      )}

      {canAddNote && (
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) {
                e.preventDefault()
                addNote.mutate(input.trim())
              }
            }}
            placeholder="Ghi chú..."
            className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
          />
          <button
            onClick={() => input.trim() && addNote.mutate(input.trim())}
            disabled={!input.trim() || addNote.isPending}
            className="p-1 text-blue-500 hover:text-blue-700 disabled:opacity-30"
          >
            <Send size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Create / Edit Order Modal ─────────────────────────────────────────────────

interface OrderItemInput {
  product_id: string
  quantity: number
  unit_price: number
  discount: number
  subtotal: number
  product_name: string
  product_code: string
  image_url?: string
  unit: string
}

interface CreateOrderForm {
  customer_id: string
  source_id: string
  note: string
  discountType: 'vnd' | 'percent' | 'final'
  discountValue: string
  extraCharge: string
  items: OrderItemInput[]
  orderStatus: OrderStatus
}

// ── Manage Order Sources Modal ────────────────────────────────────────────────

function ManageOrderSourcesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')

  const { data: sources = [] } = useQuery({
    queryKey: ['order-sources'],
    queryFn: async () => {
      const { data } = await supabase.from('order_sources').select('*').order('name')
      return (data ?? []) as OrderSource[]
    },
    enabled: isOpen,
  })

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('order_sources').insert({ name })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-sources'] })
      setNewName('')
    },
    onError: () => toast.error('Lỗi khi thêm nguồn đơn'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('order_sources').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order-sources'] }),
    onError: () => toast.error('Lỗi khi xóa'),
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quản Lý Nguồn Đơn" size="sm">
      <div className="space-y-3">
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {sources.length === 0 && (
            <p className="text-sm text-gray-400 italic text-center py-3">Chưa có nguồn đơn nào</p>
          )}
          {sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-800">{s.name}</span>
              <button
                onClick={() => deleteMutation.mutate(s.id)}
                className="text-red-400 hover:text-red-600 text-lg leading-none ml-2 flex-shrink-0"
              >×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) addMutation.mutate(newName.trim()) }}
            placeholder="Tên nguồn đơn mới..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            onClick={() => newName.trim() && addMutation.mutate(newName.trim())}
            disabled={!newName.trim() || addMutation.isPending}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
          >
            Thêm
          </button>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Đóng</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Return Ticket Modal ───────────────────────────────────────────────────────

interface ExchangeItem {
  product_id: string
  name: string
  qty: number
  price: number
}

function ReturnTicketModal({
  isOpen, onClose, order,
}: { isOpen: boolean; onClose: () => void; order: Order | null }) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const [returnedSel, setReturnedSel] = useState<Record<string, { checked: boolean; qty: number }>>({})
  const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [customerPaid, setCustomerPaid] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-for-return'],
    queryFn: async () => {
      const { data } = await supabase.from('products').select('id, name, sale_price, unit').order('name')
      return (data ?? []) as Pick<Product, 'id' | 'name' | 'sale_price' | 'unit'>[]
    },
    enabled: isOpen,
  })

  // Reset when order changes
  useEffect(() => {
    if (!order) return
    const init: Record<string, { checked: boolean; qty: number }> = {}
    ;(order.items ?? []).forEach((item) => { init[item.id] = { checked: false, qty: item.quantity } })
    setReturnedSel(init)
    setExchangeItems([])
    setCustomerPaid('')
    setReason('')
    setNote('')
  }, [order?.id, isOpen])

  const items: OrderItem[] = order?.items ?? []

  const returnedAmount = items.reduce((s, item) => {
    const sel = returnedSel[item.id]
    if (!sel?.checked) return s
    return s + item.unit_price * sel.qty
  }, 0)

  const exchangeAmount = exchangeItems.reduce((s, ei) => s + ei.price * ei.qty, 0)
  const customerPaidNum = parseFloat(customerPaid.replace(/[^0-9.]/g, '')) || 0
  // balance > 0: khách còn nợ thêm; < 0: shop cần hoàn tiền cho khách
  const balance = exchangeAmount - returnedAmount + customerPaidNum

  const filteredProducts = productSearch.trim()
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p as unknown as { product_code?: string }).product_code?.toLowerCase().includes(productSearch.toLowerCase())
      )
    : []

  function toggleReturn(itemId: string, checked: boolean) {
    setReturnedSel((prev) => ({ ...prev, [itemId]: { ...prev[itemId], checked } }))
  }

  function setReturnQty(itemId: string, qty: number) {
    setReturnedSel((prev) => ({ ...prev, [itemId]: { ...prev[itemId], qty } }))
  }

  function addExchangeProduct(p: Pick<Product, 'id' | 'name' | 'sale_price'>) {
    setExchangeItems((prev) => {
      const existing = prev.find((ei) => ei.product_id === p.id)
      if (existing) return prev.map((ei) => ei.product_id === p.id ? { ...ei, qty: ei.qty + 1 } : ei)
      return [...prev, { product_id: p.id, name: p.name, qty: 1, price: p.sale_price }]
    })
    setProductSearch('')
  }

  function removeExchangeItem(idx: number) {
    setExchangeItems((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!order) return
    const checkedItems = items.filter((item) => returnedSel[item.id]?.checked)
    if (checkedItems.length === 0 && exchangeItems.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 hàng trả về hoặc 1 hàng đổi mới')
      return
    }
    setSaving(true)
    try {
      // Sinh số phiếu
      const now = new Date()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const yy = String(now.getFullYear()).slice(-2)
      const { data: existing } = await supabase.from('return_tickets').select('id').like('ticket_number', `PTR${mm}${yy}%`)
      let seq = ((existing as unknown[])?.length ?? 0) + 1

      const returnedItems: ReturnTicketItem[] = checkedItems.map((item) => ({
        order_item_id: item.id,
        name: item.product?.name ?? '—',
        quantity: returnedSel[item.id].qty,
        unit_price: item.unit_price,
      }))

      const exchangeItemsPayload: ReturnTicketItem[] = exchangeItems.map((ei) => ({
        product_id: ei.product_id,
        name: ei.name,
        quantity: ei.qty,
        unit_price: ei.price,
      }))

      // Retry khi số phiếu bị trùng (race condition)
      let ticketInsertError: { code?: string; message?: string } | null = null
      let ticketNumber = ''
      for (let attempt = 0; attempt < 5; attempt++) {
        ticketNumber = `PTR${mm}${yy}${String(seq).padStart(3, '0')}`
        const { error } = await supabase.from('return_tickets').insert({
          ticket_number: ticketNumber,
          order_id: order.id,
          returned_items: returnedItems,
          exchange_items: exchangeItemsPayload,
          returned_amount: returnedAmount,
          exchange_amount: exchangeAmount,
          customer_paid: customerPaidNum,
          reason: reason.trim() || null,
          note: note.trim() || null,
          created_by: profile?.user_id ?? null,
        })
        if (!error) { ticketInsertError = null; break }
        if (error.code === '23505') { seq++; ticketInsertError = error; continue }
        throw error
      }
      if (ticketInsertError) throw ticketInsertError

      // Cập nhật trạng thái đơn: nếu tất cả sản phẩm đều được trả → returned; ngược lại → partial_return
      const allReturned = items.length > 0 && items.every((item) => returnedSel[item.id]?.checked && returnedSel[item.id].qty >= item.quantity)
      const newStatus: OrderStatus = allReturned ? 'returned' : 'partial_return'

      await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', order.id)

      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success(`Đã tạo phiếu đổi trả ${ticketNumber}`)
      onClose()
    } catch {
      toast.error('Có lỗi khi tạo phiếu đổi trả')
    } finally {
      setSaving(false)
    }
  }

  if (!order) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Phiếu Đổi Trả — ${order.order_number}`} size="xl">
      <div className="space-y-5">

        {/* ── Hàng trả về ── */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <RotateCcw size={14} className="text-red-500" /> Hàng khách trả về
          </p>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left w-6"></th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Sản phẩm</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 w-16">SL đơn</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">SL trả</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 w-24">Đơn giá</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 w-24">Thành tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const sel = returnedSel[item.id] ?? { checked: false, qty: item.quantity }
                  return (
                    <tr key={item.id} className={sel.checked ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={sel.checked}
                          onChange={(e) => toggleReturn(item.id, e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-red-500" />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800">{item.product?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{item.quantity}</td>
                      <td className="px-3 py-2 text-right">
                        {sel.checked ? (
                          <input type="number" min={1} max={item.quantity} value={sel.qty}
                            onChange={(e) => setReturnQty(item.id, Math.min(item.quantity, Math.max(1, parseInt(e.target.value) || 1)))}
                            className="w-16 text-right border border-red-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400" />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(item.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">
                        {sel.checked ? formatCurrency(item.unit_price * sel.qty) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {returnedAmount > 0 && (
            <p className="text-right text-xs font-semibold text-red-600 mt-1">
              Tổng trả về: {formatCurrency(returnedAmount)}
            </p>
          )}
        </div>

        {/* ── Hàng đổi mới ── */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <ArrowLeftRight size={14} className="text-blue-500" /> Hàng đổi mới cho khách
          </p>

          {/* Search */}
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm sản phẩm đổi mới..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 border border-blue-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                {filteredProducts.slice(0, 8).map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => addExchangeProduct(p)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex justify-between items-center">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-blue-600 font-semibold">{formatCurrency(p.sale_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {exchangeItems.length > 0 ? (
            <div className="border border-blue-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-blue-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-blue-700">Sản phẩm mới</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700 w-20">SL</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700 w-28">Giá bán</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700 w-28">Thành tiền</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-100">
                  {exchangeItems.map((ei, idx) => (
                    <tr key={idx} className="bg-blue-50/30">
                      <td className="px-3 py-2 font-medium text-gray-800">{ei.name}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min={1} value={ei.qty}
                          onChange={(e) => setExchangeItems((prev) => prev.map((x, i) => i === idx ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                          className="w-14 text-right border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min={0} value={ei.price}
                          onChange={(e) => setExchangeItems((prev) => prev.map((x, i) => i === idx ? { ...x, price: parseFloat(e.target.value) || 0 } : x))}
                          className="w-24 text-right border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700">
                        {formatCurrency(ei.price * ei.qty)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeExchangeItem(idx)} className="text-gray-300 hover:text-red-500">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic text-center py-3 border border-dashed border-blue-200 rounded-xl">
              Tìm và chọn sản phẩm thay thế ở trên (nếu có đổi hàng)
            </p>
          )}
          {exchangeAmount > 0 && (
            <p className="text-right text-xs font-semibold text-blue-700 mt-1">
              Tổng hàng đổi mới: {formatCurrency(exchangeAmount)}
            </p>
          )}
        </div>

        {/* ── Thanh toán ── */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Receipt size={14} className="text-green-600" /> Thanh toán
          </p>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-600 w-36">Khách đã trả (đợt này):</label>
            <input
              type="text"
              value={customerPaid}
              onChange={(e) => setCustomerPaid(e.target.value)}
              placeholder="0"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>
          {/* Summary */}
          <div className="border-t border-gray-200 pt-3 space-y-1 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>Hàng trả về:</span>
              <span className="font-medium text-red-600">{formatCurrency(returnedAmount)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Hàng đổi mới:</span>
              <span className="font-medium text-blue-700">{formatCurrency(exchangeAmount)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Khách đã trả:</span>
              <span className="font-medium text-green-600">{formatCurrency(customerPaidNum)}</span>
            </div>
            <div className={`flex justify-between font-semibold pt-1 border-t border-gray-200 text-sm ${balance > 0 ? 'text-orange-600' : balance < 0 ? 'text-green-700' : 'text-gray-500'}`}>
              <span>{balance > 0 ? 'Khách còn nợ:' : balance < 0 ? 'Hoàn tiền khách:' : 'Đã thanh toán đủ'}</span>
              <span>{balance !== 0 ? formatCurrency(Math.abs(balance)) : '✓'}</span>
            </div>
          </div>
        </div>

        {/* ── Lý do & Ghi chú ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lý do đổi trả</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Hàng lỗi, không đúng mẫu..."
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ghi chú thêm</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú nội bộ..."
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-lg text-sm font-medium"
          >
            <RotateCcw size={14} />
            {saving ? 'Đang lưu...' : 'Tạo phiếu đổi trả'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Create Order Modal ────────────────────────────────────────────────────────

function CreateOrderModal({
  isOpen, onClose, editingOrder, prefillCustomerId,
}: { isOpen: boolean; onClose: () => void; editingOrder: Order | null; prefillCustomerId?: string }) {
  const { profile, isAdmin, isAccountant, isEmployee } = useAuth()
  // Nhân viên tạo đơn → mặc định là Đơn Nháp; admin/kế toán → Đặt Đơn
  const defaultStatus: OrderStatus = isEmployee ? 'draft' : 'placed'
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateOrderForm>({
    customer_id: '', source_id: '', note: '',
    discountType: 'vnd', discountValue: '', extraCharge: '',
    items: [], orderStatus: 'draft',
  })
  const [productSearch, setProductSearch] = useState('')
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCust, setNewCust] = useState({ name: '', phone: '', address: '' })
  const [customerSaved, setCustomerSaved] = useState(false)
  const [isManageSrcOpen, setIsManageSrcOpen] = useState(false)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [showEditCustomer, setShowEditCustomer] = useState(false)
  const [editCust, setEditCust] = useState({ name: '', phone: '', address: '' })

  // Computed discount values
  const total = form.items.reduce((s, i) => s + i.subtotal, 0)
  const discountNum = parseFloat(form.discountValue) || 0
  const actualDiscount =
    form.discountType === 'vnd'     ? Math.min(discountNum, total) :
    form.discountType === 'percent' ? Math.round(total * Math.min(discountNum, 100) / 100) :
    /* final */                       Math.max(0, total - discountNum)
  const extraChargeNum = parseFloat(form.extraCharge) || 0
  const finalAmount = Math.max(0, total - actualDiscount + extraChargeNum)

  function requestClose() {
    const dirty = form.items.length > 0 || !!form.customer_id || !!form.note.trim() || !!form.source_id
    if (dirty) setConfirmCloseOpen(true)
    else onClose()
  }

  function handleSave() {
    if (showAddCustomer && !customerSaved && newCust.name.trim()) {
      toast.error('Vui lòng nhấn Lưu để lưu thông tin khách hàng trước khi tạo đơn')
      return
    }
    saveMutation.mutate()
  }

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-order'],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, product_code, sale_price, unit, quantity, image_url')
        .order('name')
      return (data ?? []) as Pick<Product, 'id' | 'name' | 'product_code' | 'sale_price' | 'unit' | 'quantity' | 'image_url'>[]
    },
    enabled: isOpen,
  })

  const { data: reservedQty = {} } = useQuery({
    queryKey: ['reserved-qty-for-order', editingOrder?.id],
    queryFn: async () => {
      let query = supabase.from('orders').select('id').in('status', ['placed', 'confirmed'])
      if (editingOrder?.id) query = query.neq('id', editingOrder.id)
      const { data: placedOrders } = await query
      if (!placedOrders?.length) return {} as Record<string, number>
      const ids = (placedOrders as { id: string }[]).map((o) => o.id)
      const { data: items } = await supabase.from('order_items').select('product_id, quantity').in('order_id', ids)
      const result: Record<string, number> = {}
      ;(items ?? []).forEach((item: { product_id: string; quantity: number }) => {
        result[item.product_id] = (result[item.product_id] ?? 0) + item.quantity
      })
      return result
    },
    enabled: isOpen,
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-simple', profile?.id, isEmployee],
    queryFn: async () => {
      let query = supabase.from('customers').select('id, name, phone, address').order('name')
      if (isEmployee && profile) query = query.eq('created_by', profile.id)
      const { data } = await query
      return (data ?? []) as Pick<Customer, 'id' | 'name' | 'phone' | 'address'>[]
    },
    enabled: isOpen,
  })

  const { data: orderSources = [] } = useQuery({
    queryKey: ['order-sources'],
    queryFn: async () => {
      const { data } = await supabase.from('order_sources').select('*').order('name')
      return (data ?? []) as OrderSource[]
    },
    enabled: isOpen,
  })

  const addCustomerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('customers').insert({
        name: newCust.name.trim(),
        phone: newCust.phone.trim() || undefined,
        address: newCust.address.trim() || undefined,
        created_by: profile?.id ?? undefined,
      }).select().single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers-simple'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setForm((f) => ({ ...f, customer_id: data.id }))
      setCustomerSaved(true)
      toast.success('Thêm khách hàng thành công')
    },
    onError: () => toast.error('Lỗi khi thêm khách hàng'),
  })

  const updateCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!form.customer_id) return
      const { error } = await supabase.from('customers').update({
        name: editCust.name.trim(),
        phone: editCust.phone.trim() || null,
        address: editCust.address.trim() || null,
      }).eq('id', form.customer_id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers-simple'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setShowEditCustomer(false)
      toast.success('Đã cập nhật thông tin khách hàng')
    },
    onError: () => toast.error('Lỗi khi cập nhật khách hàng'),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not authenticated')

      if (editingOrder) {
        const { error } = await supabase.from('orders').update({
          customer_id: form.customer_id || null,
          note: form.note,
          source_id: form.source_id || null,
          discount: actualDiscount,
          total_amount: total,
          final_amount: finalAmount,
          ...(form.orderStatus !== editingOrder.status ? { status: form.orderStatus } : {}),
        }).eq('id', editingOrder.id)
        if (error) throw error
        const { error: deleteItemsError } = await supabase.from('order_items').delete().eq('order_id', editingOrder.id)
        if (deleteItemsError) throw deleteItemsError
        if (form.items.length > 0) {
          const { error: ie } = await supabase.from('order_items').insert(
            form.items.map((item) => ({
              order_id: editingOrder.id,
              product_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount: item.discount,
              subtotal: item.subtotal,
            }))
          )
          if (ie) throw ie
        }
      } else {
        const now = new Date()
        const mm = String(now.getMonth() + 1).padStart(2, '0')
        const yy = String(now.getFullYear()).slice(-2)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const { data: countData } = await supabase.rpc('get_month_order_count', { month_start: monthStart })
        let seq = ((countData as number) ?? 0) + 1

        // Retry khi số đơn bị trùng (race condition 2 người tạo cùng lúc)
        let orderData: { id: string } | null = null
        let insertError: { code?: string; message?: string } | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          const orderNum = `DH${mm}${yy}${String(seq).padStart(3, '0')}`
          const { data: d, error: e } = await supabase.from('orders').insert({
            order_number: orderNum,
            customer_id: form.customer_id || null,
            employee_id: profile.id,
            status: defaultStatus,
            discount: actualDiscount,
            total_amount: total,
            final_amount: finalAmount,
            note: form.note,
            source_id: form.source_id || null,
          }).select().single()
          if (!e) { orderData = d as { id: string }; insertError = null; break }
          if (e.code === '23505') { seq++; insertError = e; continue } // unique violation → thử số tiếp theo
          throw e
        }
        if (insertError) throw insertError
        const newId = orderData!.id
        if (form.items.length > 0) {
          const { error: ie } = await supabase.from('order_items').insert(
            form.items.map((item) => ({
              order_id: newId,
              product_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount: item.discount,
              subtotal: item.subtotal,
            }))
          )
          if (ie) throw ie
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['pending-qty-by-product'] })
      queryClient.invalidateQueries({ queryKey: ['reserved-qty-for-order'] })
      toast.success(editingOrder ? 'Cập nhật đơn hàng thành công' : 'Tạo đơn hàng thành công')
      onClose()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  useEffect(() => {
    if (editingOrder && isOpen) {
      setForm({
        customer_id: editingOrder.customer_id ?? '',
        source_id: editingOrder.source_id ?? '',
        note: editingOrder.note ?? '',
        discountType: 'vnd',
        discountValue: editingOrder.discount > 0 ? editingOrder.discount.toString() : '',
        extraCharge: '',
        orderStatus: editingOrder.status,
        items: (editingOrder.items ?? []).map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount: i.discount,
          subtotal: i.subtotal,
          product_name: i.product?.name ?? '',
          product_code: (i.product as any)?.product_code ?? '',
          image_url: (i.product as any)?.image_url ?? undefined,
          unit: i.product?.unit ?? '',
        })),
      })
      setShowEditCustomer(false)
    } else if (isOpen) {
      setForm({
        customer_id: prefillCustomerId ?? '', source_id: '', note: '',
        discountType: 'vnd', discountValue: '', extraCharge: '',
        items: [], orderStatus: defaultStatus,
      })
      setShowAddCustomer(false)
      setShowEditCustomer(false)
      setNewCust({ name: '', phone: '', address: '' })
      setCustomerSaved(false)
      setProductSearch('')
      setShowAllProducts(false)
    }
  }, [editingOrder, isOpen])

  function addProduct(p: Pick<Product, 'id' | 'name' | 'product_code' | 'sale_price' | 'unit' | 'quantity' | 'image_url'>) {
    const idx = form.items.findIndex((i) => i.product_id === p.id)
    if (idx >= 0) {
      const updated = [...form.items]
      updated[idx] = {
        ...updated[idx],
        quantity: updated[idx].quantity + 1,
        subtotal: (updated[idx].quantity + 1) * updated[idx].unit_price - updated[idx].discount,
      }
      setForm({ ...form, items: updated })
    } else {
      setForm({
        ...form,
        items: [...form.items, {
          product_id: p.id,
          product_name: p.name,
          product_code: p.product_code ?? '',
          image_url: p.image_url ?? undefined,
          unit: p.unit,
          quantity: 1,
          unit_price: p.sale_price,
          discount: 0,
          subtotal: p.sale_price,
        }],
      })
    }
  }

  function removeItem(index: number) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) })
  }

  function updateItem(index: number, field: 'quantity' | 'unit_price' | 'discount', value: number) {
    const updated = [...form.items]
    updated[index] = { ...updated[index], [field]: value }
    updated[index].subtotal = updated[index].quantity * updated[index].unit_price - updated[index].discount
    setForm({ ...form, items: updated })
  }

  const showProductDropdown = productSearch.length > 0 || showAllProducts
  const filteredProducts = showProductDropdown
    ? products.filter((p) => {
        if (!productSearch) return true
        const q = productSearch.toLowerCase()
        return p.name.toLowerCase().includes(q) || (p.product_code ?? '').toLowerCase().includes(q)
      })
    : []

  return (
    <>
      <Modal isOpen={isOpen} onClose={requestClose} title={editingOrder ? 'Chỉnh Sửa Đơn Hàng' : 'Tạo Đơn Hàng'} size="2xl">
        <div className="space-y-4">

          {/* ── Top 2-column: left = customer info, right = product search ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

            {/* LEFT: Khách hàng + Nguồn đơn */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Khách Hàng</label>
                <div className="flex gap-2">
                  <select
                    value={form.customer_id}
                    onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  >
                    <option value="">Khách lẻ</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setShowAddCustomer((v) => !v); setCustomerSaved(false); setShowEditCustomer(false) }}
                    title="Thêm khách hàng mới"
                    className={`px-2.5 py-2 border rounded-lg transition-colors flex-shrink-0 ${showAddCustomer ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300'}`}
                  >
                    <UserPlus size={15} />
                  </button>
                  {form.customer_id && !showAddCustomer && (
                    <button
                      type="button"
                      onClick={() => {
                        const cust = customers.find((c) => c.id === form.customer_id)
                        if (cust) setEditCust({ name: cust.name, phone: cust.phone ?? '', address: (cust as any).address ?? '' })
                        setShowEditCustomer((v) => !v)
                      }}
                      title="Sửa thông tin khách hàng"
                      className={`px-2.5 py-2 border rounded-lg transition-colors flex-shrink-0 ${showEditCustomer ? 'bg-amber-50 border-amber-300 text-amber-600' : 'border-gray-300 text-gray-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300'}`}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>

                {showEditCustomer && form.customer_id && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                    <p className="text-xs font-semibold text-amber-700">Sửa thông tin khách hàng</p>
                    <input
                      type="text"
                      value={editCust.name}
                      onChange={(e) => setEditCust({ ...editCust, name: e.target.value })}
                      placeholder="Tên khách hàng *"
                      className="w-full px-2.5 py-1.5 text-sm border border-amber-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    />
                    <input
                      type="text"
                      value={editCust.phone}
                      onChange={(e) => setEditCust({ ...editCust, phone: e.target.value })}
                      placeholder="Số điện thoại"
                      className="w-full px-2.5 py-1.5 text-sm border border-amber-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    />
                    <textarea
                      value={editCust.address}
                      onChange={(e) => setEditCust({ ...editCust, address: e.target.value })}
                      placeholder="Địa chỉ"
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-sm border border-amber-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-none"
                    />
                    <div className="flex gap-2 justify-end pt-1">
                      <button type="button" onClick={() => setShowEditCustomer(false)}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 bg-white">Hủy</button>
                      <button
                        type="button"
                        onClick={() => editCust.name.trim() && updateCustomerMutation.mutate()}
                        disabled={!editCust.name.trim() || updateCustomerMutation.isPending}
                        className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg font-medium"
                      >
                        {updateCustomerMutation.isPending ? 'Đang lưu...' : 'Lưu'}
                      </button>
                    </div>
                  </div>
                )}

                {showAddCustomer && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                    <p className="text-xs font-semibold text-blue-700">Thêm khách hàng mới</p>
                    <input
                      type="text"
                      value={newCust.name}
                      onChange={(e) => { setNewCust({ ...newCust, name: e.target.value }); setCustomerSaved(false) }}
                      placeholder="Tên khách hàng *"
                      className="w-full px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    />
                    <input
                      type="text"
                      value={newCust.phone}
                      onChange={(e) => { setNewCust({ ...newCust, phone: e.target.value }); setCustomerSaved(false) }}
                      placeholder="Số điện thoại *"
                      className={`w-full px-2.5 py-1.5 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-400 bg-white ${!newCust.phone.trim() ? 'border-red-300' : 'border-blue-200'}`}
                    />
                    <VietnamAddressSelect
                      onChange={(addr) => setNewCust((c) => ({ ...c, address: addr }))}
                      inputClassName="w-full px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    />
                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => { setShowAddCustomer(false); setNewCust({ name: '', phone: '', address: '' }); setCustomerSaved(false) }}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 bg-white"
                      >Hủy</button>
                      <button
                        type="button"
                        onClick={() => !customerSaved && newCust.name.trim() && newCust.phone.trim() && addCustomerMutation.mutate()}
                        disabled={!newCust.name.trim() || !newCust.phone.trim() || addCustomerMutation.isPending || customerSaved}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium text-white transition-colors ${
                          customerSaved
                            ? 'bg-green-600 cursor-default'
                            : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400'
                        }`}
                      >
                        {addCustomerMutation.isPending ? 'Đang lưu...' : customerSaved ? '✓ Đã Lưu' : 'Lưu'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT: Nguồn đơn + Tìm sản phẩm */}
            <div className="space-y-3">
              {/* Nguồn đơn */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">Nguồn Đơn</label>
                  {isAdmin && (
                    <button type="button" onClick={() => setIsManageSrcOpen(true)}
                      title="Quản lý nguồn đơn"
                      className="text-gray-400 hover:text-gray-600 transition-colors">
                      <Settings size={13} />
                    </button>
                  )}
                </div>
                <select
                  value={form.source_id}
                  onChange={(e) => setForm({ ...form, source_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="">— Chọn nguồn đơn —</option>
                  {orderSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Tìm sản phẩm */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tìm Sản Phẩm</label>
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => { setProductSearch(e.target.value); if (e.target.value) setShowAllProducts(false) }}
                    placeholder="Tên hoặc mã hàng..."
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAllProducts((v) => !v); setProductSearch('') }}
                  title="Xem tất cả sản phẩm"
                  className={`px-2.5 py-2 border rounded-lg transition-colors flex-shrink-0 ${showAllProducts ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-300 text-gray-500 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600'}`}
                >
                  <ChevronDown size={15} className={`transition-transform duration-200 ${showAllProducts ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {showProductDropdown && (
                <div className="border border-gray-200 rounded-lg mt-1.5 overflow-hidden shadow-sm">
                  <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                    {filteredProducts.length === 0 && (
                      <p className="px-3 py-3 text-sm text-gray-400 italic text-center">Không tìm thấy sản phẩm</p>
                    )}
                    {filteredProducts.map((p) => {
                      const alreadyInCart = form.items.some((i) => i.product_id === p.id)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addProduct(p)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors flex items-center gap-3"
                        >
                          {/* Product image */}
                          <div className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                            {p.image_url
                              ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                              : (
                                <div className="w-full h-full flex items-center justify-center text-indigo-400 text-base font-bold bg-gradient-to-br from-blue-50 to-indigo-100">
                                  {p.name.charAt(0).toUpperCase()}
                                </div>
                              )
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{p.name}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              <span className="font-mono">{p.product_code}</span>
                              {' · '}Tồn: <span className={(() => { const a = Math.max(0, p.quantity - (reservedQty[p.id] ?? 0)); return a > 0 ? 'text-green-600 font-medium' : 'text-red-500' })()}>{Math.max(0, p.quantity - (reservedQty[p.id] ?? 0))}</span>
                              {' '}{p.unit}
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-blue-600 tabular-nums">{formatCurrency(p.sale_price)}</span>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${alreadyInCart ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                            {alreadyInCart ? '✓' : '+'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {form.items.length > 0 && (
                <p className="mt-1.5 text-xs text-gray-400">{form.items.length} sản phẩm đã chọn</p>
              )}
              </div>{/* end Tìm sản phẩm */}
            </div>{/* end RIGHT column */}
          </div>{/* end 2-col grid */}

          {/* ── Items — single row ── */}
          {form.items.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {form.items.map((item, idx) => (
                <div key={item.product_id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-gray-50/60 transition-colors">
                  {/* Code + Name + Unit */}
                  <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                    <span className="text-xs font-mono font-bold text-orange-500 flex-shrink-0">{item.product_code}</span>
                    <span className="text-sm font-medium text-gray-900 truncate">{item.product_name}</span>
                    <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{item.unit}</span>
                  </div>

                  {/* Qty stepper */}
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => updateItem(idx, 'quantity', Math.max(1, item.quantity - 1))}
                      className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 font-bold text-sm leading-none"
                    >−</button>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-9 text-center text-sm border-x border-gray-200 outline-none h-6"
                      min="1"
                    />
                    <button
                      type="button"
                      onClick={() => updateItem(idx, 'quantity', item.quantity + 1)}
                      className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 font-bold text-sm leading-none"
                    >+</button>
                  </div>

                  <span className="text-gray-300 flex-shrink-0 text-xs">×</span>

                  {/* Unit price — read only */}
                  <span className="text-sm text-gray-600 tabular-nums flex-shrink-0 w-28 text-right">
                    {formatCurrency(item.unit_price)}
                  </span>

                  <span className="text-gray-300 flex-shrink-0 text-xs">=</span>

                  {/* Subtotal */}
                  <span className="font-bold text-sm text-gray-900 tabular-nums flex-shrink-0 w-28 text-right">
                    {formatCurrency(item.subtotal)}
                  </span>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Summary ── */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 text-sm">
            {/* Tổng tiền hàng */}
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Tổng tiền hàng</span>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-xs">{form.items.length} sản phẩm</span>
                <span className="font-medium tabular-nums w-32 text-right">{formatCurrency(total)}</span>
              </div>
            </div>

            {/* Giảm giá */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 flex-shrink-0">
                {form.discountType === 'final' ? 'Giá chốt' : 'Giảm giá'}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <input
                    type={form.discountType === 'percent' ? 'number' : 'text'}
                    inputMode={form.discountType !== 'percent' ? 'numeric' : undefined}
                    value={form.discountType === 'percent' ? form.discountValue : fmtThousands(form.discountValue)}
                    onChange={(e) => {
                      const raw = form.discountType === 'percent'
                        ? e.target.value
                        : e.target.value.replace(/\D/g, '')
                      setForm({ ...form, discountValue: raw })
                    }}
                    className="w-32 px-2 py-1.5 text-sm text-right outline-none"
                    min="0"
                    max={form.discountType === 'percent' ? 100 : undefined}
                    placeholder={form.discountType === 'final' ? 'Giá thu...' : '0'}
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discountType: 'vnd' })}
                    className={`px-2.5 py-1 text-xs font-semibold border-l border-gray-200 transition-colors ${form.discountType === 'vnd' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  >VND</button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discountType: 'percent' })}
                    className={`px-2.5 py-1 text-xs font-semibold border-l border-gray-200 transition-colors ${form.discountType === 'percent' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  >%</button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discountType: 'final' })}
                    className={`px-2.5 py-1 text-xs font-semibold border-l border-gray-200 transition-colors ${form.discountType === 'final' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                    title="Nhập giá thu cuối — hệ thống tự tính giảm giá"
                  >Giá Chốt</button>
                </div>
                <span className={`font-medium tabular-nums w-32 text-right ${actualDiscount > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {form.discountType === 'final' && discountNum > 0
                    ? actualDiscount > 0 ? `-${formatCurrency(actualDiscount)}` : '0 đ'
                    : actualDiscount > 0 ? `-${formatCurrency(actualDiscount)}` : '0 đ'}
                </span>
              </div>
            </div>

            {/* Discount label hint */}
            {actualDiscount > 0 && total > 0 && (
              <p className="text-right text-xs text-orange-500 font-semibold -mt-1">
                CK: {((actualDiscount / total) * 100).toFixed(1)}%
                {form.discountType === 'percent' && ` · -${formatCurrency(actualDiscount)}`}
              </p>
            )}

            {/* Thu thêm */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 flex-shrink-0">Thu Thêm</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={fmtThousands(form.extraCharge)}
                  onChange={(e) => setForm({ ...form, extraCharge: e.target.value.replace(/\D/g, '') })}
                  className="w-32 text-right px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none bg-white"
                  placeholder="0"
                />
                <span className="font-medium tabular-nums w-32 text-right text-gray-700">
                  {formatCurrency(extraChargeNum)}
                </span>
              </div>
            </div>

            {/* Khách cần trả */}
            <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
              <span className="font-semibold text-gray-800">Khách cần trả</span>
              <span className="text-xl font-bold text-blue-600 tabular-nums">{formatCurrency(finalAmount)}</span>
            </div>
          </div>

          {/* ── Note ── */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú Đơn</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm"
            />
          </div>

          {/* ── Trạng thái (chỉ nhân viên chỉnh đơn nháp) ── */}
          {isEmployee && editingOrder?.status === 'draft' && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-600 flex-shrink-0">Trạng thái đơn</span>
              <select
                value={form.orderStatus}
                onChange={(e) => setForm({ ...form, orderStatus: e.target.value as OrderStatus })}
                className="px-3 py-1.5 border border-blue-200 rounded-lg text-sm outline-none bg-white focus:ring-2 focus:ring-blue-400"
              >
                <option value="draft">Đơn Nháp</option>
                <option value="placed">Đặt Đơn</option>
              </select>
              {form.orderStatus === 'placed' && (
                <span className="text-xs text-blue-600 font-medium">Đơn sẽ được gửi đi sau khi lưu</span>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={requestClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || form.items.length === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
            >
              {saveMutation.isPending ? 'Đang lưu...' : editingOrder ? 'Lưu Đơn' : isEmployee ? 'Lưu Nháp' : 'Lưu Đơn'}
            </button>
          </div>
        </div>
      </Modal>
      <ManageOrderSourcesModal isOpen={isManageSrcOpen} onClose={() => setIsManageSrcOpen(false)} />
      <ConfirmDialog
        isOpen={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        onConfirm={() => { setConfirmCloseOpen(false); onClose() }}
        title="Thoát không lưu?"
        message="Đơn hàng đang tạo chưa được lưu. Bạn có chắc muốn thoát không?"
        confirmLabel="Thoát"
      />
    </>
  )
}

// ── Order Detail Modal ────────────────────────────────────────────────────────

function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const items = order.items ?? []
  const notes = order.notes ?? []
  const carrier = CARRIERS.find((c) => c.value === order.shipping_carrier)

  return (
    <Modal isOpen onClose={onClose} title={`Chi Tiết Đơn — ${order.order_number}`} size="xl">
      <div className="space-y-5 text-sm">

        {/* ── Row 1: Trạng thái + Ngày ── */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={order.status} />
          <span className="text-gray-400 text-xs">Tạo: {formatDate(order.created_at)}</span>
          {order.updated_at !== order.created_at && (
            <span className="text-gray-400 text-xs">Cập nhật: {formatDate(order.updated_at)}</span>
          )}
          {order.source?.name && (
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
              {order.source.name}
            </span>
          )}
        </div>

        {/* ── Row 2: Khách hàng + Sale ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-1.5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Khách Hàng</p>
            <p className="font-semibold text-gray-900 text-base">{order.customer?.name ?? 'Khách lẻ'}</p>
            {order.customer?.phone && (
              <p className="text-orange-500 font-medium">{order.customer.phone}</p>
            )}
            {order.customer?.address && (
              <p className="text-gray-500 text-xs leading-relaxed">{order.customer.address}</p>
            )}
          </div>
          <div className="bg-gray-50 rounded-xl p-4 space-y-1.5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Thông Tin Đơn</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Nhân viên sale</span>
              <span className="font-semibold text-blue-600">{order.employee?.full_name ?? '—'}</span>
            </div>
            {carrier && order.shipping_carrier && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Vận chuyển</span>
                <span className="font-medium text-orange-500">{carrier.label}</span>
              </div>
            )}
            {order.shipping_code && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Mã vận đơn</span>
                <span className="font-mono text-orange-400">{order.shipping_code}</span>
              </div>
            )}
            {order.note && (
              <div className="pt-1 border-t border-gray-200 mt-1">
                <span className="text-gray-500 text-xs">Ghi chú:</span>
                <p className="text-gray-700 text-xs mt-0.5 italic">{order.note}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Sản phẩm ── */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Sản Phẩm ({items.length})</p>
          {items.length === 0 ? (
            <p className="text-gray-300 italic text-xs">Chưa có sản phẩm</p>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Sản phẩm</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600 w-16">SL</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600 w-28">Đơn giá</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600 w-28">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2.5">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          {(item.product as Record<string, unknown>)?.product_code && (
                            <span className="font-mono font-bold text-orange-500 text-[11px]">
                              {(item.product as Record<string, unknown>).product_code as string}
                            </span>
                          )}
                          <p className="font-semibold text-gray-900">{item.product?.name ?? '—'}</p>
                        </div>
                        {item.product?.unit && (
                          <p className="text-gray-400 mt-0.5">{item.product.unit}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-bold tabular-nums ${((item.product as Record<string, unknown>)?.quantity as number | undefined) !== undefined && item.quantity > ((item.product as Record<string, unknown>).quantity as number) ? 'text-red-600' : 'text-blue-600'}`}>
                          {item.quantity}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{formatCurrency(item.unit_price)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{formatCurrency(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Tổng kết ── */}
        <div className="bg-blue-50 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Tổng tiền hàng</span>
            <span className="tabular-nums font-medium text-gray-700">{formatCurrency(order.total_amount)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">
                Giảm giá
                {order.total_amount > 0 && (
                  <span className="ml-1.5 text-red-400 font-semibold">
                    CK: {((order.discount / order.total_amount) * 100).toFixed(1)}%
                  </span>
                )}
              </span>
              <span className="tabular-nums text-red-500 font-semibold">-{formatCurrency(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-blue-200 pt-2 mt-1">
            <span className="font-bold text-gray-800">Khách cần trả</span>
            <span className="font-bold text-xl text-blue-600 tabular-nums">{formatCurrency(order.final_amount)}</span>
          </div>
        </div>

        {/* ── Ghi chú ── */}
        {notes.length > 0 && (
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Lịch Sử Ghi Chú</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="flex gap-2 text-xs">
                  <span className="font-semibold text-indigo-600 flex-shrink-0">{n.profile?.full_name ?? 'NV'}:</span>
                  <span className="text-gray-700">{n.content}</span>
                  <span className="text-gray-300 ml-auto flex-shrink-0 whitespace-nowrap">{formatDate(n.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Đóng</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Delivery Note — Store settings (localStorage) ────────────────────────────

interface StoreConfig {
  name: string; phone: string; address: string
  logoText: string; logoColor: string
  bankHolder: string; bankName: string; bankAccount: string; bankBin: string
  qrImageUrl: string
}

const BANKS_VN = [
  { bin: '970436', name: 'Vietcombank' }, { bin: '970418', name: 'BIDV' },
  { bin: '970407', name: 'Techcombank' }, { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },         { bin: '970415', name: 'VietinBank' },
  { bin: '970403', name: 'Sacombank' },   { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },      { bin: '970443', name: 'SHB' },
  { bin: '970405', name: 'Agribank' },    { bin: '970414', name: 'OceanBank' },
]

const DEFAULT_CONFIG: StoreConfig = {
  name: 'Cửa Hàng', phone: '', address: '',
  logoText: 'KA', logoColor: '#f59e0b',
  bankHolder: '', bankName: '', bankAccount: '', bankBin: '970436',
  qrImageUrl: '',
}

function loadStoreConfig(): StoreConfig {
  try { const s = localStorage.getItem('crm_store_cfg'); return s ? { ...DEFAULT_CONFIG, ...JSON.parse(s) } : DEFAULT_CONFIG }
  catch { return DEFAULT_CONFIG }
}
function saveStoreConfig(c: StoreConfig) { try { localStorage.setItem('crm_store_cfg', JSON.stringify(c)) } catch { /* quota exceeded */ } }

function hexSVG(text: string, color: string, size: number) {
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#f59e0b'
  const t = text.slice(0, 2).toUpperCase().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><polygon points="50,3 95,26 95,74 50,97 5,74 5,26" fill="${safeColor}"/><text x="50" y="65" text-anchor="middle" fill="white" font-size="32" font-weight="bold" font-family="Arial,sans-serif">${t}</text></svg>`
}

// ── Delivery Note Modal ───────────────────────────────────────────────────────

function DeliveryNoteModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const items = order.items ?? []
  const carrier = CARRIERS.find((c) => c.value === order.shipping_carrier)
  const [cfg, setCfg] = useState<StoreConfig>(loadStoreConfig)
  const [showSettings, setShowSettings] = useState(false)
  const [editCfg, setEditCfg] = useState<StoreConfig>(cfg)

  function saveSettings() {
    saveStoreConfig(editCfg)
    setCfg(editCfg)
    setShowSettings(false)
  }

  const qrUrl = cfg.qrImageUrl || (cfg.bankAccount && cfg.bankBin
    ? `https://img.vietqr.io/image/${cfg.bankBin}-${cfg.bankAccount}-compact2.jpg?amount=${order.final_amount}&addInfo=${encodeURIComponent(order.order_number)}&accountName=${encodeURIComponent(cfg.bankHolder || cfg.name)}`
    : '')

  function handlePrint() {
    const rows = items.map((item, i) => `
      <tr>
        <td style="border:1px solid #ccc;padding:6px 10px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #ccc;padding:6px 10px">${item.product?.name ?? '—'}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;text-align:center">${item.quantity}</td>
      </tr>`).join('')

    const bankSection = cfg.bankHolder ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:28px;gap:16px">
        <div>
          <p style="font-weight:bold;font-size:13px">Thông Tin Chuyển Khoản</p>
          <p style="margin-top:4px;font-weight:bold">${cfg.bankHolder}</p>
          <p>Ngân Hàng: ${cfg.bankName || (BANKS_VN.find(b => b.bin === cfg.bankBin)?.name ?? '')}</p>
          <p>STK: ${cfg.bankAccount}</p>
        </div>
        ${qrUrl ? `<img src="${qrUrl}" alt="QR" style="width:360px;height:360px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'"/>` : ''}
      </div>` : ''

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>Phiếu Giao Hàng - ${order.order_number}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:13px;padding:28px;color:#111;max-width:720px;margin:0 auto}
        p{margin:3px 0;line-height:1.6}
        strong{font-weight:bold}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th{border:1px solid #ccc;padding:7px 10px;background:#f3f4f6;font-weight:bold}
        td{border:1px solid #ccc;padding:6px 10px}
        @media print{body{padding:0}}
      </style>
    </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        ${hexSVG(cfg.logoText, cfg.logoColor, 70)}
        <div style="text-align:right">
          <p style="font-size:17px;font-weight:bold">PHIẾU GIAO HÀNG</p>
          <p style="color:#555;margin-top:4px">Mã hóa đơn: <strong>${order.order_number}</strong></p>
          <p style="color:#555">Ngày: ${new Date(order.created_at).toLocaleString('vi-VN')}</p>
        </div>
      </div>
      <p style="margin-bottom:10px"><strong>Người gửi:</strong> ${cfg.name}${cfg.phone ? ' - ' + cfg.phone : ''}</p>
      ${cfg.address ? `<p style="margin-left:16px;color:#555;margin-bottom:10px">${cfg.address}</p>` : ''}
      <p style="margin-bottom:4px"><strong>Người nhận:</strong> ${order.customer?.name ?? 'Khách lẻ'}${order.customer?.phone ? ' - ' + order.customer.phone : ''}</p>
      ${order.customer?.address ? `<p style="margin-left:16px;color:#555;margin-bottom:10px">${order.customer.address}</p>` : ''}
      <p style="margin-bottom:14px"><strong>Tổng thu người nhận: <span style="color:#d97706;font-size:17px">${order.final_amount.toLocaleString('vi-VN')} VND</span></strong></p>
      <p style="margin-bottom:14px">Lưu ý khi giao hàng:&nbsp;${order.note ?? '............................................................'}</p>
      <p style="margin-bottom:6px"><strong>Tổng số sản phẩm: ${items.length}</strong></p>
      <table>
        <thead><tr>
          <th style="width:44px;text-align:center">STT</th>
          <th style="text-align:left">Tên hàng</th>
          <th style="width:44px;text-align:center">SL</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${bankSection}
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`

    const w = window.open('', '_blank', 'width=820,height=1100')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  return (
    <Modal isOpen onClose={onClose} title="Phiếu Giao Hàng" size="xl">
      <div className="space-y-4">
        {/* Settings toggle */}
        <div className="flex justify-end">
          <button onClick={() => { setEditCfg(cfg); setShowSettings((v) => !v) }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50">
            <Settings size={12} /> Cấu hình cửa hàng
          </button>
        </div>

        {/* Settings form */}
        {showSettings && (
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/40 space-y-3">
            <p className="text-sm font-semibold text-blue-800">Thông Tin Cửa Hàng & Ngân Hàng</p>
            <div className="grid grid-cols-2 gap-2">
              {([['Tên cửa hàng', 'name'], ['SĐT cửa hàng', 'phone'], ['Địa chỉ cửa hàng', 'address'],
                 ['Chữ logo (2 ký tự)', 'logoText']] as [string, keyof StoreConfig][]).map(([label, key]) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 block mb-0.5">{label}</label>
                  <input value={editCfg[key] as string} onChange={(e) => setEditCfg({ ...editCfg, [key]: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-600 block mb-0.5">Màu logo</label>
                <input type="color" value={editCfg.logoColor} onChange={(e) => setEditCfg({ ...editCfg, logoColor: e.target.value })}
                  className="w-full h-9 border border-gray-300 rounded-lg cursor-pointer" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-blue-200">
              <div>
                <label className="text-xs text-gray-600 block mb-0.5">Ngân hàng</label>
                <select value={editCfg.bankBin} onChange={(e) => setEditCfg({ ...editCfg, bankBin: e.target.value, bankName: BANKS_VN.find(b => b.bin === e.target.value)?.name ?? '' })}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none">
                  {BANKS_VN.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-0.5">Số tài khoản</label>
                <input value={editCfg.bankAccount} onChange={(e) => setEditCfg({ ...editCfg, bankAccount: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400" placeholder="105.856.4623" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-600 block mb-0.5">Chủ tài khoản</label>
                <input value={editCfg.bankHolder} onChange={(e) => setEditCfg({ ...editCfg, bankHolder: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400" placeholder="NGUYEN THI HIEN" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-600 block mb-1">Mã QR thật (tải ảnh lên)</label>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium">
                    Chọn ảnh QR
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = (ev) => setEditCfg({ ...editCfg, qrImageUrl: ev.target?.result as string })
                      reader.readAsDataURL(file)
                    }} />
                  </label>
                  {editCfg.qrImageUrl && (
                    <>
                      <img src={editCfg.qrImageUrl} alt="QR preview" className="w-14 h-14 object-contain border border-gray-200 rounded" />
                      <button onClick={() => setEditCfg({ ...editCfg, qrImageUrl: '' })}
                        className="text-xs text-red-500 hover:text-red-700">Xóa</button>
                    </>
                  )}
                  {!editCfg.qrImageUrl && <span className="text-xs text-gray-400">Chưa có ảnh — sẽ dùng QR tự động</span>}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Hủy</button>
              <button onClick={saveSettings} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">Lưu</button>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="border border-gray-200 rounded-xl p-6 bg-white text-sm space-y-3">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div dangerouslySetInnerHTML={{ __html: hexSVG(cfg.logoText, cfg.logoColor, 60) }} />
            <div className="text-right">
              <p className="font-bold text-base">PHIẾU GIAO HÀNG</p>
              <p className="text-gray-500 text-xs mt-1">Mã hóa đơn: <strong className="text-gray-800">{order.order_number}</strong></p>
              <p className="text-gray-500 text-xs">Ngày: {new Date(order.created_at).toLocaleString('vi-VN')}</p>
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <p><strong>Người gửi:</strong> {cfg.name}{cfg.phone ? ` - ${cfg.phone}` : ''}</p>
            {cfg.address && <p className="ml-4 text-gray-500">{cfg.address}</p>}
            <p><strong>Người nhận:</strong> {order.customer?.name ?? 'Khách lẻ'}{order.customer?.phone ? ` - ${order.customer.phone}` : ''}</p>
            {order.customer?.address && <p className="ml-4 text-gray-500">{order.customer.address}</p>}
            <p className="font-bold pt-1">Tổng thu người nhận: <span className="text-amber-600 text-sm">{order.final_amount.toLocaleString('vi-VN')} VND</span></p>
            <p>Lưu ý khi giao hàng: {order.note ?? '....................................'}</p>
            <p><strong>Tổng số sản phẩm: {items.length}</strong></p>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-300 px-3 py-2 text-center w-10">STT</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Tên hàng</th>
                <th className="border border-gray-300 px-3 py-2 text-center w-12">SL</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id}>
                  <td className="border border-gray-300 px-3 py-1.5 text-center">{i + 1}</td>
                  <td className="border border-gray-300 px-3 py-1.5">{item.product?.name ?? '—'}</td>
                  <td className="border border-gray-300 px-3 py-1.5 text-center font-medium">{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Bank + QR */}
          {cfg.bankHolder && (
            <div className="flex justify-between items-center pt-2 border-t border-gray-100 gap-4">
              <div className="text-xs space-y-0.5">
                <p className="font-bold text-sm">Thông Tin Chuyển Khoản</p>
                <p className="font-bold">{cfg.bankHolder}</p>
                <p>Ngân Hàng: {cfg.bankName || BANKS_VN.find((b) => b.bin === cfg.bankBin)?.name}</p>
                <p>STK: {cfg.bankAccount}</p>
              </div>
              {qrUrl && (
                <img src={qrUrl} alt="VietQR" className="object-contain rounded-lg flex-shrink-0"
                  style={{ width: '336px', height: '336px' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Đóng</button>
          <button onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
            <Printer size={15} /> In Phiếu
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Export Order Modal (barcode scan) ────────────────────────────────────────

interface ScanItem {
  orderItemId: string
  productId: string
  productName: string
  qty: number
  unit: string
  productCostPrice: number
  barcodes: { psId: string; barcode: string; supplierId: string; supplierName: string; stock: number; costPrice: number }[]
  confirmedPsId: string | null
  stockError: string
}

function ExportOrderModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const [items, setItems] = useState<ScanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scanInput, setScanInput] = useState('')
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: fullOrder } = await supabase
        .from('orders')
        .select('*, items:order_items(*, product:products(name, unit, cost_price))')
        .eq('id', order.id).single()
      const orderItems = ((fullOrder as any)?.items ?? []) as Array<{
        id: string; product_id: string; quantity: number
        product?: { name: string; unit: string; cost_price?: number }
      }>
      const productIds = [...new Set(orderItems.map((i) => i.product_id))]
      const { data: psList } = await supabase
        .from('product_suppliers').select('*, supplier:suppliers(*)').in('product_id', productIds)
      const ps = (psList ?? []) as ProductSupplier[]

      setItems(orderItems.map((item) => ({
        orderItemId: item.id,
        productId: item.product_id,
        productName: item.product?.name ?? 'SP',
        qty: item.quantity,
        unit: item.product?.unit ?? 'cái',
        productCostPrice: item.product?.cost_price ?? 0,
        barcodes: ps
          .filter((p) => p.product_id === item.product_id)
          .map((p) => ({
            psId: p.id,
            barcode: p.barcode,
            supplierId: p.supplier_id,
            supplierName: (p.supplier as any)?.name ?? 'NCC',
            stock: p.quantity,
            costPrice: p.cost_price,
          })),
        confirmedPsId: null,
        stockError: '',
      })))
      setLoading(false)
    }
    load()
  }, [order.id])

  useEffect(() => {
    if (!loading) setTimeout(() => inputRef.current?.focus(), 100)
  }, [loading])

  function handleScan(code: string) {
    const trimmed = code.trim()
    setScanInput('')
    if (!trimmed) return

    let matched = false
    setItems((prev) => {
      const next = prev.map((item) => {
        if (item.confirmedPsId) return item          // already done
        const ps = item.barcodes.find((b) => b.barcode === trimmed)
        if (!ps) return item
        matched = true
        if (ps.stock < item.qty) {
          setScanMsg({ ok: false, text: `${item.productName}: tồn kho không đủ (còn ${ps.stock}, cần ${item.qty})` })
          return { ...item, stockError: `Không đủ hàng: còn ${ps.stock} ${item.unit}` }
        }
        setScanMsg({ ok: true, text: `✓ ${item.productName} — ${ps.supplierName}` })
        return { ...item, confirmedPsId: ps.psId, stockError: '' }
      })
      return next
    })

    if (!matched) setScanMsg({ ok: false, text: 'Mã vạch không khớp với sản phẩm nào trong đơn' })
    setTimeout(() => { setScanMsg(null); inputRef.current?.focus() }, 2500)
  }

  // Walk FIFO batches for a product, deduct remaining_qty, return weighted cost per unit
  async function computeAndDeductFifoCost(productId: string, quantity: number, fallbackPrice: number): Promise<number> {
    const { data: batches } = await supabase
      .from('product_batches')
      .select('id, import_price, remaining_qty')
      .eq('product_id', productId)
      .order('import_date', { ascending: true })
      .order('created_at', { ascending: true })

    const available = ((batches ?? []) as { id: string; import_price: number; remaining_qty: number }[])
      .filter((b) => b.remaining_qty > 0)

    if (available.length === 0) return fallbackPrice  // no batch data yet

    let remaining = quantity
    let totalCost = 0

    for (const batch of available) {
      if (remaining <= 0) break
      const take = Math.min(remaining, batch.remaining_qty)
      totalCost += take * batch.import_price
      remaining -= take
      await supabase.from('product_batches')
        .update({ remaining_qty: batch.remaining_qty - take })
        .eq('id', batch.id)
    }

    // Batches exhausted before covering all units → use last batch price
    if (remaining > 0) {
      totalCost += remaining * available[available.length - 1].import_price
    }

    return quantity > 0 ? Math.round(totalCost / quantity) : fallbackPrice
  }

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not authenticated')
      for (const item of items) {
        if (!item.confirmedPsId) {
          // Sản phẩm không có NCC — ghi xuất theo giá vốn sản phẩm, không trừ tồn NCC
          if (item.barcodes.length === 0) {
            const fifoCost = await computeAndDeductFifoCost(item.productId, item.qty, item.productCostPrice)
            await supabase.from('inventory_transactions').insert({
              product_id: item.productId,
              supplier_id: null,
              type: 'export',
              quantity: item.qty,
              unit_price: fifoCost,
              note: `Xuất theo đơn ${order.order_number}`,
              created_by: profile.id,
            })
            await supabase.from('order_items').update({ cost_price: fifoCost }).eq('id', item.orderItemId)
          }
          continue
        }
        const ps = item.barcodes.find((b) => b.psId === item.confirmedPsId)
        if (!ps) continue
        const fifoCost = await computeAndDeductFifoCost(item.productId, item.qty, ps.costPrice)
        await supabase.from('order_items').update({ supplier_id: ps.supplierId, cost_price: fifoCost }).eq('id', item.orderItemId)
        // Đọc lại tồn kho hiện tại từ DB (tránh dùng giá trị cũ từ lúc mở modal)
        const { data: freshPs } = await supabase.from('product_suppliers').select('quantity').eq('id', item.confirmedPsId).single()
        const currentStock = freshPs?.quantity ?? ps.stock
        await supabase.from('product_suppliers').update({ quantity: Math.max(0, currentStock - item.qty) }).eq('id', item.confirmedPsId)
        await supabase.from('inventory_transactions').insert({
          product_id: item.productId,
          supplier_id: ps.supplierId,
          type: 'export',
          quantity: item.qty,
          unit_price: fifoCost,
          note: `Xuất theo đơn ${order.order_number}`,
          created_by: profile.id,
        })
      }
      await supabase.from('orders').update({ status: 'packing' }).eq('id', order.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['pending-qty-by-product'] })
      queryClient.invalidateQueries({ queryKey: ['reserved-qty-for-order'] })
      toast.success('Xuất kho thành công! Đơn chuyển sang Đang Đóng Gói.')
      onDone()
    },
    onError: () => toast.error('Có lỗi xảy ra khi xuất kho'),
  })

  const allScanned = items.length > 0 &&
    items.every((item) => item.confirmedPsId !== null || item.barcodes.length === 0)

  const confirmedCount = items.filter((i) => i.confirmedPsId).length
  const totalRequired = items.filter((i) => i.barcodes.length > 0).length

  return (
    <Modal isOpen onClose={onClose} title="Xác Nhận Xuất Kho" size="lg">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">Đơn hàng {order.order_number}</p>
            <p className="text-amber-700">Bắn mã vạch từng sản phẩm để xác nhận xuất kho. Sản phẩm chưa có NCC sẽ tự động bỏ qua.</p>
          </div>
        </div>

        {/* Scan input */}
        {!loading && (
          <div className="space-y-2">
            <div className="relative">
              <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleScan(scanInput) }}
                placeholder="Bắn hoặc nhập mã vạch sản phẩm rồi Enter..."
                className="w-full pl-10 pr-4 py-3 border-2 border-blue-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm font-mono bg-blue-50/40"
                autoFocus
              />
              {totalRequired > 0 && (
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${confirmedCount === totalRequired ? 'text-green-600' : 'text-gray-400'}`}>
                  {confirmedCount}/{totalRequired} sp
                </span>
              )}
            </div>

            {/* Scan result message */}
            {scanMsg && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${
                scanMsg.ok
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {scanMsg.ok
                  ? <CheckCircle size={15} className="flex-shrink-0" />
                  : <AlertTriangle size={15} className="flex-shrink-0" />
                }
                {scanMsg.text}
              </div>
            )}
          </div>
        )}

        {/* Product list */}
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const confirmed = !!item.confirmedPsId
              const noBarcodes = item.barcodes.length === 0
              const confirmedPs = item.barcodes.find((b) => b.psId === item.confirmedPsId)
              return (
                <div
                  key={item.orderItemId}
                  className={`rounded-xl border-2 p-3.5 transition-all ${
                    confirmed ? 'border-green-300 bg-green-50'
                    : item.stockError ? 'border-red-200 bg-red-50'
                    : noBarcodes ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{item.productName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Số lượng: <strong>{item.qty} {item.unit}</strong>
                        {confirmed && confirmedPs && (
                          <span className="ml-2 text-green-700">· NCC: {confirmedPs.supplierName} · Tồn: {confirmedPs.stock}</span>
                        )}
                        {noBarcodes && <span className="ml-2 text-amber-600">· Chưa có mã vạch</span>}
                        {item.stockError && <span className="ml-2 text-red-600">· {item.stockError}</span>}
                      </p>

                      {/* Danh sách mã vạch cần quét (chỉ hiện thông tin, không bấm được) */}
                      {!confirmed && !noBarcodes && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.barcodes.map((b) => (
                            <span
                              key={b.psId}
                              className={`text-[11px] px-2 py-1 rounded-lg border font-mono ${
                                b.stock < item.qty
                                  ? 'border-red-200 bg-red-50 text-red-400'
                                  : 'border-gray-200 bg-gray-50 text-gray-500'
                              }`}
                            >
                              {b.barcode}
                              <span className="font-sans ml-1 text-gray-400">· {b.supplierName} · Tồn: {b.stock}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex-shrink-0">
                      {confirmed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white text-xs font-bold rounded-lg">
                          <CheckCircle size={12} /> Đã quét
                        </span>
                      ) : noBarcodes ? (
                        <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-lg font-medium">Bỏ qua</span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded-lg font-medium">
                          Chờ quét
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={!allScanned || confirmMutation.isPending || loading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg text-sm font-medium"
          >
            <CheckCircle size={16} />
            {confirmMutation.isPending ? 'Đang xử lý...' : allScanned ? 'Xác Nhận Xuất Kho' : `Chờ quét (${confirmedCount}/${totalRequired})`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const { profile, isAdmin, isAccountant, isWarehouse, isEmployee } = useAuth()
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [exportingOrder, setExportingOrder] = useState<Order | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [prefillCustomerId, setPrefillCustomerId] = useState<string | undefined>(undefined)
  const [quickOrderCustomer, setQuickOrderCustomer] = useState<{ id: string; name: string; phone?: string } | null>(null)
  const [printingOrder, setPrintingOrder] = useState<Order | null>(null)
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [employeeFilter, setEmployeeFilter] = useState<string>('all')
  const [revealedCostOrders, setRevealedCostOrders] = useState<Set<string>>(new Set())
  const [revealedProfit, setRevealedProfit] = useState(false)
  const [revertingOrder, setRevertingOrder] = useState<Order | null>(null)
  const [returningOrder, setReturningOrder] = useState<Order | null>(null)

  const canEdit = isAdmin || isAccountant || isWarehouse
  const navigate = useNavigate()
  const { addPendingOrder } = useRoutePlanningStore()

  const revertExportMutation = useMutation({
    mutationFn: async (order: Order) => {
      // 1. Tìm các phiếu xuất kho của đơn này
      const { data: txs } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('type', 'export')
        .eq('note', `Xuất theo đơn ${order.order_number}`)
      const transactions = (txs ?? []) as InventoryTransaction[]

      // 2. Hoàn trả số lượng về product_suppliers
      for (const tx of transactions) {
        if (tx.supplier_id && tx.product_id) {
          const { data: psList } = await supabase
            .from('product_suppliers')
            .select('id, quantity')
            .eq('product_id', tx.product_id)
            .eq('supplier_id', tx.supplier_id)
          if (psList && psList.length > 0) {
            const ps = psList[0] as { id: string; quantity: number }
            await supabase
              .from('product_suppliers')
              .update({ quantity: ps.quantity + tx.quantity })
              .eq('id', ps.id)
          }
        }
      }

      // 3. Xóa các phiếu xuất kho
      for (const tx of transactions) {
        await supabase.from('inventory_transactions').delete().eq('id', tx.id)
      }

      // 4. Xóa supplier_id + cost_price khỏi order_items, hoàn trả remaining_qty về product_batches
      const { data: orderItemsData } = await supabase
        .from('order_items').select('product_id, quantity, cost_price').eq('order_id', order.id)
      const orderItems = (orderItemsData ?? []) as { product_id: string; quantity: number; cost_price: number | null }[]

      // Restore FIFO batches: hoàn trả theo cùng thứ tự FIFO (oldest first, khớp với lúc xuất)
      for (const oi of orderItems) {
        if (!oi.cost_price || !oi.quantity) continue
        const { data: batchData } = await supabase
          .from('product_batches').select('id, remaining_qty, quantity')
          .eq('product_id', oi.product_id)
          .order('import_date', { ascending: true })
          .order('created_at', { ascending: true })
        const batches = (batchData ?? []) as { id: string; remaining_qty: number; quantity: number }[]
        let toRestore = oi.quantity
        for (const b of batches) {
          if (toRestore <= 0) break
          const canRestore = Math.min(toRestore, b.quantity - b.remaining_qty)
          if (canRestore <= 0) continue
          await supabase.from('product_batches').update({ remaining_qty: b.remaining_qty + canRestore }).eq('id', b.id)
          toRestore -= canRestore
        }
        if (toRestore > 0) {
          toast.error(`Hoàn kho không đủ: còn thiếu ${toRestore} đơn vị chưa được hoàn lại vào kho`)
        }
      }

      await supabase.from('order_items').update({ supplier_id: null, cost_price: null }).eq('order_id', order.id)

      // 5. Đổi trạng thái đơn về Nháp
      await supabase.from('orders').update({ status: 'draft' }).eq('id', order.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] })
      toast.success('Đã hủy xuất kho. Đơn chuyển về Đơn Nháp để sale chỉnh sửa.')
      setRevertingOrder(null)
    },
    onError: () => toast.error('Có lỗi khi hủy xuất kho'),
  })

  const { data: routeOrdersData = [] } = useQuery({
    queryKey: ['route-orders-map'],
    queryFn: async () => {
      const { data } = await supabase
        .from('route_orders')
        .select('order_id, route_id, route:routes(name)')
      return (data ?? []) as { order_id: string; route_id: string; route: { name: string } | null }[]
    },
    enabled: canEdit,
  })

  const orderRouteMap = useMemo(() => new Map(
    routeOrdersData.map((r) => [r.order_id, { route_id: r.route_id, route_name: r.route?.name ?? '' }])
  ), [routeOrdersData])

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders', profile?.id, isAdmin, isAccountant],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*, customer:customers(name, phone, address), employee:profiles(full_name), items:order_items(*, product:products(name, product_code, unit, quantity, cost_price)), notes:order_notes(*, profile:profiles(full_name)), source:order_sources(name), return_tickets(*)')
        .order('created_at', { ascending: false })
      if (isEmployee && profile) {
        // Nhân viên: chỉ thấy đơn của mình (kể cả nháp)
        query = query.eq('employee_id', profile.id)
      } else {
        // Admin/kế toán/kho: không thấy đơn nháp
        query = query.neq('status', 'draft')
      }
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as Order[]
    },
    enabled: !!profile,
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) => {
      const { error } = await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['pending-qty-by-product'] })
      queryClient.invalidateQueries({ queryKey: ['reserved-qty-for-order'] })
      toast.success('Cập nhật trạng thái thành công')
    },
    onError: (e: Error) => toast.error(e.message || 'Không thể cập nhật trạng thái'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('order_items').delete().eq('order_id', id)
      await supabase.from('order_notes').delete().eq('order_id', id)
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Đã xóa đơn hàng')
      setDeleteId(null)
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  // Unique months available in orders (YYYY-MM), sorted descending
  const availableMonths = useMemo(() => Array.from(
    new Set(orders.map((o) => o.created_at.slice(0, 7)))
  ).sort((a, b) => b.localeCompare(a)), [orders])

  // Unique employees who have orders
  const availableEmployees = useMemo(() => Array.from(
    new Map(orders.map((o) => [o.employee_id, o.employee?.full_name ?? o.employee_id])).entries()
  ), [orders])

  const filtered = useMemo(() => orders.filter((o) => {
    const q = search.toLowerCase()
    const matchSearch = !q || o.order_number.toLowerCase().includes(q)
      || (o.customer?.name ?? '').toLowerCase().includes(q)
      || (o.customer?.phone ?? '').includes(q)
    const matchStatus = statusFilter === 'all' || o.status === statusFilter
    const matchMonth = monthFilter === 'all' || o.created_at.startsWith(monthFilter)
    const matchEmployee = employeeFilter === 'all' || o.employee_id === employeeFilter
    return matchSearch && matchStatus && matchMonth && matchEmployee
  }), [orders, search, statusFilter, monthFilter, employeeFilter])

  // Phát hiện SĐT trùng trong danh sách đang hiển thị (sau filter)
  const duplicatePhones = useMemo(() => {
    if (!canEdit) return new Set<string>()
    const phoneCount = new Map<string, number>()
    filtered.forEach((o) => {
      const p = o.customer?.phone
      if (p) {
        const norm = normalizePhone(p)
        phoneCount.set(norm, (phoneCount.get(norm) ?? 0) + 1)
      }
    })
    return new Set([...phoneCount.entries()].filter(([, c]) => c > 1).map(([p]) => p))
  }, [filtered, canEdit])

  function isDuplicatePhone(phone?: string) {
    return canEdit && !!phone && duplicatePhones.has(normalizePhone(phone))
  }

  // Group filtered orders by month for display
  type MonthGroup = { key: string; label: string; orders: Order[] }
  const groups = useMemo(() => {
    const result: MonthGroup[] = []
    for (const o of filtered) {
      const key = o.created_at.slice(0, 7)
      const last = result[result.length - 1]
      if (!last || last.key !== key) {
        const [y, m] = key.split('-')
        result.push({ key, label: `Tháng ${parseInt(m)}/${y}`, orders: [o] })
      } else {
        last.orders.push(o)
      }
    }
    return result
  }, [filtered])

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Đơn Hàng</h1>
          <p className="text-gray-500 text-sm mt-0.5">{orders.length} đơn hàng</p>
        </div>
        <button
          onClick={() => { setEditingOrder(null); setIsCreateOpen(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Tạo Đơn
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div className="mb-4">
        {/* Mobile */}
        <div className="sm:hidden flex flex-col gap-2">
          {/* Row 1: search + tháng */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm đơn, khách, SĐT..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
            </div>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
              className="px-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-[110px]">
              <option value="all">Tất cả tháng</option>
              {availableMonths.map((m) => {
                const [y, mo] = m.split('-')
                return <option key={m} value={m}>Tháng {parseInt(mo)}/{y}</option>
              })}
            </select>
          </div>
          {/* Row 2: nhân viên + trạng thái */}
          <div className="flex gap-2">
            {!isEmployee && (
              <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">Tất cả nhân viên</option>
                {availableEmployees.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">Tất Cả ({filtered.length})</option>
              {STATUS_OPTIONS.map((s) => {
                const cnt = filtered.filter((o) => o.status === s.value).length
                return <option key={s.value} value={s.value}>{s.label}{cnt > 0 ? ` (${cnt})` : ''}</option>
              })}
            </select>
          </div>
        </div>

        {/* Desktop: tất cả trên 1 dòng flex-wrap */}
        <div className="hidden sm:flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 max-w-sm flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn, tên khách, SĐT..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
          </div>
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-[140px]">
            <option value="all">Tất cả tháng</option>
            {availableMonths.map((m) => {
              const [y, mo] = m.split('-')
              return <option key={m} value={m}>Tháng {parseInt(mo)}/{y}</option>
            })}
          </select>
          {!isEmployee && (
            <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-[160px]">
              <option value="all">Tất cả nhân viên</option>
              {availableEmployees.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          <button onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            Tất Cả ({filtered.length})
          </button>
          {STATUS_OPTIONS.map((s) => {
            const cnt = filtered.filter((o) => o.status === s.value).length
            const cfg = ORDER_STATUS_CONFIG[s.value]
            return (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === s.value ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                }`}>
                {s.label}{cnt > 0 ? ` (${cnt})` : ''}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Order table ── */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <MessageSquare size={36} className="mx-auto mb-2 opacity-30" />
          <p>Không có đơn hàng nào</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Month header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-blue-400 text-white">
                <span className="font-semibold text-sm">{group.label}</span>
                <span className="text-xs text-blue-200">
                  {group.orders.length} đơn &nbsp;·&nbsp;
                  {group.orders.reduce((s, o) => s + o.final_amount, 0).toLocaleString('vi-VN')} đ
                  {isAdmin && (() => {
                    const groupProfit = group.orders.reduce((s, o) => {
                      const its = o.items ?? []
                      const cost = its.reduce((cs, item) => {
                        const cp = item.cost_price != null
                          ? item.cost_price
                          : ((item.product as Record<string, unknown>)?.cost_price as number | undefined) ?? 0
                        return cs + cp * item.quantity
                      }, 0)
                      return s + o.final_amount - cost
                    }, 0)
                    return (
                      <span className="ml-2 inline-flex items-center gap-1">
                        &nbsp;·&nbsp; LN:&nbsp;
                        <span className={revealedProfit ? (groupProfit >= 0 ? 'text-green-300' : 'text-red-300') : 'tracking-widest text-blue-300'}>
                          {revealedProfit ? `${groupProfit >= 0 ? '+' : ''}${groupProfit.toLocaleString('vi-VN')} đ` : '••••••'}
                        </span>
                        <button onClick={() => setRevealedProfit((v) => !v)} className="p-0.5 text-blue-200 hover:text-white rounded transition-colors" title={revealedProfit ? 'Ẩn lợi nhuận' : 'Hiện lợi nhuận'}>
                          {revealedProfit ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                      </span>
                    )
                  })()}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: (isAdmin || isAccountant) ? 1310 : 1150 }}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-[173px]">Mã Đơn</th>
                      <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-48">Khách Hàng</th>
                      <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-[26rem]">Sản Phẩm</th>
                      {(isAdmin || isAccountant) && (
                        <th className="px-4 py-2.5 w-[124px]"></th>
                      )}
                      <th className="text-center text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-36">Giá Tiền</th>
                      <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-44">Trạng Thái</th>
                      <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5 w-[183px]">Ghi Chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.orders.map((order) => {
                  const items: OrderItem[] = order.items ?? []
                  const canExport = canEdit && order.status === 'confirmed'
                  // Use FIFO cost_price stored at packing time when available, fall back to current product cost
                  const hasFifoCost = items.length > 0 && items.every((i) => i.cost_price != null)
                  const totalCost = canEdit ? items.reduce((s, item) => {
                    const cp = item.cost_price != null
                      ? item.cost_price
                      : ((item.product as Record<string, unknown>)?.cost_price as number | undefined) ?? 0
                    return s + cp * item.quantity
                  }, 0) : 0
                  const isBelowCost = canEdit && items.length > 0 && totalCost > 0 && order.final_amount < totalCost

                  return (
                    <tr key={order.id} className={`border-t border-dashed border-gray-200 align-top transition-colors ${isDuplicatePhone(order.customer?.phone) ? 'bg-yellow-50 hover:bg-yellow-100/70' : 'hover:bg-gray-50/60'}`}>

                      {/* Col 1: Mã đơn */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <div className="flex items-center gap-1.5">
                          <p className="font-mono font-bold text-blue-600 text-xs">{order.order_number}</p>
                          <button
                            onClick={() => setViewingOrder(order)}
                            title="Xem chi tiết đơn"
                            className="p-0.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">lúc {formatDate(order.created_at)}</p>
                        {canExport && (
                          <button onClick={() => setExportingOrder(order)}
                            className="mt-2 flex items-center gap-1 text-[11px] font-bold italic text-green-600 hover:text-green-700">
                            <Truck size={10} /> Xuất kho
                          </button>
                        )}
                        {canEdit && order.status === 'packing' && (
                          <button onClick={() => setRevertingOrder(order)}
                            className="mt-2 flex items-center gap-1 text-[11px] font-bold italic text-red-500 hover:text-red-700">
                            <X size={10} /> Hủy xuất kho
                          </button>
                        )}
                        {canEdit && order.status === 'shipping' && (
                          <button onClick={() => setPrintingOrder(order)}
                            className="mt-1 flex items-center gap-1 text-[11px] font-bold italic text-indigo-600 hover:text-indigo-700">
                            <Printer size={10} /> In phiếu giao hàng
                          </button>
                        )}
                        {canEdit && order.status === 'partial_return' && (
                          <button onClick={() => setReturningOrder(order)}
                            className="mt-1 flex items-center gap-1 text-[11px] font-bold italic text-orange-500 hover:text-orange-700">
                            <RotateCcw size={10} /> Tạo đổi trả
                          </button>
                        )}
                        {/* Hiển thị phiếu đổi trả hiện có */}
                        {!isEmployee && (order.return_tickets?.length ?? 0) > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {order.return_tickets!.map((rt) => (
                              <div key={rt.id} className="flex items-center gap-1 text-[10px] text-orange-600 font-mono bg-orange-50 rounded px-1.5 py-0.5">
                                <Receipt size={9} />
                                <span className="font-semibold">{rt.ticket_number}</span>
                                {rt.exchange_items.length > 0 && <span className="text-blue-500">↔ đổi {rt.exchange_items.length} sp</span>}
                                {rt.returned_items.length > 0 && <span className="text-red-400">↩ trả {rt.returned_items.length} sp</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {canEdit && (() => {
                          const assigned = orderRouteMap.get(order.id)
                          return (
                            <button
                              onClick={() => { addPendingOrder(order); navigate('/route-planning') }}
                              className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${assigned ? 'text-purple-600 hover:text-purple-700' : 'text-gray-400 hover:text-purple-500'}`}
                              title={assigned ? `Đang ở: ${assigned.route_name}` : 'Thêm vào Xếp Tuyến'}
                            >
                              <MapPin size={10} />
                              {assigned
                                ? <span className="max-w-[110px] truncate">{assigned.route_name}</span>
                                : 'Xếp tuyến'}
                            </button>
                          )
                        })()}
                        {!isEmployee && items.some((item) => {
                          const pQty = (item.product as Record<string, unknown>)?.quantity as number | undefined
                          return pQty !== undefined && item.quantity > pQty
                        }) && (
                          <button
                            onClick={() => navigate('/stock-call')}
                            title="Đơn này có sản phẩm thiếu hàng — xem Gọi Hàng"
                            className="mt-1 flex items-center gap-1 text-[11px] font-medium text-orange-500 hover:text-orange-700"
                          >
                            <PhoneCall size={10} /> Gọi hàng
                          </button>
                        )}
                        {(canEdit || (isEmployee && (order.status === 'draft' || order.status === 'placed'))) && (
                          <div className="flex gap-1 mt-2">
                            <button onClick={() => { setEditingOrder(order); setIsCreateOpen(true) }}
                              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                              <Pencil size={12} />
                            </button>
                            {canEdit && (
                              <button onClick={() => setDeleteId(order.id)}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors text-sm leading-none font-bold">
                                ×
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Col 2: Khách hàng */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        {order.customer_id ? (
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <p className="font-semibold text-gray-900 text-sm leading-snug">
                                {order.customer?.name ?? 'Khách lẻ'}
                              </p>
                              {order.customer?.phone && (
                                <p className={`text-xs font-medium mt-0.5 ${isDuplicatePhone(order.customer.phone) ? 'text-yellow-600' : 'text-orange-500'}`}>
                                  {order.customer.phone}
                                  {isDuplicatePhone(order.customer.phone) && <span className="ml-1">⚠</span>}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setQuickOrderCustomer({ id: order.customer_id!, name: order.customer?.name ?? '', phone: order.customer?.phone })}
                              className="flex-shrink-0 p-0.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                              title="Tạo đơn mới cho khách này"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        ) : (
                          <p className="font-semibold text-gray-900 text-sm leading-snug">Khách lẻ</p>
                        )}
                        {order.customer?.address && (
                          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{order.customer.address}</p>
                        )}
                        <div className="mt-1.5">
                          <span className="text-[10px] text-blue-600 font-medium italic">
                            Sale: {order.employee?.full_name ?? '—'}
                          </span>
                        </div>
                      </td>

                      {/* Col 3: Sản phẩm */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        {items.length === 0 ? (
                          <span className="text-xs text-gray-300 italic">Chưa có sản phẩm</span>
                        ) : (
                          <table className="w-full text-xs border-collapse">
                            <tbody>
                              {items.map((item, i) => (
                                <tr key={item.id} className={i < items.length - 1 ? 'border-b border-dashed border-green-400' : ''}>
                                  <td className="py-1 pr-1 text-gray-300 w-3 align-top">✓</td>
                                  <td className="py-1 text-gray-900 font-semibold leading-snug">{item.product?.name ?? '—'}</td>
                                  <td className={`py-1 text-right font-bold tabular-nums whitespace-nowrap pl-2 w-10 align-top ${((item.product as Record<string, unknown>)?.quantity as number | undefined) !== undefined && item.quantity > ((item.product as Record<string, unknown>).quantity as number) ? 'text-red-600' : 'text-blue-600'}`}>SL:{item.quantity}</td>
                                  <td className="py-1 text-right text-gray-600 font-medium tabular-nums whitespace-nowrap pl-2 w-28 align-top">{formatCurrency(item.unit_price)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>

                      {/* Col 4b: Giá Vốn (admin + kế toán) */}
                      {(isAdmin || isAccountant) && (() => {
                        const revealed = revealedCostOrders.has(order.id)
                        return (
                          <td className="px-4 py-3 border-r border-dashed border-gray-200 text-center align-middle">
                            {items.length > 0 ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className={`font-bold text-sm tabular-nums ${revealed ? (isBelowCost ? 'text-red-600' : 'text-gray-700') : 'text-gray-400 tracking-widest'}`}>
                                    {revealed ? totalCost.toLocaleString('vi-VN') : '••••••'}
                                  </span>
                                  <button
                                    onClick={() => setRevealedCostOrders((prev) => {
                                      const next = new Set(prev)
                                      if (revealed) next.delete(order.id)
                                      else next.add(order.id)
                                      return next
                                    })}
                                    className={`p-0.5 rounded transition-colors flex-shrink-0 ${isBelowCost ? 'text-red-500' : 'text-gray-400 hover:text-blue-500'}`}
                                    title={revealed ? 'Ẩn giá vốn' : 'Hiện giá vốn'}
                                  >
                                    {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                                  </button>
                                </div>
                                {(() => {
                                  const estProfit = order.final_amount - totalCost
                                  const estPct = totalCost > 0 ? (estProfit / totalCost) * 100 : null
                                  const profitColor = estProfit < 0 ? 'text-red-500' : estProfit === 0 ? 'text-gray-400' : 'text-green-600'
                                  return (
                                    <div className="flex flex-col items-center gap-0.5">
                                      {hasFifoCost ? (
                                        <span className="text-[9px] text-green-500 font-medium">✓ FIFO</span>
                                      ) : (
                                        <>
                                          <span className={`text-[10px] font-bold tabular-nums ${revealedProfit ? profitColor : 'text-gray-400 tracking-widest'}`}>
                                            {revealedProfit ? `LN ${estProfit >= 0 ? '+' : ''}${estProfit.toLocaleString('vi-VN')}` : '••••••'}
                                          </span>
                                          {revealedProfit && estPct !== null && (
                                            <span className={`text-[9px] font-semibold ${profitColor}`}>
                                              {estPct >= 0 ? '+' : ''}{estPct.toFixed(1)}%
                                            </span>
                                          )}
                                          {revealedProfit && <span className="text-[9px] text-gray-400">~ ước tính</span>}
                                        </>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            ) : (
                              <span className="text-gray-300 text-sm">—</span>
                            )}
                          </td>
                        )
                      })()}

                      {/* Col 4: Giá tiền */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200 text-center align-middle">
                        {items.length > 0 ? (
                          <>
                            <p className={`font-bold text-base tabular-nums ${isBelowCost ? 'text-red-600' : 'text-blue-600'}`}>
                              {order.final_amount.toLocaleString('vi-VN')}
                            </p>
                            {order.discount > 0 && order.total_amount > 0 ? (
                              <p className="text-[11px] text-red-500 font-semibold mt-0.5">
                                CK: {((order.discount / order.total_amount) * 100).toFixed(1)}%
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                      </td>

                      {/* Col 5: Trạng thái */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        {canEdit || (isEmployee && order.status === 'draft') ? (
                          <StatusSelect order={order} onUpdate={(id, s) => updateStatusMutation.mutate({ id, status: s })} />
                        ) : (
                          <StatusBadge status={order.status} block />
                        )}
                        <p className="text-[11px] text-gray-400 mt-1.5 text-center">{formatDateOnly(order.updated_at)}</p>
                        <ShippingNoteEditor order={order} canEdit={canEdit} />
                      </td>

                      {/* Col 6: Ghi chú nhân viên */}
                      <td className="px-4 py-3">
                        {/* Nguồn đơn + ghi chú đơn */}
                        {(order.source?.name || order.note) && (
                          <div className="mb-2 space-y-1">
                            {order.source?.name && (
                              <p className="text-xs text-gray-500">
                                Nguồn: <span className="font-medium text-gray-700">{order.source.name}</span>
                              </p>
                            )}
                            {order.note && (
                              <div className="text-xs leading-snug">
                                <span className="font-semibold text-indigo-600">{order.employee?.full_name ?? 'NV'}:</span>{' '}
                                <span className="text-gray-700 italic">{order.note}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <NotesCell order={order} profileId={profile?.id ?? ''} canAddNote={!!profile} />
                      </td>
                    </tr>
                  )
                })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateOrderModal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setEditingOrder(null); setPrefillCustomerId(undefined) }}
        editingOrder={editingOrder}
        prefillCustomerId={prefillCustomerId}
      />

      {/* Quick reorder popup */}
      {quickOrderCustomer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setQuickOrderCustomer(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 max-w-xs w-full border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-gray-900 text-base">{quickOrderCustomer.name}</p>
            {quickOrderCustomer.phone && (
              <p className="text-sm text-orange-500 font-medium mt-0.5">{quickOrderCustomer.phone}</p>
            )}
            <p className="text-sm text-gray-500 mt-3">Khách muốn mua thêm? Tạo đơn mới với thông tin sẵn có.</p>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setQuickOrderCustomer(null)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Đóng</button>
              <button
                onClick={() => {
                  setPrefillCustomerId(quickOrderCustomer.id)
                  setEditingOrder(null)
                  setIsCreateOpen(true)
                  setQuickOrderCustomer(null)
                }}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
              >Tạo Đơn Mới</button>
            </div>
          </div>
        </div>
      )}

      {viewingOrder && (
        <OrderDetailModal order={viewingOrder} onClose={() => setViewingOrder(null)} />
      )}

      {exportingOrder && (
        <ExportOrderModal order={exportingOrder} onClose={() => setExportingOrder(null)} onDone={() => setExportingOrder(null)} />
      )}

      <ConfirmDialog
        isOpen={!!revertingOrder}
        onClose={() => setRevertingOrder(null)}
        onConfirm={() => revertingOrder && revertExportMutation.mutate(revertingOrder)}
        loading={revertExportMutation.isPending}
        title="Hủy Xuất Kho?"
        message={`Đơn ${revertingOrder?.order_number ?? ''} sẽ chuyển về Đơn Nháp. Phiếu xuất kho bị xóa, số lượng hàng hoàn trả về tồn kho. Sale có thể chỉnh sửa lại đơn. Tiếp tục?`}
        confirmLabel="Hủy Xuất Kho & Hoàn Tồn Kho"
      />

      {printingOrder && (
        <DeliveryNoteModal order={printingOrder} onClose={() => setPrintingOrder(null)} />
      )}

      <ReturnTicketModal
        isOpen={!!returningOrder}
        onClose={() => setReturningOrder(null)}
        order={returningOrder}
      />

      <ConfirmDialog
        isOpen={!!deleteId} onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Xóa Đơn Hàng" message="Bạn có chắc muốn xóa đơn hàng này? Hành động này không thể hoàn tác."
        confirmLabel="Xóa" loading={deleteMutation.isPending}
      />

    </div>
  )
}

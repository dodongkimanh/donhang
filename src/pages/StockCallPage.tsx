import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PhoneCall, CheckCircle, X, Package, Plus, Search, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/utils/format'
import type { Order, OrderItem } from '@/types'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockCall {
  id: string
  order_id: string
  dismissed: boolean
  manually_added: boolean
  created_at: string
}

interface StockCallNote {
  id: string
  order_id: string
  content: string
  author_name: string
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOutOfStock(item: OrderItem): boolean {
  const productQty = (item.product as Record<string, unknown>)?.quantity as number | undefined
  return productQty !== undefined && item.quantity > productQty
}

function fmtNoteTime(dateStr: string): string {
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${hh}:${mm} ${dd}/${mo}/${yy}`
}

// ── Chat note cell ────────────────────────────────────────────────────────────

function NoteChat({
  orderId,
  notes,
  onSend,
  sending,
}: {
  orderId: string
  notes: StockCallNote[]
  onSend: (orderId: string, content: string) => void
  sending: boolean
}) {
  const [value, setValue] = useState('')

  function send() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(orderId, trimmed)
    setValue('')
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      {/* Messages */}
      {notes.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto pr-0.5">
          {notes.map((note) => (
            <div key={note.id}>
              <p className="text-xs leading-snug">
                <span className="font-semibold text-blue-700">{note.author_name}</span>
                <span className="text-gray-700">: {note.content}</span>
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">{fmtNoteTime(note.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus-within:ring-1 focus-within:ring-amber-400 focus-within:border-amber-300 transition-all">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="Ghi chú..."
          className="flex-1 text-xs outline-none bg-transparent placeholder:text-gray-300"
        />
        <button
          onClick={send}
          disabled={!value.trim() || sending}
          className="p-0.5 text-gray-300 hover:text-amber-500 disabled:opacity-30 transition-colors flex-shrink-0"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StockCallPage() {
  const { isAdmin, isAccountant, isWarehouse, profile } = useAuth()
  const canManage = isAdmin || isAccountant || isWarehouse
  const queryClient = useQueryClient()

  // Gọi Thêm panel state
  const [extraPanelOpen, setExtraPanelOpen] = useState(false)
  const [extraSearchNum, setExtraSearchNum] = useState('')
  const [extraFoundOrder, setExtraFoundOrder] = useState<Order | null>(null)
  const [extraSearching, setExtraSearching] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-stock-call'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customer:customers(name, phone), employee:profiles(full_name), items:order_items(*, product:products(name, product_code, unit, quantity))')
        .in('status', ['draft', 'placed', 'confirmed', 'packing', 'shipping'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Order[]
    },
  })

  const { data: stockCalls = [], isLoading: scLoading } = useQuery({
    queryKey: ['stock-calls'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_calls').select('*')
      if (error) throw error
      return (data ?? []) as StockCall[]
    },
  })

  const { data: allNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['stock-call-notes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_call_notes')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as StockCallNote[]
    },
  })

  // Group notes by order_id
  const notesByOrder = allNotes.reduce<Record<string, StockCallNote[]>>((acc, n) => {
    if (!acc[n.order_id]) acc[n.order_id] = []
    acc[n.order_id].push(n)
    return acc
  }, {})

  const dismissedIds = new Set(stockCalls.filter((sc) => sc.dismissed).map((sc) => sc.order_id))
  const manuallyAddedIds = new Set(
    stockCalls.filter((sc) => sc.manually_added && !sc.dismissed).map((sc) => sc.order_id)
  )

  // Manually-added orders (any status)
  const manualIdList = [...manuallyAddedIds]
  const { data: manualOrders = [], isLoading: manualLoading } = useQuery({
    queryKey: ['manual-stock-call-orders', manualIdList.join(',')],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, customer:customers(name, phone), employee:profiles(full_name), items:order_items(*, product:products(name, product_code, unit, quantity))')
        .in('id', manualIdList)
      return (data ?? []) as Order[]
    },
    enabled: manualIdList.length > 0,
  })

  // Auto-detected orders (out of stock, not dismissed)
  const autoOrders = orders.filter((order) => {
    if (dismissedIds.has(order.id)) return false
    return (order.items ?? []).some((item) => isOutOfStock(item))
  })
  const autoOrderIdSet = new Set(autoOrders.map((o) => o.id))

  // Manual-only orders
  const manualOnlyOrders = manualOrders.filter(
    (o) => !autoOrderIdSet.has(o.id) && !dismissedIds.has(o.id)
  )

  const allStockCallOrders = [...autoOrders, ...manualOnlyOrders]

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addNoteMutation = useMutation({
    mutationFn: async ({ orderId, content }: { orderId: string; content: string }) => {
      const { error } = await supabase.from('stock_call_notes').insert({
        order_id: orderId,
        content,
        author_name: profile?.full_name ?? 'Người dùng',
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-call-notes'] }),
    onError: () => toast.error('Không thể lưu ghi chú'),
  })

  const dismissMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('stock_calls')
        .upsert({ order_id: orderId, dismissed: true }, { onConflict: 'order_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-calls'] })
      toast.success('Đã đánh dấu đủ hàng')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const removeMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('stock_calls')
        .upsert({ order_id: orderId, dismissed: true }, { onConflict: 'order_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-calls'] })
      toast.success('Đã xóa khỏi danh sách')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const addExtraCallMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('stock_calls')
        .upsert({ order_id: orderId, dismissed: false, manually_added: true }, { onConflict: 'order_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-calls'] })
      queryClient.invalidateQueries({ queryKey: ['manual-stock-call-orders'] })
      toast.success('Đã thêm đơn vào gọi hàng')
      setExtraPanelOpen(false)
      setExtraSearchNum('')
      setExtraFoundOrder(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message
      toast.error(msg || 'Có lỗi xảy ra')
    },
  })

  // ── Gọi Thêm search ────────────────────────────────────────────────────────

  async function handleExtraSearch() {
    const num = extraSearchNum.trim().toUpperCase()
    if (!num) return
    setExtraSearching(true)
    setExtraFoundOrder(null)
    const { data } = await supabase
      .from('orders')
      .select('*, customer:customers(name, phone), employee:profiles(full_name), items:order_items(*, product:products(name, product_code, unit, quantity))')
      .eq('order_number', num)
      .maybeSingle()
    setExtraSearching(false)
    if (data) {
      setExtraFoundOrder(data as Order)
    } else {
      toast.error('Không tìm thấy mã đơn hàng')
    }
  }

  function toggleExtraPanel() {
    setExtraPanelOpen((v) => !v)
    setExtraFoundOrder(null)
    setExtraSearchNum('')
  }

  const isLoading = ordersLoading || scLoading || notesLoading || (manualIdList.length > 0 && manualLoading)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <PhoneCall size={22} className="text-orange-500" />
            Gọi Hàng
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {autoOrders.length > 0 && `${autoOrders.length} đơn thiếu hàng`}
            {autoOrders.length > 0 && manualOnlyOrders.length > 0 && ' · '}
            {manualOnlyOrders.length > 0 && `${manualOnlyOrders.length} gọi thêm`}
            {allStockCallOrders.length === 0 && !isLoading && 'Không có đơn nào cần xử lý'}
          </p>
        </div>
        <button
          onClick={toggleExtraPanel}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
            extraPanelOpen
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
          }`}
        >
          <Plus size={15} />
          Gọi Thêm
        </button>
      </div>

      {/* Gọi Thêm panel */}
      {extraPanelOpen && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
              <Plus size={14} /> Gọi thêm đơn hàng
            </p>
            <p className="text-xs text-blue-500 mt-0.5">
              Nhập mã đơn để thêm vào danh sách gọi hàng, dù đơn đó không thiếu tồn kho.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={extraSearchNum}
              onChange={(e) => setExtraSearchNum(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleExtraSearch()}
              placeholder="VD: DH2602260001"
              className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            />
            <button
              onClick={handleExtraSearch}
              disabled={!extraSearchNum.trim() || extraSearching}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {extraSearching
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Search size={15} />
              }
              Tìm đơn
            </button>
          </div>

          {extraFoundOrder && (
            <div className="bg-white border border-blue-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-blue-600 text-sm">{extraFoundOrder.order_number}</span>
                    <StatusBadge status={extraFoundOrder.status} />
                    <span className="text-[11px] text-gray-400">{formatDate(extraFoundOrder.created_at)}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">
                    {extraFoundOrder.customer?.name ?? 'Khách lẻ'}
                    {extraFoundOrder.customer?.phone && (
                      <span className="text-orange-500 font-normal text-xs ml-2">{extraFoundOrder.customer.phone}</span>
                    )}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {(extraFoundOrder.items ?? []).slice(0, 4).map((item) => (
                      <span key={item.id} className="text-xs text-gray-700">
                        {item.product?.name ?? '—'}
                        <span className="text-blue-600 font-bold ml-1">×{item.quantity}</span>
                      </span>
                    ))}
                    {(extraFoundOrder.items ?? []).length > 4 && (
                      <span className="text-xs text-gray-400">+{(extraFoundOrder.items ?? []).length - 4} khác</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (manuallyAddedIds.has(extraFoundOrder.id)) {
                      toast('Đơn này đã có trong danh sách gọi hàng', { icon: 'ℹ️' })
                    } else {
                      addExtraCallMutation.mutate(extraFoundOrder.id)
                    }
                  }}
                  disabled={addExtraCallMutation.isPending || manuallyAddedIds.has(extraFoundOrder.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    manuallyAddedIds.has(extraFoundOrder.id)
                      ? 'bg-gray-100 text-gray-400 cursor-default'
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white'
                  }`}
                >
                  <Plus size={13} />
                  {manuallyAddedIds.has(extraFoundOrder.id) ? 'Đã thêm' : 'Thêm vào Gọi Hàng'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : allStockCallOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <Package size={36} className="mx-auto mb-2 opacity-30" />
          <p className="font-medium">Không có đơn nào cần gọi hàng</p>
          <p className="text-sm mt-1">Tất cả sản phẩm trong các đơn đang xử lý đều đủ tồn kho</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm table-fixed"
              style={{ minWidth: canManage ? 1220 : 920 }}
            >
              <thead>
                <tr className="bg-orange-50 border-b border-orange-200">
                  <th style={{ width: 148 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Mã Đơn</th>
                  <th style={{ width: 140 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Khách Hàng</th>
                  <th style={{ width: 200 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Sản Phẩm</th>
                  <th style={{ width: 130 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Trạng Thái</th>
                  <th style={{ width: 110 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Sale</th>
                  <th className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Ghi Chú Đơn</th>
                  {canManage && (
                    <th style={{ width: 300 }} className="text-left text-xs font-bold text-gray-900 uppercase tracking-wide px-4 py-2.5">Ghi Chú Kho</th>
                  )}
                  <th style={{ width: canManage ? 96 : 56 }} className="text-center text-xs font-bold text-gray-900 uppercase tracking-wide px-2 py-2.5">
                    {canManage ? 'Thao Tác' : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {allStockCallOrders.map((order) => {
                  const items: OrderItem[] = order.items ?? []
                  const isManual = manuallyAddedIds.has(order.id)
                  const hasOutOfStock = items.some(isOutOfStock)
                  const orderNotes = notesByOrder[order.id] ?? []

                  return (
                    <tr
                      key={order.id}
                      className={`border-t border-dashed align-top transition-colors ${
                        isManual && !hasOutOfStock
                          ? 'border-blue-200 hover:bg-blue-50/40 bg-blue-50/20'
                          : 'border-gray-200 hover:bg-orange-50/30'
                      }`}
                    >
                      {/* Mã Đơn */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <p className="font-mono font-bold text-blue-600 text-xs">{order.order_number}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(order.created_at)}</p>
                        {isManual && (
                          <span className="inline-flex items-center gap-0.5 mt-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            <Plus size={9} /> Gọi Thêm
                          </span>
                        )}
                      </td>

                      {/* Khách Hàng */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <p className="font-semibold text-gray-900 text-sm leading-snug">
                          {order.customer?.name ?? 'Khách lẻ'}
                        </p>
                        {order.customer?.phone && (
                          <p className="text-xs text-orange-500 mt-0.5">{order.customer.phone}</p>
                        )}
                      </td>

                      {/* Sản Phẩm */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <table className="w-full text-xs border-collapse">
                          <tbody>
                            {items.map((item, i) => {
                              const oos = isOutOfStock(item)
                              return (
                                <tr
                                  key={item.id}
                                  className={i < items.length - 1 ? 'border-b border-dashed border-green-400' : ''}
                                >
                                  <td className="py-1 pr-1 text-gray-300 w-3 align-top">✓</td>
                                  <td className={`py-1 leading-snug ${oos ? 'text-red-600' : 'text-gray-900'}`}>
                                    {(item.product as Record<string, unknown>)?.product_code && (
                                      <span className="font-mono font-bold text-orange-500 text-[10px] mr-1">
                                        {(item.product as Record<string, unknown>).product_code as string}
                                      </span>
                                    )}
                                    <span className="font-semibold">{item.product?.name ?? '—'}</span>
                                  </td>
                                  <td className={`py-1 text-right font-bold tabular-nums whitespace-nowrap pl-2 w-10 align-top ${oos ? 'text-red-600' : 'text-blue-600'}`}>
                                    SL:{item.quantity}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>

                      {/* Trạng Thái */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <StatusBadge status={order.status} />
                      </td>

                      {/* Sale */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        <p className="text-xs text-blue-600 font-medium">{order.employee?.full_name ?? '—'}</p>
                      </td>

                      {/* Ghi Chú Đơn */}
                      <td className="px-4 py-3 border-r border-dashed border-gray-200">
                        {order.note ? (
                          <p className="text-xs text-gray-700 italic leading-snug">{order.note}</p>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>

                      {/* Ghi Chú Kho — chat */}
                      {canManage && (
                        <td className="px-3 py-2.5 border-r border-dashed border-gray-200">
                          <NoteChat
                            orderId={order.id}
                            notes={orderNotes}
                            onSend={(id, content) => addNoteMutation.mutate({ orderId: id, content })}
                            sending={addNoteMutation.isPending}
                          />
                        </td>
                      )}

                      {/* Thao Tác */}
                      <td className="px-2 py-3">
                        {canManage && (
                          <div className="flex flex-col gap-1.5 items-center">
                            <button
                              onClick={() => dismissMutation.mutate(order.id)}
                              disabled={dismissMutation.isPending}
                              title={hasOutOfStock ? 'Vẫn đang thiếu hàng' : 'Đủ hàng — gỡ khỏi danh sách'}
                              className={`flex items-center gap-1 px-2 py-1 text-white text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                                hasOutOfStock
                                  ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-300'
                                  : 'bg-green-600 hover:bg-green-700 disabled:bg-green-300'
                              }`}
                            >
                              <CheckCircle size={11} /> Đủ Hàng
                            </button>
                            <button
                              onClick={() => removeMutation.mutate(order.id)}
                              disabled={removeMutation.isPending}
                              title="Xóa khỏi danh sách gọi hàng"
                              className="flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-500 text-xs font-medium rounded-lg whitespace-nowrap"
                            >
                              <X size={11} /> Xóa
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

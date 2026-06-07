import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, ChevronDown, MapPin, ArrowRight, ArrowLeftRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatCurrency, formatDateOnly } from '@/utils/format'
import { useRoutePlanningStore } from '@/stores/routePlanningStore'
import type { Order, OrderStatus } from '@/types'
import toast from 'react-hot-toast'

// ── Local types ───────────────────────────────────────────────────────────────

type RouteOrderRow = {
  id: string
  created_at: string
  warehouse_note?: string
  order?: {
    id: string
    order_number: string
    status: OrderStatus
    final_amount: number
    created_at: string
    note?: string
    customer?: { name: string; phone?: string }
    employee?: { full_name: string }
    items?: Array<{ id: string; quantity: number; unit_price: number; product?: { name: string; unit: string } }>
  }
}

type RouteWithOrders = {
  id: string
  name: string
  description?: string
  sort_order: number
  created_at: string
  updated_at: string
  route_orders: RouteOrderRow[]
}

// ── Warehouse note inline editor ──────────────────────────────────────────────

function WarehouseNoteCell({
  routeOrderId,
  initialNote,
}: {
  routeOrderId: string
  initialNote: string
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState(initialNote)

  const saveMutation = useMutation({
    mutationFn: async (val: string) => {
      const { error } = await supabase
        .from('route_orders')
        .update({ warehouse_note: val || null })
        .eq('id', routeOrderId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routes'] }),
    onError: () => toast.error('Lỗi khi lưu ghi chú'),
  })

  return (
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => { if (note !== initialNote) saveMutation.mutate(note) }}
      placeholder="Ghi chú kho..."
      rows={2}
      className="w-full text-xs px-2 py-1 border border-gray-200 rounded-md outline-none focus:ring-1 focus:ring-blue-400 bg-white placeholder:text-gray-300 resize-none leading-relaxed"
    />
  )
}

// ── Pending order card ────────────────────────────────────────────────────────

function PendingOrderCard({
  order,
  routes,
  onAssign,
  onDismiss,
  isPending,
}: {
  order: Order
  routes: RouteWithOrders[]
  onAssign: (orderId: string, routeId: string) => void
  onDismiss: (orderId: string) => void
  isPending: boolean
}) {
  const items = order.items ?? []

  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-purple-50">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-blue-600 text-sm">{order.order_number}</span>
            <StatusBadge status={order.status} />
            <span className="text-[11px] text-gray-400">{formatDateOnly(order.created_at)}</span>
          </div>
          {order.customer && (
            <p className="text-sm font-semibold text-gray-900 mt-0.5">
              {order.customer.name}
              {order.customer.phone && (
                <span className="text-orange-500 font-normal ml-2 text-xs">{order.customer.phone}</span>
              )}
            </p>
          )}
          {items.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {items.map((item) => (
                <span key={item.id} className="text-xs text-gray-700 font-semibold">
                  {item.product?.name ?? '—'} <span className="text-blue-600">×{item.quantity}</span>
                </span>
              ))}
            </div>
          )}
          {order.note && (
            <p className="text-xs text-gray-500 mt-1 italic">📝 {order.note}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-bold text-blue-600 text-base tabular-nums">
            {formatCurrency(order.final_amount)}
          </p>
          <button
            onClick={() => onDismiss(order.id)}
            className="mt-1 text-gray-300 hover:text-gray-500 transition-colors"
            title="Bỏ qua"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap bg-white border-t border-purple-100">
        <span className="text-xs text-gray-500 flex items-center gap-1 mr-1">
          <ArrowRight size={12} /> Chọn tuyến:
        </span>
        {routes.length === 0 ? (
          <span className="text-xs text-gray-400 italic">Chưa có tuyến nào</span>
        ) : (
          routes.map((route) => (
            <button
              key={route.id}
              onClick={() => onAssign(order.id, route.id)}
              disabled={isPending}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-xs font-semibold rounded-full transition-colors"
            >
              {route.name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RoutePlanningPage() {
  const { isAdmin, isAccountant, profile } = useAuth()
  const canManage = isAdmin || isAccountant
  const queryClient = useQueryClient()

  const { pendingOrders, removePendingOrder, clearAll } = useRoutePlanningStore()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<RouteWithOrders | null>(null)
  const [deleteRouteId, setDeleteRouteId] = useState<string | null>(null)
  const [openChangeRoute, setOpenChangeRoute] = useState<string | null>(null)
  const [changeRoutePos, setChangeRoutePos] = useState<{ top: number; right: number } | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formOrder, setFormOrder] = useState(1)

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select(`
          *,
          route_orders(
            id, created_at, warehouse_note,
            order:orders(
              id, order_number, status, final_amount, created_at, note,
              customer:customers(name, phone),
              employee:profiles(full_name),
              items:order_items(id, quantity, unit_price, product:products(name, unit))
            )
          )
        `)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as RouteWithOrders[]
    },
  })

  const assignMutation = useMutation({
    mutationFn: async ({ orderId, routeId }: { orderId: string; routeId: string }) => {
      const { error } = await supabase
        .from('route_orders')
        .upsert({ route_id: routeId, order_id: orderId, added_by: profile!.id }, { onConflict: 'order_id' })
      if (error) throw error
    },
    onSuccess: (_data, { orderId }) => {
      removePendingOrder(orderId)
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['route-orders-map'] })
      toast.success('Đã xếp đơn vào tuyến')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const removeOrderMutation = useMutation({
    mutationFn: async (routeOrderId: string) => {
      const { error } = await supabase.from('route_orders').delete().eq('id', routeOrderId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['route-orders-map'] })
      toast.success('Đã xóa đơn khỏi tuyến')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const saveRouteMutation = useMutation({
    mutationFn: async () => {
      if (!formName.trim()) throw new Error('Tên tuyến không được trống')
      if (editingRoute) {
        const { error } = await supabase.from('routes').update({
          name: formName.trim(),
          description: formDesc.trim() || null,
          sort_order: formOrder,
          updated_at: new Date().toISOString(),
        }).eq('id', editingRoute.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('routes').insert({
          name: formName.trim(),
          description: formDesc.trim() || null,
          sort_order: formOrder,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['routes-simple'] })
      setIsFormOpen(false)
      toast.success(editingRoute ? 'Đã cập nhật tuyến' : 'Đã thêm tuyến mới')
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message
      toast.error(msg || 'Có lỗi xảy ra khi lưu tuyến')
    },
  })

  const deleteRouteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('routes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['routes-simple'] })
      setDeleteRouteId(null)
      toast.success('Đã xóa tuyến')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  function openAdd() {
    setEditingRoute(null)
    setFormName('')
    setFormDesc('')
    setFormOrder(routes.length + 1)
    setIsFormOpen(true)
  }

  function openEdit(r: RouteWithOrders) {
    setEditingRoute(r)
    setFormName(r.name)
    setFormDesc(r.description ?? '')
    setFormOrder(r.sort_order)
    setIsFormOpen(true)
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3" />
        Đang tải...
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Xếp Tuyến</h1>
          <p className="text-sm text-gray-500 mt-0.5">Phân công đơn hàng theo tuyến vận chuyển</p>
        </div>
        {canManage && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Thêm Tuyến
          </button>
        )}
      </div>

      {/* Đơn chờ xếp tuyến */}
      {pendingOrders.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-purple-500 rounded-full animate-pulse" />
              <span className="font-bold text-gray-900 text-sm">Đơn chờ xếp tuyến</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                {pendingOrders.length}
              </span>
            </div>
            <button
              onClick={clearAll}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <X size={12} /> Xóa tất cả
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pendingOrders.map((order) => (
              <PendingOrderCard
                key={order.id}
                order={order}
                routes={routes}
                onAssign={(orderId, routeId) => assignMutation.mutate({ orderId, routeId })}
                onDismiss={removePendingOrder}
                isPending={assignMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {pendingOrders.length > 0 && <div className="border-t border-gray-200" />}

      {/* Routes */}
      {routes.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
          <MapPin size={40} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">Chưa có tuyến nào</p>
          {canManage && <p className="text-sm mt-1">Nhấn "Thêm Tuyến" để bắt đầu</p>}
        </div>
      ) : (
        routes.map((route) => {
          const isCollapsed = collapsed.has(route.id)
          const orders = route.route_orders ?? []
          const totalAmount = orders.reduce((s, ro) => s + (ro.order?.final_amount ?? 0), 0)

          return (
            <div key={route.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

              {/* Route header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-orange-100 hover:bg-orange-200 transition-colors select-none"
                onClick={() => toggleCollapse(route.id)}
              >
                <div className="w-8 h-8 rounded-lg bg-orange-200 flex items-center justify-center flex-shrink-0">
                  <MapPin size={16} className="text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">{route.name}</p>
                  {route.description && (
                    <p className="text-xs text-gray-500 truncate">{route.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs bg-orange-200 text-orange-700 px-2 py-0.5 rounded-full font-semibold">
                    {orders.length} đơn
                  </span>
                  {orders.length > 0 && (
                    <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-semibold hidden sm:inline">
                      {totalAmount.toLocaleString('vi-VN')} đ
                    </span>
                  )}
                  {canManage && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(route) }}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteRouteId(route.id) }}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
                  />
                </div>
              </div>

              {/* Orders table */}
              {!isCollapsed && (
                orders.length === 0 ? (
                  <div className="border-t border-gray-100 py-5 text-center text-sm text-gray-400 italic">
                    Chưa có đơn nào — xếp đơn từ tab <span className="font-medium text-purple-500">Đơn Hàng</span>
                  </div>
                ) : (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-sm table-fixed" style={{ minWidth: canManage ? 1080 : 860 }}>
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 120 }}>Mã Đơn</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 140 }}>Khách Hàng</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 180 }}>Sản Phẩm</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 110 }}>Tổng Tiền</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 130 }}>Trạng Thái</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5" style={{ width: 100 }}>Sale</th>
                          <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5">Ghi Chú Đơn</th>
                          {canManage && (
                            <th className="text-left text-xs font-bold text-gray-900 px-3 py-2.5">Ghi Chú Kho</th>
                          )}
                          <th style={{ width: 56 }} className="px-2 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((ro) => {
                          const o = ro.order
                          if (!o) return null
                          const items = o.items ?? []
                          return (
                            <tr
                              key={ro.id}
                              className="border-t border-dashed border-green-300 hover:bg-gray-50/60 transition-colors align-top"
                            >
                              {/* Mã đơn */}
                              <td className="px-3 py-2.5">
                                <p className="font-mono font-bold text-blue-600 text-xs">{o.order_number}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">{formatDateOnly(o.created_at)}</p>
                              </td>

                              {/* Khách hàng */}
                              <td className="px-3 py-2.5">
                                <p className="font-semibold text-gray-900 text-sm leading-snug">
                                  {o.customer?.name ?? 'Khách lẻ'}
                                </p>
                                {o.customer?.phone && (
                                  <p className="text-xs text-orange-500 mt-0.5">{o.customer.phone}</p>
                                )}
                              </td>

                              {/* Sản phẩm */}
                              <td className="px-3 py-2.5">
                                {items.length === 0 ? (
                                  <span className="text-xs text-gray-300 italic">—</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    {items.slice(0, 2).map((item) => (
                                      <p key={item.id} className="text-xs text-gray-900 font-semibold leading-snug">
                                        {item.product?.name ?? '—'}{' '}
                                        <span className="text-blue-600 font-bold">×{item.quantity}</span>
                                      </p>
                                    ))}
                                    {items.length > 2 && (
                                      <p className="text-[11px] text-gray-400 italic">+{items.length - 2} khác</p>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Tổng tiền */}
                              <td className="px-3 py-2.5">
                                <p className="font-bold text-blue-600 text-sm tabular-nums">
                                  {formatCurrency(o.final_amount)}
                                </p>
                              </td>

                              {/* Trạng thái */}
                              <td className="px-3 py-2.5">
                                <StatusBadge status={o.status} />
                              </td>

                              {/* Sale */}
                              <td className="px-3 py-2.5">
                                <p className="text-xs text-blue-500 italic">{o.employee?.full_name ?? '—'}</p>
                              </td>

                              {/* Ghi chú đơn */}
                              <td className="px-3 py-2.5 align-top">
                                {o.note
                                  ? <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap break-words">{o.note}</p>
                                  : <span className="text-xs text-gray-300">—</span>
                                }
                              </td>

                              {/* Ghi chú kho — chỉ admin/kế toán */}
                              {canManage && (
                                <td className="px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                                  <WarehouseNoteCell
                                    routeOrderId={ro.id}
                                    initialNote={ro.warehouse_note ?? ''}
                                  />
                                </td>
                              )}

                              {/* Actions: Đổi tuyến + Xóa */}
                              <td className="px-2 py-2.5">
                                <div className="flex items-center gap-1">
                                  {/* Nút đổi tuyến */}
                                  <div className="relative">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (openChangeRoute === ro.id) {
                                          setOpenChangeRoute(null)
                                        } else {
                                          const rect = e.currentTarget.getBoundingClientRect()
                                          setChangeRoutePos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                                          setOpenChangeRoute(ro.id)
                                        }
                                      }}
                                      className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                                      title="Đổi tuyến"
                                    >
                                      <ArrowLeftRight size={14} />
                                    </button>
                                  </div>

                                  {/* Nút xóa khỏi tuyến */}
                                  <button
                                    onClick={() => removeOrderMutation.mutate(ro.id)}
                                    disabled={removeOrderMutation.isPending}
                                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                    title="Xóa khỏi tuyến"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          )
        })
      )}

      {/* Add / Edit Route modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">
                {editingRoute ? 'Sửa Tuyến' : 'Thêm Tuyến Mới'}
              </h2>
              <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tên Tuyến <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRouteMutation.mutate()}
                  placeholder="VD: Tuyến 1: Hà Nam - Hà Nội - Hòa Bình"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô Tả</label>
                <input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="VD: Chạy thứ 2, 4, 6"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Thứ Tự</label>
                <input
                  type="number"
                  min={1}
                  value={formOrder}
                  onChange={(e) => setFormOrder(parseInt(e.target.value) || 1)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={() => saveRouteMutation.mutate()}
                disabled={!formName.trim() || saveRouteMutation.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
              >
                {saveRouteMutation.isPending ? 'Đang lưu...' : (editingRoute ? 'Cập Nhật' : 'Thêm Tuyến')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dropdown đổi tuyến — fixed để thoát khỏi overflow-x-auto */}
      {openChangeRoute && changeRoutePos && (() => {
        const ro = routes.flatMap((r) => r.route_orders).find((r) => r.id === openChangeRoute)
        const currentRouteId = routes.find((r) => r.route_orders.some((x) => x.id === openChangeRoute))?.id
        const orderId = ro?.order?.id
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenChangeRoute(null)} />
            <div
              className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 min-w-[220px]"
              style={{ top: changeRoutePos.top, right: changeRoutePos.right }}
            >
              <p className="text-[11px] text-gray-400 px-2 py-1 font-semibold uppercase tracking-wide">
                Chuyển sang tuyến:
              </p>
              {routes.filter((r) => r.id !== currentRouteId).length === 0 ? (
                <p className="text-xs text-gray-400 italic px-2 py-1.5">Không có tuyến khác</p>
              ) : (
                routes.filter((r) => r.id !== currentRouteId).map((r) => (
                  <button
                    key={r.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (orderId) assignMutation.mutate({ orderId, routeId: r.id })
                      setOpenChangeRoute(null)
                    }}
                    className="w-full text-left px-2.5 py-2 text-xs rounded-lg hover:bg-purple-50 text-gray-700 hover:text-purple-700 transition-colors flex items-center gap-2"
                  >
                    <MapPin size={11} className="text-purple-400 flex-shrink-0" />
                    {r.name}
                  </button>
                ))
              )}
            </div>
          </>
        )
      })()}

      {/* Delete route confirm */}
      <ConfirmDialog
        isOpen={!!deleteRouteId}
        onClose={() => setDeleteRouteId(null)}
        onConfirm={() => deleteRouteId && deleteRouteMutation.mutate(deleteRouteId)}
        title="Xóa Tuyến"
        message="Bạn có chắc muốn xóa tuyến này? Các đơn hàng trong tuyến sẽ được gỡ ra nhưng không bị xóa."
        confirmLabel="Xóa Tuyến"
        loading={deleteRouteMutation.isPending}
      />
    </div>
  )
}

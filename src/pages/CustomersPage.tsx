import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Users, Search, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatCurrency } from '@/utils/format'
import type { Customer, Order } from '@/types'
import toast from 'react-hot-toast'

interface CustomerForm {
  name: string
  phone: string
  address: string
  note: string
}

const defaultForm: CustomerForm = {
  name: '',
  phone: '',
  address: '',
  note: '',
}

export function CustomersPage() {
  const { canEdit, isEmployee, profile } = useAuth()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<CustomerForm>(defaultForm)
  const [search, setSearch] = useState('')
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', profile?.id, isEmployee],
    queryFn: async () => {
      let query = supabase
        .from('customers')
        .select('*, creator:profiles!created_by(*)')
        .order('name')
      if (isEmployee && profile) {
        query = query.eq('created_by', profile.id)
      }
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as Customer[]
    },
    enabled: !!profile,
  })

  const { data: customerOrders = [] } = useQuery({
    queryKey: ['customer-orders', historyCustomer?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, final_amount, created_at')
        .eq('customer_id', historyCustomer!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Order[]
    },
    enabled: !!historyCustomer,
  })

  const saveMutation = useMutation({
    mutationFn: async (values: CustomerForm) => {
      const payload: Record<string, unknown> = {
        name: values.name,
        phone: values.phone || null,
        address: values.address || null,
        note: values.note || null,
      }
      if (!editingCustomer && profile) {
        payload.created_by = profile.id
      }
      if (editingCustomer) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editingCustomer.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('customers').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success(editingCustomer ? 'Cập nhật khách hàng thành công' : 'Thêm khách hàng thành công')
      closeModal()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Đã xóa khách hàng')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa khách hàng'),
  })

  function openAdd() {
    setEditingCustomer(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  function openEdit(customer: Customer) {
    setEditingCustomer(customer)
    setForm({
      name: customer.name,
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      note: customer.note ?? '',
    })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingCustomer(null)
    setForm(defaultForm)
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = editingCustomer !== null || !!form.name.trim() || !!form.phone || !!form.address || !!form.note
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search)
  )

  // Employees can add their own customers; canEdit controls edit/delete
  const canAdd = !!profile

  const colSpan = (canEdit ? 1 : 0) + (!isEmployee ? 1 : 0) + 6

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Khách Hàng</h1>
          <p className="text-gray-500 mt-1">{customers.length} khách hàng</p>
        </div>
        {canAdd && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus size={18} />
            Thêm Khách Hàng
          </button>
        )}
      </div>

      <div className="mb-4 relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên, điện thoại..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Tên Khách Hàng</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Điện Thoại</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Địa Chỉ</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Ghi Chú</th>
                  {!isEmployee && (
                    <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Người Tạo</th>
                  )}
                  <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Ngày Tạo</th>
                  <th className="text-center text-sm font-medium text-gray-500 px-4 py-3">Đơn Hàng</th>
                  {canEdit && (
                    <th className="text-right text-sm font-medium text-gray-500 px-4 py-3">Thao Tác</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{customer.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{customer.phone ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{customer.address ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{customer.note ?? '-'}</td>
                    {!isEmployee && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {customer.creator?.full_name ?? '-'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(customer.created_at)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setHistoryCustomer(customer)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded"
                      >
                        <History size={14} />
                        Xem đơn
                      </button>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(customer)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => setDeleteId(customer.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="text-center py-12 text-gray-400">
                      <Users size={40} className="mx-auto mb-2" />
                      Không tìm thấy khách hàng
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lịch sử đơn hàng */}
      <Modal
        isOpen={!!historyCustomer}
        onClose={() => setHistoryCustomer(null)}
        title={`Lịch Sử Đơn Hàng – ${historyCustomer?.name ?? ''}`}
      >
        {customerOrders.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            <History size={32} className="mx-auto mb-2" />
            <p>Chưa có đơn hàng nào</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {customerOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border">
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold text-gray-800">{order.order_number}</span>
                  <span className="ml-3 text-xs text-gray-500">{formatDate(order.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 ml-3 shrink-0">
                  <StatusBadge status={order.status} />
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    {formatCurrency(order.final_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Form thêm / sửa */}
      <Modal
        isOpen={isModalOpen}
        onClose={requestClose}
        title={editingCustomer ? 'Chỉnh Sửa Khách Hàng' : 'Thêm Khách Hàng'}
      >
        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form) }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên Khách Hàng *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nhập tên khách hàng"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Điện Thoại</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="0912345678"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Địa Chỉ</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nhập địa chỉ"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Hủy
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
            >
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Xóa Khách Hàng"
        message="Bạn có chắc muốn xóa khách hàng này không?"
        confirmLabel="Xóa"
        loading={deleteMutation.isPending}
      />
      <ConfirmDialog
        isOpen={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        onConfirm={closeModal}
        title="Thoát mà không lưu?"
        message="Bạn có thay đổi chưa được lưu. Bạn có chắc muốn thoát không?"
        confirmLabel="Thoát"
      />
    </div>
  )
}

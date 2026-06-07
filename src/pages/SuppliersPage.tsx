import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Truck, Search, Phone, Mail, MapPin,
  CreditCard, X, DollarSign, CheckCircle2, Calendar, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatCurrency, fmtThousands } from '@/utils/format'
import type { Supplier, SupplierPayment } from '@/types'
import toast from 'react-hot-toast'

interface SupplierForm {
  name: string
  phone: string
  email: string
  address: string
  note: string
}

const defaultForm: SupplierForm = { name: '', phone: '', email: '', address: '', note: '' }

function fmtPayDate(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function SuppliersPage() {
  const { profile, canEdit, isAdmin } = useAuth()
  const queryClient = useQueryClient()

  // ── Supplier form state ──
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<SupplierForm>(defaultForm)
  const [search, setSearch] = useState('')

  // ── Debt / payment state ──
  const [debtSupplier, setDebtSupplier] = useState<Supplier | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [deletePayId, setDeletePayId] = useState<string | null>(null)

  // ── Opening balance state ──
  const [editingOpeningBalance, setEditingOpeningBalance] = useState(false)
  const [openingBalanceInput, setOpeningBalanceInput] = useState('')

  // ── Queries ──
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').order('name')
      if (error) throw error
      return (data ?? []) as Supplier[]
    },
  })

  // All-time import amounts per supplier (for debt calculation)
  const { data: importTotals = [] } = useQuery({
    queryKey: ['supplier-import-totals'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_transactions')
        .select('supplier_id, quantity, unit_price')
        .eq('type', 'import')
      return (data ?? []) as { supplier_id: string | null; quantity: number; unit_price: number }[]
    },
  })

  // All supplier payments
  const { data: payments = [] } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_payments')
        .select('*, profile:profiles(full_name)')
        .order('payment_date', { ascending: false })
      return (data ?? []) as SupplierPayment[]
    },
  })

  // Precompute debt map một lần thay vì O(n²) mỗi render
  const debtMap = useMemo(() => {
    const importedBySupplier: Record<string, number> = {}
    for (const t of importTotals) {
      if (t.supplier_id) importedBySupplier[t.supplier_id] = (importedBySupplier[t.supplier_id] ?? 0) + t.quantity * t.unit_price
    }
    const paidBySupplier: Record<string, number> = {}
    for (const p of payments) {
      paidBySupplier[p.supplier_id] = (paidBySupplier[p.supplier_id] ?? 0) + p.amount
    }
    return { importedBySupplier, paidBySupplier }
  }, [importTotals, payments])

  function getDebtInfo(supplier: Supplier) {
    const opening = supplier.opening_balance ?? 0
    const imported = debtMap.importedBySupplier[supplier.id] ?? 0
    const paid = debtMap.paidBySupplier[supplier.id] ?? 0
    return { opening, imported, paid, debt: opening + imported - paid }
  }

  // ── Payment mutation ──
  const payMutation = useMutation({
    mutationFn: async (supplierId: string) => {
      if (!profile) throw new Error('Not authenticated')
      const amount = parseFloat(payAmount.replace(/\D/g, ''))
      if (!amount || amount <= 0) throw new Error('Số tiền không hợp lệ')
      const { error } = await supabase.from('supplier_payments').insert({
        supplier_id: supplierId,
        amount,
        note: payNote || null,
        payment_date: payDate,
        created_by: profile.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-payments'] })
      toast.success('Ghi thanh toán thành công')
      setPayAmount('')
      setPayNote('')
    },
    onError: (err: Error) => toast.error(err.message || 'Có lỗi xảy ra'),
  })

  // ── Delete payment mutation (admin only) ──
  const deletePayMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('supplier_payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-payments'] })
      toast.success('Đã xóa thanh toán')
      setDeletePayId(null)
    },
    onError: () => toast.error('Có lỗi khi xóa'),
  })

  // ── Opening balance mutation (admin only) ──
  const openingBalanceMutation = useMutation({
    mutationFn: async ({ supplierId, amount }: { supplierId: string; amount: number }) => {
      const { error } = await supabase
        .from('suppliers')
        .update({ opening_balance: amount })
        .eq('id', supplierId)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setDebtSupplier((prev) =>
        prev?.id === vars.supplierId ? { ...prev, opening_balance: vars.amount } : prev
      )
      toast.success('Đã cập nhật nợ đầu kỳ')
      setEditingOpeningBalance(false)
      setOpeningBalanceInput('')
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  // ── Supplier CRUD mutations ──
  const saveMutation = useMutation({
    mutationFn: async (values: SupplierForm) => {
      const payload = {
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || null,
        note: values.note || null,
      }
      if (editingSupplier) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editingSupplier.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success(editingSupplier ? 'Cập nhật thành công' : 'Thêm NCC thành công')
      closeModal()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success('Đã xóa nhà cung cấp')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa. NCC này có thể đang được sử dụng'),
  })

  function openAdd() {
    setEditingSupplier(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditingSupplier(supplier)
    setForm({
      name: supplier.name,
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      note: supplier.note ?? '',
    })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingSupplier(null)
    setForm(defaultForm)
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = editingSupplier !== null || !!form.name.trim() || !!form.phone || !!form.email || !!form.address || !!form.note
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q) || (s.email ?? '').toLowerCase().includes(q)
  })

  // Debt modal computed data
  const debtInfo = debtSupplier ? getDebtInfo(debtSupplier) : null
  const supplierPaymentHistory = debtSupplier
    ? payments.filter((p) => p.supplier_id === debtSupplier.id)
    : []

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nhà Cung Cấp</h1>
          <p className="text-gray-500 mt-1">{suppliers.length} nhà cung cấp</p>
        </div>
        {canEdit && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus size={18} />
            Thêm NCC
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên, SĐT, email..."
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
            {filtered.map((supplier) => {
              const { imported, debt } = getDebtInfo(supplier)
              return (
                <div key={supplier.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                      <Truck size={18} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{supplier.name}</p>
                      {supplier.phone && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Phone size={10} /> {supplier.phone}
                        </p>
                      )}
                      {supplier.email && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                          <Mail size={10} /> {supplier.email}
                        </p>
                      )}
                      {supplier.address && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                          <MapPin size={10} /> {supplier.address}
                        </p>
                      )}
                      {supplier.note && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{supplier.note}</p>
                      )}
                    </div>
                  </div>

                  {/* Debt row */}
                  <button
                    onClick={() => setDebtSupplier(supplier)}
                    className={`mt-3 w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                      debt > 0
                        ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                        : imported > 0
                        ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                        : 'border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <CreditCard size={13} />
                      {debt > 0
                        ? `Còn nợ: ${formatCurrency(debt)}`
                        : imported > 0
                        ? 'Đã thanh toán hết'
                        : 'Chưa có giao dịch'}
                    </span>
                    <ChevronRight size={14} className="opacity-50" />
                  </button>

                  {canEdit && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => openEdit(supplier)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg">
                        <Pencil size={12} /> Sửa
                      </button>
                      <button onClick={() => setDeleteId(supplier.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded-lg">
                        <Trash2 size={12} /> Xóa
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="col-span-2 text-center py-16 text-gray-400">
                <Truck size={40} className="mx-auto mb-2 opacity-40" />
                <p>Chưa có nhà cung cấp nào</p>
              </div>
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden lg:block bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Tên NCC</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Liên Hệ</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Địa Chỉ</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Ghi Chú</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Công Nợ</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((supplier) => {
                    const { imported, debt } = getDebtInfo(supplier)
                    return (
                      <tr key={supplier.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                              <Truck size={14} className="text-indigo-600" />
                            </div>
                            <span className="font-semibold text-gray-900">{supplier.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {supplier.phone && (
                              <p className="text-xs text-gray-600 flex items-center gap-1"><Phone size={10} /> {supplier.phone}</p>
                            )}
                            {supplier.email && (
                              <p className="text-xs text-gray-500 flex items-center gap-1"><Mail size={10} /> {supplier.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{supplier.address ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 max-w-[200px] truncate">{supplier.note ?? '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setDebtSupplier(supplier)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                              debt > 0
                                ? 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200'
                                : imported > 0
                                ? 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'
                                : 'bg-gray-50 text-gray-400 hover:bg-gray-100 border-gray-200'
                            }`}
                          >
                            <CreditCard size={11} />
                            {debt > 0 ? formatCurrency(debt) : imported > 0 ? 'Đã TT' : '–'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {canEdit && (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit(supplier)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => setDeleteId(supplier.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-16 text-gray-400">
                        <Truck size={40} className="mx-auto mb-2 opacity-40" />
                        <p>Chưa có nhà cung cấp nào</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Công Nợ Modal ── */}
      {debtSupplier && debtInfo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDebtSupplier(null)} />
          <div className="relative bg-white w-full max-w-xl rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <CreditCard size={17} className="text-indigo-500" />
                  Công Nợ — {debtSupplier.name}
                </h2>
                {debtSupplier.phone && (
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <Phone size={10} /> {debtSupplier.phone}
                  </p>
                )}
              </div>
              <button onClick={() => { setDebtSupplier(null); setEditingOpeningBalance(false); setOpeningBalanceInput('') }} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-3 text-center">
                  <p className="text-[10px] text-orange-500 font-medium uppercase tracking-wide mb-1">Nợ Đầu Kỳ</p>
                  <p className="text-sm font-bold text-orange-700">{formatCurrency(debtInfo.opening)}</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-3 text-center">
                  <p className="text-[10px] text-blue-500 font-medium uppercase tracking-wide mb-1">Đã Nhập Hệ Thống</p>
                  <p className="text-sm font-bold text-blue-700">{formatCurrency(debtInfo.imported)}</p>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-3 text-center">
                  <p className="text-[10px] text-green-500 font-medium uppercase tracking-wide mb-1">Đã Thanh Toán</p>
                  <p className="text-sm font-bold text-green-700">{formatCurrency(debtInfo.paid)}</p>
                </div>
                <div className={`rounded-xl px-3 py-3 text-center border ${
                  debtInfo.debt > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
                }`}>
                  <p className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${debtInfo.debt > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {debtInfo.debt > 0 ? 'Còn Nợ' : 'Trạng Thái'}
                  </p>
                  {debtInfo.debt > 0 ? (
                    <p className="text-sm font-bold text-red-700">{formatCurrency(debtInfo.debt)}</p>
                  ) : (
                    <p className="text-sm font-bold text-green-700 flex items-center justify-center gap-1">
                      <CheckCircle2 size={13} /> Hết nợ
                    </p>
                  )}
                </div>
              </div>

              {/* Opening balance — admin only */}
              {isAdmin && (
                <div className="border border-orange-200 rounded-xl p-4 bg-orange-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-orange-700 flex items-center gap-2">
                      <CreditCard size={14} className="text-orange-500" />
                      Nợ Đầu Kỳ
                    </p>
                    {!editingOpeningBalance && (
                      <button
                        onClick={() => {
                          setOpeningBalanceInput(Math.round(debtInfo.opening).toString())
                          setEditingOpeningBalance(true)
                        }}
                        className="text-xs text-orange-600 hover:underline"
                      >
                        {debtInfo.opening > 0 ? 'Chỉnh sửa' : 'Nhập nợ đầu kỳ'}
                      </button>
                    )}
                  </div>
                  {editingOpeningBalance ? (
                    <div className="space-y-2">
                      <p className="text-xs text-orange-600">
                        Số tiền đã nợ NCC từ trước khi dùng hệ thống này.
                      </p>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          value={fmtThousands(openingBalanceInput)}
                          onChange={(e) => setOpeningBalanceInput(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              openingBalanceMutation.mutate({
                                supplierId: debtSupplier.id,
                                amount: parseFloat(openingBalanceInput) || 0,
                              })
                            }
                          }}
                          placeholder="0"
                          className="flex-1 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none bg-white"
                        />
                        <button
                          onClick={() => openingBalanceMutation.mutate({
                            supplierId: debtSupplier.id,
                            amount: parseFloat(openingBalanceInput) || 0,
                          })}
                          disabled={openingBalanceMutation.isPending}
                          className="px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white rounded-lg text-sm font-medium whitespace-nowrap"
                        >
                          {openingBalanceMutation.isPending ? 'Đang lưu...' : 'Lưu'}
                        </button>
                        <button
                          onClick={() => { setEditingOpeningBalance(false); setOpeningBalanceInput('') }}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-orange-800 font-semibold">
                      {debtInfo.opening > 0 ? formatCurrency(debtInfo.opening) : <span className="text-gray-400 font-normal">Chưa nhập</span>}
                    </p>
                  )}
                </div>
              )}

              {/* Record payment form */}
              {canEdit && (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/50">
                  <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <DollarSign size={15} className="text-green-600" />
                    Ghi Thanh Toán Mới
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Số tiền (VNĐ) <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fmtThousands(payAmount)}
                        onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, ''))}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      />
                      {debtInfo.debt > 0 && (
                        <button
                          type="button"
                          onClick={() => setPayAmount(Math.round(debtInfo.debt).toString())}
                          className="mt-1 text-[11px] text-blue-600 hover:underline"
                        >
                          Điền toàn bộ: {formatCurrency(debtInfo.debt)}
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Ngày thanh toán</label>
                      <input
                        type="date"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Ghi chú</label>
                    <input
                      type="text"
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                      placeholder="VD: Chuyển khoản MB Bank, CK tháng 6..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => payMutation.mutate(debtSupplier.id)}
                      disabled={!payAmount || payMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <DollarSign size={14} />
                      {payMutation.isPending ? 'Đang lưu...' : 'Xác Nhận Thanh Toán'}
                    </button>
                  </div>
                </div>
              )}

              {/* Payment history */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Calendar size={14} className="text-gray-400" />
                  Lịch Sử Thanh Toán
                  {supplierPaymentHistory.length > 0 && (
                    <span className="text-xs text-gray-400 font-normal">({supplierPaymentHistory.length} lần)</span>
                  )}
                </p>
                {supplierPaymentHistory.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-xl">
                    <DollarSign size={28} className="mx-auto mb-1 opacity-30" />
                    <p className="text-sm">Chưa có lần thanh toán nào</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {supplierPaymentHistory.map((pmt) => (
                      <div key={pmt.id} className="flex items-start justify-between bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm">
                        <div>
                          <p className="font-semibold text-green-700 text-base">{formatCurrency(pmt.amount)}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Calendar size={10} /> {fmtPayDate(pmt.payment_date)}
                            </span>
                            {pmt.profile?.full_name && (
                              <span className="text-xs text-gray-400">{pmt.profile.full_name}</span>
                            )}
                          </div>
                          {pmt.note && <p className="text-xs text-gray-500 mt-1">{pmt.note}</p>}
                        </div>
                        {profile?.role === 'admin' && (
                          <button
                            onClick={() => setDeletePayId(pmt.id)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 ml-2"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 flex justify-end flex-shrink-0 rounded-b-xl">
              <button
                onClick={() => { setDebtSupplier(null); setEditingOpeningBalance(false); setOpeningBalanceInput('') }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Supplier Modal ── */}
      <Modal isOpen={isModalOpen} onClose={requestClose} title={editingSupplier ? 'Sửa Nhà Cung Cấp' : 'Thêm Nhà Cung Cấp'} size="md">
        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form) }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên Nhà Cung Cấp <span className="text-red-500">*</span></label>
            <input
              type="text" required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="VD: NCC Công Nghệ Viễn Đông"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Số Điện Thoại</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="028 1234 5678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="contact@ncc.vn"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Địa Chỉ</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="KCN Sóng Thần, Bình Dương"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi Chú</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="Phân phối chính hãng Apple, Samsung..."
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
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
        title="Xóa Nhà Cung Cấp"
        message="Bạn có chắc muốn xóa nhà cung cấp này? Dữ liệu tồn kho theo NCC này sẽ bị ảnh hưởng."
        confirmLabel="Xóa"
        loading={deleteMutation.isPending}
      />
      <ConfirmDialog
        isOpen={!!deletePayId}
        onClose={() => setDeletePayId(null)}
        onConfirm={() => deletePayId && deletePayMutation.mutate(deletePayId)}
        title="Xóa Thanh Toán"
        message="Bạn có chắc muốn xóa lần thanh toán này? Công nợ sẽ được cộng lại."
        confirmLabel="Xóa"
        loading={deletePayMutation.isPending}
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

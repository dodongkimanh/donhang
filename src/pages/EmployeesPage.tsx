import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, UserCircle, KeyRound } from 'lucide-react'
import { supabase, adminSupabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatDate } from '@/utils/format'
import type { Profile, UserRole } from '@/types'
import toast from 'react-hot-toast'

interface EmployeeForm {
  full_name: string
  email: string
  password: string
  role: UserRole
  phone: string
  cmnd: string
  address: string
}

const defaultForm: EmployeeForm = {
  full_name: '',
  email: '',
  password: '',
  role: 'sale',
  phone: '',
  cmnd: '',
  address: '',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Quản Trị Viên',
  accountant: 'Kế Toán',
  sale:       'Nhân Viên Sale',
  warehouse:  'Nhân Viên Kho',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  admin:      'bg-red-100 text-red-800',
  accountant: 'bg-purple-100 text-purple-800',
  sale:       'bg-green-100 text-green-800',
  warehouse:  'bg-amber-100 text-amber-800',
}

const ROLE_GROUPS: { role: UserRole; label: string }[] = [
  { role: 'admin',      label: 'Quản Trị Viên' },
  { role: 'accountant', label: 'Kế Toán' },
  { role: 'warehouse',  label: 'Nhân Viên Kho' },
  { role: 'sale',       label: 'Nhân Viên Sale' },
]

export function EmployeesPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen]           = useState(false)
  const [editingEmployee, setEditingEmployee]   = useState<Profile | null>(null)
  const [deleteId, setDeleteId]                 = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm]                         = useState<EmployeeForm>(defaultForm)

  const [pwEmployee, setPwEmployee] = useState<Profile | null>(null)
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').neq('email', 'admin@kimanh.com').order('full_name')
      if (error) throw error
      return (data ?? []) as Profile[]
    },
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (values: EmployeeForm) => {
      // Dùng admin client (service_role) để tạo user không ảnh hưởng session hiện tại
      const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
        email: values.email,
        password: values.password,
        email_confirm: true,           // bỏ qua xác nhận email
        user_metadata: {
          full_name: values.full_name,
          role: values.role,
        },
      })
      if (authError) throw authError
      if (!authData.user) throw new Error('Không thể tạo tài khoản')

      // Trigger handle_new_user đã tạo profile — chỉ cần update thêm phone/cmnd/address
      const { error: profileError } = await adminSupabase
        .from('profiles')
        .update({
          phone:   values.phone   || null,
          cmnd:    values.cmnd    || null,
          address: values.address || null,
          email:   values.email,
        })
        .eq('user_id', authData.user.id)
      if (profileError) throw profileError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Thêm nhân viên thành công')
      closeModal()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const updateMutation = useMutation({
    mutationFn: async (values: EmployeeForm) => {
      if (!editingEmployee) return
      const { error } = await supabase.from('profiles').update({
        full_name: values.full_name,
        role:      values.role,
        phone:     values.phone   || null,
        cmnd:      values.cmnd    || null,
        address:   values.address || null,
      }).eq('id', editingEmployee.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Cập nhật thành công')
      closeModal()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Đã xóa nhân viên')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa nhân viên'),
  })

  const resetPwMutation = useMutation({
    mutationFn: async ({ emp, password }: { emp: Profile; password: string }) => {
      const { error } = await adminSupabase.auth.admin.updateUserById(emp.user_id, { password })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Đã đặt lại mật khẩu')
      setPwEmployee(null)
      setNewPw('')
      setConfirmPw('')
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingEmployee(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  function openEdit(emp: Profile) {
    setEditingEmployee(emp)
    setForm({
      full_name: emp.full_name,
      email:     '',
      password:  '',
      role:      emp.role,
      phone:     emp.phone   ?? '',
      cmnd:      emp.cmnd    ?? '',
      address:   emp.address ?? '',
    })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingEmployee(null)
    setForm(defaultForm)
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = editingEmployee !== null
      || !!form.full_name.trim() || !!form.email || !!form.password
      || !!form.phone || !!form.cmnd || !!form.address
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editingEmployee) updateMutation.mutate(form)
    else createMutation.mutate(form)
  }

  function handleResetPw(e: React.FormEvent) {
    e.preventDefault()
    if (!pwEmployee) return
    if (newPw.length < 6) { toast.error('Mật khẩu tối thiểu 6 ký tự'); return }
    if (newPw !== confirmPw) { toast.error('Mật khẩu xác nhận không khớp'); return }
    resetPwMutation.mutate({ emp: pwEmployee, password: newPw })
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const grouped = ROLE_GROUPS.map(({ role, label }) => ({
    role, label,
    members: employees.filter((e) => e.role === role),
  })).filter((g) => g.members.length > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nhân Viên</h1>
          <p className="text-gray-500 mt-1">{employees.length} tài khoản</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} />
          Thêm Nhân Viên
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : employees.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm text-center py-16 text-gray-400">
          <UserCircle size={40} className="mx-auto mb-2" />
          Chưa có nhân viên nào
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[20%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[25%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Họ Tên</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Email Đăng Nhập</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Điện Thoại</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden md:table-cell">CMND / CCCD</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden lg:table-cell">Địa Chỉ</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden sm:table-cell">Ngày Tạo</th>
                  <th className="text-right text-xs font-medium text-gray-500 px-4 py-2.5">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ role, label, members }) => (
                  <>
                    {/* Dòng tiêu đề nhóm */}
                    <tr key={`group-${role}`} className={
                      role === 'admin'      ? 'bg-red-50' :
                      role === 'accountant' ? 'bg-purple-50' :
                      role === 'warehouse'  ? 'bg-amber-50' :
                                              'bg-green-50'
                    }>
                      <td colSpan={7} className="px-4 py-2 border-y border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role]}`}>
                            {label}
                          </span>
                          <span className="text-xs text-gray-400">{members.length} người</span>
                        </div>
                      </td>
                    </tr>

                    {/* Dòng nhân viên */}
                    {members.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50 border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-900 text-sm">{emp.full_name}</td>
                        <td className="px-4 py-3 text-sm text-blue-600 font-mono">{emp.email ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{emp.phone ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell font-mono">{emp.cmnd ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 hidden lg:table-cell truncate" title={emp.address ?? ''}>{emp.address ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">{formatDate(emp.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setPwEmployee(emp); setNewPw(''); setConfirmPw('') }}
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                              title="Đặt lại mật khẩu"
                            >
                              <KeyRound size={15} />
                            </button>
                            <button
                              onClick={() => openEdit(emp)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Chỉnh sửa"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => setDeleteId(emp.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Xóa"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal thêm / sửa ── */}
      <Modal isOpen={isModalOpen} onClose={requestClose} title={editingEmployee ? 'Chỉnh Sửa Nhân Viên' : 'Thêm Nhân Viên'}>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Họ tên */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Họ Tên *</label>
            <input
              type="text" value={form.full_name} required
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nguyễn Văn A"
            />
          </div>

          {/* Email + Mật khẩu (chỉ khi thêm mới) */}
          {!editingEmployee && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email" value={form.email} required
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="ten@kimanh.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mật Khẩu *</label>
                <input
                  type="password" value={form.password} required minLength={6}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          {/* Vai trò + Điện thoại */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vai Trò *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="sale">Nhân Viên Sale</option>
                <option value="warehouse">Nhân Viên Kho</option>
                <option value="accountant">Kế Toán</option>
                <option value="admin">Quản Trị Viên</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Điện Thoại</label>
              <input
                type="tel" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="0912345678"
              />
            </div>
          </div>

          {/* CMND + Địa chỉ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CMND / CCCD</label>
              <input
                type="text" value={form.cmnd}
                onChange={(e) => setForm({ ...form, cmnd: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                placeholder="012345678901"
                maxLength={12}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Địa Chỉ</label>
              <input
                type="text" value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Số nhà, đường, phường/xã..."
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Hủy
            </button>
            <button type="submit" disabled={isPending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium">
              {isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Modal đặt lại mật khẩu ── */}
      <Modal isOpen={!!pwEmployee} onClose={() => setPwEmployee(null)} title={`Đặt Lại Mật Khẩu — ${pwEmployee?.full_name ?? ''}`}>
        <form onSubmit={handleResetPw} className="space-y-4">
          <p className="text-sm text-gray-500">
            Nhập mật khẩu mới cho <span className="font-medium text-gray-800">{pwEmployee?.full_name}</span>.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mật Khẩu Mới *</label>
            <input
              type="password" value={newPw} required minLength={6}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Xác Nhận Mật Khẩu *</label>
            <input
              type="password" value={confirmPw} required minLength={6}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${
                confirmPw && confirmPw !== newPw ? 'border-red-400' : 'border-gray-300'
              }`}
              placeholder="••••••••"
            />
            {confirmPw && confirmPw !== newPw && (
              <p className="text-xs text-red-500 mt-1">Mật khẩu không khớp</p>
            )}
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setPwEmployee(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Hủy
            </button>
            <button
              type="submit"
              disabled={resetPwMutation.isPending || (!!confirmPw && confirmPw !== newPw)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium"
            >
              {resetPwMutation.isPending ? 'Đang lưu...' : 'Đặt Lại Mật Khẩu'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Xóa Nhân Viên"
        message="Bạn có chắc muốn xóa nhân viên này không?"
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

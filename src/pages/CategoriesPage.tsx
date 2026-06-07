import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Tag, ImageIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { formatDate } from '@/utils/format'
import type { Category } from '@/types'
import toast from 'react-hot-toast'

interface CategoryForm {
  name: string
  description: string
  image_url: string | null
}

const defaultForm: CategoryForm = { name: '', description: '', image_url: null }

export function CategoriesPage() {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<CategoryForm>(defaultForm)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('name')
      if (error) throw error
      return (data ?? []) as Category[]
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (values: CategoryForm) => {
      const payload = {
        name: values.name,
        description: values.description || null,
        image_url: values.image_url || null,
      }
      if (editingCategory) {
        const { error } = await supabase
          .from('categories')
          .update(payload)
          .eq('id', editingCategory.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('categories').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success(editingCategory ? 'Cập nhật danh mục thành công' : 'Thêm danh mục thành công')
      closeModal()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('categories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Đã xóa danh mục')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa danh mục. Có thể đang được sử dụng.'),
  })

  function openAdd() {
    setEditingCategory(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  function openEdit(category: Category) {
    setEditingCategory(category)
    setForm({
      name: category.name,
      description: category.description ?? '',
      image_url: category.image_url ?? null,
    })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingCategory(null)
    setForm(defaultForm)
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = editingCategory !== null || !!form.name.trim() || !!form.description || form.image_url !== null
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    saveMutation.mutate(form)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Danh Mục Hàng Hóa</h1>
          <p className="text-gray-500 mt-1">{categories.length} danh mục</p>
        </div>
        {canEdit && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={18} />
            Thêm Danh Mục
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Tag size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Chưa có danh mục nào</p>
          {canEdit && (
            <button onClick={openAdd} className="mt-3 text-blue-600 hover:underline text-sm">
              Thêm danh mục đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left text-sm font-medium text-gray-500 px-4 py-3 w-16">Ảnh</th>
                <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Tên Danh Mục</th>
                <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Mô Tả</th>
                <th className="text-left text-sm font-medium text-gray-500 px-4 py-3">Ngày Tạo</th>
                {canEdit && (
                  <th className="text-right text-sm font-medium text-gray-500 px-4 py-3">Thao Tác</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {cat.image_url ? (
                      <img
                        src={cat.image_url}
                        alt={cat.name}
                        className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <ImageIcon size={16} className="text-gray-400" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{cat.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{cat.description ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{formatDate(cat.created_at)}</td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(cat)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(cat.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={requestClose}
        title={editingCategory ? 'Chỉnh Sửa Danh Mục' : 'Thêm Danh Mục'}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Image upload centred at top */}
          <div className="flex flex-col items-center gap-2">
            <ImageUpload
              value={form.image_url}
              onChange={(url) => setForm({ ...form, image_url: url })}
              bucket="categories"
              folder="categories"
              shape="square"
              size="lg"
            />
            <p className="text-xs text-gray-400">Nhấn vào khung để tải ảnh (tối đa 5MB)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tên Danh Mục <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nhập tên danh mục"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô Tả</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="Nhập mô tả danh mục"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
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
        title="Xóa Danh Mục"
        message="Bạn có chắc muốn xóa danh mục này? Hành động này không thể hoàn tác."
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

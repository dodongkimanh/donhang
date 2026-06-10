import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Tag, ImageIcon, Package, Search, X, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { formatDate, generateBundleCode } from '@/utils/format'
import type { Category, ProductBundle, BundleItem, Product } from '@/types'
import toast from 'react-hot-toast'

// ── Category CRUD ─────────────────────────────────────────────────────────────

interface CategoryForm {
  name: string
  description: string
  image_url: string | null
}

const defaultCatForm: CategoryForm = { name: '', description: '', image_url: null }

function CategoriesTab() {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<CategoryForm>(defaultCatForm)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name')
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
        const { error } = await supabase.from('categories').update(payload).eq('id', editingCategory.id)
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
    setForm(defaultCatForm)
    setIsModalOpen(true)
  }

  function openEdit(category: Category) {
    setEditingCategory(category)
    setForm({ name: category.name, description: category.description ?? '', image_url: category.image_url ?? null })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingCategory(null)
    setForm(defaultCatForm)
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = editingCategory !== null || !!form.name.trim() || !!form.description || form.image_url !== null
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-gray-500 text-sm">{categories.length} danh mục</p>
        {canEdit && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
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
                        <img src={cat.image_url} alt={cat.name} className="w-10 h-10 rounded-lg object-cover border border-gray-100" />
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

      <Modal isOpen={isModalOpen} onClose={requestClose} title={editingCategory ? 'Chỉnh Sửa Danh Mục' : 'Thêm Danh Mục'}>
        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form) }} className="space-y-5">
          <div className="flex flex-col items-center gap-2">
            <ImageUpload value={form.image_url} onChange={(url) => setForm({ ...form, image_url: url })} bucket="categories" folder="categories" shape="square" size="lg" />
            <p className="text-xs text-gray-400">Nhấn vào khung để tải ảnh (tối đa 5MB)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên Danh Mục <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Nhập tên danh mục" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô Tả</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" placeholder="Nhập mô tả danh mục" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
            <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors">
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
    </>
  )
}

// ── Bundle CRUD ───────────────────────────────────────────────────────────────

interface BundleItemInput {
  product_id: string
  product_name: string
  product_code: string
  quantity: number
  image_url?: string
}

interface BundleForm {
  name: string
  bundle_code: string
  description: string
  image_url: string | null
  items: BundleItemInput[]
}

const defaultBundleForm: BundleForm = { name: '', bundle_code: '', description: '', image_url: null, items: [] }

function BundlesTab() {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingBundle, setEditingBundle] = useState<ProductBundle | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [form, setForm] = useState<BundleForm>(defaultBundleForm)
  const [productSearch, setProductSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ['product-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_bundles')
        .select('*, items:bundle_items(*, product:products(id, name, product_code, sale_price, unit, quantity, image_url))')
        .order('name')
      if (error) throw error
      return (data ?? []) as ProductBundle[]
    },
  })

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-simple-for-bundle'],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, product_code, sale_price, unit, quantity, image_url')
        .order('name')
      return (data ?? []) as Pick<Product, 'id' | 'name' | 'product_code' | 'sale_price' | 'unit' | 'quantity' | 'image_url'>[]
    },
    enabled: isModalOpen,
  })

  const filteredProducts = productSearch.trim()
    ? allProducts.filter((p) => {
        const q = productSearch.toLowerCase()
        return p.name.toLowerCase().includes(q) || (p.product_code ?? '').toLowerCase().includes(q)
      }).filter((p) => !form.items.some((i) => i.product_id === p.id))
    : []

  const saveMutation = useMutation({
    mutationFn: async (values: BundleForm) => {
      const payload = {
        name: values.name.trim(),
        bundle_code: values.bundle_code.trim().toUpperCase(),
        description: values.description.trim() || null,
        image_url: values.image_url || null,
      }

      let bundleId: string
      if (editingBundle) {
        const { error } = await supabase.from('product_bundles').update(payload).eq('id', editingBundle.id)
        if (error) throw error
        bundleId = editingBundle.id
        // Delete all old items then re-insert
        await supabase.from('bundle_items').delete().eq('bundle_id', bundleId)
      } else {
        const { data, error } = await supabase.from('product_bundles').insert(payload).select().single()
        if (error) throw error
        bundleId = (data as { id: string }).id
      }

      if (values.items.length > 0) {
        const { error } = await supabase.from('bundle_items').insert(
          values.items.map((item) => ({
            bundle_id: bundleId,
            product_id: item.product_id,
            quantity: item.quantity,
          }))
        )
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-bundles'] })
      toast.success(editingBundle ? 'Cập nhật bộ sản phẩm thành công' : 'Thêm bộ sản phẩm thành công')
      closeModal()
    },
    onError: () => toast.error('Có lỗi xảy ra'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('product_bundles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-bundles'] })
      toast.success('Đã xóa bộ sản phẩm')
      setDeleteId(null)
    },
    onError: () => toast.error('Không thể xóa bộ sản phẩm'),
  })

  function openAdd() {
    setEditingBundle(null)
    setForm({ ...defaultBundleForm, bundle_code: generateBundleCode(bundles.map((b) => b.bundle_code)) })
    setProductSearch('')
    setIsModalOpen(true)
  }

  function openEdit(bundle: ProductBundle) {
    setEditingBundle(bundle)
    setForm({
      name: bundle.name,
      bundle_code: bundle.bundle_code,
      description: bundle.description ?? '',
      image_url: bundle.image_url ?? null,
      items: (bundle.items ?? []).map((bi) => ({
        product_id: bi.product_id,
        product_name: bi.product?.name ?? '',
        product_code: bi.product?.product_code ?? '',
        quantity: bi.quantity,
        image_url: bi.product?.image_url ?? undefined,
      })),
    })
    setProductSearch('')
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingBundle(null)
    setForm(defaultBundleForm)
    setProductSearch('')
    setConfirmCloseOpen(false)
  }

  function requestClose() {
    const dirty = !!form.name.trim() || form.items.length > 0 || editingBundle !== null
    if (dirty) setConfirmCloseOpen(true)
    else closeModal()
  }

  function addProductToBundle(p: Pick<Product, 'id' | 'name' | 'product_code' | 'sale_price' | 'unit' | 'quantity' | 'image_url'>) {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, {
        product_id: p.id,
        product_name: p.name,
        product_code: p.product_code ?? '',
        quantity: 1,
        image_url: p.image_url ?? undefined,
      }],
    }))
    setProductSearch('')
  }

  function removeItemFromBundle(idx: number) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))
  }

  function updateItemQty(idx: number, qty: number) {
    setForm((prev) => {
      const items = [...prev.items]
      items[idx] = { ...items[idx], quantity: Math.max(1, qty) }
      return { ...prev, items }
    })
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-gray-500 text-sm">{bundles.length} bộ sản phẩm</p>
        {canEdit && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Thêm Bộ Sản Phẩm
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
        </div>
      ) : bundles.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Package size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Chưa có bộ sản phẩm nào</p>
          {canEdit && (
            <button onClick={openAdd} className="mt-3 text-purple-600 hover:underline text-sm">
              Tạo bộ sản phẩm đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left text-sm font-medium text-gray-500 px-3 py-3 w-12">Ảnh</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-3 py-3 w-20">Mã Bộ</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-3 py-3 min-w-[160px]">Tên Bộ Sản Phẩm</th>
                  <th className="text-center text-sm font-medium text-gray-500 px-3 py-3 w-16">Số Món</th>
                  <th className="text-right text-sm font-medium text-gray-500 px-3 py-3 w-32">Tổng Giá</th>
                  <th className="text-left text-sm font-medium text-gray-500 px-3 py-3 min-w-[280px]">Ghi Chú</th>
                  <th className="hidden md:table-cell text-left text-sm font-medium text-gray-500 px-3 py-3">Ngày Tạo</th>
                  {canEdit && <th className="text-right text-sm font-medium text-gray-500 px-3 py-3">Thao Tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bundles.map((bundle) => {
                  const isExpanded = expandedId === bundle.id
                  return (
                    <>
                      <tr key={bundle.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : bundle.id)}>
                        <td className="px-3 py-3">
                          {bundle.image_url ? (
                            <img src={bundle.image_url} alt={bundle.name} className="w-9 h-9 rounded-lg object-cover border border-gray-100" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                              <Package size={15} className="text-purple-400" />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">{bundle.bundle_code}</span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-bold text-gray-900 text-sm">{bundle.name}</p>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">
                            {bundle.items?.length ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-semibold text-green-600 text-sm whitespace-nowrap">
                              {(() => {
                                const total = (bundle.items ?? []).reduce((s, bi) => s + (bi.product?.sale_price ?? 0) * bi.quantity, 0)
                                return total > 0 ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(total) : '—'
                              })()}
                            </span>
                            {isExpanded ? <ChevronUp size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-400">
                          {bundle.description ?? ''}
                        </td>
                        <td className="hidden md:table-cell px-3 py-3 text-gray-500 text-sm whitespace-nowrap">{formatDate(bundle.created_at)}</td>
                        {canEdit && (
                          <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEdit(bundle)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <Pencil size={16} />
                              </button>
                              <button onClick={() => setDeleteId(bundle.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (bundle.items ?? []).map((item: BundleItem) => {
                        const linePrice = (item.product?.sale_price ?? 0) * item.quantity
                        return (
                          <tr key={`${bundle.id}-${item.id}`} className="bg-purple-50/30 border-t-0">
                            <td className="px-3 py-1.5 pl-6">
                              {item.product?.image_url ? (
                                <img src={item.product.image_url} alt={item.product.name} className="w-6 h-6 rounded object-cover border border-gray-100" />
                              ) : (
                                <div className="w-6 h-6 rounded bg-gray-50 border border-gray-100 flex items-center justify-center">
                                  <Package size={10} className="text-gray-300" />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[11px] text-gray-400 tabular-nums whitespace-nowrap">{item.product?.product_code}</td>
                            <td className="px-3 py-1.5 text-xs font-medium text-orange-500">{item.product?.name ?? '—'}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className="text-[11px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">SL:{item.quantity}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-xs font-semibold text-gray-800 tabular-nums whitespace-nowrap">
                              {linePrice > 0 ? `${linePrice.toLocaleString('vi-VN')} đ` : '—'}
                            </td>
                            <td />
                            <td className="hidden md:table-cell" />
                            {canEdit && <td />}
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bundle Add / Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={requestClose} title={editingBundle ? 'Chỉnh Sửa Bộ Sản Phẩm' : 'Thêm Bộ Sản Phẩm'} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); if (form.items.length === 0) { toast.error('Vui lòng thêm ít nhất 1 sản phẩm vào bộ'); return } saveMutation.mutate(form) }} className="space-y-4">

          {/* Image */}
          <div className="flex flex-col items-center gap-2">
            <ImageUpload value={form.image_url} onChange={(url) => setForm({ ...form, image_url: url })} bucket="categories" folder="bundles" shape="square" size="lg" />
            <p className="text-xs text-gray-400">Ảnh đại diện bộ sản phẩm (tối đa 5MB)</p>
          </div>

          {/* Name + Code row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên Bộ Sản Phẩm <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="VD: Bộ dưỡng da 3 bước..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã Bộ <span className="text-red-500">*</span></label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={form.bundle_code}
                  onChange={(e) => setForm({ ...form, bundle_code: e.target.value.toUpperCase() })}
                  required
                  maxLength={10}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm font-mono uppercase"
                  placeholder="B001"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, bundle_code: generateBundleCode(bundles.map((b) => b.bundle_code).filter((c) => c !== editingBundle?.bundle_code)) })}
                  title="Tạo mã mới"
                  className="px-2 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 flex-shrink-0"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô Tả</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none text-sm" placeholder="Mô tả bộ sản phẩm..." />
          </div>

          {/* Product picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sản Phẩm Trong Bộ <span className="text-red-500">*</span>
              <span className="ml-2 text-xs text-gray-400 font-normal">({form.items.length} sản phẩm)</span>
            </label>

            {/* Search */}
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Tìm sản phẩm để thêm vào bộ..."
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm"
              />
              {filteredProducts.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredProducts.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProductToBundle(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-purple-50 flex items-center gap-2.5 border-b border-gray-50 last:border-0"
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-7 h-7 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Package size={10} className="text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.product_code} · Tồn: {p.quantity}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected items */}
            {form.items.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                Tìm và thêm sản phẩm vào bộ ở trên
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {form.items.map((item, idx) => (
                  <div key={item.product_id} className="flex items-center gap-2.5 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.product_name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center flex-shrink-0">
                        <Package size={12} className="text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                      <p className="text-xs text-gray-400">{item.product_code}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button type="button" onClick={() => updateItemQty(idx, item.quantity - 1)} className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 text-sm font-bold leading-none">−</button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItemQty(idx, parseInt(e.target.value) || 1)}
                        className="w-12 text-center text-sm border border-gray-300 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <button type="button" onClick={() => updateItemQty(idx, item.quantity + 1)} className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 text-sm font-bold leading-none">+</button>
                    </div>
                    <button type="button" onClick={() => removeItemFromBundle(idx)} className="p-1 text-gray-400 hover:text-red-500 flex-shrink-0">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Hủy</button>
            <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg text-sm font-medium transition-colors">
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Xóa Bộ Sản Phẩm"
        message="Bạn có chắc muốn xóa bộ sản phẩm này? Hành động này không thể hoàn tác."
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
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'categories' | 'bundles'

export function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('categories')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Danh Mục Hàng Hóa</h1>
          <p className="text-gray-500 mt-1 text-sm">Quản lý danh mục và bộ sản phẩm</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('categories')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'categories'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag size={15} />
          Danh Mục
        </button>
        <button
          onClick={() => setActiveTab('bundles')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'bundles'
              ? 'bg-white text-purple-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package size={15} />
          Bộ Sản Phẩm
        </button>
      </div>

      {activeTab === 'categories' ? <CategoriesTab /> : <BundlesTab />}
    </div>
  )
}

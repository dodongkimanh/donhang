import { useState } from 'react'
import { Plus, Pencil, Trash2, Truck, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { formatCurrency, generateBarcode, fmtThousands } from '@/utils/format'
import type { Supplier } from '@/types'

export interface SupplierEntry {
  id?: string
  supplier_id: string
  barcode: string
  cost_price: string
  quantity: string
  note: string
}

interface Props {
  entries: SupplierEntry[]
  onChange: (entries: SupplierEntry[]) => void
  suppliers: Supplier[]
  unit?: string
}

const emptyEntry = (): SupplierEntry => ({
  supplier_id: '',
  barcode: generateBarcode(),
  cost_price: '',
  quantity: '',
  note: '',
})

function BarcodePreviewInline({ barcode }: { barcode: string }) {
  if (!barcode) return null
  let svgData = ''
  try {
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svgEl, barcode, { format: 'CODE128', width: 1.5, height: 40, displayValue: true, fontSize: 10, margin: 3 })
    svgData = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svgEl))
  } catch { return null }
  return <img src={svgData} alt={barcode} className="h-12 mx-auto" />
}

export function ProductSuppliersEditor({ entries, onChange, suppliers, unit = 'cái' }: Props) {
  const [addMode, setAddMode] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState<SupplierEntry>(emptyEntry())
  const [previewBc, setPreviewBc] = useState(false)

  const totalQty = entries.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0)
  const avgCost = entries.length > 0
    ? entries.reduce((s, e) => s + (parseFloat(e.cost_price) || 0), 0) / entries.length
    : 0

  function openAdd() {
    setDraft(emptyEntry())
    setAddMode(true)
    setEditIdx(null)
  }

  function openEdit(idx: number) {
    setDraft({ ...entries[idx] })
    setEditIdx(idx)
    setAddMode(false)
  }

  function cancelDraft() {
    setAddMode(false)
    setEditIdx(null)
    setDraft(emptyEntry())
  }

  function saveDraft() {
    if (!draft.supplier_id) return
    if (editIdx !== null) {
      const next = [...entries]
      next[editIdx] = draft
      onChange(next)
    } else {
      onChange([...entries, draft])
    }
    cancelDraft()
  }

  function removeEntry(idx: number) {
    onChange(entries.filter((_, i) => i !== idx))
  }

  const draftSupplierUsed = (entries.some((e, i) => e.supplier_id === draft.supplier_id && i !== editIdx))

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-4 text-sm bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Truck size={14} className="text-blue-500" />
            <span className="text-gray-600">{entries.length} nhà cung cấp</span>
          </div>
          <div className="h-4 w-px bg-blue-200" />
          <div>
            <span className="text-gray-500">Tổng tồn: </span>
            <span className="font-bold text-gray-900">{totalQty} {unit}</span>
          </div>
          <div className="h-4 w-px bg-blue-200" />
          <div>
            <span className="text-gray-500">Giá nhập TB: </span>
            <span className="font-bold text-gray-900">{formatCurrency(avgCost)}</span>
          </div>
        </div>
      )}

      {/* Entries list */}
      {entries.map((entry, idx) => {
        const isEditing = editIdx === idx
        const sup = suppliers.find((s) => s.id === entry.supplier_id)
        return (
          <div key={entry.id || entry.barcode || entry.supplier_id} className={`border rounded-xl overflow-hidden transition-all ${isEditing ? 'border-blue-400 shadow-md' : 'border-gray-200'}`}>
            {isEditing ? (
              <DraftForm
                draft={draft}
                setDraft={setDraft}
                suppliers={suppliers}
                entries={entries}
                editIdx={editIdx}
                onSave={saveDraft}
                onCancel={cancelDraft}
                previewBc={previewBc}
                setPreviewBc={setPreviewBc}
                draftSupplierUsed={draftSupplierUsed}
              />
            ) : (
              <div className="flex items-start gap-3 px-4 py-3">
                {/* NCC icon */}
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Truck size={14} className="text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{sup?.name ?? 'NCC không xác định'}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                    <span>MV: <span className="font-mono text-gray-700">{entry.barcode}</span></span>
                    <span>Giá nhập: <span className="font-semibold text-red-600">{formatCurrency(parseFloat(entry.cost_price) || 0)}</span></span>
                    <span>Tồn: <span className="font-bold text-green-700">{entry.quantity} {unit}</span></span>
                  </div>
                  {entry.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{entry.note}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => openEdit(idx)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Pencil size={13} />
                  </button>
                  <button type="button" onClick={() => removeEntry(idx)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Add form */}
      {addMode && (
        <div className="border border-blue-400 rounded-xl overflow-hidden shadow-md">
          <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
            <p className="text-sm font-semibold text-blue-800">Thêm Nhà Cung Cấp</p>
          </div>
          <DraftForm
            draft={draft}
            setDraft={setDraft}
            suppliers={suppliers}
            entries={entries}
            editIdx={null}
            onSave={saveDraft}
            onCancel={cancelDraft}
            previewBc={previewBc}
            setPreviewBc={setPreviewBc}
            draftSupplierUsed={draftSupplierUsed}
          />
        </div>
      )}

      {/* Add button */}
      {!addMode && editIdx === null && (
        <button
          type="button"
          onClick={openAdd}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-all"
        >
          <Plus size={15} />
          Thêm Nhà Cung Cấp
        </button>
      )}

      {entries.length === 0 && !addMode && (
        <p className="text-xs text-center text-gray-400 pb-1">
          Chưa có NCC nào. Thêm NCC để quản lý tồn kho và mã vạch theo từng nguồn hàng.
        </p>
      )}
    </div>
  )
}

// ── Inner draft form ──────────────────────────────────────────────────────────

function DraftForm({
  draft, setDraft, suppliers, entries, editIdx, onSave, onCancel, previewBc, setPreviewBc, draftSupplierUsed,
}: {
  draft: SupplierEntry
  setDraft: (d: SupplierEntry) => void
  suppliers: Supplier[]
  entries: SupplierEntry[]
  editIdx: number | null
  onSave: () => void
  onCancel: () => void
  previewBc: boolean
  setPreviewBc: (v: boolean) => void
  draftSupplierUsed: boolean
}) {
  const availableSuppliers = suppliers.filter(
    (s) => !entries.some((e, i) => e.supplier_id === s.id && i !== editIdx)
  )

  return (
    <div className="p-4 space-y-3">
      {/* NCC select */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Nhà Cung Cấp <span className="text-red-500">*</span></label>
        <select
          value={draft.supplier_id}
          onChange={(e) => setDraft({ ...draft, supplier_id: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">-- Chọn NCC --</option>
          {availableSuppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          {editIdx !== null && draft.supplier_id && !availableSuppliers.find(s => s.id === draft.supplier_id) && (
            <option value={draft.supplier_id}>{suppliers.find(s => s.id === draft.supplier_id)?.name}</option>
          )}
        </select>
        {draftSupplierUsed && (
          <p className="text-xs text-red-500 mt-1">NCC này đã được thêm rồi</p>
        )}
        {suppliers.length === 0 && (
          <p className="text-xs text-orange-500 mt-1">Chưa có NCC nào. Vào trang Nhà Cung Cấp để tạo trước.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Barcode */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Mã Vạch NCC <span className="text-gray-400">(barcode của nhà cung cấp này)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft.barcode}
              onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Quét hoặc nhập mã vạch của NCC"
            />
            <button
              type="button"
              onClick={() => setDraft({ ...draft, barcode: generateBarcode() })}
              className="px-2.5 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500"
              title="Tạo mã vạch mới"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={() => setPreviewBc(!previewBc)}
              className={`px-2.5 py-2 border rounded-lg text-xs ${previewBc ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
              title="Xem trước mã vạch"
            >
              {previewBc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {previewBc && draft.barcode && (
            <div className="mt-2 bg-white border border-gray-100 rounded-lg p-2">
              <BarcodePreviewInline barcode={draft.barcode} />
            </div>
          )}
        </div>

        {/* Cost price */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Giá Nhập (VNĐ)</label>
          <input
            type="text"
            inputMode="numeric"
            value={fmtThousands(draft.cost_price)}
            onChange={(e) => setDraft({ ...draft, cost_price: e.target.value.replace(/\D/g, '') })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="0"
          />
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Số Lượng Nhập</label>
          <input
            type="text"
            inputMode="numeric"
            value={fmtThousands(draft.quantity)}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value.replace(/\D/g, '') })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="0"
          />
        </div>

        {/* Note */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Ghi Chú</label>
          <input
            type="text"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="VD: Hàng chính hãng, bảo hành 12 tháng..."
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.supplier_id || draftSupplierUsed}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={14} />
          {editIdx !== null ? 'Cập nhật' : 'Thêm NCC'}
        </button>
      </div>
    </div>
  )
}

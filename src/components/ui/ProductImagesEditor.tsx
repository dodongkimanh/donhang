import { useRef, useState } from 'react'
import { Upload, X, Crown, ImageIcon, Plus } from 'lucide-react'
import { uploadImage, validateImageFile } from '@/utils/imageUpload'
import toast from 'react-hot-toast'

interface Props {
  images: string[]
  onChange: (images: string[]) => void
  bucket?: string
  folder?: string
  maxImages?: number
}

export function ProductImagesEditor({
  images,
  onChange,
  bucket = 'products',
  folder = 'products',
  maxImages = 8,
}: Props) {
  const primaryInputRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPrimary, setUploadingPrimary] = useState(false)
  const [uploadingNew, setUploadingNew] = useState(false)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  const primary = images[0]

  // ── Upload helpers ──────────────────────────────────────────────────────────

  async function uploadFile(
    file: File,
    mode: 'primary' | 'replace' | 'add',
    replaceIdx?: number,
  ) {
    const err = validateImageFile(file)
    if (err) { toast.error(err); return }

    if (mode === 'primary') setUploadingPrimary(true)
    else if (mode === 'replace' && replaceIdx !== undefined) setUploadingIdx(replaceIdx)
    else setUploadingNew(true)

    try {
      const url = await uploadImage(file, bucket, folder)
      if (mode === 'primary') {
        // Replace first slot (or prepend if empty)
        const next = images.length > 0 ? [url, ...images.slice(1)] : [url]
        onChange(next)
      } else if (mode === 'replace' && replaceIdx !== undefined) {
        const next = [...images]
        next[replaceIdx] = url
        onChange(next)
      } else {
        onChange([...images, url])
      }
    } catch {
      toast.error('Không thể tải ảnh lên')
    } finally {
      setUploadingPrimary(false)
      setUploadingNew(false)
      setUploadingIdx(null)
    }
  }

  function handlePrimaryFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    uploadFile(f, 'primary')
    e.target.value = ''
  }

  function handleAddFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    uploadFile(f, 'add')
    e.target.value = ''
  }

  function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>, idx: number) {
    const f = e.target.files?.[0]; if (!f) return
    uploadFile(f, 'replace', idx)
    e.target.value = ''
  }

  // ── Image management ────────────────────────────────────────────────────────

  function setPrimary(idx: number) {
    if (idx === 0) return
    const next = [...images]
    const [moved] = next.splice(idx, 1)
    next.unshift(moved)
    onChange(next)
    toast.success('Đã đặt làm ảnh chính')
  }

  function removeImage(idx: number) {
    onChange(images.filter((_, i) => i !== idx))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* ── Primary (large) image ─────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden bg-gray-100 border border-gray-200" style={{ aspectRatio: '16/9', minHeight: '180px' }}>
        {primary ? (
          <>
            <img src={primary} alt="Ảnh chính" className="w-full h-full object-cover" />
            {/* Overlay on hover */}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all group flex items-center justify-center">
              <button
                type="button"
                onClick={() => primaryInputRef.current?.click()}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center text-white gap-1"
              >
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                  <Upload size={18} />
                </div>
                <span className="text-xs font-medium">Thay ảnh chính</span>
              </button>
            </div>
            {/* Primary badge */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-yellow-400 text-yellow-900 text-xs font-bold px-2.5 py-1 rounded-xl shadow">
              <Crown size={11} />
              Ảnh chính
            </div>
            {/* Loading overlay */}
            {uploadingPrimary && (
              <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => primaryInputRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
          >
            {uploadingPrimary ? (
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-gray-200 flex items-center justify-center">
                  <ImageIcon size={28} className="text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-600">Thêm ảnh chính</p>
                  <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, WebP · tối đa 5MB</p>
                </div>
              </>
            )}
          </button>
        )}
        <input ref={primaryInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePrimaryFile} className="hidden" />
      </div>

      {/* ── Thumbnail row ─────────────────────────────────── */}
      {(images.length > 0 || images.length < maxImages) && (
        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => {
            const isLoading = uploadingIdx === idx
            return (
              <div key={idx} className="relative group flex-shrink-0">
                {/* Thumbnail */}
                <div
                  className={`w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                    idx === 0
                      ? 'border-yellow-400 shadow shadow-yellow-100'
                      : 'border-gray-200 hover:border-blue-400 hover:shadow-md'
                  }`}
                  onClick={() => setPrimary(idx)}
                  title={idx === 0 ? 'Ảnh chính' : 'Nhấn để đặt làm ảnh chính'}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  {isLoading && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-xl">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                    </div>
                  )}
                </div>

                {/* Primary badge on thumbnail */}
                {idx === 0 && (
                  <div className="absolute bottom-0 left-0 right-0 bg-yellow-400/90 text-yellow-900 text-[9px] font-bold text-center py-0.5 rounded-b-xl">
                    Chính
                  </div>
                )}

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeImage(idx) }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md z-10"
                >
                  <X size={10} />
                </button>

                {/* Replace on click (double-click or right area) */}
                <label
                  className="absolute inset-0 cursor-pointer opacity-0"
                  title="Nhấn để thay ảnh"
                  style={{ display: idx === 0 ? 'none' : 'block' }}
                >
                  <input
                    type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => handleReplaceFile(e, idx)}
                    className="hidden"
                  />
                </label>
              </div>
            )
          })}

          {/* Add more button */}
          {images.length < maxImages && (
            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              className="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 bg-gray-50 hover:bg-blue-50 flex flex-col items-center justify-center gap-0.5 transition-all flex-shrink-0"
            >
              {uploadingNew ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              ) : (
                <>
                  <Plus size={18} className="text-gray-400" />
                  <span className="text-[10px] text-gray-400 font-medium">Thêm</span>
                </>
              )}
            </button>
          )}
          <input ref={addInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAddFile} className="hidden" />
        </div>
      )}

      {images.length > 1 && (
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Crown size={10} className="text-yellow-500" />
          Nhấn vào ảnh nhỏ để đặt làm ảnh chính · Tối đa {maxImages} ảnh
        </p>
      )}
    </div>
  )
}

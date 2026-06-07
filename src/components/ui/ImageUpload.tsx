import { useRef, useState } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'
import { uploadImage, validateImageFile } from '@/utils/imageUpload'
import toast from 'react-hot-toast'

interface Props {
  value?: string | null
  onChange: (url: string | null) => void
  bucket?: string
  folder?: string
  shape?: 'square' | 'circle'
  size?: 'sm' | 'md' | 'lg'
}

const sizeCls: Record<string, string> = {
  sm: 'w-12 h-12',
  md: 'w-28 h-28',
  lg: 'w-36 h-36',
}

export function ImageUpload({
  value,
  onChange,
  bucket = 'images',
  folder = 'uploads',
  shape = 'square',
  size = 'md',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  const shapeCls = shape === 'circle' ? 'rounded-full' : 'rounded-xl'

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const err = validateImageFile(file)
    if (err) { toast.error(err); return }

    setLoading(true)
    try {
      const url = await uploadImage(file, bucket, folder)
      onChange(url)
    } catch {
      toast.error('Không thể tải ảnh lên')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={`relative ${sizeCls[size]} ${shapeCls} flex-shrink-0 overflow-hidden group cursor-pointer`}>
      {value ? (
        <>
          <img
            src={value}
            alt="preview"
            className="w-full h-full object-cover"
          />
          {/* hover overlay */}
          <div
            className={`absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 ${shapeCls}`}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="p-1.5 bg-white rounded-lg hover:bg-gray-100 transition-colors"
              title="Thay ảnh"
            >
              <Upload size={13} className="text-gray-700" />
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="p-1.5 bg-white rounded-lg hover:bg-red-50 transition-colors"
              title="Xóa ảnh"
            >
              <X size={13} className="text-red-600" />
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full h-full border-2 border-dashed border-gray-300 hover:border-blue-400 bg-gray-50 hover:bg-blue-50 transition-colors flex flex-col items-center justify-center gap-1 ${shapeCls}`}
        >
          <ImageIcon size={size === 'sm' ? 14 : 22} className="text-gray-400" />
          {size !== 'sm' && (
            <span className="text-xs text-gray-400">Tải ảnh</span>
          )}
        </button>
      )}

      {loading && (
        <div className={`absolute inset-0 bg-white/70 flex items-center justify-center ${shapeCls}`}>
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}

import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

export default function IOSInstallGuide({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md animate-slide-up rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
              <span className="text-xl font-bold text-white">KA</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Cài đặt ứng dụng</h3>
              <p className="text-sm text-gray-500">KA CRM - Quản Lý Đơn Hàng</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600">
            Làm theo 3 bước để cài app, ẩn thanh địa chỉ & có icon trên màn hình chính:
          </p>

          <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">1</span>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Nhấn nút{' '}
                <span className="inline-flex items-center justify-center rounded bg-blue-600 px-1.5 py-0.5 align-middle">
                  <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>
                {' '}ở thanh dưới cùng Safari
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">2</span>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Cuộn xuống → chọn <strong>"Thêm vào MH chính"</strong>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Add to Home Screen</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">3</span>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Nhấn <strong>"Thêm"</strong> ở góc trên bên phải
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-center pb-3">
          <svg className="h-8 w-8 animate-bounce text-blue-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 16l-6-6h12l-6 6z"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

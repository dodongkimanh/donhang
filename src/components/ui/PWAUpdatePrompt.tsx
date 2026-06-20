import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'

export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg bg-blue-600 p-4 text-white shadow-lg sm:left-auto sm:right-4">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 flex-shrink-0" />
        <p className="flex-1 text-sm">Có bản cập nhật mới!</p>
        <button
          onClick={() => updateServiceWorker(true)}
          className="rounded-md bg-white px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
        >
          Cập nhật
        </button>
      </div>
    </div>
  )
}

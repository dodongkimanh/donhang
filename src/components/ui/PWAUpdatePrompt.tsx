import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Tự động áp dụng bản cập nhật ngay khi phát hiện, thay vì chờ người dùng
// bấm nút — trước đây nếu người dùng bỏ qua banner, họ bị kẹt ở bản cũ và
// phải tự F5 nhiều lần mới "trúng" bản mới.
export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (needRefresh) updateServiceWorker(true)
  }, [needRefresh, updateServiceWorker])

  return null
}

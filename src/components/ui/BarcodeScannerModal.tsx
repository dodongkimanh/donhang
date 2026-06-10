import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { X, Camera, CameraOff, RefreshCw, Scan } from 'lucide-react'

interface Props {
  onDetected: (barcode: string) => void
  onClose: () => void
}

export function BarcodeScannerModal({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [status, setStatus] = useState<'loading' | 'scanning' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastBarcode, setLastBarcode] = useState('')
  const cooldownRef = useRef(false)

  // Detect number of cameras (labels may be empty before permission, so just count)
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then((devices) => {
        setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1)
      })
      .catch(() => {})
  }, [])

  // Start/restart scanner when facingMode changes
  useEffect(() => {
    if (!videoRef.current) return

    const reader = new BrowserMultiFormatReader()
    cooldownRef.current = false
    setStatus('loading')
    setLastBarcode('')

    reader
      .decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current,
        (result, err, controls) => {
          if (controls) controlsRef.current = controls

          if (result) {
            if (cooldownRef.current) return
            cooldownRef.current = true
            const text = result.getText()
            setLastBarcode(text)
            setStatus('scanning')
            setTimeout(() => {
              controls?.stop()
              controlsRef.current = null
              onDetected(text)
              onClose()
            }, 600)
            return
          }

          if (err instanceof NotFoundException) return

          if (err) {
            setStatus('error')
            setErrorMsg('Lỗi quét mã. Thử đổi camera hoặc tải lại.')
          }
        }
      )
      .then((controls) => {
        controlsRef.current = controls
        setStatus('scanning')
      })
      .catch(() => {
        setStatus('error')
        setErrorMsg('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập.')
      })

    return () => {
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [facingMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchCamera() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Full-screen video */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        autoPlay
      />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 text-white">
            <Scan size={20} className="text-blue-400" />
            <span className="font-semibold">Quét Mã Vạch</span>
          </div>
          <button
            onClick={() => { controlsRef.current?.stop(); onClose() }}
            className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Scanning frame */}
      {status === 'scanning' && !lastBarcode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: 60 }}>
          <div className="relative" style={{ width: '78%', height: '28%' }}>
            {/* corners */}
            <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-white" />
            <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-white" />
            <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-white" />
            <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-white" />
          </div>
        </div>
      )}

      {/* Success overlay */}
      {lastBarcode && (
        <div className="absolute inset-0 flex items-center justify-center bg-green-500/30">
          <div className="bg-green-600 text-white px-6 py-4 rounded-2xl text-center shadow-2xl">
            <p className="text-sm opacity-80 mb-1">Đã quét được</p>
            <p className="font-bold font-mono text-lg">{lastBarcode}</p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-black/60">
          <Camera size={40} className="animate-pulse text-blue-400" />
          <p className="text-gray-300">Đang khởi động camera...</p>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-4 px-8 text-center bg-black/80">
          <CameraOff size={40} className="text-red-400" />
          <p className="text-gray-300">{errorMsg}</p>
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between px-4 py-5">
          <p className="text-sm text-gray-300">
            {status === 'scanning' && !lastBarcode && 'Đặt mã vạch vào trong khung để quét.'}
          </p>
          {hasMultipleCameras && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-full text-sm transition-colors"
            >
              <RefreshCw size={14} />
              Đổi camera
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

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
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraIdx, setCameraIdx] = useState(0)
  const [status, setStatus] = useState<'loading' | 'scanning' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastBarcode, setLastBarcode] = useState('')
  const cooldownRef = useRef(false)

  // List cameras on mount
  useEffect(() => {
    BrowserMultiFormatReader.listVideoInputDevices()
      .then((devices) => {
        if (!devices.length) {
          setStatus('error')
          setErrorMsg('Không tìm thấy camera nào trên thiết bị này.')
          return
        }
        // prefer back camera on mobile
        const backIdx = devices.findIndex((d) =>
          /back|rear|environment/i.test(d.label)
        )
        setCameras(devices)
        setCameraIdx(backIdx >= 0 ? backIdx : 0)
      })
      .catch(() => {
        setStatus('error')
        setErrorMsg('Không thể truy cập camera. Vui lòng cấp quyền camera.')
      })
  }, [])

  // Start/restart scanner when camera changes
  useEffect(() => {
    if (!cameras.length || !videoRef.current) return

    const reader = new BrowserMultiFormatReader()
    const deviceId = cameras[cameraIdx]?.deviceId
    cooldownRef.current = false
    setStatus('loading')
    setLastBarcode('')

    reader
      .decodeFromVideoDevice(deviceId, videoRef.current, (result, err, controls) => {
        // store controls for cleanup
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

        if (err instanceof NotFoundException) return // normal: no barcode in frame

        if (err) {
          setStatus('error')
          setErrorMsg('Lỗi quét mã. Thử đổi camera hoặc tải lại.')
        }
      })
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
  }, [cameras, cameraIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchCamera() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setCameraIdx((i) => (i + 1) % cameras.length)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800">
          <div className="flex items-center gap-2 text-white">
            <Scan size={18} className="text-blue-400" />
            <span className="text-sm font-semibold">Quét Mã Vạch</span>
          </div>
          <button
            onClick={() => { controlsRef.current?.stop(); onClose() }}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors text-gray-300 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Camera view */}
        <div className="relative bg-black aspect-[4/3] flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
            autoPlay
          />

          {/* Scanning overlay */}
          {status === 'scanning' && !lastBarcode && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-52 h-36">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br" />
                <div className="absolute left-2 right-2 h-0.5 bg-blue-400 opacity-80 animate-scan-line" />
              </div>
            </div>
          )}

          {/* Success overlay */}
          {lastBarcode && (
            <div className="absolute inset-0 flex items-center justify-center bg-green-500/30">
              <div className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-center shadow-lg">
                <p className="text-xs opacity-80 mb-0.5">Đã quét được</p>
                <p className="font-bold font-mono text-sm">{lastBarcode}</p>
              </div>
            </div>
          )}

          {/* Loading */}
          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
              <Camera size={32} className="animate-pulse text-blue-400" />
              <p className="text-sm text-gray-300">Đang khởi động camera...</p>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 px-6 text-center">
              <CameraOff size={32} className="text-red-400" />
              <p className="text-sm text-gray-300">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-800 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400 flex-1">
            {status === 'scanning' && !lastBarcode && 'Hướng camera vào mã vạch sản phẩm'}
          </p>
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs transition-colors"
            >
              <RefreshCw size={13} />
              Đổi camera
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scan-line {
          0%   { top: 8px; opacity: 1; }
          50%  { top: calc(100% - 8px); opacity: 0.6; }
          100% { top: 8px; opacity: 1; }
        }
        .animate-scan-line { animation: scan-line 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

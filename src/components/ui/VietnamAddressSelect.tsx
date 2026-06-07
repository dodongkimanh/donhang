import { useState, useEffect, useRef } from 'react'

interface Province { code: number; name: string }
interface District { code: number; name: string }
interface Ward { code: number; name: string }

interface Props {
  onChange: (address: string) => void
  inputClassName?: string
}

export function VietnamAddressSelect({ onChange, inputClassName }: Props) {
  const [provinces, setProvinces] = useState<Province[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [loadingProvinces, setLoadingProvinces] = useState(true)
  const [loadingDistricts, setLoadingDistricts] = useState(false)
  const [loadingWards, setLoadingWards] = useState(false)
  const [apiError, setApiError] = useState(false)

  const [provinceCode, setProvinceCode] = useState('')
  const [districtCode, setDistrictCode] = useState('')
  const [wardCode, setWardCode] = useState('')
  const [street, setStreet] = useState('')

  const provinceNameRef = useRef('')
  const districtNameRef = useRef('')
  const wardNameRef = useRef('')

  const cls = inputClassName ?? 'w-full px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 bg-white'

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch('https://provinces.open-api.vn/api/p/', { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Province[]) => {
        setProvinces(data)
        setLoadingProvinces(false)
      })
      .catch(() => {
        setApiError(true)
        setLoadingProvinces(false)
      })
      .finally(() => clearTimeout(timeout))
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [])

  function buildAddress(streetVal: string, ward: string, district: string, province: string) {
    const parts = [streetVal.trim(), ward, district, province].filter(Boolean)
    onChange(parts.join(', '))
  }

  function handleProvinceChange(code: string) {
    setProvinceCode(code)
    setDistrictCode('')
    setWardCode('')
    setDistricts([])
    setWards([])
    districtNameRef.current = ''
    wardNameRef.current = ''

    const p = provinces.find((p) => String(p.code) === code)
    provinceNameRef.current = p?.name ?? ''
    buildAddress(street, '', '', p?.name ?? '')

    if (code) {
      setLoadingDistricts(true)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      fetch(`https://provinces.open-api.vn/api/p/${code}?depth=2`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => { setDistricts(data.districts ?? []) })
        .catch(() => {})
        .finally(() => { setLoadingDistricts(false); clearTimeout(timeout) })
    }
  }

  function handleDistrictChange(code: string) {
    setDistrictCode(code)
    setWardCode('')
    setWards([])
    wardNameRef.current = ''

    const d = districts.find((d) => String(d.code) === code)
    districtNameRef.current = d?.name ?? ''
    buildAddress(street, '', d?.name ?? '', provinceNameRef.current)

    if (code) {
      setLoadingWards(true)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      fetch(`https://provinces.open-api.vn/api/d/${code}?depth=2`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => { setWards(data.wards ?? []) })
        .catch(() => {})
        .finally(() => { setLoadingWards(false); clearTimeout(timeout) })
    }
  }

  function handleWardChange(code: string) {
    setWardCode(code)
    const w = wards.find((w) => String(w.code) === code)
    wardNameRef.current = w?.name ?? ''
    buildAddress(street, w?.name ?? '', districtNameRef.current, provinceNameRef.current)
  }

  function handleStreetChange(val: string) {
    setStreet(val)
    buildAddress(val, wardNameRef.current, districtNameRef.current, provinceNameRef.current)
  }

  // Fallback to plain text if API unavailable
  if (apiError) {
    return (
      <input
        type="text"
        onChange={(e) => onChange(e.target.value)}
        placeholder="Địa chỉ"
        className={cls}
      />
    )
  }

  if (loadingProvinces) {
    return <p className="text-xs text-gray-400 italic py-1">Đang tải danh sách tỉnh thành...</p>
  }

  return (
    <div className="space-y-1.5">
      {/* Tỉnh / Thành phố */}
      <select value={provinceCode} onChange={(e) => handleProvinceChange(e.target.value)} className={cls}>
        <option value="">— Tỉnh / Thành phố —</option>
        {provinces.map((p) => (
          <option key={p.code} value={String(p.code)}>{p.name}</option>
        ))}
      </select>

      {/* Quận / Huyện */}
      {provinceCode && (
        <select
          value={districtCode}
          onChange={(e) => handleDistrictChange(e.target.value)}
          disabled={loadingDistricts}
          className={cls}
        >
          <option value="">{loadingDistricts ? 'Đang tải...' : '— Quận / Huyện —'}</option>
          {districts.map((d) => (
            <option key={d.code} value={String(d.code)}>{d.name}</option>
          ))}
        </select>
      )}

      {/* Phường / Xã */}
      {districtCode && (
        <select
          value={wardCode}
          onChange={(e) => handleWardChange(e.target.value)}
          disabled={loadingWards}
          className={cls}
        >
          <option value="">{loadingWards ? 'Đang tải...' : '— Phường / Xã —'}</option>
          {wards.map((w) => (
            <option key={w.code} value={String(w.code)}>{w.name}</option>
          ))}
        </select>
      )}

      {/* Số nhà / Tên đường */}
      <input
        type="text"
        value={street}
        onChange={(e) => handleStreetChange(e.target.value)}
        placeholder="Số nhà, tên đường..."
        className={cls}
      />
    </div>
  )
}

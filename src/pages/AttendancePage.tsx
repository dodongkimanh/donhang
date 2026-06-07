import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Upload, CheckSquare, Plus,
  X, Download, FileText, AlertTriangle, Check,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Attendance, AttendanceShift, Profile } from '@/types'
import toast from 'react-hot-toast'
import { format, getDaysInMonth, getDay, addMonths, subMonths } from 'date-fns'
import { parseCSV } from '@/utils/csvUtils'
import { Modal } from '@/components/ui/Modal'

// ── Shift config ──────────────────────────────────────────────────────────────

const SHIFTS = [
  { id: 'morning' as AttendanceShift, label: 'Buổi Sáng', timeLabel: '08:30 - 11:45', startH: 8, startM: 30, endH: 11, endM: 45 },
  { id: 'afternoon' as AttendanceShift, label: 'Buổi Chiều', timeLabel: '13:30 - 17:00', startH: 13, startM: 30, endH: 17, endM: 0 },
]

const GRACE = 5  // minutes grace for on-time determination

const DAY_ABBRS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const COL_W = 44   // px width per day column
const FREEZE1 = 88  // px — "Ca làm việc" column
const FREEZE2 = 148 // px — "Nhân viên" column

// ── Status types & helpers ────────────────────────────────────────────────────

type CellStatus = 'on_time' | 'late_or_early' | 'missing_punch' | 'absent' | 'day_off' | 'future' | 'in_progress'

const STATUS_DOT: Record<CellStatus, string> = {
  on_time:       'bg-blue-500',
  late_or_early: 'bg-purple-500',
  missing_punch: 'bg-red-500',
  absent:        'bg-orange-400',
  day_off:       'bg-gray-300',
  in_progress:   'bg-blue-300',
  future:        '',
}

const STATUS_LABELS: Record<Exclude<CellStatus, 'future' | 'in_progress'>, string> = {
  on_time:       'Đúng giờ',
  late_or_early: 'Đi muộn / Về sớm',
  missing_punch: 'Chấm công thiếu',
  absent:        'Chưa chấm công',
  day_off:       'Nghỉ làm',
}

function getCellStatus(
  rec: Attendance | undefined,
  shift: typeof SHIFTS[0],
  date: Date,
  now: Date,
): CellStatus {
  if (getDay(date) === 0) return 'day_off'

  const dOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (dOnly > nOnly) return 'future'

  if (!rec || (!rec.check_in && !rec.check_out)) return 'absent'

  if (rec.check_in && !rec.check_out) {
    const shiftEnd = new Date(date)
    shiftEnd.setHours(shift.endH, shift.endM + GRACE, 0)
    return now > shiftEnd ? 'missing_punch' : 'in_progress'
  }

  if (!rec.check_in && rec.check_out) return 'missing_punch'

  const expIn = new Date(date)
  expIn.setHours(shift.startH, shift.startM + GRACE, 0)
  const expOut = new Date(date)
  expOut.setHours(shift.endH, shift.endM - GRACE, 0)

  if (new Date(rec.check_in!) > expIn || new Date(rec.check_out!) < expOut) return 'late_or_early'
  return 'on_time'
}

// ── Upload / compare types ────────────────────────────────────────────────────

interface UploadRecord {
  name: string
  date: string
  shift: AttendanceShift
  checkIn: string
  checkOut: string
}

interface CompareRow {
  name: string
  date: string
  shift: AttendanceShift
  sysCI?: string
  sysCO?: string
  csvCI: string
  csvCO: string
  status: 'match' | 'discrepancy' | 'missing_sys'
}

function normalizeVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim()
}

function hhmm(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function parseUploadCSV(text: string): UploadRecord[] {
  const rows = parseCSV(text)
  return rows.flatMap((row) => {
    const name   = row['Họ tên'] || row['Ho ten'] || row['Họ và tên'] || ''
    const dateRaw = row['Ngày']  || row['Ngay']   || row['Date']      || ''
    const shiftRaw = row['Ca']   || row['Shift']  || ''
    const ciRaw  = row['Giờ vào'] || row['Gio vao'] || row['Check in']  || ''
    const coRaw  = row['Giờ ra']  || row['Gio ra']  || row['Check out'] || ''

    if (!name || !dateRaw) return []

    let date = dateRaw
    if (dateRaw.includes('/')) {
      const [d, m, y] = dateRaw.split('/')
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }

    const sl = shiftRaw.toLowerCase()
    const shift: AttendanceShift =
      sl.includes('chiều') || sl.includes('chieu') || sl === 'pm' || sl === 'afternoon'
        ? 'afternoon' : 'morning'

    return [{ name: name.trim(), date, shift, checkIn: ciRaw.trim(), checkOut: coRaw.trim() }]
  })
}

function downloadTemplate() {
  const headers = ['Họ tên', 'Ngày', 'Ca', 'Giờ vào', 'Giờ ra']
  const samples = [
    ['Nguyễn Văn A', '01/06/2026', 'Sáng',  '08:32', '11:45'],
    ['Nguyễn Văn A', '01/06/2026', 'Chiều', '13:30', '17:00'],
    ['Trần Thị B',  '01/06/2026', 'Sáng',  '08:45', '11:40'],
  ]
  const csv = [headers, ...samples].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'mau-cham-cong.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── AttendancePage ─────────────────────────────────────────────────────────────

export function AttendancePage() {
  const { profile, isAdmin, isAccountant } = useAuth()
  const canViewAll = isAdmin || isAccountant

  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [compareRows, setCompareRows] = useState<CompareRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const year  = currentMonth.getFullYear()
  const month = currentMonth.getMonth() + 1
  const daysCount = getDaysInMonth(currentMonth)
  const today = new Date()

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => new Date(year, month - 1, i + 1)),
    [year, month, daysCount],
  )

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').order('full_name')
      return (data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]
    },
    enabled: canViewAll,
  })

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(daysCount).padStart(2, '0')}`

  const { data: attendances = [], isLoading } = useQuery({
    queryKey: ['attendance-monthly', startDate, endDate, profile?.id, canViewAll],
    queryFn: async () => {
      let q = supabase
        .from('attendance')
        .select('*, employee:profiles(id, full_name, role)')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date', { ascending: true })
      if (!canViewAll && profile) q = q.eq('employee_id', profile.id)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Attendance[]
    },
    enabled: !!profile,
  })

  const attMap = useMemo(() => {
    const m = new Map<string, Attendance>()
    attendances.forEach((a) => m.set(`${a.employee_id}-${a.shift}-${a.work_date}`, a))
    return m
  }, [attendances])

  const displayEmployees: Pick<Profile, 'id' | 'full_name' | 'role'>[] = canViewAll
    ? employees
    : profile ? [{ id: profile.id, full_name: profile.full_name, role: profile.role }] : []

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const uploaded = parseUploadCSV(text)
      if (!uploaded.length) {
        toast.error('Không đọc được dữ liệu. Kiểm tra định dạng file CSV.')
        return
      }
      const rows: CompareRow[] = uploaded.map((u) => {
        const emp = displayEmployees.find((e) => normalizeVi(e.full_name) === normalizeVi(u.name))
        if (!emp) return { name: u.name, date: u.date, shift: u.shift, csvCI: u.checkIn, csvCO: u.checkOut, status: 'missing_sys' as const }
        const sysRec = attMap.get(`${emp.id}-${u.shift}-${u.date}`)
        const sCI = hhmm(sysRec?.check_in)
        const sCO = hhmm(sysRec?.check_out)
        let status: CompareRow['status'] = 'missing_sys'
        if (sysRec) {
          const ciDiff = Math.abs(hhmmToMin(sCI === '-' ? '0:0' : sCI) - hhmmToMin(u.checkIn || '0:0'))
          const coDiff = Math.abs(hhmmToMin(sCO === '-' ? '0:0' : sCO) - hhmmToMin(u.checkOut || '0:0'))
          status = ciDiff <= 5 && coDiff <= 5 ? 'match' : 'discrepancy'
        }
        return { name: emp.full_name, date: u.date, shift: u.shift, sysCI: sCI, sysCO: sCO, csvCI: u.checkIn, csvCO: u.checkOut, status }
      })
      setCompareRows(rows)
      setShowUploadModal(true)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const tableMinW = FREEZE1 + FREEZE2 + daysCount * COL_W

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">Bảng chấm công</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Month navigation */}
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden text-sm">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="px-2 py-1.5 hover:bg-gray-100 border-r border-gray-300"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="px-3 py-1.5 font-medium whitespace-nowrap">
              Tháng {month}, {year}
            </span>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="px-2 py-1.5 hover:bg-gray-100 border-l border-gray-300"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <button
            onClick={() => setCurrentMonth(new Date())}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            Chọn
          </button>

          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          {(isAdmin || isAccountant) && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              <Upload size={14} />
              Tải file chấm công
            </button>
          )}

          {(isAdmin || isAccountant) && (
            <button
              onClick={() => toast.success(`Đã duyệt chấm công tháng ${month}/${year}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
            >
              <CheckSquare size={14} />
              Duyệt chấm công
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table
              className="border-collapse text-sm select-none"
              style={{ minWidth: tableMinW, tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: FREEZE1 }} />
                <col style={{ width: FREEZE2 }} />
                {days.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
              </colgroup>

              {/* ── Header row ── */}
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 border-r border-gray-200 text-left px-2.5 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap">
                    Ca làm việc
                    {isAdmin && <button className="ml-1 text-blue-400 hover:text-blue-600 align-middle"><Plus size={11} /></button>}
                  </th>
                  <th
                    className="sticky z-20 bg-gray-50 border-r border-gray-200 text-left px-2.5 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap"
                    style={{ left: FREEZE1 }}
                  >
                    Nhân viên
                    {isAdmin && <button className="ml-1 text-blue-400 hover:text-blue-600 align-middle"><Plus size={11} /></button>}
                  </th>
                  {days.map((d) => {
                    const dow    = getDay(d)
                    const isSun  = dow === 0
                    const isToday = format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')
                    return (
                      <th
                        key={d.getDate()}
                        className={`border-r border-gray-100 text-center py-1 px-0 ${isSun ? 'bg-gray-100' : ''}`}
                      >
                        <div className={`text-[10px] font-medium leading-none mb-0.5 ${isSun ? 'text-gray-400' : 'text-gray-500'}`}>
                          {DAY_ABBRS[dow]}
                        </div>
                        <div className="flex justify-center">
                          <span className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full ${
                            isToday ? 'bg-blue-600 text-white' : isSun ? 'text-gray-400' : 'text-gray-700'
                          }`}>
                            {String(d.getDate()).padStart(2, '0')}
                          </span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>

              <tbody>
                {SHIFTS.map((shift, shiftIdx) => (
                  <>
                    {/* ── Shift group header ── */}
                    <tr key={`sh-${shift.id}`} className="border-b border-gray-200 bg-gray-50/80">
                      <td className="sticky left-0 z-10 bg-gray-50 border-r border-gray-200 px-2.5 py-1.5">
                        <div className="font-semibold text-xs text-gray-800 leading-tight">{shift.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{shift.timeLabel}</div>
                      </td>
                      <td
                        className="sticky z-10 bg-gray-50 border-r border-gray-200"
                        style={{ left: FREEZE1 }}
                      />
                      {days.map((d) => (
                        <td
                          key={d.getDate()}
                          className={`border-r border-gray-100 py-1 ${getDay(d) === 0 ? 'bg-gray-100' : 'bg-gray-50'}`}
                        />
                      ))}
                    </tr>

                    {/* ── Employee rows ── */}
                    {displayEmployees.map((emp) => (
                      <tr
                        key={`${shift.id}-${emp.id}`}
                        className="border-b border-gray-100 hover:bg-blue-50/20 transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-white border-r border-gray-100 px-2.5 py-1.5" />
                        <td
                          className="sticky z-10 bg-white border-r border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 whitespace-nowrap overflow-hidden"
                          style={{ left: FREEZE1 }}
                          title={emp.full_name}
                        >
                          {emp.full_name.length > 17 ? emp.full_name.slice(0, 16) + '…' : emp.full_name}
                        </td>
                        {days.map((d) => {
                          const dateStr = format(d, 'yyyy-MM-dd')
                          const rec     = attMap.get(`${emp.id}-${shift.id}-${dateStr}`)
                          const status  = getCellStatus(rec, shift, d, today)
                          const isSun   = getDay(d) === 0
                          const label   = STATUS_LABELS[status as keyof typeof STATUS_LABELS]
                          return (
                            <td
                              key={d.getDate()}
                              className={`border-r border-gray-100 text-center py-1.5 ${isSun ? 'bg-gray-50' : ''}`}
                            >
                              {status !== 'future' && STATUS_DOT[status] && (
                                <span
                                  className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[status]}`}
                                  title={label ?? ''}
                                />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}

                    {/* Spacer between shifts */}
                    {shiftIdx < SHIFTS.length - 1 && (
                      <tr key={`sp-${shift.id}`}>
                        <td colSpan={2 + daysCount} className="py-1.5 border-b border-gray-100" />
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Legend ── */}
          <div className="flex items-center justify-center gap-4 px-4 py-2.5 border-t border-gray-100 flex-wrap">
            {(Object.entries(STATUS_LABELS) as [Exclude<CellStatus, 'future' | 'in_progress'>, string][]).map(([s, label]) => (
              <div key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upload compare modal ── */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => { setShowUploadModal(false); setCompareRows([]) }}
        title="So khớp file chấm công"
        size="2xl"
      >
        <CompareView rows={compareRows} />
      </Modal>
    </div>
  )
}

// ── Compare view (inside modal) ───────────────────────────────────────────────

function CompareView({ rows }: { rows: CompareRow[] }) {
  if (!rows.length) {
    return (
      <div className="text-center py-10 text-gray-400">
        <FileText size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm mb-4">Chưa có dữ liệu để so khớp</p>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 mx-auto px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 text-gray-600"
        >
          <Download size={14} />
          Tải mẫu file CSV
        </button>
      </div>
    )
  }

  const matched    = rows.filter((r) => r.status === 'match').length
  const discrepant = rows.filter((r) => r.status === 'discrepancy').length
  const missingSys = rows.filter((r) => r.status === 'missing_sys').length

  const SHIFT_LBL: Record<AttendanceShift, string> = { morning: 'Sáng', afternoon: 'Chiều' }
  const BADGE = {
    match:       { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Khớp',     icon: <Check size={11} /> },
    discrepancy: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Sai lệch', icon: <AlertTriangle size={11} /> },
    missing_sys: { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Thiếu HT', icon: <X size={11} /> },
  }

  return (
    <div>
      {/* Summary chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-sm">
          <Check size={14} /> Khớp: {matched}
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-50 text-yellow-700 text-sm">
          <AlertTriangle size={14} /> Sai lệch: {discrepant}
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">
          <X size={14} /> Thiếu HT: {missingSys}
        </span>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-2 py-2 font-semibold text-gray-600">Nhân viên</th>
              <th className="text-left px-2 py-2 font-semibold text-gray-600">Ngày</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">Ca</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">HT vào</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">HT ra</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">File vào</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">File ra</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => {
              const b = BADGE[r.status]
              const isDiff = r.status === 'discrepancy'
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 font-medium text-gray-800">{r.name}</td>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{r.date}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600">{SHIFT_LBL[r.shift]}</td>
                  <td className="px-2 py-1.5 text-center text-green-700 font-medium">{r.sysCI ?? '-'}</td>
                  <td className="px-2 py-1.5 text-center text-orange-600 font-medium">{r.sysCO ?? '-'}</td>
                  <td className={`px-2 py-1.5 text-center font-medium ${isDiff ? 'text-yellow-700' : 'text-gray-700'}`}>
                    {r.csvCI || '-'}
                  </td>
                  <td className={`px-2 py-1.5 text-center font-medium ${isDiff ? 'text-yellow-700' : 'text-gray-700'}`}>
                    {r.csvCO || '-'}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium ${b.bg} ${b.text}`}>
                      {b.icon} {b.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          <Download size={13} />
          Tải mẫu CSV
        </button>
        <span className="text-xs text-gray-400">Tổng {rows.length} bản ghi</span>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package, ShoppingCart, Users, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  LabelList, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency } from '@/utils/format'

// ── Status colors & labels ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  placed:            '#60a5fa',
  confirmed:         '#818cf8',
  packing:           '#fb923c',
  shipping:          '#c084fc',
  completed:         '#34d399',
  returned:          '#f87171',
  returned_received: '#9ca3af',
  partial_return:    '#fbbf24',
  cancelled:         '#fca5a5',
  draft:             '#d1d5db',
}

const STATUS_LABELS: Record<string, string> = {
  placed:            'Đặt Đơn',
  confirmed:         'Xác Nhận',
  packing:           'Đóng Gói',
  shipping:          'Vận Chuyển',
  completed:         'Hoàn Thành',
  returned:          'Hoàn',
  returned_received: 'Đã Hoàn Về',
  partial_return:    'Đổi Trả',
  cancelled:         'Khách Hủy',
  draft:             'Nháp',
}

const MONTH_LABELS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12']

const ALL_STATUSES = Object.keys(STATUS_LABELS)

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAxis(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}`
  return String(v)
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label, labelFormatter }: any) {
  if (!active || !payload?.length) return null
  const nonZero = payload.filter((p: any) => p.value > 0)
  if (!nonZero.length) return null
  const displayLabel = typeof labelFormatter === 'function' ? labelFormatter(label) : label
  return (
    <div className="bg-white rounded-lg shadow-md p-3 text-xs min-w-[180px]">
      <p className="font-semibold text-gray-800 mb-2">{displayLabel}</p>
      {nonZero.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 py-0.5">
          <span className="font-medium text-gray-800 shrink-0">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RawOrder = {
  id: string
  employee_id: string
  final_amount: number
  status: string
  created_at: string
  employee?: { id: string; full_name: string } | null
}

interface StatCard {
  title: string
  value: string | number
  icon: ReactNode
  color: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { profile, isAdmin, isAccountant, isEmployee } = useAuth()
  const isPrivileged = isAdmin || isAccountant

  // ── Month selector ──────────────────────────────────────────────────────
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()) // 0-indexed

  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth()

  function prevMonth() {
    if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear(y => y - 1) }
    else setSelectedMonth(m => m - 1)
  }
  function nextMonth() {
    if (selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth >= now.getMonth())) return
    if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear(y => y + 1) }
    else setSelectedMonth(m => m + 1)
  }

  const monthLabel = `Tháng ${selectedMonth + 1}/${selectedYear}`

  // ── Static counts ────────────────────────────────────────────────────────

  const { data: productCount = 0 } = useQuery({
    queryKey: ['dashboard-products'],
    queryFn: async () => {
      const { count } = await supabase.from('products').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })

  const { data: customerCount = 0 } = useQuery({
    queryKey: ['dashboard-customers'],
    queryFn: async () => {
      const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })

  // ── All orders for charts ────────────────────────────────────────────────

  const { data: allOrders = [] } = useQuery({
    queryKey: ['dashboard-all-orders', profile?.id, isPrivileged],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, employee_id, final_amount, status, created_at, employee:profiles!employee_id(id, full_name)')
      if (!isPrivileged && profile) {
        query = query.eq('employee_id', profile.id)
      }
      const { data } = await query
      return (data ?? []) as RawOrder[]
    },
    enabled: !!profile,
  })

  // ── Derived totals – theo tháng được chọn ────────────────────────────

  const { thisMonthOrders, totalRevenue, totalOrders, todayOrders } = useMemo(() => {
    const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`
    const todayStr = new Date().toISOString().split('T')[0]
    const monthOrders = allOrders.filter(o => o.created_at.startsWith(monthPrefix))
    return {
      thisMonthOrders: monthOrders,
      totalRevenue: monthOrders.reduce((s, o) => s + o.final_amount, 0),
      totalOrders: monthOrders.length,
      todayOrders: allOrders.filter(o => o.created_at.startsWith(todayStr)).length,
    }
  }, [allOrders, selectedYear, selectedMonth])

  // ── Chart 1 data: Doanh số theo nhân viên + trạng thái (tháng này) ──────

  const { salesByEmployee, activeStatuses } = useMemo(() => {
    const empMap = new Map<string, Record<string, number | string>>()
    const statusSet = new Set<string>()

    for (const order of thisMonthOrders) {
      const empId = order.employee_id
      const empName = order.employee?.full_name ?? empId
      if (!empMap.has(empId)) empMap.set(empId, { name: empName })
      const entry = empMap.get(empId)!
      entry[order.status] = ((entry[order.status] as number) || 0) + order.final_amount
      statusSet.add(order.status)
    }

    return {
      salesByEmployee: Array.from(empMap.values()),
      activeStatuses: Array.from(statusSet),
    }
  }, [thisMonthOrders])

  // Toggle lọc trạng thái (set chứa các trạng thái đang ẩn)
  const [disabledStatuses, setDisabledStatuses] = useState<Set<string>>(new Set())

  function toggleStatus(status: string) {
    setDisabledStatuses(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  // Doanh thu + số đơn theo trạng thái đang bật
  const { filteredRevenue, filteredOrderCount } = useMemo(() => {
    const enabledOrders = disabledStatuses.size === 0
      ? thisMonthOrders
      : thisMonthOrders.filter(o => !disabledStatuses.has(o.status))
    return {
      filteredRevenue: enabledOrders.reduce((s, o) => s + o.final_amount, 0),
      filteredOrderCount: enabledOrders.length,
    }
  }, [thisMonthOrders, disabledStatuses])

  // Dữ liệu chart theo trạng thái đang bật, kèm _total và _lbl_<status>
  const { empChartData, visibleStatuses } = useMemo(() => {
    const visible = activeStatuses.filter(s => !disabledStatuses.has(s))
    const data = salesByEmployee.map(emp => {
      const total = visible.reduce((s, st) => s + ((emp[st] as number) || 0), 0)
      // Trạng thái cuối cùng có giá trị > 0 → hiển thị label tại đó
      let lastStatus = ''
      for (const st of visible) {
        if (((emp[st] as number) || 0) > 0) lastStatus = st
      }
      // _lbl_<status>: chỉ status cuối cùng mang giá trị total, còn lại = 0
      const labels: Record<string, number> = {}
      for (const st of visible) {
        labels[`_lbl_${st}`] = st === lastStatus ? total : 0
      }
      return { ...emp, _total: total, ...labels }
    })
    // Sắp xếp giảm dần theo tổng doanh số
    data.sort((a, b) => (b._total as number) - (a._total as number))
    return { empChartData: data, visibleStatuses: visible }
  }, [salesByEmployee, activeStatuses, disabledStatuses])

  // ── Chart 2 data: Tháng được chọn vs tháng trước – theo từng ngày ───

  const monthData = useMemo(() => {
    const curY = selectedYear
    const curM = selectedMonth
    const prevM = curM === 0 ? 11 : curM - 1
    const prevY = curM === 0 ? curY - 1 : curY
    const daysInMonth = new Date(curY, curM + 1, 0).getDate()

    const result = Array.from({ length: daysInMonth }, (_, i) => ({
      day: String(i + 1),
      'Tháng này': 0,
      'Tháng trước': 0,
    }))

    for (const order of allOrders) {
      const d = new Date(order.created_at)
      const y = d.getFullYear()
      const m = d.getMonth()
      const day = d.getDate()

      if (y === curY && m === curM) {
        result[day - 1]['Tháng này'] += order.final_amount
      } else if (y === prevY && m === prevM && day <= daysInMonth) {
        result[day - 1]['Tháng trước'] += order.final_amount
      }
    }
    return result
  }, [allOrders, selectedYear, selectedMonth])

  // ── Chart 3 data: Năm nay vs năm trước – theo từng tháng ───────────────

  const yearData = useMemo(() => {
    const thisYear = new Date().getFullYear()

    const result = MONTH_LABELS.map(m => ({
      month: m,
      'Năm nay': 0,
      'Năm trước': 0,
    }))

    for (const order of allOrders) {
      const d = new Date(order.created_at)
      const y = d.getFullYear()
      const m = d.getMonth()
      if (y === thisYear) result[m]['Năm nay'] += order.final_amount
      else if (y === thisYear - 1) result[m]['Năm trước'] += order.final_amount
    }
    return result
  }, [allOrders])

  // ── Bộ lọc xem theo tháng / năm ─────────────────────────────────────────

  const [view, setView] = useState<'month' | 'year'>('month')

  // ── Stat cards ───────────────────────────────────────────────────────────

  const monthShort = `T${selectedMonth + 1}`
  const stats: StatCard[] = [
    isEmployee
      ? { title: `Doanh Số ${monthShort}`, value: formatCurrency(totalRevenue), icon: <TrendingUp size={24} />, color: 'bg-blue-500' }
      : { title: 'Tổng Hàng Hóa',          value: productCount,                 icon: <Package size={24} />,    color: 'bg-blue-500' },
    { title: `Đơn ${monthShort}`,    value: totalOrders,   icon: <ShoppingCart size={24} />, color: 'bg-green-500'  },
    { title: 'Đơn Hôm Nay',          value: todayOrders,   icon: <TrendingUp size={24} />,   color: 'bg-orange-500' },
    { title: 'Tổng Khách Hàng',      value: customerCount, icon: <Users size={24} />,        color: 'bg-purple-500' },
  ]

  const empChartHeight = Math.max(120, salesByEmployee.length * 36 + 40)

  // ── Legend style shared ──────────────────────────────────────────────────
  const legendStyle = { fontSize: 11, paddingTop: 8 }

  return (
    <div className="space-y-4">
      {/* Header + Month selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Tổng Quan</h1>
          <p className="text-sm text-gray-500 mt-0.5">Xin chào, {profile?.full_name}</p>
        </div>
        <div className="flex items-center gap-1 bg-white rounded-xl shadow-sm px-1 py-1">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-semibold text-gray-800 min-w-[100px] text-center select-none">
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.title} className="bg-white rounded-xl shadow-sm px-3 py-3 flex items-center gap-3">
            <div className={`${stat.color} text-white p-2 rounded-lg flex-shrink-0`}>
              {/* Thu nhỏ icon trên mobile */}
              <span className="block [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-6 sm:[&>svg]:h-6">{stat.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">{stat.title}</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Doanh thu tháng – nhảy theo trạng thái được chọn */}
      {isPrivileged && (
        <div className="bg-white rounded-xl shadow-sm px-4 py-3">
          <h2 className="text-xs font-medium text-gray-500 mb-0.5">Doanh Thu {monthLabel}</h2>
          <p className="text-2xl sm:text-3xl font-bold text-blue-600">{formatCurrency(filteredRevenue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Tổng {filteredOrderCount} đơn trong {monthLabel.toLowerCase()}
          </p>
        </div>
      )}

      {/* Chart 1: Doanh số nhân viên theo trạng thái (admin / kế toán) */}
      {isPrivileged && salesByEmployee.length > 0 && (
        <div className="bg-white rounded-xl p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Doanh Số Theo Nhân Viên &amp; Trạng Thái
            <span className="ml-2 text-sm font-normal text-gray-400">
              {monthLabel}
            </span>
          </h2>

          {/* Toggle trạng thái – hiển thị tất cả */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {/* Chọn tất cả */}
            {(() => {
              const allOn = disabledStatuses.size === 0
              return (
                <button
                  onClick={() => setDisabledStatuses(allOn ? new Set(ALL_STATUSES) : new Set())}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                  style={{
                    borderColor: '#6b7280',
                    color: allOn ? '#fff' : '#6b7280',
                    backgroundColor: allOn ? '#6b7280' : '#f9fafb',
                  }}
                >
                  {allOn ? 'Bỏ tất cả' : 'Chọn tất cả'}
                </button>
              )
            })()}
            {ALL_STATUSES.map((status) => {
              const enabled = !disabledStatuses.has(status)
              const hasData = activeStatuses.includes(status)
              const color = STATUS_COLORS[status] ?? '#94a3b8'
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                  style={{
                    borderColor: color,
                    color: enabled ? color : '#9ca3af',
                    backgroundColor: enabled ? `${color}18` : '#f9fafb',
                    opacity: enabled ? (hasData ? 1 : 0.4) : 0.35,
                  }}
                  title={!hasData ? 'Chưa có đơn' : undefined}
                >
                  <span className="w-2 h-2 rounded-sm" style={{ background: enabled && hasData ? color : '#d1d5db' }} />
                  {STATUS_LABELS[status]}
                </button>
              )
            })}
          </div>

          <div style={{ height: empChartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={empChartData}
                margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
              >
                <XAxis
                  type="number"
                  tickFormatter={fmtAxis}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                    <text x={x - 118} y={y} dy={4} textAnchor="start" fontSize={12} fill="#374151">
                      {payload.value}
                    </text>
                  )}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                {visibleStatuses.map((status) => (
                  <Bar
                    key={status}
                    dataKey={status}
                    name={STATUS_LABELS[status] ?? status}
                    stackId="a"
                    fill={STATUS_COLORS[status] ?? '#94a3b8'}
                    barSize={12}
                  >
                    <LabelList
                      dataKey={`_lbl_${status}`}
                      position="right"
                      formatter={(v: unknown) => (Number(v) > 0 ? fmtAxis(Number(v)) : '')}
                      style={{ fontSize: 11, fontWeight: 600, fill: '#374151' }}
                    />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Chart 2+3: So sánh doanh số – có bộ lọc tháng / năm */}
      <div className="bg-white rounded-xl p-5">
        {/* Header + toggle */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEmployee ? 'Doanh Số Của Tôi' : 'Doanh Số'}
              {' – '}
              {view === 'month' ? 'Tháng Này vs Tháng Trước' : 'Năm Nay vs Năm Trước'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {view === 'month' ? 'So sánh theo từng ngày' : 'So sánh theo từng tháng'}
            </p>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm shrink-0">
            <button
              onClick={() => setView('month')}
              className={`px-4 py-1.5 font-medium transition-colors ${
                view === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Theo Ngày
            </button>
            <button
              onClick={() => setView('year')}
              className={`px-4 py-1.5 font-medium transition-colors border-l border-gray-200 ${
                view === 'year'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Theo Tháng
            </button>
          </div>
        </div>

        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            {view === 'month' ? (
              <BarChart
                data={monthData}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                barCategoryGap="20%"
                barGap={1}
              >
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 9, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={fmtAxis}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: '#f9fafb' }}
                  labelFormatter={(v) => `Ngày ${v}`}
                />
                <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
                <Bar dataKey="Tháng trước" fill="#bfdbfe" maxBarSize={12} />
                <Bar dataKey="Tháng này" fill="#3b82f6" maxBarSize={12} radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <BarChart
                data={yearData}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                barCategoryGap="25%"
              >
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={fmtAxis}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
                <Bar dataKey="Năm trước" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Năm nay" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

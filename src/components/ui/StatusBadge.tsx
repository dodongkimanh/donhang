import type { OrderStatus } from '@/types'

interface Props {
  status: OrderStatus
  block?: boolean
}

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string; border: string }> = {
  placed:            { label: 'Đặt Đơn',              color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-300' },
  confirmed:         { label: 'Xác Nhận Đơn',         color: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-300' },
  packing:           { label: 'Đang Đóng Gói',        color: 'text-orange-700', bg: 'bg-orange-50',  border: 'border-orange-300' },
  shipping:          { label: 'Đang Vận Chuyển',      color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-300' },
  completed:         { label: 'Hoàn Thành',           color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-300' },
  returned:          { label: 'Hoàn',                 color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-300' },
  returned_received: { label: 'Đã Hoàn Về',           color: 'text-gray-600',   bg: 'bg-gray-100',   border: 'border-gray-300' },
  partial_return:    { label: 'Đổi Trả 1 Phần',       color: 'text-yellow-700', bg: 'bg-yellow-50',  border: 'border-yellow-300' },
  cancelled:         { label: 'Khách Hủy',            color: 'text-rose-700',   bg: 'bg-rose-50',    border: 'border-rose-300' },
  draft:             { label: 'Đơn Nháp',            color: 'text-gray-500',   bg: 'bg-gray-100',   border: 'border-gray-300' },
}

export function StatusBadge({ status, block = false }: Props) {
  const cfg = ORDER_STATUS_CONFIG[status] ?? { label: status, color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' }
  return (
    <span className={`${block ? 'flex w-full justify-center' : 'inline-flex'} items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      {cfg.label}
    </span>
  )
}

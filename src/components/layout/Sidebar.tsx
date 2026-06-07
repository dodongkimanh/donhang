import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Clock,
  LogOut,
  Tag,
  ArrowUpDown,
  UserCircle,
  Truck,
  MapPin,
  PhoneCall,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

interface NavItem {
  to: string
  icon: ReactNode
  label: string
  roles?: ('admin' | 'accountant' | 'sale' | 'warehouse')[]
}

const navItems: NavItem[] = [
  { to: '/', icon: <LayoutDashboard size={20} />, label: 'Tổng Quan', roles: ['admin', 'sale'] },
  { to: '/categories', icon: <Tag size={20} />, label: 'Danh Mục' },
  { to: '/products', icon: <Package size={20} />, label: 'Hàng Hóa' },
  { to: '/orders', icon: <ShoppingCart size={20} />, label: 'Đơn Hàng' },
  { to: '/route-planning', icon: <MapPin size={20} />,    label: 'Xếp Tuyến', roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/stock-call',     icon: <PhoneCall size={20} />, label: 'Gọi Hàng',  roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/customers', icon: <Users size={20} />, label: 'Khách Hàng' },
  { to: '/inventory', icon: <ArrowUpDown size={20} />, label: 'Nhập/Xuất Kho', roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/suppliers', icon: <Truck size={20} />, label: 'Nhà Cung Cấp', roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/attendance', icon: <Clock size={20} />, label: 'Chấm Công' },
  { to: '/employees', icon: <UserCircle size={20} />, label: 'Nhân Viên', roles: ['admin'] },
]

export function Sidebar() {
  const { profile, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    toast.success('Đã đăng xuất')
  }

  const filteredItems = navItems.filter((item) => {
    if (!item.roles) return true
    if (!profile) return false
    return item.roles.includes(profile.role)
  })

  const roleLabel = {
    admin:      'Quản Trị Viên',
    accountant: 'Kế Toán',
    sale:       'NV Sale',
    warehouse:  'NV Kho',
  }

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen fixed left-0 top-0 z-10">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShoppingCart size={20} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">CRM Đơn Hàng</p>
            <p className="text-xs text-gray-400 truncate">{profile?.full_name ?? ''}</p>
          </div>
        </div>
        {profile && (
          <span className="mt-2 inline-block text-xs bg-blue-600 px-2 py-0.5 rounded-full">
            {roleLabel[profile.role]}
          </span>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-700">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut size={20} />
          Đăng Xuất
        </button>
      </div>
    </aside>
  )
}

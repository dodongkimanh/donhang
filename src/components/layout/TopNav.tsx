import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  LogOut, Tag, ArrowUpDown, UserCircle, Menu, X, Truck, MapPin, PhoneCall, ScanSearch, KeyRound, Download,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import IOSInstallGuide from '@/components/ui/IOSInstallPrompt'
import toast from 'react-hot-toast'

interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
  roles?: ('admin' | 'accountant' | 'sale' | 'warehouse')[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',           icon: <LayoutDashboard size={16} />, label: 'Tổng Quan', roles: ['admin', 'sale'] },
  { to: '/categories', icon: <Tag size={16} />,             label: 'Danh Mục' },
  { to: '/products',   icon: <Package size={16} />,         label: 'Hàng Hóa' },
  { to: '/orders',          icon: <ShoppingCart size={16} />, label: 'Đơn Hàng' },
  { to: '/route-planning',  icon: <Truck size={16} />,      label: 'Xếp Tuyến', roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/stock-call',      icon: <PhoneCall size={16} />, label: 'Gọi Hàng',  roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/customers',       icon: <Users size={16} />,       label: 'Khách Hàng' },
  { to: '/inventory',       icon: <ArrowUpDown size={16} />, label: 'Nhập/Xuất Kho',  roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/barcode-tracker', icon: <ScanSearch size={16} />, label: 'Tra Cứu Mã Vạch', roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/suppliers',  icon: <MapPin size={16} />,          label: 'Nhà Cung Cấp',  roles: ['admin', 'accountant', 'warehouse'] },
  { to: '/employees',  icon: <UserCircle size={16} />,      label: 'Nhân Viên', roles: ['admin'] },
]

const ROLE_LABEL = { admin: 'Quản Trị Viên', accountant: 'Kế Toán', sale: 'NV Sale', warehouse: 'NV Kho' }
const ROLE_COLOR = {
  admin:      'bg-red-500/20 text-red-300',
  accountant: 'bg-purple-500/20 text-purple-300',
  sale:       'bg-green-500/20 text-green-300',
  warehouse:  'bg-amber-500/20 text-amber-300',
}

export function TopNav() {
  const { profile, signOut } = useAuth()
  const { canInstall, install, showIOSGuide, setShowIOSGuide } = usePWAInstall()
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [newPw, setNewPw]             = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [pwLoading, setPwLoading]     = useState(false)

  async function handleSignOut() {
    await signOut()
    toast.success('Đã đăng xuất')
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault()
    if (newPw.length < 6) { toast.error('Mật khẩu tối thiểu 6 ký tự'); return }
    if (newPw !== confirmPw) { toast.error('Mật khẩu xác nhận không khớp'); return }
    setPwLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwLoading(false)
    if (error) { toast.error(`Lỗi: ${error.message}`); return }
    toast.success('Đã đổi mật khẩu thành công')
    setPwModalOpen(false)
    setNewPw('')
    setConfirmPw('')
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true
    if (!profile) return false
    return item.roles.includes(profile.role)
  })

  const linkBase = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap'
  const linkActive = 'bg-white/20 text-white shadow-sm'
  const linkIdle = 'text-blue-100 hover:bg-white/10 hover:text-white'

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-20 bg-blue-600 border-b border-blue-700 flex items-center px-3 gap-2 pt-[env(safe-area-inset-top)] h-[calc(3.5rem+env(safe-area-inset-top))]">

        {/* Mobile: hamburger bên trái */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden p-1.5 rounded-lg text-blue-100 hover:bg-white/10 hover:text-white transition-colors flex-shrink-0"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        {/* Mobile: Logo Kim Ánh giữa */}
        <div className="lg:hidden flex-1 flex items-center justify-start">
          <span className="text-white font-bold text-lg tracking-wide select-none">
            Đồ Đồng Kim Ánh
          </span>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkIdle}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Right side: user info + logout */}
        <div className="ml-auto lg:ml-0 flex items-center gap-1 flex-shrink-0">
          {profile && (
            <div className="hidden md:flex items-center gap-2 max-w-[180px]">
              <span className="text-sm text-white font-medium truncate">{profile.full_name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${ROLE_COLOR[profile.role]}`}>
                {ROLE_LABEL[profile.role]}
              </span>
            </div>
          )}
          {canInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm font-medium bg-white/20 text-white hover:bg-white/30 transition-colors animate-pulse"
              title="Cài đặt ứng dụng"
            >
              <Download size={15} />
              <span className="hidden sm:inline">Cài App</span>
            </button>
          )}
          <button
            onClick={() => { setPwModalOpen(true); setNewPw(''); setConfirmPw('') }}
            className="p-1.5 rounded-lg text-blue-100 hover:bg-white/10 hover:text-white transition-colors"
            title="Đổi mật khẩu"
          >
            <KeyRound size={16} />
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-blue-100 hover:bg-white/10 hover:text-white transition-colors"
            title="Đăng xuất"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Đăng Xuất</span>
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-0 right-0 z-20 bg-blue-700 border-b border-blue-800 p-3 grid grid-cols-2 gap-1 lg:hidden shadow-xl">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? linkActive : linkIdle
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </>
      )}
      {/* Modal đổi mật khẩu cá nhân */}
      <Modal isOpen={pwModalOpen} onClose={() => setPwModalOpen(false)} title="Đổi Mật Khẩu">
        <form onSubmit={handleChangePw} className="space-y-4">
          <p className="text-sm text-gray-500">
            Đổi mật khẩu cho tài khoản <span className="font-medium text-gray-800">{profile?.full_name}</span>.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mật Khẩu Mới *</label>
            <input
              type="password" value={newPw} required minLength={6}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Xác Nhận Mật Khẩu *</label>
            <input
              type="password" value={confirmPw} required minLength={6}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${
                confirmPw && confirmPw !== newPw ? 'border-red-400' : 'border-gray-300'
              }`}
              placeholder="••••••••"
            />
            {confirmPw && confirmPw !== newPw && (
              <p className="text-xs text-red-500 mt-1">Mật khẩu không khớp</p>
            )}
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setPwModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Hủy
            </button>
            <button
              type="submit"
              disabled={pwLoading || (!!confirmPw && confirmPw !== newPw)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
            >
              {pwLoading ? 'Đang lưu...' : 'Đổi Mật Khẩu'}
            </button>
          </div>
        </form>
      </Modal>
      <IOSInstallGuide open={showIOSGuide} onClose={() => setShowIOSGuide(false)} />
    </>
  )
}

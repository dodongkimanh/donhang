import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuth, useAuthInit } from '@/hooks/useAuth'
import { LoginPage } from '@/components/auth/LoginPage'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import PWAUpdatePrompt from '@/components/ui/PWAUpdatePrompt'

// Mỗi trang tách thành 1 chunk riêng — chỉ tải khi người dùng thực sự vào trang đó,
// thay vì gộp chung vào 1 file JS khổng lồ phải tải hết trước khi app chạy được.
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const CategoriesPage = lazy(() => import('@/pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })))
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })))
const OrdersPage = lazy(() => import('@/pages/OrdersPage').then((m) => ({ default: m.OrdersPage })))
const CustomersPage = lazy(() => import('@/pages/CustomersPage').then((m) => ({ default: m.CustomersPage })))
const EmployeesPage = lazy(() => import('@/pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })))
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const RoutePlanningPage = lazy(() => import('@/pages/RoutePlanningPage').then((m) => ({ default: m.RoutePlanningPage })))
const StockCallPage = lazy(() => import('@/pages/StockCallPage').then((m) => ({ default: m.StockCallPage })))
const BarcodeTrackerPage = lazy(() => import('@/pages/BarcodeTrackerPage').then((m) => ({ default: m.BarcodeTrackerPage })))

function PageLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      // Backend tự host qua Cloudflare Tunnel đôi khi có độ trễ "đánh thức" ngay
      // sau khi load trang — thử lại vài lần với backoff thay vì bỏ cuộc ngay,
      // tránh hiện số liệu 0 sai lệch và phải F5 thủ công nhiều lần.
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  },
})

function RootRedirect() {
  const { profile } = useAuth()
  if (profile?.role === 'warehouse' || profile?.role === 'accountant') {
    return <Navigate to="/orders" replace />
  }
  return <DashboardPage />
}

function AppRoutes() {
  useAuthInit() // khởi tạo session một lần duy nhất cho toàn app
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        <p className="text-sm text-gray-400">Đang tải...</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        >
          Tải lại trang
        </button>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout>
              <RootRedirect />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/categories"
        element={
          <ProtectedRoute>
            <AppLayout>
              <CategoriesPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ProductsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'warehouse']}>
            <AppLayout>
              <InventoryPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <AppLayout>
              <OrdersPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/route-planning"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'warehouse']}>
            <AppLayout>
              <RoutePlanningPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/stock-call"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'warehouse']}>
            <AppLayout>
              <StockCallPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute>
            <AppLayout>
              <CustomersPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/suppliers"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'warehouse']}>
            <AppLayout>
              <SuppliersPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AppLayout>
              <EmployeesPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/barcode-tracker"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'warehouse']}>
            <AppLayout>
              <BarcodeTrackerPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="top-right" />
        <PWAUpdatePrompt />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuth, useAuthInit } from '@/hooks/useAuth'
import { LoginPage } from '@/components/auth/LoginPage'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { RoutePlanningPage } from '@/pages/RoutePlanningPage'
import { StockCallPage } from '@/pages/StockCallPage'
import { BarcodeTrackerPage } from '@/pages/BarcodeTrackerPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
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
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

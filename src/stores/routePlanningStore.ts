import { create } from 'zustand'
import type { Order } from '@/types'

interface RoutePlanningStore {
  pendingOrders: Order[]
  addPendingOrder: (order: Order) => void
  removePendingOrder: (orderId: string) => void
  clearAll: () => void
}

export const useRoutePlanningStore = create<RoutePlanningStore>((set) => ({
  pendingOrders: [],
  addPendingOrder: (order) =>
    set((state) => ({
      pendingOrders: state.pendingOrders.some((o) => o.id === order.id)
        ? state.pendingOrders
        : [...state.pendingOrders, order],
    })),
  removePendingOrder: (orderId) =>
    set((state) => ({
      pendingOrders: state.pendingOrders.filter((o) => o.id !== orderId),
    })),
  clearAll: () => set({ pendingOrders: [] }),
}))

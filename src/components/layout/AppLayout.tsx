import type { ReactNode } from 'react'
import { TopNav } from './TopNav'

interface Props {
  children: ReactNode
}

export function AppLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <main className="pt-[calc(3.5rem+env(safe-area-inset-top))] overflow-x-hidden">
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </div>
  )
}

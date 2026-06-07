import type { ReactNode } from 'react'
import { TopNav } from './TopNav'

interface Props {
  children: ReactNode
}

export function AppLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      {/* pt-14 = height of the fixed top nav */}
      <main className="pt-14 overflow-x-hidden">
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </div>
  )
}

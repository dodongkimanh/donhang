import { createClient } from '@supabase/supabase-js'
import { mockSupabase, seedDemoData } from './mockSupabase'

export const isDemoMode =
  !import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL === 'https://your-project.supabase.co'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any

if (isDemoMode) {
  seedDemoData()
  _client = mockSupabase
  _adminClient = mockSupabase
} else {
  const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const serviceKey      = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string
  _client      = createClient(supabaseUrl, supabaseAnonKey)
  _adminClient = createClient(supabaseUrl, serviceKey || supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = _client

// adminSupabase dùng service_role key — bypass RLS, chỉ dùng cho trang Nhân Viên
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adminSupabase: any = _adminClient

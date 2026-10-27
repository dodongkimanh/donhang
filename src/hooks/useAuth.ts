import { useEffect } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Profile } from '@/types'

// Backend tự host qua Cloudflare Tunnel đôi khi có độ trễ "đánh thức" ngay sau
// khi load trang — thử lại vài lần trước khi chấp nhận profile = null, tránh
// việc người dùng phải F5 thủ công nhiều lần mới đăng nhập/tải dữ liệu được.
async function fetchProfile(userId: string, attempt = 0): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error) {
    console.error('fetchProfile error:', error.message)
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      return fetchProfile(userId, attempt + 1)
    }
  }
  return (data ?? null) as Profile | null
}

// Gọi duy nhất một lần ở App.tsx — khởi tạo session + lắng nghe auth changes
export function useAuthInit() {
  const { setUser, setProfile, setLoading, reset } = useAuthStore()

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(false)
    }, 8000)

    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: Session | null } }) => {
      if (session?.user) {
        const p = await fetchProfile(session.user.id)
        if (p?.is_locked) {
          await supabase.auth.signOut()
          reset()
          clearTimeout(timeout)
          setLoading(false)
          return
        }
        setUser(session.user as User)
        setProfile(p)
      } else {
        setUser(null)
      }
      clearTimeout(timeout)
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: string, session: Session | null) => {
        setUser((session?.user ?? null) as User | null)
        if (session?.user) {
          setProfile(await fetchProfile(session.user.id))
        } else {
          reset()
        }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// Pure reader — không đăng ký subscription, dùng được ở bất kỳ component nào
export function useAuth() {
  const { user, profile, loading } = useAuthStore()

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }

    if (data.user) {
      const p = await fetchProfile(data.user.id)
      if (p?.is_locked) {
        await supabase.auth.signOut()
        useAuthStore.getState().reset()
        return { error: { message: 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' } }
      }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    useAuthStore.getState().reset()
  }

  const isAdmin = profile?.role === 'admin'
  const isAccountant = profile?.role === 'accountant'
  const isWarehouse = profile?.role === 'warehouse'
  const isSale = profile?.role === 'sale'
  const isEmployee = isSale  // sale: chỉ thấy đơn của mình, quyền hạn chế
  const canEdit = isAdmin || isAccountant || isWarehouse
  const canDelete = isAdmin

  return { user, profile, loading, signIn, signOut, isAdmin, isAccountant, isWarehouse, isSale, isEmployee, canEdit, canDelete }
}

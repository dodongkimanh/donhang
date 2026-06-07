import { useEffect } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Profile } from '@/types'

async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error) console.error('fetchProfile error:', error.message)
  return (data ?? null) as Profile | null
}

// Gọi duy nhất một lần ở App.tsx — khởi tạo session + lắng nghe auth changes
export function useAuthInit() {
  const { setUser, setProfile, setLoading, reset } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: Session | null } }) => {
      setUser((session?.user ?? null) as User | null)
      if (session?.user) {
        setProfile(await fetchProfile(session.user.id))
      }
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
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
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

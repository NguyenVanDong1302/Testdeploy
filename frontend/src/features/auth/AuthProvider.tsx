import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAppStore } from '../../state/store'
import { firebaseConfigError, getFirebaseServices } from '../../lib/firebase'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configError: string
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isJwtLikeToken(value: string) {
  return String(value || '').trim().split('.').length === 3
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!firebaseConfigError)
  const { state, setState } = useAppStore()
  const shouldUseStoredSessionDirectly = Boolean(state.token && state.username) && (Boolean(firebaseConfigError) || isJwtLikeToken(state.token))

  useEffect(() => {
    if (shouldUseStoredSessionDirectly) {
      setUser({
        uid: state.token,
        email: state.username.includes('@') ? state.username : `${state.username}@local.app`,
        displayName: state.username,
      } as User)
      setLoading(false)
      return
    }

    if (firebaseConfigError) {
      setUser(null)
      setLoading(false)
      return
    }

    const { auth } = getFirebaseServices()
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      const username = firebaseUser?.email?.split('@')[0]?.trim() || firebaseUser?.displayName?.trim().replace(/\s+/g, '_').toLowerCase() || ''
      setState({ username, token: firebaseUser?.uid || '', role: 'user' })
      setLoading(false)
    })

    return () => unsub()
  }, [firebaseConfigError, setState, shouldUseStoredSessionDirectly, state.token, state.username])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configError: firebaseConfigError,
      loginWithGoogle: async () => {
        const { auth, googleProvider } = getFirebaseServices()
        await signInWithPopup(auth, googleProvider)
      },
      logout: async () => {
        if (!firebaseConfigError) {
          const { auth } = getFirebaseServices()
          await signOut(auth)
        }
        setUser(null)
        setState({ username: '', token: '', role: 'user' })
      },
    }),
    [user, loading, setState],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}

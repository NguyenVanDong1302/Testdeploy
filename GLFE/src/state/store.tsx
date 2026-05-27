import React, { createContext, useContext, useMemo, useState } from 'react'

export type AppState = {
  username: string
  token: string
  role: 'user' | 'admin'
}

type Ctx = {
  state: AppState
  setState: (partial: Partial<AppState>) => void
}

const StoreCtx = createContext<Ctx | null>(null)

function loadState(): AppState {
  return {
    username: localStorage.getItem('x_username') || '',
    token: localStorage.getItem('token') || '',
    role: localStorage.getItem('role') === 'admin' ? 'admin' : 'user',
  }
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateInternal] = useState<AppState>(() => loadState())

  const setState = (partial: Partial<AppState>) => {
    setStateInternal((prev) => {
      const next = { ...prev, ...partial }
      if (partial.username !== undefined) localStorage.setItem('x_username', next.username)
      if (partial.token !== undefined) localStorage.setItem('token', next.token)
      if (partial.role !== undefined) localStorage.setItem('role', next.role)
      return next
    })
  }

  const value = useMemo(() => ({ state, setState }), [state])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useAppStore() {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useAppStore must be used within AppStoreProvider')
  return v
}

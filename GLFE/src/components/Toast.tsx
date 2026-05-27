import React, { createContext, useContext, useMemo, useRef, useState } from 'react'

type ToastItem = { id: string; msg: string }
type Ctx = { push: (msg: string) => void }

const ToastCtx = createContext<Ctx>({ push: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<number[]>([])

  const push = (msg: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setItems((prev) => [{ id, msg }, ...prev].slice(0, 5))
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id))
    }, 3500)
    timersRef.current.push(timer)
  }

  const value = useMemo(() => ({ push }), [])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast">
        {items.map((t) => (
          <div key={t.id} className="toastItem">{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function ToastHost() {
  return null
}

export function useToast() {
  return useContext(ToastCtx)
}

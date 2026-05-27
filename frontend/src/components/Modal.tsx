import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'
import styles from './Modal.module.css'
import desktopStyles from './Modal.desktop.module.css'
import tabletStyles from './Modal.tablet.module.css'
import mobileStyles from './Modal.mobile.module.css'

type Mode = 'normal' | 'fullscreen'

type Ctx = {
  open: (node: React.ReactNode) => void
  openFullscreen: (node: React.ReactNode) => void
  close: () => void
}

const ModalCtx = createContext<Ctx | null>(null)

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

export function useModal() {
  const ctx = useContext(ModalCtx)
  if (!ctx) throw new Error('useModal must be used within <ModalProvider>')
  return ctx
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<React.ReactNode | null>(null)
  const [mode, setMode] = useState<Mode>('normal')

  useEffect(() => {
    if (!node || typeof document === 'undefined') return undefined

    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [node])

  const close = () => setNode(null)

  const open = (n: React.ReactNode) => {
    setMode('normal')
    setNode(n)
  }

  const openFullscreen = (n: React.ReactNode) => {
    setMode('fullscreen')
    setNode(n)
  }

  const value = useMemo(() => ({ open, openFullscreen, close }), [])

  return (
    <ModalCtx.Provider value={value}>
      {children}
      <ModalHost node={node} mode={mode} onClose={close} />
    </ModalCtx.Provider>
  )
}

function ModalHost({
  node,
  mode,
  onClose,
}: {
  node: React.ReactNode | null
  mode: Mode
  onClose: () => void
}) {
  if (!node) return null

  const overlay = (
    <div
      className={mode === 'fullscreen' ? styles.fullscreenOverlay : cx(styles.overlay, responsiveStyles.overlay)}
      onMouseDown={(e) => {
        if (mode === 'normal' && e.target === e.currentTarget) onClose()
      }}
    >
      {mode === 'normal' ? (
        <div className={cx(styles.modal, responsiveStyles.modal)}>
          <button className={cx(styles.closeBtn, responsiveStyles.closeBtn)} onClick={onClose} aria-label="Dong popup">
            {'\u00D7'}
          </button>
          <div className={cx(styles.body, responsiveStyles.body)}>{node}</div>
        </div>
      ) : (
        <>{node}</>
      )}
    </div>
  )

  return createPortal(overlay, document.body)
}

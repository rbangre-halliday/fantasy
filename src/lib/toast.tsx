import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readableError } from './supabase'

type Kind = 'plain' | 'good' | 'error'
interface Toast { id: number; text: string; kind: Kind }

const Ctx = createContext<{
  toast: (text: string, kind?: Kind) => void
  fail: (err: unknown) => void
}>({ toast: () => {}, fail: () => {} })

export function ToastProvider ({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const toast = useCallback((text: string, kind: Kind = 'plain') => {
    const id = ++seq.current
    setItems(cur => [...cur, { id, text, kind }])
    setTimeout(() => setItems(cur => cur.filter(t => t.id !== id)), 4200)
  }, [])

  const fail = useCallback((err: unknown) => toast(readableError(err), 'error'), [toast])

  return (
    <Ctx.Provider value={{ toast, fail }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast ${t.kind === 'plain' ? '' : t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)

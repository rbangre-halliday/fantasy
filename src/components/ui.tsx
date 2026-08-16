import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Position } from '../lib/types'

export const PosChip = ({ pos }: { pos: Position }) =>
  <span className={`pos ${pos}`}>{pos}</span>

export function Eyebrow ({ children }: { children: ReactNode }) {
  return <div className="eyebrow-rule"><span className="eyebrow">{children}</span></div>
}

export function Notice ({ kind = 'plain', children }: { kind?: 'plain' | 'error' | 'good' | 'warn'; children: ReactNode }) {
  return <div className={`notice ${kind === 'plain' ? '' : kind}`}>{children}</div>
}

export function Empty ({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Loading ({ rows = 6 }: { rows?: number }) {
  return (
    <div className="stack gap-8 mt-16" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height: 44, opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  )
}

/**
 * One dialog primitive: a bottom sheet on phones, a centred card on desktop.
 * Closes on backdrop click and Escape, and traps scroll behind it.
 */
export function Sheet ({
  title, onClose, children, footer
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2 className="h3">{title}</h2>
          <button className="btn quiet" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Filter strip used by every player list in the app. */
export function Segmented<T extends string> ({
  options, value, onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="group">
      {options.map(o => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// --------------------------------------------------------------- icons ----
// Inline so there is no icon-font request and they inherit currentColor.

const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const
}

export const IconDraft = () => (
  <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="8" /><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /></svg>
)
export const IconTeam = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
)
export const IconPlayers = () => (
  <svg viewBox="0 0 24 24" {...stroke}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 8h5M16 12h5M16 16h3" /></svg>
)
export const IconTrade = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
)
export const IconTable = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M4 6h16M4 12h16M4 18h16M9 4v16" /></svg>
)
export const IconStar = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
    <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" />
  </svg>
)

export const IconLock = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" {...stroke}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
)

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag one player onto another.
 *
 * Pointer events rather than HTML5 drag-and-drop: the native API has no touch
 * support at all, needs a serialised payload for what is a same-page gesture,
 * and gives no say over the thing being dragged. This is one listener pair and
 * a div that follows your finger.
 *
 * A press that never travels is a tap, so the existing player sheet still opens
 * — the gesture is added to the screen, not swapped in for what was there.
 *
 * Touch has to be handled differently from a mouse. `touch-action: none` is the
 * only way to stop a browser scrolling the page out from under a drag, and
 * putting it on a bench row would mean the list could not be scrolled by
 * touching a row — which is most of the list. So on touch a drag starts only
 * from an explicit handle, and anywhere else on the row still scrolls and taps.
 * A mouse has no such conflict and can drag from the whole row.
 */
export interface DragState {
  /** Player being dragged, or null when idle. */
  id: number | null
  /** Player under the pointer that would accept the drop, or null. */
  over: number | null
  x: number
  y: number
}

const IDLE: DragState = { id: null, over: null, x: 0, y: 0 }

/** Past this many pixels a press is a drag and not a tap. */
const SLOP = 6

export function useDragSwap ({ canDrop, onDrop, onTap, locked }: {
  canDrop: (from: number, to: number) => boolean
  onDrop: (from: number, to: number) => void
  onTap?: (id: number) => void
  locked?: (id: number) => boolean
}) {
  const [drag, setDrag] = useState<DragState>(IDLE)

  // Everything the move handler needs, off the render path: a drag updates
  // coordinates on every pointermove and re-binding window listeners at that
  // rate is how a drag ends up dropping frames.
  const g = useRef({ id: null as number | null, x0: 0, y0: 0, moved: false, frozen: false })

  // Live refs for the callbacks, so the listeners can be bound once per drag
  // and still see current props.
  const fns = useRef({ canDrop, onDrop, onTap })
  useEffect(() => { fns.current = { canDrop, onDrop, onTap } })

  // `from` is passed in rather than read off the ref. pointerup has to clear the
  // gesture before it can settle it — otherwise a re-render mid-teardown leaves
  // a drag that never ended — and reading the source id afterwards meant asking
  // canDrop(null, target), which is false for every target. The drag lit up
  // correctly all the way to the drop and then quietly did nothing.
  const targetAt = useCallback((from: number, x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drag-id]')
    if (!el) return null
    const to = Number((el as HTMLElement).dataset.dragId)
    if (!Number.isFinite(to) || to === from) return null
    return fns.current.canDrop(from, to) ? to : null
  }, [])

  const begin = useCallback((id: number, e: React.PointerEvent) => {
    // Only the primary button drags; a right-click should not.
    if (e.button !== 0 && e.pointerType === 'mouse') return

    // A player who cannot be moved can still be *opened* — his match has
    // started, which is exactly when you want his points itemised. So a frozen
    // press is not ignored, it is a press that can only ever end up a tap.
    // Bailing out here instead cost every locked player his player sheet.
    const frozen = !!locked?.(id) ||
      (e.pointerType === 'touch' &&
       !(e.target as HTMLElement).closest('[data-drag-handle]'))

    g.current = { id, x0: e.clientX, y0: e.clientY, moved: false, frozen }

    const move = (ev: PointerEvent) => {
      const { x0, y0, moved, frozen } = g.current
      if (frozen) {
        // Travelled: this was a scroll or a stray movement, not a tap. Let it
        // go rather than firing the sheet open when the finger lifts.
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) >= SLOP) g.current.moved = true
        return
      }
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < SLOP) return
      g.current.moved = true
      // Once it is a drag, it is not a scroll.
      ev.preventDefault()
      setDrag({
        id: g.current.id, over: targetAt(id, ev.clientX, ev.clientY),
        x: ev.clientX, y: ev.clientY
      })
    }

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      const { id: from, moved, frozen } = g.current
      g.current.id = null
      setDrag(IDLE)
      if (from === null) return
      if (!moved) { fns.current.onTap?.(from); return }
      if (frozen) return
      const to = targetAt(from, ev.clientX, ev.clientY)
      if (to !== null) fns.current.onDrop(from, to)
    }

    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      g.current.id = null
      setDrag(IDLE)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [locked, targetAt])

  /** Spread onto anything draggable *and* droppable. */
  const bind = useCallback((id: number) => ({
    'data-drag-id': id,
    onPointerDown: (e: React.PointerEvent) => begin(id, e)
  }), [begin])

  return { drag, bind, dragging: drag.id !== null }
}

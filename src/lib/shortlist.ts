import { useCallback, useEffect, useState } from 'react'

/**
 * A private draft shortlist, kept in localStorage.
 *
 * Deliberately not server state: it's personal, it changes constantly while
 * you're scanning the board, and nobody else should ever see it. Keeping it
 * local means starring is instant and costs no round trip mid-draft.
 */
const key = (leagueId: string) => `draft.shortlist.${leagueId}`

function read (leagueId: string): number[] {
  try {
    const raw = localStorage.getItem(key(leagueId))
    return raw ? (JSON.parse(raw) as number[]) : []
  } catch { return [] }
}

export function useShortlist (leagueId: string) {
  const [ids, setIds] = useState<number[]>(() => read(leagueId))

  useEffect(() => { setIds(read(leagueId)) }, [leagueId])

  // Keep other tabs in step - plenty of people draft with two windows open.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key(leagueId)) setIds(read(leagueId))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [leagueId])

  const toggle = useCallback((playerId: number) => {
    setIds(cur => {
      const next = cur.includes(playerId)
        ? cur.filter(x => x !== playerId)
        : [...cur, playerId]
      try { localStorage.setItem(key(leagueId), JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [leagueId])

  const clear = useCallback(() => {
    setIds([])
    try { localStorage.removeItem(key(leagueId)) } catch { /* private mode */ }
  }, [leagueId])

  return { ids, set: new Set(ids), toggle, clear }
}

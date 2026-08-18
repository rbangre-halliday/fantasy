import type { Position, SquadPlayer } from './types'
import { XI_SHAPE } from './types'

export const POS_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 }

export const POS_LABEL: Record<Position, string> = {
  GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards'
}

/** m:ss, clamped at zero — used for the pick clock. */
export function clock (ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function kickoffLabel (iso: string | null): string {
  if (!iso) return 'No fixture'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit'
  })
}

export function relativeTime (iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** Injury / availability flags straight from FPL's status codes. */
export function availability (status: string | null): { label: string; tone: string } | null {
  switch (status) {
    case 'i': return { label: 'Injured', tone: 'var(--red)' }
    case 'd': return { label: 'Doubtful', tone: 'var(--gold)' }
    case 's': return { label: 'Suspended', tone: 'var(--red)' }
    case 'u': return { label: 'Unavailable', tone: 'var(--ink-3)' }
    case 'n': return { label: 'Not in squad', tone: 'var(--ink-3)' }
    default:  return null
  }
}

/**
 * Is this set of starters a legal 4-4-2? Mirrors the check the database runs,
 * so the UI can disable the save button before the round trip.
 */
export function xiIsValid (starters: SquadPlayer[]): boolean {
  if (starters.length !== 11) return false
  return (Object.keys(XI_SHAPE) as Position[])
    .every(p => starters.filter(s => s.position === p).length === XI_SHAPE[p])
}

export function xiProblem (starters: SquadPlayer[]): string | null {
  for (const p of Object.keys(XI_SHAPE) as Position[]) {
    const have = starters.filter(s => s.position === p).length
    const want = XI_SHAPE[p]
    if (have !== want) {
      return have < want
        ? `Start ${want - have} more ${p}`
        : `Start ${have - want} fewer ${p}`
    }
  }
  return null
}

/**
 * "LIV (H)" — the opponent and whether it is at home.
 *
 * Short on purpose: this sits in a table row beside a name and two numbers, and
 * the useful part is the three letters. The gameweek is only worth showing when
 * it is not the one being looked at.
 */
export function fixtureLabel (
  fx: { opp: string; home: boolean; gw: number } | undefined,
  showGw?: number
): string {
  if (!fx) return '—'
  const base = `${fx.opp} (${fx.home ? 'H' : 'A'})`
  return showGw != null && fx.gw !== showGw ? `${base} · GW${fx.gw}` : base
}

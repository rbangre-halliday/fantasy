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

/**
 * FPL's stat identifiers, in English.
 *
 * The scoring rules change between seasons — defensive contributions arrived
 * one summer, manager elements another — so the points themselves are always
 * FPL's own number and this map only names them. Anything unrecognised falls
 * back to its identifier with the underscores taken out, which reads well
 * enough that a new rule never shows up as a blank row.
 */
const POINT_LABELS: Record<string, string> = {
  minutes: 'Minutes played',
  goals_scored: 'Goals',
  assists: 'Assists',
  clean_sheets: 'Clean sheet',
  goals_conceded: 'Goals conceded',
  own_goals: 'Own goals',
  penalties_saved: 'Penalties saved',
  penalties_missed: 'Penalties missed',
  yellow_cards: 'Yellow card',
  red_cards: 'Red card',
  saves: 'Saves',
  bonus: 'Bonus',
  defensive_contribution: 'Defensive contribution',
  starts: 'Started'
}

export interface PointsLine {
  identifier: string
  label: string
  /** "90'", "×2", or empty where the count would only repeat the points. */
  detail: string
  points: number
}

/**
 * FPL's per-fixture explanation, flattened into the lines a manager reads.
 *
 * A double gameweek arrives as two fixtures and is summed, because the squad
 * screen shows one number per player. `bps` is dropped: it is the input to the
 * bonus, not points, and a row scoring zero next to real ones invites the
 * reader to work out why.
 */
export function pointsLines (
  breakdown: { stats: { identifier: string; points: number; value: number }[] }[] | null
): PointsLine[] {
  const byId = new Map<string, { points: number; value: number }>()
  for (const fx of breakdown ?? []) {
    for (const s of fx.stats ?? []) {
      if (s.identifier === 'bps') continue
      const at = byId.get(s.identifier) ?? { points: 0, value: 0 }
      byId.set(s.identifier, { points: at.points + s.points, value: at.value + s.value })
    }
  }
  return [...byId.entries()]
    .filter(([, v]) => v.points !== 0 || v.value !== 0)
    .map(([identifier, v]) => ({
      identifier,
      label: POINT_LABELS[identifier] ?? identifier.replace(/_/g, ' '),
      detail:
        identifier === 'minutes' ? `${v.value}'`
        : identifier === 'bonus' || v.value <= 1 ? ''
        : `×${v.value}`,
      points: v.points
    }))
    // Minutes first — it is the line that explains whether the rest happened —
    // then the biggest contributions, then the deductions.
    .sort((a, b) =>
      (a.identifier === 'minutes' ? -1 : 0) - (b.identifier === 'minutes' ? -1 : 0) ||
      b.points - a.points)
}

/**
 * The opponent for the gameweek being looked at, straight off the squad row.
 *
 * This used to be composed from a client-side "next unfinished fixture" lookup,
 * which is a different question: on the GW1 tab it printed GW1's kick-off time
 * beside GW2's opponent. Both halves now come from the same row.
 */
export function gwFixtureLabel (p: {
  opp_short: string | null
  is_home: boolean | null
  fixture_count: number
}): string {
  if (!p.opp_short) return p.fixture_count === 0 ? 'No fixture' : ''
  const base = `${p.opp_short} (${p.is_home ? 'H' : 'A'})`
  // A double gameweek: the first match named, the rest counted.
  return p.fixture_count > 1 ? `${base} +${p.fixture_count - 1}` : base
}

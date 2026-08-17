import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Club badges and player portraits, from the Premier League's own image CDN.
 *
 * A football app made entirely of strings asks you to read every row; a badge
 * is recognised without reading. Both endpoints are public and unauthenticated,
 * and we already hold the two ids they key on — so this costs one small lookup
 * and no new infrastructure.
 *
 * The two ids are easy to confuse: `epl_teams.id` is FPL's team number (Arsenal
 * are 1) while `epl_teams.code` is the Premier League's own club id (Arsenal
 * are t3, which is what the badge is filed under).
 */

export const badgeUrl = (teamCode: number | null | undefined, size: 25 | 50 | 100 = 50) =>
  teamCode ? `https://resources.premierleague.com/premierleague/badges/${size}/t${teamCode}.png` : null

export const photoUrl = (playerCode: number | null | undefined) =>
  playerCode ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${playerCode}.png` : null

interface Lookups {
  /** FPL team id → Premier League club code, for badges. */
  teamCode: Map<number, number>
  /** Club short name ("ARS") → club code, for rows that carry only the
      abbreviation. member_squad returns club_short and no team id. */
  shortCode: Map<string, number>
  /** FPL element id → player code, for portraits. */
  playerCode: Map<number, number>
}

const empty: Lookups = { teamCode: new Map(), shortCode: new Map(), playerCode: new Map() }

// Module-level so every screen in a session shares one fetch. Six hundred
// (id, code) pairs is a few kilobytes and it never changes mid-session.
let cache: Lookups | null = null
let inflight: Promise<Lookups> | null = null

async function fetchLookups (): Promise<Lookups> {
  const [teams, players] = await Promise.all([
    supabase.from('epl_teams').select('id, code, short_name'),
    supabase.from('epl_players').select('id, code').eq('active', true)
  ])
  return {
    teamCode: new Map(
      (teams.data ?? [])
        .filter(t => t.code != null)
        .map(t => [t.id as number, t.code as number])),
    shortCode: new Map(
      (teams.data ?? [])
        .filter(t => t.code != null)
        .map(t => [t.short_name as string, t.code as number])),
    playerCode: new Map(
      (players.data ?? [])
        .filter(p => p.code != null)
        .map(p => [p.id as number, p.code as number]))
  }
}

export function useCrests (): Lookups {
  const [maps, setMaps] = useState<Lookups>(cache ?? empty)

  useEffect(() => {
    if (cache) { setMaps(cache); return }
    let live = true
    inflight ??= fetchLookups()
    // A missing badge is a cosmetic loss, never an error worth surfacing.
    inflight.then(m => { cache = m; if (live) setMaps(m) }).catch(() => { inflight = null })
    return () => { live = false }
  }, [])

  return maps
}

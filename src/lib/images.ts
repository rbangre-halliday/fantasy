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

export interface NextFixture {
  /** Opponent's short name, e.g. "LIV". */
  opp: string
  /** True when this team is at home. */
  home: boolean
  gw: number
  kickoff: string | null
}

interface Lookups {
  /** FPL team id → Premier League club code, for badges. */
  teamCode: Map<number, number>
  /** Club short name → FPL team id, for rows that carry only the abbreviation. */
  idByShort: Map<string, number>
  /**
   * FPL team id → the next fixture that team has.
   *
   * A fantasy manager picks on fixtures — who a player faces next is at least
   * as informative as last season's total, and we were showing none of it
   * despite syncing the whole fixture list for lock timing.
   */
  nextFixture: Map<number, NextFixture>
  /** Club short name ("ARS") → club code, for rows that carry only the
      abbreviation. member_squad returns club_short and no team id. */
  shortCode: Map<string, number>
}

const empty: Lookups = {
  teamCode: new Map(), shortCode: new Map(),
  idByShort: new Map(), nextFixture: new Map()
}

// Module-level so every screen in a session shares one fetch. Six hundred
// (id, code) pairs is a few kilobytes and it never changes mid-session.
let cache: Lookups | null = null
let inflight: Promise<Lookups> | null = null

async function fetchLookups (): Promise<Lookups> {
  // Twenty clubs, and the fixtures still to be played. Both are small and
  // neither changes within a session.
  const [teams, fixtures] = await Promise.all([
    supabase.from('epl_teams').select('id, code, short_name'),
    supabase.from('fixtures')
      .select('gw, kickoff, home_team, away_team, finished')
      .eq('finished', false)
      .order('gw')
  ])

  const shortOf = new Map<number, string>(
    (teams.data ?? []).map(t => [t.id as number, t.short_name as string]))

  // First unfinished fixture per team, in gameweek order.
  const nextFixture = new Map<number, NextFixture>()
  for (const f of fixtures.data ?? []) {
    for (const [teamId, oppId, home] of [
      [f.home_team as number, f.away_team as number, true],
      [f.away_team as number, f.home_team as number, false]
    ] as const) {
      if (teamId == null || nextFixture.has(teamId)) continue
      const opp = shortOf.get(oppId)
      if (!opp) continue
      nextFixture.set(teamId, { opp, home, gw: f.gw as number, kickoff: f.kickoff as string | null })
    }
  }
  return {
    teamCode: new Map(
      (teams.data ?? [])
        .filter(t => t.code != null)
        .map(t => [t.id as number, t.code as number])),
    shortCode: new Map(
      (teams.data ?? [])
        .filter(t => t.code != null)
        .map(t => [t.short_name as string, t.code as number])),
    idByShort: new Map(
      (teams.data ?? []).map(t => [t.short_name as string, t.id as number])),
    nextFixture
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

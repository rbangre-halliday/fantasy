#!/usr/bin/env node
/**
 * Pulls everything the game needs from the official Fantasy Premier League API
 * and upserts it into Supabase, then asks Postgres to recompute standings.
 *
 * No API key, no scraping — these are the same public JSON endpoints the
 * official FPL site calls, and they carry the canonical `element` ids we store
 * as our own player ids.
 *
 *   node scripts/sync-fpl.mjs            # teams, players, gameweeks, fixtures,
 *                                        # live points for recent gameweeks
 *   node scripts/sync-fpl.mjs --full     # + every gameweek's points, backfilled
 *   node scripts/sync-fpl.mjs --history  # + previous-season totals (slow, weekly)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const API = 'https://fantasy.premierleague.com/api'
const POSITIONS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

const FULL = process.argv.includes('--full')
const HISTORY = process.argv.includes('--history')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function get (path, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: { 'User-Agent': 'epl-fantasy-draft/1.0 (+github actions sync)' }
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json()
    } catch (err) {
      if (i === tries) throw new Error(`GET ${path} failed: ${err.message}`)
      await new Promise(r => setTimeout(r, 500 * 2 ** i))
    }
  }
}

async function upsert (table, rows, onConflict) {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
  }
  log(`  ${table}: ${rows.length} rows`)
}

// --------------------------------------------------------------------------

async function main () {
  log('Fetching bootstrap-static…')
  const boot = await get('/bootstrap-static/')

  await upsert('epl_teams', boot.teams.map(t => ({
    id: t.id, name: t.name, short_name: t.short_name
  })), 'id')

  await upsert('gameweeks', boot.events.map(e => ({
    id: e.id,
    name: e.name,
    deadline: e.deadline_time,
    is_current: e.is_current,
    is_next: e.is_next,
    finished: e.finished,
    data_checked: e.data_checked
  })), 'id')

  // element_type 5+ are the "manager" elements FPL added for its own chips.
  // This game only fields footballers.
  const players = boot.elements.filter(e => POSITIONS[e.element_type])

  await upsert('epl_players', players.map(e => ({
    id: e.id,
    code: e.code,
    first_name: e.first_name,
    second_name: e.second_name,
    web_name: e.web_name,
    team_id: e.team,
    position: POSITIONS[e.element_type],
    current_season_points: e.total_points ?? 0,
    status: e.status,
    news: e.news ?? '',
    active: true,
    updated_at: new Date().toISOString()
  })), 'id')

  // Anyone who has left the league stops appearing as a free agent, but stays
  // in the table so historical rosters and scores still resolve.
  const liveIds = new Set(players.map(p => p.id))
  const { data: known } = await db.from('epl_players').select('id').eq('active', true)
  const gone = (known ?? []).map(r => r.id).filter(id => !liveIds.has(id))
  if (gone.length) {
    await db.from('epl_players').update({ active: false }).in('id', gone)
    log(`  deactivated ${gone.length} departed players`)
  }

  log('Fetching fixtures…')
  const fixtures = await get('/fixtures/')
  await upsert('fixtures', fixtures.map(f => ({
    id: f.id,
    gw: f.event,
    kickoff: f.kickoff_time,
    home_team: f.team_h,
    away_team: f.team_a,
    started: !!f.started,
    finished: !!f.finished
  })), 'id')

  // ---- gameweek points -----------------------------------------------------
  const current = boot.events.find(e => e.is_current)?.id ?? 0
  const targets = FULL
    ? boot.events.filter(e => e.finished || e.is_current).map(e => e.id)
    // Normally only the live gameweek and the one before it can still change
    // (bonus points and provisional stats settle a day or two late).
    : boot.events.filter(e => e.id >= current - 1 && e.id <= current && e.id > 0).map(e => e.id)

  for (const gw of targets) {
    log(`Fetching gameweek ${gw} live points…`)
    const live = await get(`/event/${gw}/live/`)
    const rows = live.elements
      .filter(el => liveIds.has(el.id))
      .map(el => ({
        player_id: el.id,
        gw,
        points: el.stats?.total_points ?? 0,
        minutes: el.stats?.minutes ?? 0
      }))
    await upsert('player_gw_points', rows, 'player_id,gw')
  }

  // ---- previous-season totals (draft rankings) -----------------------------
  if (HISTORY) await syncHistory(players)

  // ---- let Postgres do the rest -------------------------------------------
  log('Refreshing lineups…')
  const r1 = await db.rpc('refresh_lineups')
  if (r1.error) throw new Error(`refresh_lineups: ${r1.error.message}`)

  log('Recomputing scores…')
  const r2 = await db.rpc('recompute_scores')
  if (r2.error) throw new Error(`recompute_scores: ${r2.error.message}`)

  log('Done.')
}

/**
 * Previous-season points are the primary draft ranking, and they only live on
 * the per-player summary endpoint. That is one request per player, so this runs
 * on its own weekly schedule and only for players we don't already have.
 */
async function syncHistory (players) {
  const { data: have } = await db
    .from('epl_players').select('id').gt('prev_season_points', 0)
  const known = new Set((have ?? []).map(r => r.id))
  const todo = players.filter(p => !known.has(p.id))

  if (!todo.length) { log('History: nothing to backfill.'); return }
  log(`History: fetching ${todo.length} player summaries…`)

  const CONCURRENCY = 4
  const out = []
  let cursor = 0

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < todo.length) {
      const p = todo[cursor++]
      try {
        const summary = await get(`/element-summary/${p.id}/`, 2)
        const past = summary.history_past ?? []
        // history_past is chronological; the last entry is the most recent season.
        const prev = past.length ? past[past.length - 1].total_points : 0
        out.push({ id: p.id, prev_season_points: prev })
      } catch {
        out.push({ id: p.id, prev_season_points: 0 })
      }
      await new Promise(r => setTimeout(r, 60)) // be a good citizen
    }
  }))

  for (let i = 0; i < out.length; i += 200) {
    const { error } = await db.from('epl_players').upsert(out.slice(i, i + 200), { onConflict: 'id' })
    if (error) throw new Error(`history upsert: ${error.message}`)
  }
  log(`History: updated ${out.length} players.`)
}

main().catch(err => { console.error(err); process.exit(1) })

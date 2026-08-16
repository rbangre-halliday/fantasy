import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Loading, Notice, PosChip, Segmented, Sheet } from '../components/ui'
import { clock } from '../lib/format'
import { POSITIONS, SQUAD_CAPS } from '../lib/types'
import type { DraftPick, LeaguePlayer, Position } from '../lib/types'

type Filter = 'ALL' | Position

export default function DraftRoom () {
  const { league, members, me, draft, isCommissioner, refresh } = useLeague()
  const { toast, fail } = useToast()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [picks, setPicks] = useState<DraftPick[]>([])
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<LeaguePlayer | null>(null)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const tickGuard = useRef(0)

  const nameOf = useMemo(
    () => new Map(members.map(m => [m.id, m.team_name])),
    [members]
  )

  const reload = useCallback(async () => {
    const [p, pk] = await Promise.all([
      api.getLeaguePlayers(league.id),
      api.getPicks(league.id)
    ])
    setPlayers(p); setPicks(pk)
  }, [league.id])

  useEffect(() => { reload().catch(fail) }, [reload, fail])
  useEffect(() => { api.clockOffset().then(setOffset).catch(() => setOffset(0)) }, [])

  // Live pick feed. A new pick only needs a local patch, so the 600-row player
  // list is fetched once per session rather than once per pick.
  useEffect(() => {
    const ch = supabase.channel(`draft:${league.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `league_id=eq.${league.id}` },
        payload => {
          const pick = payload.new as DraftPick
          setPicks(cur => cur.some(p => p.id === pick.id) ? cur : [...cur, pick])
          setPlayers(cur => cur?.map(p => p.id === pick.player_id
            ? { ...p, owner_member_id: pick.member_id, owner_team_name: nameOf.get(pick.member_id) ?? '' }
            : p) ?? cur)
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'draft_picks', filter: `league_id=eq.${league.id}` },
        () => { void reload() })   // an undo: cheapest correct thing is a refetch
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [league.id, nameOf, reload])

  // One second heartbeat for the clock display.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const deadline = draft?.pick_deadline ? new Date(draft.pick_deadline).getTime() : null
  const remaining = deadline === null ? null : deadline - (now + offset)
  const running = draft?.status === 'running'
  const myTurn = running && draft?.current_member_id === me.id
  const expired = running && remaining !== null && remaining < -900

  // When the clock runs out, whoever is watching asks the server to advance.
  // The server re-checks its own clock, so an early or duplicated call is a
  // no-op rather than a wrong auto-pick.
  useEffect(() => {
    if (!expired) return
    const stamp = draft?.current_pick ?? 0
    if (tickGuard.current === stamp) return
    tickGuard.current = stamp
    api.draftTick(league.id).then(() => refresh()).catch(() => { tickGuard.current = 0 })
  }, [expired, draft?.current_pick, league.id, refresh])

  const myCounts = useMemo(() => {
    const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
    if (!players) return c
    for (const p of players) if (p.owner_member_id === me.id) c[p.position]++
    return c
  }, [players, me.id])

  const myTotal = POSITIONS.reduce((n, p) => n + myCounts[p], 0)

  const visible = useMemo(() => {
    if (!players) return []
    const q = query.trim().toLowerCase()
    return players.filter(p =>
      !p.owner_member_id &&
      (filter === 'ALL' || p.position === filter) &&
      (!q ||
        p.web_name.toLowerCase().includes(q) ||
        `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q) ||
        (p.club ?? '').toLowerCase().includes(q))
    ).slice(0, 180)
  }, [players, filter, query])

  async function pick (p: LeaguePlayer) {
    setBusy(true)
    try {
      await api.makePick(league.id, p.id)
      setConfirming(null)
      toast(`${p.web_name} is yours`, 'good')
      await refresh()
    } catch (err) { fail(err); void reload() }
    finally { setBusy(false) }
  }

  async function commish (fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await fn(); await refresh(); await reload(); toast(done, 'good') }
    catch (err) { fail(err) } finally { setBusy(false) }
  }

  if (!draft) {
    return <div className="page mt-32"><Notice>The draft hasn’t started yet.</Notice></div>
  }

  const complete = draft.status === 'complete'
  const onClockTeam = draft.current_member_id ? nameOf.get(draft.current_member_id) : null
  const totalPicks = members.length * draft.total_rounds

  return (
    <div className="page">
      {/* ---- the clock ------------------------------------------------- */}
      <div className={`slab mt-24 ${myTurn ? 'red' : 'green'}`} style={{ position: 'sticky', top: 0 }}>
        {complete ? (
          <>
            <div className="eyebrow">Draft complete</div>
            <h1 className="h2 mt-8">Every squad is full. Good luck.</h1>
            <p className="small muted mt-8">Set your starting XI on the Squad tab.</p>
          </>
        ) : (
          <div className="between wrap gap-16">
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">
                Round {draft.current_round} · Pick {draft.current_pick} of {totalPicks}
              </div>
              <h1 className="h2 mt-8 truncate">
                {myTurn ? 'You’re on the clock' : onClockTeam ?? '—'}
              </h1>
              {draft.status === 'paused' && (
                <div className="small muted mt-8">Paused by the commissioner</div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow">{draft.status === 'paused' ? 'Held' : 'Time left'}</div>
              <div className="num" style={{
                fontSize: 'clamp(34px, 9vw, 50px)',
                lineHeight: 1,
                color: remaining !== null && remaining < 20000 && running
                  ? 'var(--red)' : 'var(--ink)'
              }}>
                {draft.status === 'paused'
                  ? clock(draft.paused_remaining_ms ?? 0)
                  : clock(remaining ?? 0)}
              </div>
            </div>
          </div>
        )}

        {isCommissioner && !complete && (
          <div className="row gap-8 wrap mt-16" style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
            {draft.status === 'running'
              ? <button className="btn sm ghost" disabled={busy}
                  onClick={() => void commish(() => api.pauseDraft(league.id), 'Draft paused')}>Pause</button>
              : <button className="btn sm ghost" disabled={busy}
                  onClick={() => void commish(() => api.resumeDraft(league.id), 'Draft resumed')}>Resume</button>}
            <button className="btn sm ghost" disabled={busy || picks.length === 0}
              onClick={() => {
                const last = picks[picks.length - 1]
                if (confirm(`Undo the last pick (${last ? nameOf.get(last.member_id) : ''})?`)) {
                  void commish(() => api.undoLastPick(league.id), 'Last pick undone')
                }
              }}>Undo last pick</button>
          </div>
        )}
      </div>

      {/* ---- my squad so far ------------------------------------------- */}
      <div className="mt-24">
        <Eyebrow>Your squad · {myTotal} of 16</Eyebrow>
        <div className="row gap-8 wrap">
          {POSITIONS.map(p => {
            const full = myCounts[p] >= SQUAD_CAPS[p]
            return (
              <div key={p} className="card" style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                opacity: full ? .5 : 1
              }}>
                <PosChip pos={p} />
                <span className="num small">{myCounts[p]}/{SQUAD_CAPS[p]}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-32" style={{
        display: 'grid', gap: 32,
        gridTemplateColumns: 'minmax(0, 1fr)'
      }}>
        <div style={{ display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0,1fr)' }}
          className="draft-grid">

          {/* ---- available players ------------------------------------- */}
          <section>
            <Eyebrow>Available</Eyebrow>

            <div className="stack gap-12">
              <input className="input" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search player or club" type="search" />
              <Segmented<Filter>
                value={filter} onChange={setFilter}
                options={[
                  { value: 'ALL', label: 'All' },
                  ...POSITIONS.map(p => ({
                    value: p as Filter,
                    label: myCounts[p] >= SQUAD_CAPS[p] ? `${p} · full` : p
                  }))
                ]}
              />
            </div>

            {players === null ? <Loading /> : (
              <>
                <div className="thead mt-16">
                  <span className="grow">Player</span>
                  <span style={{ width: 46, textAlign: 'right' }}>Last</span>
                  <span style={{ width: 46, textAlign: 'right' }}>This</span>
                </div>
                <ul>
                  {visible.map(p => {
                    const capped = myCounts[p.position] >= SQUAD_CAPS[p.position]
                    return (
                      <li key={p.id}>
                        <button className={`list-row ${capped ? 'is-disabled' : ''}`}
                          disabled={!myTurn || capped || busy}
                          onClick={() => setConfirming(p)}>
                          <PosChip pos={p.position} />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                            <span className="club">{p.club_short ?? '—'}</span>
                          </span>
                          <span className="num small" style={{ width: 46, textAlign: 'right' }}>
                            {p.prev_season_points}
                          </span>
                          <span className="num small muted" style={{ width: 46, textAlign: 'right' }}>
                            {p.current_season_points}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {visible.length === 0 && <div className="empty">No players match that.</div>}
                {visible.length === 180 && (
                  <p className="tiny muted mt-8" style={{ textAlign: 'center' }}>
                    Showing the top 180 — search to narrow it down.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---- the board --------------------------------------------- */}
          <section>
            <Eyebrow>Picks</Eyebrow>
            {picks.length === 0 ? (
              <div className="empty">No picks yet.</div>
            ) : (
              <ul className="list">
                {[...picks].reverse().slice(0, 40).map(pk => {
                  const player = players?.find(p => p.id === pk.player_id)
                  return (
                    <li key={pk.id} className="list-row">
                      <span className="num tiny muted" style={{ width: 34 }}>
                        {pk.round}.{String(((pk.pick_number - 1) % members.length) + 1)}
                      </span>
                      {player && <PosChip pos={player.position} />}
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>
                          {player?.web_name ?? `#${pk.player_id}`}
                        </span>
                        <span className="tiny muted truncate" style={{ display: 'block' }}>
                          {nameOf.get(pk.member_id)}{pk.auto_pick && ' · auto'}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {confirming && (
        <Sheet title="Confirm your pick" onClose={() => setConfirming(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirming(null)}>Back</button>
              <button className="btn" disabled={busy} onClick={() => void pick(confirming)}>
                {busy ? 'Drafting…' : 'Draft'}
              </button>
            </>
          }>
          <div className="row gap-12">
            <PosChip pos={confirming.position} />
            <div>
              <div className="h3">{confirming.first_name} {confirming.second_name}</div>
              <div className="club">{confirming.club}</div>
            </div>
          </div>
          <div className="row gap-24 mt-24">
            <div>
              <div className="eyebrow">Last season</div>
              <div className="num h2">{confirming.prev_season_points}</div>
            </div>
            <div>
              <div className="eyebrow">This season</div>
              <div className="num h2">{confirming.current_season_points}</div>
            </div>
          </div>
          {confirming.news && (
            <div className="mt-16"><Notice kind="warn">{confirming.news}</Notice></div>
          )}
        </Sheet>
      )}

      <style>{`
        @media (min-width: 940px) {
          .draft-grid { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  )
}

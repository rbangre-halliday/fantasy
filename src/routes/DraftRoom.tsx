import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Eyebrow, IconStar, Loading, Notice, PlayerPortrait, PosChip, SearchField, Segmented, Sheet } from '../components/ui'
import SquadPitch from '../components/SquadPitch'
import { useCrests } from '../lib/images'
import { useShortlist } from '../lib/shortlist'
import { clock } from '../lib/format'
import { POSITIONS, SQUAD_CAPS } from '../lib/types'
import type { DraftPick, LeaguePlayer, Position } from '../lib/types'

type Filter = 'ALL' | 'SHORT' | Position

export default function DraftRoom () {
  const { league, members, me, draft, isCommissioner, refresh } = useLeague()
  const { toast, fail } = useToast()
  const crests = useCrests()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [picks, setPicks] = useState<DraftPick[]>([])
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<LeaguePlayer | null>(null)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const tickGuard = useRef(0)
  const shortlist = useShortlist(league.id)

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

  // Nobody watches a draft in a focused tab for two hours. Missing your pick
  // costs you the player — the server auto-picks — so the turn has to be able
  // to reach you when the page isn't the thing you're looking at. The tab
  // title is the one channel that needs no permission and makes no noise.
  useEffect(() => {
    const mine = draft?.status === 'running' && draft.current_member_id === me.id
    const base = 'Gaffer — Fantasy Premier League'
    document.title = mine ? '⏱ Your pick — Gaffer' : base
    return () => { document.title = base }
  }, [draft?.status, draft?.current_member_id, me.id])

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

  /**
   * How many picks until it's your turn again.
   *
   * A snake draft makes this genuinely hard to work out in your head — the
   * order reverses every round, so "when am I up?" changes with the round's
   * parity. Sitting there not knowing whether you have ten seconds or ten
   * minutes is the worst part of a draft, and the answer is a pure function of
   * numbers the client already has. Mirrors snake_member() in
   * supabase/03_functions.sql: slot = idx on odd rounds, n + 1 - idx on even.
   */
  const picksUntilMine = useMemo(() => {
    const n = members.length
    if (!draft || !n || me.draft_position == null) return null
    const slotAt = (pick: number) => {
      const round = Math.floor((pick - 1) / n) + 1
      const idx = ((pick - 1) % n) + 1
      return round % 2 === 1 ? idx : n + 1 - idx
    }
    const last = n * draft.total_rounds
    for (let p = draft.current_pick; p <= last; p++) {
      if (slotAt(p) === me.draft_position) return p - draft.current_pick
    }
    return null                                  // no picks left this draft
  }, [draft, members.length, me.draft_position])

  /** The positions you still have room for, so the board can be narrowed. */
  const stillNeeded = useMemo(
    () => POSITIONS
      .map(p => ({ pos: p, left: SQUAD_CAPS[p] - myCounts[p] }))
      .filter(x => x.left > 0),
    [myCounts])

  const mySquad = useMemo(
    () => (players ?? [])
      .filter(p => p.owner_member_id === me.id)
      .map(p => ({ id: p.id, name: p.web_name, club: p.club_short, position: p.position })),
    [players, me.id])

  const visible = useMemo(() => {
    if (!players) return []
    const q = query.trim().toLowerCase()
    const rows = players.filter(p =>
      !p.owner_member_id &&
      (filter === 'ALL' || filter === 'SHORT' || p.position === filter) &&
      (filter !== 'SHORT' || shortlist.set.has(p.id)) &&
      (!q ||
        p.web_name.toLowerCase().includes(q) ||
        `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q) ||
        (p.club ?? '').toLowerCase().includes(q))
    )
    // Starred players float to the top everywhere else, so the board you built
    // is the board you pick from when the clock is running.
    if (filter !== 'SHORT') {
      rows.sort((a, b) =>
        Number(shortlist.set.has(b.id)) - Number(shortlist.set.has(a.id)))
    }
    return rows.slice(0, 180)
  }, [players, filter, query, shortlist.set])

  // How many of your starred players are still on the board.
  const shortlistLeft = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id && shortlist.set.has(p.id)).length,
    [players, shortlist.set])

  async function pick (p: LeaguePlayer) {
    setBusy(true)
    try {
      await api.makePick(league.id, p.id)
      setConfirming(null)
      toast(`${p.web_name} is yours`, 'good')
      // Refetch our own view rather than waiting on the realtime echo of our
      // own write. Relying on the socket to tell us about something we just
      // did made the squad's arrival a race, and a lost or slow event left
      // the pitch empty until a manual refresh. Realtime is for what *other*
      // managers do.
      await Promise.all([reload(), refresh()])
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
      {/* ---- the clock -------------------------------------------------
          The only screen in the app with a genuine deadline on it, so it is
          the only one that gets a block of colour this big: aubergine while
          you wait, crimson the moment it's your pick. */}
      <div className={`slab sticky-head mt-32 ${myTurn ? 'red' : 'green'}`}>
        {complete ? (
          <>
            <h1 className="h2">Every squad is full. Good luck.</h1>
            <p className="small muted mt-8">
              Draft complete · set your starting XI on the Squad tab.
            </p>
          </>
        ) : (
          <div className="between wrap gap-16">
            <div style={{ minWidth: 0 }}>
              <h1 className="h2 truncate">
                {myTurn ? 'You’re on the clock' : onClockTeam ?? '—'}
              </h1>
              <div className="small muted mt-8" data-testid="draft-progress">
                Round {draft.current_round} · pick {draft.current_pick} of {totalPicks}
                {draft.status === 'paused'
                  ? ' · paused by the commissioner'
                  // Guarded above zero on purpose: the countdown is derived
                  // from the snake order while `myTurn` comes off the draft
                  // row, and if those two ever disagree the honest thing is to
                  // say nothing rather than to announce "up in 0 picks".
                  : !myTurn && picksUntilMine !== null && picksUntilMine > 0 && (
                      picksUntilMine === 1 ? ' · you’re next'
                        : ` · you’re up in ${picksUntilMine} picks`
                    )}
              </div>

              {/* The one moment attention is guaranteed to be here is the
                  moment the clock is yours — so this is where "what do I
                  still need?" belongs, rather than in a counter further down
                  the page that you'd have to go looking for. */}
              {myTurn && stillNeeded.length > 0 && (
                <div className="needs">
                  <span className="need-note">Still to fill</span>
                  {stillNeeded.map(({ pos, left }) => (
                    <span key={pos} className="need">
                      <span className="need-n num">{left}</span> {pos}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              {/* Test hook: the clock and the pick counter are the two things a
                  UI run has to read, and both were being matched by class until
                  a restyle moved those classes elsewhere. */}
              <div className="figure" data-testid="draft-clock" style={{
                fontSize: 'clamp(46px, 11vw, 68px)',
                fontVariantNumeric: 'tabular-nums',
                color: remaining !== null && remaining < 20000 && running
                  ? 'var(--live)' : 'var(--fg)'
              }}>
                {draft.status === 'paused'
                  ? clock(draft.paused_remaining_ms ?? 0)
                  : clock(remaining ?? 0)}
              </div>
              <div className="eyebrow" style={{ marginTop: 6 }}>
                {draft.status === 'paused' ? 'Held' : 'Time left'}
              </div>
            </div>
          </div>
        )}

        {isCommissioner && !complete && (
          <div className="row gap-8 wrap mt-24"
            style={{ borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 16 }}>
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

      <div className="mt-32" style={{
        display: 'grid', gap: 32,
        gridTemplateColumns: 'minmax(0, 1fr)'
      }}>
        <div style={{ display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0,1fr)' }}
          className="draft-grid">

          {/* ---- available players -------------------------------------
              Once every squad is full there is nothing to pick, so the board
              of 500+ names is just noise. It disappears. */}
          <section hidden={complete}>
            <Eyebrow>Available</Eyebrow>

            <div className="stack gap-12">
              <SearchField value={query} onChange={setQuery}
                placeholder="Search player or club" />
              <Segmented<Filter>
                value={filter} onChange={setFilter}
                options={[
                  { value: 'ALL', label: 'All' },
                  { value: 'SHORT', label: `★ ${shortlistLeft}` },
                  ...POSITIONS.map(p => ({
                    value: p as Filter,
                    label: myCounts[p] >= SQUAD_CAPS[p] ? `${p} · full` : p
                  }))
                ]}
              />
            </div>

            {players === null ? <Loading /> : (
              <>
                <div className="thead mt-16" style={{ paddingLeft: 34 }}>
                  <span className="grow">Player</span>
                  <span style={{ width: 46, textAlign: 'right' }}>Last</span>
                  <span style={{ width: 46, textAlign: 'right' }}>This</span>
                </div>
                {/* The board scrolls inside itself rather than making the page
                    thousands of pixels tall. */}
                <ul className="scroll-pane">
                  {visible.map(p => {
                    const capped = myCounts[p.position] >= SQUAD_CAPS[p.position]
                    const starred = shortlist.set.has(p.id)
                    return (
                      <li key={p.id} className="pick-row">
                        <button
                          className={`star ${starred ? 'on' : ''}`}
                          aria-pressed={starred}
                          aria-label={starred ? `Remove ${p.web_name} from shortlist` : `Shortlist ${p.web_name}`}
                          onClick={() => shortlist.toggle(p.id)}>
                          <IconStar filled={starred} />
                        </button>
                        <button className={`list-row ${capped ? 'is-disabled' : ''}`}
                          disabled={!myTurn || capped || busy}
                          onClick={() => setConfirming(p)}>
                          <Crest code={crests.teamCode.get(p.team_id ?? -1)} alt={p.club ?? ''} />
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
                {filter === 'SHORT' && visible.length === 0 && (
                  <div className="empty">
                    Nothing starred yet. Tap the ★ beside a player to build your board.
                  </div>
                )}
                {visible.length === 0 && <div className="empty">No players match that.</div>}
                {visible.length === 180 && (
                  <p className="tiny muted mt-8" style={{ textAlign: 'center' }}>
                    Showing the top 180 — search to narrow it down.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---- your squad, as a shape -------------------------------- */}
          <section>
            <Eyebrow>Your squad · {myTotal} of 16</Eyebrow>
            <SquadPitch players={mySquad} />
            <div className="row gap-6 wrap mt-12" style={{ marginTop: 12 }}>
              {POSITIONS.map(p => (
                <span key={p} className="tiny muted num"
                  style={{ opacity: myCounts[p] >= SQUAD_CAPS[p] ? .4 : 1 }}>
                  {p} {myCounts[p]}/{SQUAD_CAPS[p]}
                </span>
              ))}
            </div>

            <div className="mt-32" />
            <Eyebrow>Picks</Eyebrow>
            {picks.length === 0 ? (
              <div className="empty">No picks yet.</div>
            ) : (
              <ul className="list scroll-pane" style={{ maxHeight: 360 }}>
                {[...picks].reverse().slice(0, 40).map((pk, i) => {
                  const player = players?.find(p => p.id === pk.player_id)
                  return (
                    // The newest pick stays marked until it is superseded.
                    // Picks arrive over the wire while you are reading the
                    // board, and a row that silently appears at the top of a
                    // list of forty identical rows is a change nobody sees.
                    <li key={pk.id} className={`list-row${i === 0 ? ' is-latest' : ''}`}>
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
            <PlayerPortrait badge={crests.teamCode.get(confirming.team_id ?? -1)} />
            <div>
              <div className="row gap-8"><PosChip pos={confirming.position} /></div>
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

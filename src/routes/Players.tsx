import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Eyebrow, IconLock, Loading, Notice, PageHead, PosChip, SearchField, Segmented } from '../components/ui'
import SquadPitch from '../components/SquadPitch'
import { useCrests } from '../lib/images'
import { fixtureLabel } from '../lib/format'
import { relativeTime } from '../lib/format'
import { POSITIONS, POS_MIN, canSwap, countByPos, flexUsed } from '../lib/types'
import type { LeaguePlayer, Move, Position, SquadPlayer } from '../lib/types'

type Filter = 'ALL' | Position
type Scope = 'free' | 'dropped' | 'all'

/** How long a dropped player still counts as news. */
const JUST_DROPPED_MS = 72 * 3600 * 1000

/** How many past gameweeks the market list shows per player. */
const RECENT_GWS = 5

/** "Timber", "Timber or Raya", "Timber, Raya or Doku". */
const joinNames = (names: string[]) =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`

export default function Players () {
  const { league, me, gameweeks, currentGw, nextGw, refresh } = useLeague()
  const { toast, fail } = useToast()
  const crests = useCrests()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  // league_players knows ownership but not the XI. The pitch is the control
  // now, and "is he starting" is the thing you weigh hardest when choosing who
  // to let go, so the lineup has to come with it.
  const [squad, setSquad] = useState<SquadPlayer[] | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [scope, setScope] = useState<Scope>('free')
  const [query, setQuery] = useState('')
  const [moves, setMoves] = useState<Move[]>([])
  const [history, setHistory] = useState<Map<number, Map<number, number>>>(new Map())
  const [sort, setSort] = useState<'this' | 'last'>('this')
  const [signing, setSigning] = useState<LeaguePlayer | null>(null)
  const [dropId, setDropId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)

  // The gameweek a signing would land in, and so the squad worth showing: if
  // this week is already being played, the shape you are editing is next week's.
  const swapGw = useMemo(
    () => (gameweeks.some(g => g.id === currentGw && Date.parse(g.deadline) < Date.now())
      ? nextGw : currentGw),
    [gameweeks, currentGw, nextGw])


  // The gameweeks the Recent column shows: the most recent few that have been
  // scored, oldest first so the row reads left to right like a form guide.
  // Capped because this is one query over every player in the game.
  const recentGws = useMemo(() => {
    const all: number[] = []
    for (let id = Math.max(1, league.scoring_start_gw); id <= currentGw; id++) {
      if (gameweeks.some(g => g.id === id)) all.push(id)
    }
    return all.slice(-RECENT_GWS)
  }, [league.scoring_start_gw, currentGw, gameweeks])

  const load = useCallback(async () => {
    const [ps, ms, sq, hist] = await Promise.all([
      api.getLeaguePlayers(league.id),
      api.getFreeAgentMoves(league.id, 25).catch(() => [] as Move[]),
      api.getSquad(me.id, swapGw).catch(() => null),
      recentGws.length
        ? api.getPlayerRecentPoints(recentGws[0], recentGws[recentGws.length - 1])
            .catch(() => ({} as Record<string, (number | null)[]>))
        : Promise.resolve({} as Record<string, (number | null)[]>)
    ])
    setPlayers(ps)
    setMoves(ms)
    setSquad(sq)
    // player -> gameweek -> points, from the positional array. A null is "did
    // not feature" and stays out of the map: a dash and a 0 are different
    // facts and the row draws them differently.
    const grid = new Map<number, Map<number, number>>()
    for (const [id, arr] of Object.entries(hist)) {
      const row = new Map<number, number>()
      arr.forEach((pts, i) => { if (pts !== null) row.set(recentGws[0] + i, pts) })
      grid.set(Number(id), row)
    }
    setHistory(grid)
  }, [league.id, me.id, swapGw, recentGws])

  useEffect(() => { load().catch(fail) }, [load, fail])

  // Free agency is first come, first served, so the list has to be live — and
  // so does the reason it changed. roster_players says a player is gone;
  // transactions says who took him and what they gave up for him.
  useEffect(() => {
    const ch = supabase.channel(`market:${league.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'roster_players', filter: `league_id=eq.${league.id}` },
        () => { void load() })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions', filter: `league_id=eq.${league.id}` },
        () => {
          void api.getFreeAgentMoves(league.id, 25).then(ms => {
            setMoves(prev => {
              // Somebody else's move, arriving while you are reading the list
              // you were about to sign from. Say so rather than silently
              // re-rendering the row out from under the cursor.
              const fresh = ms[0]
              const isNew = fresh && !prev.some(m => m.id === fresh.id)
              if (isNew && fresh.member_id !== me.id && fresh.in_name) {
                toast(`${fresh.team_name ?? 'Someone'} signed ${fresh.in_name}`)
              }
              return ms
            })
          })
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [league.id, load, me.id, toast])

  const mine = useMemo(
    () => (players ?? []).filter(p => p.owner_member_id === me.id), [players, me.id])

  /** player id -> the drop that put them back in the pool, if it was recent. */
  const justDropped = useMemo(() => {
    const cut = Date.now() - JUST_DROPPED_MS
    const map = new Map<number, Move>()
    for (const m of moves) {
      if (m.out_id === null) continue
      if (new Date(m.created_at).getTime() < cut) continue
      if (!map.has(m.out_id)) map.set(m.out_id, m)
    }
    return map
  }, [moves])

  // Has the season started? Not gameweeks.finished — that is FPL's flag for
  // "bonus confirmed", which lags full time by up to a day and left this page
  // insisting it was still pre-season two days into gameweek 1, quoting last
  // season's totals and saying nothing about the football that had just been
  // played. A gameweek whose deadline has passed is the honest signal: it comes
  // from FPL, it is never revised, and it means the football has begun.
  const seasonUnderway = useMemo(
    () => gameweeks.some(g => g.finished || Date.parse(g.deadline) < Date.now()),
    [gameweeks])

  const visible = useMemo(() => {
    if (!players) return []
    const q = query.trim().toLowerCase()
    const matched = players.filter(p =>
      (scope === 'all' || !p.owner_member_id) &&
      (scope !== 'dropped' || justDropped.has(p.id)) &&
      (filter === 'ALL' || p.position === filter) &&
      (!q ||
        p.web_name.toLowerCase().includes(q) ||
        `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q) ||
        (p.club ?? '').toLowerCase().includes(q))
    )
    // The server hands these back ranked by last season, which is the right
    // order for a draft and the wrong one for a market that has football behind
    // it. Sorted here rather than in the RPC because the whole list is already
    // in hand — the 200 cap is applied after, so re-ranking never hides anyone
    // the old order would have shown.
    const byThis = seasonUnderway && sort === 'this'
    return [...matched].sort((a, b) =>
      byThis
        ? b.current_season_points - a.current_season_points ||
          b.prev_season_points - a.prev_season_points ||
          a.web_name.localeCompare(b.web_name)
        : b.prev_season_points - a.prev_season_points ||
          b.current_season_points - a.current_season_points ||
          a.web_name.localeCompare(b.web_name)
    ).slice(0, 200)
  }, [players, filter, scope, query, justDropped, sort, seasonUnderway])


  const freeCount = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id).length, [players])

  const droppedCount = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id && justDropped.has(p.id)).length,
    [players, justDropped])

  const mySquad = useMemo(
    () => (squad ?? []).map(p => ({
      id: p.player_id, name: p.web_name, club: p.club_short, position: p.position,
      kit: crests.shortCode.get(p.club_short ?? '')
    })), [squad, crests])

  const benched = useMemo(
    () => new Set((squad ?? []).filter(p => p.lineup_status !== 'starter').map(p => p.player_id)),
    [squad])

  // Squad size is fixed at sixteen but the shape is not: fifteen of them are a
  // 2/5/5/3 floor and the last is a flex. So a signing no longer has to be
  // like-for-like — it has to leave you with a squad you are allowed to hold.
  // Sign a midfielder while your flex sits on a forward and you may drop that
  // forward or a midfielder, but not a defender: that would leave you four.
  const myCounts = useMemo(() => countByPos(mine), [mine])
  const droppable = useMemo(
    () => new Set(signing
      ? mine.filter(p => canSwap(myCounts, signing.position, p.position)).map(p => p.id)
      : []),
    [myCounts, mine, signing])

  const dropped = useMemo(
    () => mine.find(p => p.id === dropId) ?? null, [mine, dropId])

  // Whether the live gameweek has been played, and whether it is over.
  //
  // Not "is anyone locked", which was the first version and fails at exactly
  // the wrong moment: the lock releases when a gameweek is confirmed, so from
  // Monday night to Friday every player reads unlocked and this said the week
  // had not started. A deadline that has passed is the honest test.
  const liveGw = useMemo(() => gameweeks.find(g => g.id === currentGw), [gameweeks, currentGw])
  const weekUnderway = !!liveGw && Date.parse(liveGw.deadline) < Date.now()
  const weekOver = !!liveGw?.finished

  /**
   * Which gameweek a signing would land on, mirroring add_drop(). A locked
   * player is no longer unsignable — he just isn't yours until next week — so
   * the interface has to say which week it is buying, every time.
   */
  const landsOn = useCallback((add: LeaguePlayer, drop: LeaguePlayer | undefined) => {
    if (!weekUnderway) return currentGw
    if (!drop) return nextGw
    // Once the gameweek is confirmed, everyone who had a fixture has played it
    // — the like-for-like exception cannot apply to any of them, whatever the
    // lock flag currently says.
    if (weekOver) return nextGw
    return add.position === drop.position && !add.locked && !drop.locked ? currentGw : nextGw
  }, [weekUnderway, weekOver, currentGw, nextGw])

  /**
   * Which of the legal drops would still land on the gameweek being played.
   *
   * Every droppable player is drawn identically, and once a week is under way
   * the drops divide into two kinds that look exactly alike: the man whose own
   * match has yet to kick off, who buys you this gameweek, and everyone else,
   * who buys you the next one. That is frequently the difference between a
   * signing that covers a blank and one that does nothing for six days, and
   * the screen knew it before you clicked and didn't say.
   *
   * Empty when the week hasn't started — then every drop lands now and a mark
   * on all of them says nothing.
   */
  const landsNow = useMemo(() => {
    if (!signing || !weekUnderway) return new Set<number>()
    return new Set(mine
      .filter(p => droppable.has(p.id) && landsOn(signing, p) === currentGw)
      .map(p => p.id))
  }, [signing, weekUnderway, mine, droppable, landsOn, currentGw])

  // Named, because "one of your defenders" is not a thing anyone can act on.
  const landsNowNames = useMemo(
    () => mine.filter(p => landsNow.has(p.id)).map(p => p.web_name),
    [mine, landsNow])

  /**
   * Start a swap. On a phone the pitch is below the list rather than beside it,
   * so the control the tap just armed would otherwise be off-screen — the tap
   * would look like it had done nothing.
   */
  function beginSwap (p: LeaguePlayer) {
    if (signing?.id === p.id) { setSigning(null); setDropId(null); return }
    setSigning(p)
    setDropId(null)
    if (window.matchMedia('(max-width: 899px)').matches) {
      requestAnimationFrame(() =>
        asideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  async function confirmSign () {
    if (!signing || dropId === null) return
    setBusy(true)
    try {
      await api.addDrop(league.id, signing.id, dropId)
      const dropped = mine.find(p => p.id === dropId)
      toast(`Signed ${signing.web_name}${dropped ? `, dropped ${dropped.web_name}` : ''}`, 'good')
      setSigning(null); setDropId(null)
      await load(); await refresh()
    } catch (err) { fail(err); await load() }
    finally { setBusy(false) }
  }

  const open = league.status === 'active'

  return (
    <div className="page">
      <PageHead
        title="Players"
        meta={<>
          Free agency is first come, first served. Sign a player and you drop one,
          leaving a legal squad. Once a gameweek has started, signings are for the
          next one. <Link className="rules-link" to="/rules#market">Signing rules</Link>
        </>}
        aside={
          <div style={{ textAlign: 'right' }}>
            <div className="figure" style={{ fontSize: 'clamp(38px, 8vw, 54px)' }}>{freeCount}</div>
            <span className="eyebrow">Free agents</span>
          </div>
        } />

      {!open && (
        <div className="mt-16">
          <Notice kind="warn">Signings open once the draft is complete.</Notice>
        </div>
      )}

      {/* Two columns, like the draft room: the market on the left, your own
          squad on the right. A signing costs you a player in the same
          position, so "who would I drop?" is part of reading this screen. */}
      <div className={`market-grid mt-24 ${signing ? 'is-swapping' : ''}`}>
        <section>
          <div className="stack gap-12">
            <SearchField value={query} onChange={setQuery}
              placeholder="Search player or club" />
            <div className="row gap-8 wrap">
              <Segmented<Scope> value={scope} onChange={setScope}
                options={[
                  { value: 'free', label: 'Free agents' },
                  // The pool's newest arrivals, which is where the value is:
                  // somebody dropped them an hour ago to make room.
                  { value: 'dropped', label: `Just dropped${droppedCount ? ` · ${droppedCount}` : ''}` },
                  { value: 'all', label: 'Everyone' }
                ]} />
              <Segmented<Filter> value={filter} onChange={setFilter}
                options={[{ value: 'ALL', label: 'All' }, ...POSITIONS.map(p => ({ value: p as Filter, label: p }))]} />
            </div>
          </div>

      {players === null ? <Loading rows={10} /> : (
        <div className="mt-24">
          {/* Both seasons, once there is a this-season to show. One column that
              silently swapped meaning when the season began was how this page
              came to be ranked by figures it wasn't displaying. The headers are
              the sort: there is nowhere else on the row to put it, and a column
              you can order by is the one place people look for it. */}
          <div className="thead">
            <span className="grow">Player</span>
            <span style={{ width: 62 }}>Next</span>
            {/* One cell per gameweek, headed by its number, so a column of
                scores reads down the list like a printed results grid. */}
            {recentGws.length > 0 && (
              <span className="gw-cells" aria-label="Recent gameweeks">
                {recentGws.map(id => <span key={id} className="gw-cell">{id}</span>)}
              </span>
            )}
            {scope === 'all' && <span style={{ width: 76 }}>Owner</span>}
            {seasonUnderway && (
              <button type="button" className={`sort-th ${sort === 'this' ? 'on' : ''}`}
                aria-pressed={sort === 'this'} onClick={() => setSort('this')}>
                This
              </button>
            )}
            <button type="button" className={`sort-th ${!seasonUnderway || sort === 'last' ? 'on' : ''}`}
              aria-pressed={sort === 'last'} onClick={() => setSort('last')}
              disabled={!seasonUnderway}>
              Last
            </button>
          </div>
          {/* Six hundred players is a 14,000px page if the list is left to
              grow. It scrolls inside its own pane instead. */}
          <ul className="scroll-pane">
            {visible.map(p => {
              const free = !p.owner_member_id
              return (
                <li key={p.id}>
                  <button className={`list-row ${free ? '' : 'is-disabled'} ${signing?.id === p.id ? 'is-selected' : ''}`}
                    disabled={!open || !free}
                    onClick={() => beginSwap(p)}>
                    <Crest code={crests.teamCode.get(p.team_id ?? -1)} alt={p.club ?? ''} />
                    <PosChip pos={p.position} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                      <span className="row gap-6 tiny muted market-meta">
                        <span className="club">{p.club_short ?? '—'}</span>
                        {/* Last season used to live here because it had no
                            column. It has one now, and printing "84 last
                            season" beside a column headed LAST reading 84 is
                            just the number twice. */}
                        {free && justDropped.has(p.id) && (
                          <span className="dropped-chip">
                            Dropped {relativeTime(justDropped.get(p.id)!.created_at)}
                          </span>
                        )}
                        {/* Icon alone: this line clips rather than wraps, and
                            a padlock on a row you cannot press says it. */}
                        {p.locked && <span className="locked" title={`Already played this gameweek — signing him now puts him in your squad from GW${nextGw}`}><IconLock /></span>}
                      </span>
                    </span>
                    <span className="fixture" style={{ width: 62 }}>
                      {fixtureLabel(crests.nextFixture.get(p.team_id ?? -1))}
                    </span>
                    {recentGws.length > 0 && (
                      <span className="gw-cells">
                        {recentGws.map(id => {
                          const pts = history.get(p.id)?.get(id)
                          return (
                            <span key={id}
                              className={`gw-cell num ${pts === undefined ? 'is-blank' : pts > 0 ? 'has-pts' : ''}`}
                              title={`GW${id}: ${pts === undefined ? 'did not feature' : `${pts} pts`}`}>
                              {pts ?? '–'}
                            </span>
                          )
                        })}
                      </span>
                    )}
                    {scope === 'all' && (
                      <span className="tiny truncate" style={{ width: 76, color: free ? 'var(--green)' : 'var(--ink-3)' }}>
                        {free ? 'Free' : p.owner_member_id === me.id ? 'You' : p.owner_team_name}
                      </span>
                    )}
                    {seasonUnderway && (
                      <span className="num small" style={{
                        width: 40, textAlign: 'right',
                        fontWeight: sort === 'this' ? 700 : 600,
                        color: sort === 'this' ? 'var(--fg)' : 'var(--fg-3)'
                      }}>
                        {p.current_season_points}
                      </span>
                    )}
                    <span className="num small" style={{
                      width: 40, textAlign: 'right',
                      fontWeight: !seasonUnderway || sort === 'last' ? 700 : 600,
                      color: !seasonUnderway || sort === 'last' ? 'var(--fg)' : 'var(--fg-3)'
                    }}>
                      {p.prev_season_points}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {visible.length === 0 && <div className="empty">Nobody matches that.</div>}
        </div>
      )}
        </section>

        <aside className="market-squad" ref={asideRef}>
          {/* The swap happens here, on the shape, not in a dialog listing the
              same names as words. Picking who to drop is a question about your
              squad — who is starting, where you are thin, who the flex is
              currently paying for — and every one of those is already drawn.
              The old sheet covered this pitch with a scrolling list of nine
              names in no order, captioned "played GW1, keeps those points"
              seven times. */}
          <Eyebrow>{signing ? `Replace with ${signing.web_name}` : 'Your squad'}</Eyebrow>

          {signing && (
            <div className="swap-head mt-8">
              <Crest code={crests.teamCode.get(signing.team_id ?? -1)} size={22} alt={signing.club ?? ''} />
              <PosChip pos={signing.position} />
              <span className="grow truncate name">{signing.web_name}</span>
              <span className="tiny muted">{fixtureLabel(crests.nextFixture.get(signing.team_id ?? -1))}</span>
            </div>
          )}

          <div className="mt-8">
            <SquadPitch
              players={mySquad}
              compact={!signing}
              bench={id => benched.has(id)}
              {...(signing
                ? {
                    onSelect: setDropId,
                    selected: dropId,
                    canSwap: id => droppable.has(id),
                    dim: id => !droppable.has(id),
                    note: id => landsNow.has(id) ? `GW${currentGw}` : undefined
                  }
                : {})} />
          </div>

          {signing ? (
            <div className="swap-bar mt-12">
              <p className="tiny muted" style={{ margin: 0 }}>
                {dropped
                  ? <><b>{signing.web_name}</b> in, <b>{dropped.web_name}</b> out
                      {landsOn(signing, dropped) === currentGw
                        ? <> · from GW{currentGw}</>
                        : <> · from GW{nextGw}, this week’s XI is untouched
                            {/* The alternative, by name. This is the sentence
                                whose absence cost a gameweek: the swap was
                                legal, it just wasn't the one that bought this
                                week, and the other one was two taps away. */}
                            {landsNowNames.length > 0 && <>
                              {' — drop '}<b>{joinNames(landsNowNames)}</b>
                              {' instead and he plays in GW'}{currentGw}</>}</>}</>
                  : <>Tap anyone still lit to make room. The greyed-out players would
                      leave you below the 2/5/5/3 minimum somewhere.
                      {weekUnderway && (landsNowNames.length > 0
                        ? <> Only <b>{joinNames(landsNowNames)}</b>{' '}
                            {landsNowNames.length === 1 ? 'still buys' : 'still buy'} him for
                            GW{currentGw} — every other drop is for GW{nextGw}.</>
                        : <> Every match this week has kicked off, so whoever you drop,
                            he is yours from GW{nextGw}.</>)}</>}
              </p>
              <div className="row gap-8" style={{ marginTop: 10 }}>
                <button className="btn ghost" onClick={() => { setSigning(null); setDropId(null) }}>
                  Cancel
                </button>
                <button className="btn grow" disabled={busy || dropId === null}
                  onClick={() => void confirmSign()}>
                  {busy ? 'Signing…' : dropped ? `Sign ${signing.web_name}` : 'Pick who to drop'}
                </button>
              </div>
            </div>
          ) : (
            <p className="tiny muted" style={{ marginTop: 12 }}>
              Tap a free agent to sign him; this pitch will show who you can drop.
              Every squad carries at least 2 GK, 5 DEF, 5 MID and 3 FWD; the sixteenth
              is a flex, and yours is{' '}
              {flexUsed(myCounts) === 0
                ? 'still free'
                : `on your ${POSITIONS.find(x => myCounts[x] > POS_MIN[x])}`}.
            </p>
          )}

          {/* Who has moved, in the column where you decide whether to move.
              This used to live only at the bottom of the table screen, mixed
              in with trades and commissioner corrections. */}
          <div className="mt-32">
            <Eyebrow>Free agency</Eyebrow>
            {moves.length === 0 ? (
              <div className="empty">No signings yet.</div>
            ) : (
              <ul className="list">
                {moves.slice(0, 8).map(m => (
                  <li key={m.id} className="list-row move-row">
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="small truncate" style={{ display: 'block' }}>
                        <strong style={{ fontWeight: 650 }}>
                          {m.member_id === me.id ? 'You' : m.team_name ?? 'A manager'}
                        </strong>{' '}
                        {m.in_name
                          ? <>signed <span className="move-in">{m.in_name}</span></>
                          : 'released'}
                        {m.out_name && (
                          <span className="muted">
                            {m.in_name ? ', dropped ' : ' '}
                            <span className="move-out">{m.out_name}</span>
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                      {relativeTime(m.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

    </div>
  )
}

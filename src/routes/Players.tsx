import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Eyebrow, IconLock, Loading, Notice, PageHead, PlayerPortrait, PosChip, SearchField, Segmented, Sheet } from '../components/ui'
import SquadPitch from '../components/SquadPitch'
import { useCrests } from '../lib/images'
import { fixtureLabel } from '../lib/format'
import { relativeTime } from '../lib/format'
import { POSITIONS, POS_MIN, canSwap, countByPos, flexUsed } from '../lib/types'
import type { LeaguePlayer, Move, Position } from '../lib/types'

type Filter = 'ALL' | Position
type Scope = 'free' | 'dropped' | 'all'

/** How long a dropped player still counts as news. */
const JUST_DROPPED_MS = 72 * 3600 * 1000

export default function Players () {
  const { league, me, gameweeks, currentGw, nextGw, refresh } = useLeague()
  const { toast, fail } = useToast()
  const crests = useCrests()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [scope, setScope] = useState<Scope>('free')
  const [query, setQuery] = useState('')
  const [moves, setMoves] = useState<Move[]>([])
  const [signing, setSigning] = useState<LeaguePlayer | null>(null)
  const [dropId, setDropId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [ps, ms] = await Promise.all([
      api.getLeaguePlayers(league.id),
      api.getFreeAgentMoves(league.id, 25).catch(() => [] as Move[])
    ])
    setPlayers(ps)
    setMoves(ms)
  }, [league.id])

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

  const visible = useMemo(() => {
    if (!players) return []
    const q = query.trim().toLowerCase()
    return players.filter(p =>
      (scope === 'all' || !p.owner_member_id) &&
      (scope !== 'dropped' || justDropped.has(p.id)) &&
      (filter === 'ALL' || p.position === filter) &&
      (!q ||
        p.web_name.toLowerCase().includes(q) ||
        `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q) ||
        (p.club ?? '').toLowerCase().includes(q))
    ).slice(0, 200)
  }, [players, filter, scope, query, justDropped])

  // See DraftRoom: pre-season, current_season_points is a copy of last
  // season's, so the honest column to show is the one that is actually true.
  const seasonUnderway = useMemo(() => gameweeks.some(g => g.finished), [gameweeks])

  const freeCount = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id).length, [players])

  const droppedCount = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id && justDropped.has(p.id)).length,
    [players, justDropped])

  const mySquad = useMemo(
    () => mine.map(p => ({
      id: p.id, name: p.web_name, club: p.club_short, position: p.position,
      kit: crests.teamCode.get(p.team_id ?? -1)
    })), [mine, crests])

  // Squad size is fixed at sixteen but the shape is not: fifteen of them are a
  // 2/5/5/3 floor and the last is a flex. So a signing no longer has to be
  // like-for-like — it has to leave you with a squad you are allowed to hold.
  // Sign a midfielder while your flex sits on a forward and you may drop that
  // forward or a midfielder, but not a defender: that would leave you four.
  const myCounts = useMemo(() => countByPos(mine), [mine])
  const droppable = useMemo(
    () => signing ? mine.filter(p => canSwap(myCounts, signing.position, p.position)) : [],
    [myCounts, mine, signing])

  // Has a ball been kicked this gameweek? If anyone in the league is locked,
  // yes — which is the same question gw_started() asks on the server.
  const weekUnderway = useMemo(() => (players ?? []).some(p => p.locked), [players])

  /**
   * Which gameweek a signing would land on, mirroring add_drop(). A locked
   * player is no longer unsignable — he just isn't yours until next week — so
   * the interface has to say which week it is buying, every time.
   */
  const landsOn = useCallback((add: LeaguePlayer, drop: LeaguePlayer | undefined) => {
    if (!weekUnderway) return currentGw
    if (!drop) return nextGw
    return add.position === drop.position && !add.locked && !drop.locked ? currentGw : nextGw
  }, [weekUnderway, currentGw, nextGw])

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
      <div className="market-grid mt-24">
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
          <div className="thead">
            <span className="grow">Player</span>
            <span style={{ width: 62 }}>Next</span>
            {scope === 'all' && <span style={{ width: 76 }}>Owner</span>}
            <span style={{ width: 40, textAlign: 'right' }}>
              {seasonUnderway ? 'Pts' : '25/26'}
            </span>
          </div>
          {/* Six hundred players is a 14,000px page if the list is left to
              grow. It scrolls inside its own pane instead. */}
          <ul className="scroll-pane">
            {visible.map(p => {
              const free = !p.owner_member_id
              return (
                <li key={p.id}>
                  <button className={`list-row ${free ? '' : 'is-disabled'}`}
                    disabled={!open || !free}
                    onClick={() => { setSigning(p); setDropId(null) }}>
                    <Crest code={crests.teamCode.get(p.team_id ?? -1)} alt={p.club ?? ''} />
                    <PosChip pos={p.position} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                      <span className="row gap-6 tiny muted market-meta">
                        <span className="club">{p.club_short ?? '—'}</span>
                        {/* On a phone this line has room for one fact. A player
                            who was dropped an hour ago is the more useful one. */}
                        {seasonUnderway && !justDropped.has(p.id) &&
                          <span>· {p.prev_season_points} last season</span>}
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
                    {scope === 'all' && (
                      <span className="tiny truncate" style={{ width: 76, color: free ? 'var(--green)' : 'var(--ink-3)' }}>
                        {free ? 'Free' : p.owner_member_id === me.id ? 'You' : p.owner_team_name}
                      </span>
                    )}
                    <span className="num small" style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>
                      {seasonUnderway ? p.current_season_points : p.prev_season_points}
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

        <aside className="market-squad">
          <Eyebrow>Your squad</Eyebrow>
          {/* compact here: in a 340px column the club line costs the width
              that the name needs, and this pitch is reference rather than the
              subject of the screen. */}
          <SquadPitch players={mySquad} compact />
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Signing a {filter === 'ALL' ? 'player' : filter} means dropping one. Every
            squad carries at least 2 GK, 5 DEF, 5 MID and 3 FWD; the sixteenth is a
            flex, and yours is{' '}
            {flexUsed(myCounts) === 0
              ? 'still free'
              : `on your ${POSITIONS.find(x => myCounts[x] > POS_MIN[x])}`}.
          </p>

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

      {signing && (
        <Sheet title={`Sign ${signing.web_name}`} onClose={() => setSigning(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setSigning(null)}>Cancel</button>
              <button className="btn" disabled={busy || dropId === null} onClick={() => void confirmSign()}>
                {busy ? 'Signing…' : 'Confirm'}
              </button>
            </>
          }>
          <div className="row gap-12">
            <PlayerPortrait badge={crests.teamCode.get(signing.team_id ?? -1)} />
            <div>
              <div className="row gap-8"><PosChip pos={signing.position} /></div>
              <div className="h3" style={{ marginTop: 6 }}>{signing.first_name} {signing.second_name}</div>
              <div className="club">
                {signing.club} · next {fixtureLabel(crests.nextFixture.get(signing.team_id ?? -1))}
              </div>
            </div>
          </div>

          {signing.news && <div className="mt-16"><Notice kind="warn">{signing.news}</Notice></div>}

          {/* The one thing a manager must not have to work out for himself.
              Signing used to be refused outright while a gameweek was on, so
              there was never a week to name; now there always is. */}
          <div className="mt-16">
            <Notice kind={landsOn(signing, mine.find(p => p.id === dropId)) === currentGw ? undefined : 'warn'}>
              {landsOn(signing, mine.find(p => p.id === dropId)) === currentGw
                ? <>Takes effect in <b>GW{currentGw}</b>, straight into this week’s squad.</>
                : <>Takes effect in <b>GW{nextGw}</b>. Gameweek {currentGw} is already
                    being played, so its XI — and its points — stay exactly as they are.</>}
            </Notice>
          </div>

          <div className="mt-24">
            <Eyebrow>Drop someone to make room</Eyebrow>
            {droppable.length === 0 ? (
              <Notice kind="error">
                Nobody in your squad can be dropped for a {signing.position} without
                leaving you below the 2/5/5/3 minimum somewhere.
              </Notice>
            ) : (
              <ul className="list">
                {droppable.map(p => (
                  <li key={p.id}>
                    <button className={`list-row ${dropId === p.id ? 'is-selected' : ''}`}
                      onClick={() => setDropId(p.id)}>
                      <PosChip pos={p.position} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                        <span className="club">
                          {p.club_short}
                          {p.locked && ` · played GW${currentGw}, keeps those points`}
                        </span>
                      </span>
                      <span className="num small">{p.current_season_points}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}

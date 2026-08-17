import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Eyebrow, IconLock, Loading, Notice, PageHead, PlayerPortrait, PosChip, SearchField, Segmented, Sheet } from '../components/ui'
import SquadPitch from '../components/SquadPitch'
import { useCrests } from '../lib/images'
import { POSITIONS } from '../lib/types'
import type { LeaguePlayer, Position } from '../lib/types'

type Filter = 'ALL' | Position
type Scope = 'free' | 'all'

export default function Players () {
  const { league, me, refresh } = useLeague()
  const { toast, fail } = useToast()
  const crests = useCrests()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [scope, setScope] = useState<Scope>('free')
  const [query, setQuery] = useState('')
  const [signing, setSigning] = useState<LeaguePlayer | null>(null)
  const [dropId, setDropId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setPlayers(await api.getLeaguePlayers(league.id))
  }, [league.id])

  useEffect(() => { load().catch(fail) }, [load, fail])

  // Free agency is first come, first served, so the list has to be live.
  useEffect(() => {
    const ch = supabase.channel(`roster:${league.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'roster_players', filter: `league_id=eq.${league.id}` },
        () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [league.id, load])

  const mine = useMemo(
    () => (players ?? []).filter(p => p.owner_member_id === me.id), [players, me.id])

  const visible = useMemo(() => {
    if (!players) return []
    const q = query.trim().toLowerCase()
    return players.filter(p =>
      (scope === 'all' || !p.owner_member_id) &&
      (filter === 'ALL' || p.position === filter) &&
      (!q ||
        p.web_name.toLowerCase().includes(q) ||
        `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q) ||
        (p.club ?? '').toLowerCase().includes(q))
    ).slice(0, 200)
  }, [players, filter, scope, query])

  const freeCount = useMemo(
    () => (players ?? []).filter(p => !p.owner_member_id).length, [players])

  const mySquad = useMemo(
    () => mine.map(p => ({
      id: p.id, name: p.web_name, club: p.club_short, position: p.position
    })), [mine])

  // Squad size and shape are fixed, so signing a midfielder means dropping one.
  const droppable = useMemo(
    () => signing ? mine.filter(p => p.position === signing.position && !p.locked) : [],
    [mine, signing])

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
        meta="Free agency is first come, first served. Sign a player and you drop one in the same position."
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
                options={[{ value: 'free', label: 'Free agents' }, { value: 'all', label: 'Everyone' }]} />
              <Segmented<Filter> value={filter} onChange={setFilter}
                options={[{ value: 'ALL', label: 'All' }, ...POSITIONS.map(p => ({ value: p as Filter, label: p }))]} />
            </div>
          </div>

      {players === null ? <Loading rows={10} /> : (
        <div className="mt-24">
          <div className="thead">
            <span className="grow">Player</span>
            <span style={{ width: 84 }}>Owner</span>
            <span style={{ width: 44, textAlign: 'right' }}>Pts</span>
          </div>
          {/* Six hundred players is a 14,000px page if the list is left to
              grow. It scrolls inside its own pane instead. */}
          <ul className="scroll-pane">
            {visible.map(p => {
              const free = !p.owner_member_id
              return (
                <li key={p.id}>
                  <button className={`list-row ${free ? '' : 'is-disabled'}`}
                    disabled={!open || !free || p.locked}
                    onClick={() => { setSigning(p); setDropId(null) }}>
                    <Crest code={crests.teamCode.get(p.team_id ?? -1)} alt={p.club ?? ''} />
                    <PosChip pos={p.position} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                      <span className="row gap-6 tiny muted">
                        <span className="club">{p.club_short ?? '—'}</span>
                        <span>· {p.prev_season_points} last season</span>
                        {p.locked && <span className="locked"><IconLock /> Locked</span>}
                      </span>
                    </span>
                    <span className="tiny truncate" style={{ width: 84, color: free ? 'var(--green)' : 'var(--ink-3)' }}>
                      {free ? 'Free' : p.owner_member_id === me.id ? 'You' : p.owner_team_name}
                    </span>
                    <span className="num small" style={{ width: 44, textAlign: 'right', fontWeight: 600 }}>
                      {p.current_season_points}
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
            Signing a {filter === 'ALL' ? 'player' : filter} means dropping one in the
            same position — squads are a fixed 2/5/5/4.
          </p>
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
              <div className="club">{signing.club} · {signing.current_season_points} pts this season</div>
            </div>
          </div>

          {signing.news && <div className="mt-16"><Notice kind="warn">{signing.news}</Notice></div>}

          <div className="mt-24">
            <Eyebrow>Drop a {signing.position} to make room</Eyebrow>
            {droppable.length === 0 ? (
              <Notice kind="error">
                Every {signing.position} in your squad has already kicked off this
                gameweek. Try again once the gameweek finishes.
              </Notice>
            ) : (
              <ul className="list">
                {droppable.map(p => (
                  <li key={p.id}>
                    <button className={`list-row ${dropId === p.id ? 'is-selected' : ''}`}
                      onClick={() => setDropId(p.id)}>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                        <span className="club">{p.club_short}</span>
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

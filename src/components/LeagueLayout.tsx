import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Draft, Gameweek, League, Member, Trade } from '../lib/types'
import { IconChat, IconChevron, IconDraft, IconPlayers, IconTable, IconTeam, IconTrade, Loading } from './ui'

interface LeagueCtx {
  league: League
  members: Member[]
  me: Member
  draft: Draft | null
  gameweeks: Gameweek[]
  currentGw: number
  nextGw: number
  isCommissioner: boolean
  pendingForMe: Trade[]
  refresh: () => Promise<void>
}

const Ctx = createContext<LeagueCtx | null>(null)
export const useLeague = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLeague outside LeagueLayout')
  return v
}

export default function LeagueLayout () {
  const { leagueId = '' } = useParams()
  const { userId, name, signOut } = useAuth()
  const { fail } = useToast()
  const navigate = useNavigate()

  const [state, setState] = useState<Omit<LeagueCtx, 'refresh'> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [league, members, draft, gameweeks, trades] = await Promise.all([
      api.getLeague(leagueId),
      api.getMembers(leagueId),
      api.getDraft(leagueId),
      api.getGameweeks(),
      api.getTrades(leagueId).catch(() => [] as Trade[])
    ])
    const me = members.find(m => m.user_id === userId)
    if (!me) throw new Error('You are not a member of this league.')

    const cur = gameweeks.find(g => g.is_current)?.id
      ?? gameweeks.find(g => g.is_next)?.id
      ?? gameweeks[0]?.id ?? 1
    const nxt = gameweeks.find(g => g.is_next)?.id
      ?? gameweeks.find(g => !g.finished)?.id ?? cur

    setState({
      league, members, me, draft, gameweeks,
      currentGw: cur,
      nextGw: nxt,
      isCommissioner: league.commissioner_id === userId,
      pendingForMe: trades.filter(t => t.status === 'pending' && t.receiver_id === me.id)
    })
  }, [leagueId, userId])

  const refresh = useCallback(async () => {
    try { await load() } catch (e) { fail(e) }
  }, [load, fail])

  useEffect(() => {
    let live = true
    load().catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [load])

  // One channel for the whole league. Anything that changes league state nudges
  // a refetch; individual screens subscribe to nothing.
  useEffect(() => {
    if (!leagueId) return
    const ch = supabase
      .channel(`league:${leagueId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'leagues', filter: `id=eq.${leagueId}` },
        () => { void refresh() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'league_members', filter: `league_id=eq.${leagueId}` },
        () => { void refresh() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` },
        () => { void refresh() })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trades', filter: `league_id=eq.${leagueId}` },
        () => { void refresh() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [leagueId, refresh])

  if (error) {
    return (
      <div className="page mt-40">
        <h1 className="h2">Can’t open that league</h1>
        <p className="muted mt-8">{error}</p>
        <button className="btn ghost mt-24" onClick={() => navigate('/')}>Back to my leagues</button>
      </div>
    )
  }

  if (!state) return <div className="page"><Loading /></div>

  const value: LeagueCtx = { ...state, refresh }
  const { league, pendingForMe } = state
  const base = `/l/${leagueId}`

  const drafting = league.status === 'drafting'
  const preDraft = league.status === 'lobby'

  const tabs = preDraft
    ? [{ to: base, label: 'Lobby', icon: <IconDraft />, end: true }]
    : drafting
      ? [
          { to: `${base}/draft`, label: 'Draft', icon: <IconDraft />, live: true },
          { to: `${base}/team`, label: 'Squad', icon: <IconTeam /> },
          { to: `${base}/chat`, label: 'Chat', icon: <IconChat /> },
          { to: `${base}/table`, label: 'Table', icon: <IconTable /> }
        ]
      : [
          { to: `${base}/team`, label: 'Squad', icon: <IconTeam /> },
          { to: `${base}/players`, label: 'Players', icon: <IconPlayers /> },
          { to: `${base}/trades`, label: 'Trades', icon: <IconTrade />, badge: pendingForMe.length },
          { to: `${base}/table`, label: 'Table', icon: <IconTable /> },
          { to: `${base}/chat`, label: 'Chat', icon: <IconChat /> },
          { to: `${base}/draft`, label: 'Draft', icon: <IconDraft /> }
        ]

  return (
    <Ctx.Provider value={value}>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="grow row gap-12" style={{ minWidth: 0 }}>
            <NavLink to="/" className="back-link" aria-label="All leagues">
              <IconChevron dir="left" size={17} />
            </NavLink>
            <div className="wordmark truncate" style={{ maxWidth: '100%' }}>
              {league.name}
            </div>
            <LeagueBadge status={league.status} />
          </div>
          {/* Which account you're on decides whether you see commissioner
              controls, so it shouldn't be a mystery — but on a phone the
              league's own name has the better claim on the space. */}
          <button className="btn quiet account"
            title={`Signed in as ${name}`}
            onClick={() => { if (confirm(`Sign out of ${name}?`)) void signOut() }}>
            {name}<span className="account-verb"> · sign out</span>
          </button>
        </div>

        <nav className="tabs-desktop">
          {tabs.map(t => (
            <NavLink key={t.to} to={t.to} end={'end' in t ? t.end : false}
              className={({ isActive }) => isActive ? 'active' : ''}>
              {t.label}
              {'badge' in t && t.badge ? <span className="tab-badge">{t.badge}</span> : null}
            </NavLink>
          ))}
          <div className="grow" />
          <NavLink to="/rules" className={({ isActive }) => isActive ? 'active' : ''}>
            Rules
          </NavLink>
          {state.isCommissioner && (
            <NavLink to={`${base}/commissioner`} className={({ isActive }) => isActive ? 'active' : ''}>
              Commissioner
            </NavLink>
          )}
        </nav>
      </header>

      <main><Outlet /></main>

      <nav className="tabbar">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={'end' in t ? t.end : false}
            className={({ isActive }) => isActive ? 'active' : ''}>
            {t.icon}
            <span>{t.label}</span>
            {'badge' in t && t.badge ? <span className="dot" /> : null}
          </NavLink>
        ))}
      </nav>
    </Ctx.Provider>
  )
}

function LeagueBadge ({ status }: { status: League['status'] }) {
  if (status === 'drafting') return <span className="live">Drafting</span>
  const map: Record<string, string> = {
    lobby: 'Lobby', active: 'In season', completed: 'Finished'
  }
  return <span className="status-tag">{map[status]}</span>
}

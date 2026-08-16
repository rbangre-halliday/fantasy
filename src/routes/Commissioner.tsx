import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Loading, Notice, PageHead, PosChip, Sheet } from '../components/ui'
import { relativeTime } from '../lib/format'
import type { LeaguePlayer, Trade } from '../lib/types'

/**
 * Repair tools, not gameplay. Everything here exists because friends make
 * mistakes: a misclick in the draft, a trade someone regrets agreeing to.
 */
export default function Commissioner () {
  const { league, members, isCommissioner, draft, refresh } = useLeague()
  const { toast, fail } = useToast()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [query, setQuery] = useState('')
  const [moving, setMoving] = useState<LeaguePlayer | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api.getLeaguePlayers(league.id), api.getTrades(league.id)])
    setPlayers(p); setTrades(t)
  }, [league.id])

  useEffect(() => { if (isCommissioner) load().catch(fail) }, [isCommissioner, load, fail])

  const teamName = useMemo(() => new Map(members.map(m => [m.id, m.team_name])), [members])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!players || q.length < 2) return []
    return players.filter(p =>
      p.web_name.toLowerCase().includes(q) ||
      `${p.first_name ?? ''} ${p.second_name ?? ''}`.toLowerCase().includes(q)
    ).slice(0, 25)
  }, [players, query])

  const accepted = trades.filter(t => t.status === 'accepted')

  if (!isCommissioner) return <Navigate to={`/l/${league.id}/team`} replace />

  async function act (fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await fn(); toast(done, 'good'); await load(); await refresh() }
    catch (err) { fail(err) } finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <PageHead
        title="Commissioner"
        meta="Repair tools, not gameplay. Everything here exists because friends make mistakes." />

      {draft && draft.status !== 'complete' && (
        <div>
          <Eyebrow>Draft controls</Eyebrow>
          <div className="row gap-8 wrap">
            {draft.status === 'running' ? (
              <button className="btn ghost" disabled={busy}
                onClick={() => void act(() => api.pauseDraft(league.id), 'Draft paused')}>Pause draft</button>
            ) : draft.status === 'paused' ? (
              <button className="btn ghost" disabled={busy}
                onClick={() => void act(() => api.resumeDraft(league.id), 'Draft resumed')}>Resume draft</button>
            ) : null}
            <button className="btn ghost" disabled={busy}
              onClick={() => void act(() => api.undoLastPick(league.id), 'Last pick undone')}>
              Undo last pick
            </button>
          </div>
        </div>
      )}

      <div className="mt-40">
        <Eyebrow>Move a player</Eyebrow>
        <Notice>
          Assign any player to any squad, or release them back to free agency.
          Positional limits still apply.
        </Notice>
        <input className="input mt-16" type="search" value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search for a player" />

        {players === null ? <Loading rows={3} /> : (
          <ul className="list mt-16">
            {results.map(p => (
              <li key={p.id}>
                <button className="list-row" onClick={() => setMoving(p)}>
                  <PosChip pos={p.position} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
                    <span className="tiny muted">
                      {p.club_short} · {p.owner_member_id ? teamName.get(p.owner_member_id) : 'Free agent'}
                    </span>
                  </span>
                  <span className="tiny muted">Move</span>
                </button>
              </li>
            ))}
            {query.length >= 2 && results.length === 0 && <div className="empty">No matches.</div>}
          </ul>
        )}
      </div>

      {accepted.length > 0 && (
        <div className="mt-40">
          <Eyebrow>Reverse a trade</Eyebrow>
          <ul className="list">
            {accepted.slice(0, 10).map(t => (
              <li key={t.id} className="list-row">
                <span className="grow small truncate">
                  {teamName.get(t.proposer_id)} ⇄ {teamName.get(t.receiver_id)}
                  <span className="tiny muted"> · {relativeTime(t.created_at)}</span>
                </span>
                <button className="btn sm ghost" disabled={busy}
                  onClick={() => {
                    if (confirm('Put every player in this trade back where they started?')) {
                      void act(() => api.commishReverseTrade(t.id), 'Trade reversed')
                    }
                  }}>Reverse</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {moving && (
        <Sheet title={`Move ${moving.web_name}`} onClose={() => setMoving(null)}>
          <div className="row gap-12">
            <PosChip pos={moving.position} />
            <div className="small muted">
              Currently {moving.owner_member_id
                ? `with ${teamName.get(moving.owner_member_id)}`
                : 'a free agent'}
            </div>
          </div>
          <ul className="list mt-16">
            {members.map(m => (
              <li key={m.id}>
                <button className="list-row" disabled={busy || m.id === moving.owner_member_id}
                  onClick={() => void act(
                    () => api.commishMovePlayer(league.id, moving.id, m.id),
                    `${moving.web_name} → ${m.team_name}`).then(() => setMoving(null))}>
                  <span className="grow name truncate">{m.team_name}</span>
                  <span className="tiny muted">
                    {m.id === moving.owner_member_id ? 'Current' : 'Assign'}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button className="list-row" disabled={busy || !moving.owner_member_id}
                onClick={() => void act(
                  () => api.commishMovePlayer(league.id, moving.id, null),
                  `${moving.web_name} released`).then(() => setMoving(null))}>
                <span className="grow name" style={{ color: 'var(--red)' }}>Release to free agency</span>
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  )
}

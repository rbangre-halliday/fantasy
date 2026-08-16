import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Loading, Notice, PosChip, Sheet } from '../components/ui'
import { relativeTime } from '../lib/format'
import { POSITIONS } from '../lib/types'
import type { LeaguePlayer, Position, Trade, TradePlayerRow } from '../lib/types'

const MAX_PER_SIDE = 3

export default function Trades () {
  const { league, members, me, refresh } = useLeague()
  const { toast, fail } = useToast()

  const [players, setPlayers] = useState<LeaguePlayer[] | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [tradePlayers, setTradePlayers] = useState<TradePlayerRow[]>([])
  const [composing, setComposing] = useState<string | null>(null) // receiver member id
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, t, tp] = await Promise.all([
      api.getLeaguePlayers(league.id),
      api.getTrades(league.id),
      api.getTradePlayers(league.id)
    ])
    setPlayers(p); setTrades(t); setTradePlayers(tp)
  }, [league.id])

  useEffect(() => { load().catch(fail) }, [load, fail])

  const byId = useMemo(() => new Map((players ?? []).map(p => [p.id, p])), [players])
  const teamName = useMemo(() => new Map(members.map(m => [m.id, m.team_name])), [members])

  const pending = trades.filter(t => t.status === 'pending')
  const history = trades.filter(t => t.status !== 'pending')

  async function act (fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await fn(); toast(done, 'good'); await load(); await refresh() }
    catch (err) { fail(err) } finally { setBusy(false) }
  }

  if (players === null) return <div className="page"><Loading rows={6} /></div>

  const open = league.status === 'active'

  return (
    <div className="page">
      <div className="mt-32">
        <div className="eyebrow">No vetoes, no committee</div>
        <h1 className="h1 mt-8">Trades</h1>
      </div>

      {!open && <div className="mt-16"><Notice kind="warn">Trading opens once the draft is complete.</Notice></div>}

      <div className="mt-24">
        <Eyebrow>Propose a trade</Eyebrow>
        <div className="row gap-8 wrap">
          {members.filter(m => m.id !== me.id).map(m => (
            <button key={m.id} className="btn ghost" disabled={!open}
              onClick={() => setComposing(m.id)}>
              {m.team_name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-40">
        <Eyebrow>Open offers</Eyebrow>
        {pending.length === 0 ? <div className="empty">Nothing on the table.</div> : (
          <ul className="stack gap-12">
            {pending.map(t => (
              <TradeCard key={t.id} trade={t} rows={tradePlayers.filter(r => r.trade_id === t.id)}
                byId={byId} teamName={teamName} meId={me.id}
                actions={
                  t.receiver_id === me.id ? (
                    <>
                      <button className="btn sm" disabled={busy}
                        onClick={() => void act(() => api.respondTrade(t.id, true), 'Trade accepted')}>
                        Accept
                      </button>
                      <button className="btn sm ghost" disabled={busy}
                        onClick={() => void act(() => api.respondTrade(t.id, false), 'Trade rejected')}>
                        Reject
                      </button>
                    </>
                  ) : t.proposer_id === me.id ? (
                    <button className="btn sm ghost" disabled={busy}
                      onClick={() => void act(() => api.cancelTrade(t.id), 'Offer withdrawn')}>
                      Withdraw
                    </button>
                  ) : null
                } />
            ))}
          </ul>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-40">
          <Eyebrow>Settled</Eyebrow>
          <ul className="stack gap-12">
            {history.slice(0, 15).map(t => (
              <TradeCard key={t.id} trade={t} rows={tradePlayers.filter(r => r.trade_id === t.id)}
                byId={byId} teamName={teamName} meId={me.id} />
            ))}
          </ul>
        </div>
      )}

      {composing && (
        <Composer leagueId={league.id} meId={me.id} receiverId={composing}
          receiverName={teamName.get(composing) ?? 'Manager'}
          players={players}
          onClose={() => setComposing(null)}
          onDone={async () => { setComposing(null); await load(); await refresh() }} />
      )}
    </div>
  )
}

function TradeCard ({
  trade, rows, byId, teamName, meId, actions
}: {
  trade: Trade
  rows: TradePlayerRow[]
  byId: Map<number, LeaguePlayer>
  teamName: Map<string, string>
  meId: string
  actions?: React.ReactNode
}) {
  const out = rows.filter(r => r.from_member === trade.proposer_id)
  const back = rows.filter(r => r.from_member === trade.receiver_id)
  const label: Record<Trade['status'], string> = {
    pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Withdrawn'
  }

  return (
    <li className="card card-pad">
      <div className="between">
        <span className="eyebrow">
          {trade.proposer_id === meId ? 'You' : teamName.get(trade.proposer_id)}
          {' → '}
          {trade.receiver_id === meId ? 'You' : teamName.get(trade.receiver_id)}
        </span>
        <span className="tiny muted">{label[trade.status]} · {relativeTime(trade.created_at)}</span>
      </div>

      <div className="mt-16" style={{
        display: 'grid', gap: 14, gridTemplateColumns: '1fr auto 1fr', alignItems: 'start'
      }}>
        <Side rows={out} byId={byId} heading="Gives" />
        <span aria-hidden className="muted" style={{ fontSize: 18, paddingTop: 18 }}>⇄</span>
        <Side rows={back} byId={byId} heading="Gets" />
      </div>

      {actions && <div className="row gap-8 mt-16">{actions}</div>}
    </li>
  )
}

function Side ({ rows, byId, heading }: {
  rows: TradePlayerRow[]; byId: Map<number, LeaguePlayer>; heading: string
}) {
  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 6 }}>{heading}</div>
      <ul className="stack gap-6">
        {rows.map(r => {
          const p = byId.get(r.player_id)
          return (
            <li key={r.id} className="row gap-6" style={{ minWidth: 0 }}>
              {p && <PosChip pos={p.position} />}
              <span className="small truncate">{p?.web_name ?? `#${r.player_id}`}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Composer ({
  leagueId, meId, receiverId, receiverName, players, onClose, onDone
}: {
  leagueId: string
  meId: string
  receiverId: string
  receiverName: string
  players: LeaguePlayer[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { fail, toast } = useToast()
  const [offer, setOffer] = useState<number[]>([])
  const [request, setRequest] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const mine = players.filter(p => p.owner_member_id === meId)
  const theirs = players.filter(p => p.owner_member_id === receiverId)

  function toggle (list: number[], set: (v: number[]) => void, id: number) {
    set(list.includes(id)
      ? list.filter(x => x !== id)
      : list.length >= MAX_PER_SIDE ? list : [...list, id])
  }

  // Squads are a fixed 2/5/5/4, so a trade only stays legal if each side sends
  // and receives the same positions. Say so before the server has to.
  const balance = useMemo(() => {
    const count = (ids: number[], pos: Position) =>
      ids.filter(id => players.find(p => p.id === id)?.position === pos).length
    const off: string[] = []
    for (const pos of POSITIONS) {
      const a = count(offer, pos)
      const b = count(request, pos)
      if (a !== b) off.push(`${pos} ${a}↔${b}`)
    }
    return off
  }, [offer, request, players])

  const ready = offer.length > 0 && request.length > 0 && balance.length === 0

  async function send () {
    setBusy(true)
    try {
      await api.proposeTrade(leagueId, receiverId, offer, request)
      toast('Offer sent', 'good')
      await onDone()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  return (
    <Sheet title={`Offer to ${receiverName}`} onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!ready || busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send offer'}
          </button>
        </>
      }>
      <Notice>
        Up to three each way. Because every squad is a fixed 2/5/5/4, each side has to
        send the same positions it receives.
      </Notice>

      <div className="mt-24">
        <Eyebrow>You give · {offer.length}/{MAX_PER_SIDE}</Eyebrow>
        <PickList players={mine} selected={offer} onToggle={id => toggle(offer, setOffer, id)} />
      </div>

      <div className="mt-24">
        <Eyebrow>You get · {request.length}/{MAX_PER_SIDE}</Eyebrow>
        <PickList players={theirs} selected={request} onToggle={id => toggle(request, setRequest, id)} />
      </div>

      {balance.length > 0 && (offer.length > 0 || request.length > 0) && (
        <div className="mt-16">
          <Notice kind="warn">Positions don’t match: {balance.join(', ')}</Notice>
        </div>
      )}
    </Sheet>
  )
}

function PickList ({ players, selected, onToggle }: {
  players: LeaguePlayer[]; selected: number[]; onToggle: (id: number) => void
}) {
  const sorted = [...players].sort((a, b) =>
    POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
    b.current_season_points - a.current_season_points)

  return (
    <ul className="list">
      {sorted.map(p => (
        <li key={p.id}>
          <button
            className={`list-row ${selected.includes(p.id) ? 'is-selected' : ''} ${p.locked ? 'is-disabled' : ''}`}
            disabled={p.locked}
            onClick={() => onToggle(p.id)}>
            <PosChip pos={p.position} />
            <span className="grow truncate name">{p.web_name}</span>
            <span className="club">{p.club_short}</span>
            <span className="num small" style={{ width: 38, textAlign: 'right' }}>
              {p.current_season_points}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

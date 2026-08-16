import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, IconLock, Loading, Notice, PosChip, Segmented } from '../components/ui'
import { POS_LABEL, availability, kickoffLabel, xiProblem } from '../lib/format'
import { POSITIONS, XI_SHAPE } from '../lib/types'
import type { Position, SquadPlayer } from '../lib/types'

export default function Squad () {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const { league, members, me, currentGw, nextGw } = useLeague()
  const { fail } = useToast()

  const viewing = members.find(m => m.id === memberId) ?? me
  const isMine = viewing.id === me.id

  const [gw, setGw] = useState(currentGw)
  const [squad, setSquad] = useState<SquadPlayer[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    // ensure_lineup is idempotent; calling it here means a squad always has a
    // lineup to show, even for a gameweek nobody has opened yet.
    if (isMine) await api.ensureLineup(viewing.id, gw).catch(() => {})
    setSquad(await api.getSquad(viewing.id, gw))
  }, [viewing.id, gw, isMine])

  useEffect(() => { setSquad(null); load().catch(fail) }, [load, fail])

  const starters = useMemo(
    () => (squad ?? []).filter(p => p.lineup_status === 'starter'), [squad])
  const bench = useMemo(
    () => (squad ?? []).filter(p => p.lineup_status !== 'starter')
      .sort((a, b) => (a.bench_priority ?? 99) - (b.bench_priority ?? 99)), [squad])

  const gwPoints = useMemo(() => starters.reduce((n, p) => n + p.gw_points, 0), [starters])
  const problem = squad ? xiProblem(starters) : null

  async function persist (next: SquadPlayer[]) {
    const nextStarters = next.filter(p => p.lineup_status === 'starter')
    const nextBench = next.filter(p => p.lineup_status !== 'starter')
      .sort((a, b) => (a.bench_priority ?? 99) - (b.bench_priority ?? 99))
    setSaving(true)
    try {
      await api.setLineup(league.id, gw,
        nextStarters.map(p => p.player_id), nextBench.map(p => p.player_id))
    } catch (err) {
      fail(err)
      await load()          // server said no; show the truth
    } finally { setSaving(false) }
  }

  /** Swap a starter with a bench player of the same position. */
  function swap (aId: number, bId: number) {
    const a = squad!.find(p => p.player_id === aId)!
    const b = squad!.find(p => p.player_id === bId)!
    const [starter, sub] = a.lineup_status === 'starter' ? [a, b] : [b, a]

    const next = squad!.map(p => {
      if (p.player_id === starter.player_id) {
        return { ...p, lineup_status: 'substitute' as const, bench_priority: sub.bench_priority }
      }
      if (p.player_id === sub.player_id) {
        return { ...p, lineup_status: 'starter' as const, bench_priority: null }
      }
      return p
    })
    setSquad(next)
    setPicked(null)
    void persist(next)
  }

  function moveBench (playerId: number, dir: -1 | 1) {
    const order = bench.map(p => p.player_id)
    const i = order.indexOf(playerId)
    const j = i + dir
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    const next = squad!.map(p => {
      const idx = order.indexOf(p.player_id)
      return idx === -1 ? p : { ...p, bench_priority: idx + 1 }
    })
    setSquad(next)
    void persist(next)
  }

  function onTap (p: SquadPlayer) {
    if (!isMine || p.locked) return
    if (picked === null) { setPicked(p.player_id); return }
    if (picked === p.player_id) { setPicked(null); return }
    const other = squad!.find(x => x.player_id === picked)!
    const swappable =
      other.position === p.position &&
      (other.lineup_status === 'starter') !== (p.lineup_status === 'starter')
    if (swappable) swap(picked, p.player_id)
    else setPicked(p.player_id)
  }

  const pickedPlayer = squad?.find(p => p.player_id === picked) ?? null
  const canSwapWith = (p: SquadPlayer) =>
    !!pickedPlayer &&
    pickedPlayer.player_id !== p.player_id &&
    pickedPlayer.position === p.position &&
    (pickedPlayer.lineup_status === 'starter') !== (p.lineup_status === 'starter') &&
    !p.locked

  const gwOptions = [
    { value: String(currentGw), label: `GW ${currentGw}` },
    ...(nextGw !== currentGw ? [{ value: String(nextGw), label: `GW ${nextGw}` }] : [])
  ]

  return (
    <div className="page">
      <div className="mt-32 between wrap gap-16">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{isMine ? 'Your squad' : viewing.profiles?.name ?? 'Manager'}</div>
          <h1 className="h1 mt-8 truncate">{viewing.team_name}</h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow">GW {gw} points</div>
          <div className="num" style={{ fontSize: 'clamp(30px, 8vw, 44px)', lineHeight: 1 }}>
            {gwPoints}
          </div>
        </div>
      </div>

      <div className="mt-16 row gap-8 wrap">
        {gwOptions.length > 1 && (
          <Segmented value={String(gw)} onChange={v => setGw(Number(v))} options={gwOptions} />
        )}
        <div className="seg" role="group">
          {members.map(m => (
            <button key={m.id} aria-pressed={m.id === viewing.id}
              onClick={() => navigate(m.id === me.id
                ? `/l/${league.id}/team`
                : `/l/${league.id}/team/${m.id}`)}>
              {m.id === me.id ? 'You' : m.team_name}
            </button>
          ))}
        </div>
      </div>

      {squad === null ? <Loading rows={8} /> : squad.length === 0 ? (
        <div className="mt-24"><Notice>This squad will fill up once the draft is done.</Notice></div>
      ) : (
        <>
          {isMine && (
            <div className="mt-16 stack gap-8">
              {problem
                ? <Notice kind="warn">{problem} — your XI must be 1 GK, 4 DEF, 4 MID, 2 FWD.</Notice>
                : <Notice>
                    Tap a player, then tap someone in the same position to swap them.
                    Everyone locks when their own match kicks off.
                  </Notice>}
              {saving && <div className="tiny muted">Saving…</div>}
            </div>
          )}

          <div className="mt-32">
            <Eyebrow>Starting XI · 4-4-2</Eyebrow>
            {POSITIONS.map(pos => (
              <PositionBlock key={pos} pos={pos}
                players={starters.filter(p => p.position === pos)}
                expected={XI_SHAPE[pos]}
                picked={picked} canSwapWith={canSwapWith} onTap={onTap}
                interactive={isMine} gw={gw} />
            ))}
          </div>

          <div className="mt-32">
            <Eyebrow>Bench · in substitution order</Eyebrow>
            <ul className="list">
              {bench.map((p, i) => (
                <PlayerRow key={p.player_id} p={p} gw={gw}
                  lead={<span className="num tiny muted" style={{ width: 16 }}>{i + 1}</span>}
                  selected={picked === p.player_id}
                  highlight={canSwapWith(p)}
                  interactive={isMine}
                  onTap={() => onTap(p)}
                  trailing={isMine && (
                    <span className="row gap-4">
                      <button className="btn quiet" aria-label="Move up" disabled={i === 0 || saving}
                        onClick={e => { e.stopPropagation(); moveBench(p.player_id, -1) }}>↑</button>
                      <button className="btn quiet" aria-label="Move down"
                        disabled={i === bench.length - 1 || saving}
                        onClick={e => { e.stopPropagation(); moveBench(p.player_id, 1) }}>↓</button>
                    </span>
                  )} />
              ))}
            </ul>
            <p className="tiny muted mt-8">
              If a starter doesn’t play, the first eligible substitute in this order
              takes their place automatically.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function PositionBlock ({
  pos, players, expected, picked, canSwapWith, onTap, interactive, gw
}: {
  pos: Position
  players: SquadPlayer[]
  expected: number
  picked: number | null
  canSwapWith: (p: SquadPlayer) => boolean
  onTap: (p: SquadPlayer) => void
  interactive: boolean
  gw: number
}) {
  return (
    <div className="mt-16">
      <div className="row gap-8" style={{ marginBottom: 4 }}>
        <PosChip pos={pos} />
        <span className="tiny muted">{POS_LABEL[pos]} · {players.length}/{expected}</span>
      </div>
      <ul className="list">
        {players.map(p => (
          <PlayerRow key={p.player_id} p={p} gw={gw}
            selected={picked === p.player_id}
            highlight={canSwapWith(p)}
            interactive={interactive}
            onTap={() => onTap(p)} />
        ))}
      </ul>
    </div>
  )
}

function PlayerRow ({
  p, lead, trailing, selected, highlight, interactive, onTap
}: {
  p: SquadPlayer
  gw: number
  lead?: React.ReactNode
  trailing?: React.ReactNode
  selected: boolean
  highlight: boolean
  interactive: boolean
  onTap: () => void
}) {
  const flag = availability(p.status)
  const Tag = interactive ? 'button' : 'div'
  return (
    <li>
      <Tag
        className={`list-row ${selected ? 'is-selected' : ''} ${p.locked ? 'is-disabled' : ''}`}
        style={highlight ? { boxShadow: 'inset 3px 0 0 var(--green)' } : undefined}
        {...(interactive ? { onClick: onTap, disabled: p.locked } : {})}
      >
        {lead}
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
          <span className="row gap-6 tiny muted" style={{ marginTop: 1 }}>
            <span className="club">{p.club_short ?? '—'}</span>
            {p.locked
              ? <span className="locked"><IconLock /> {p.minutes > 0 ? `${p.minutes}'` : 'Kicked off'}</span>
              : <span>{kickoffLabel(p.kickoff)}</span>}
            {flag && <span style={{ color: flag.tone }}>· {flag.label}</span>}
          </span>
        </span>
        <span className="num" style={{ width: 38, textAlign: 'right', fontWeight: 600 }}>
          {p.gw_points}
        </span>
        {trailing}
      </Tag>
    </li>
  )
}

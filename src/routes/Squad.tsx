import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Eyebrow, IconChevron, IconLock, Loading, Notice, PageHead, Segmented } from '../components/ui'
import SquadPitch from '../components/SquadPitch'
import PlayerSheet from '../components/PlayerSheet'
import { useCrests } from '../lib/images'
import { availability, gwFixtureLabel, kickoffLabel, xiProblem } from '../lib/format'
import { XI_SHAPE } from '../lib/types'
import type { SquadPlayer } from '../lib/types'

export default function Squad () {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const { league, members, me, currentGw, nextGw } = useLeague()
  const { fail } = useToast()
  const crests = useCrests()

  const viewing = members.find(m => m.id === memberId) ?? me
  const isMine = viewing.id === me.id

  const [gw, setGw] = useState(currentGw)
  const [squad, setSquad] = useState<SquadPlayer[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    // ensure_lineup is idempotent; calling it here means a squad always has a
    // lineup to show, even for a gameweek nobody has opened yet.
    if (isMine) await api.ensureLineup(viewing.id, gw).catch(() => {})
    setSquad(await api.getSquad(viewing.id, gw))
  }, [viewing.id, gw, isMine])

  useEffect(() => { setSquad(null); setOpenId(null); load().catch(fail) }, [load, fail])

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
    setOpenId(null)
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

  /** Who could take this player's place: same position, other side, movable. */
  const swapTargets = (p: SquadPlayer) => (squad ?? []).filter(o =>
    o.player_id !== p.player_id &&
    o.position === p.position &&
    (o.lineup_status === 'starter') !== (p.lineup_status === 'starter') &&
    !o.locked)

  const opened = squad?.find(p => p.player_id === openId) ?? null
  const crestOf = (p: SquadPlayer) => crests.shortCode.get(p.club_short ?? '')

  const gwOptions = [
    { value: String(currentGw), label: `GW ${currentGw}` },
    ...(nextGw !== currentGw ? [{ value: String(nextGw), label: `GW ${nextGw}` }] : [])
  ]

  return (
    <div className="page">
      <PageHead
        title={viewing.team_name}
        meta={isMine ? 'Your squad' : `Managed by ${viewing.profiles?.name ?? 'a manager'}`}
        aside={
          <div style={{ textAlign: 'right' }}>
            <div className="figure" style={{ fontSize: 'clamp(44px, 11vw, 64px)' }}>
              {gwPoints}
            </div>
            <div className="eyebrow" style={{ marginTop: 6 }}>Gameweek {gw}</div>
          </div>
        } />

      <div className="row gap-8 wrap">
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
                // The how-to lives under the pitch, where the tapping
                // happens. This slot is for the rule you cannot see.
                : <Notice>
                    Each player locks when his own match kicks off — in that gameweek only.{' '}
                    <Link className="rules-link" to="/rules#lineups">Why can’t I move him?</Link>
                  </Notice>}
              {saving && <div className="tiny muted">Saving…</div>}
            </div>
          )}

          <div className="mt-32 squad-grid">
            {/* The XI is drawn once, and the drawing is the control. It used to
                be here as a diagram *and* again as eleven rows underneath —
                the same eleven names twice, with only the list clickable. Now
                a tap anywhere opens the player: his fixture, how his points
                were scored, and the substitution if he can still be moved. */}
            <aside className="squad-pitch-col">
              <Eyebrow>Starting XI · 4-4-2</Eyebrow>
              <SquadPitch
                capacity={XI_SHAPE}
                players={starters.map(p => ({
                  id: p.player_id, name: p.web_name, club: p.club_short,
                  position: p.position, kit: crestOf(p)
                }))}
                onSelect={setOpenId}
                locked={id => !!squad!.find(x => x.player_id === id)?.locked}
                points={id => squad!.find(x => x.player_id === id)?.gw_points}
              />
              <p className="tiny muted" style={{ marginTop: 12 }}>
                {isMine
                  ? 'Tap a player for his points breakdown, and to bench him.'
                  : 'Tap a player to see how his points were scored.'}
              </p>
            </aside>

            <div className="squad-list-col">
              <div>
                <Eyebrow>Bench · in substitution order</Eyebrow>
                <ul className="list">
                  {bench.map((p, i) => (
                    <PlayerRow key={p.player_id} p={p} crest={crestOf(p)}
                      lead={<span className="num tiny muted" style={{ width: 16 }}>{i + 1}</span>}
                      onTap={() => setOpenId(p.player_id)}
                      trailing={isMine ? (
                        <span className="row-aside">
                          <button className="nudge" aria-label={`Move ${p.web_name} up the bench`}
                            disabled={i === 0 || saving}
                            onClick={() => moveBench(p.player_id, -1)}><IconChevron dir="up" size={13} /></button>
                          <button className="nudge" aria-label={`Move ${p.web_name} down the bench`}
                            disabled={i === bench.length - 1 || saving}
                            onClick={() => moveBench(p.player_id, 1)}><IconChevron dir="down" size={13} /></button>
                        </span>
                      ) : undefined} />
                  ))}
                </ul>
                <p className="tiny muted mt-8">
                  If a starter doesn’t play, the first eligible substitute in this order
                  takes their place automatically.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {opened && (
        <PlayerSheet
          p={opened} gw={gw} isMine={isMine} busy={saving}
          crestOf={crestOf}
          swapTargets={swapTargets(opened)}
          onSwap={other => swap(opened.player_id, other)}
          onClose={() => setOpenId(null)} />
      )}

      <style>{`
        .squad-grid { display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr); }
        .squad-list-col { max-width: 640px; }
        .bench-chip {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 5px 9px; border-radius: var(--r-sm);
          border: 1px solid var(--rule); background: var(--stock-2);
          font-size: 11.5px; font-weight: 600; letter-spacing: -.01em;
        }
        @media (min-width: 1000px) {
          .squad-grid { grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 44px; }
          .squad-pitch-col { position: sticky; top: calc(var(--head-h) + 16px); align-self: start; }
        }
      `}</style>
    </div>
  )
}

function PlayerRow ({
  p, lead, trailing, onTap, crest
}: {
  p: SquadPlayer
  crest?: number
  lead?: React.ReactNode
  trailing?: React.ReactNode
  onTap: () => void
}) {
  const flag = availability(p.status)
  const fixture = gwFixtureLabel(p)
  return (
    // The reorder controls sit *beside* the row's hit target, not inside it.
    // Nested buttons are invalid HTML, and a browser that recovers from them
    // does so by making the inner control unreachable by keyboard.
    <li className={trailing ? 'row-with-aside' : undefined}>
      {/* A locked row still opens: it can't be moved, but it is the row whose
          points you most want itemised. */}
      <button className={`list-row ${p.locked ? 'is-disabled' : ''}`} onClick={onTap}>
        {lead}
        <Crest code={crest} size={18} alt={p.club_short ?? ''} />
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="name truncate" style={{ display: 'block' }}>{p.web_name}</span>
          <span className="row gap-6 tiny muted" style={{ marginTop: 2 }}>
            <span className="club">{p.club_short ?? '—'}</span>
            {p.locked
              ? <span className="locked"><IconLock /> {p.minutes > 0 ? `${p.minutes}'` : 'Kicked off'}</span>
              : <span>{kickoffLabel(p.kickoff)}</span>}
            {fixture && <span className="fixture">{fixture}</span>}
            {flag && <span style={{ color: flag.tone }}>· {flag.label}</span>}
          </span>
        </span>
        <span className="num" style={{ width: 38, textAlign: 'right', fontWeight: 700 }}>
          {p.gw_points}
        </span>
      </button>
      {trailing}
    </li>
  )
}

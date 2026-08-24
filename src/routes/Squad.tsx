import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { useDragSwap } from '../lib/drag'
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

  // The score is the XI *after* automatic substitutions — a starter who has
  // been replaced scores nothing here and the substitute who replaced him
  // scores instead. This used to be a plain sum of the eleven starters, which
  // disagreed with the league table by however much the bench had covered:
  // 48 here against 61 there, for the same squad in the same gameweek.
  const gwPoints = useMemo(
    () => (squad ?? [])
      .filter(p => (p.lineup_status === 'starter' && !p.subbed_out) || p.subbed_in)
      .reduce((n, p) => n + p.gw_points, 0),
    [squad])

  const nameById = useMemo(
    () => new Map((squad ?? []).map(p => [p.player_id, p.web_name])), [squad])
  const subCount = useMemo(
    () => (squad ?? []).filter(p => p.subbed_in).length, [squad])
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

  /** Drop one bench player onto another: he takes that slot, the rest shuffle. */
  function reorderBench (fromId: number, toId: number) {
    const order = bench.map(p => p.player_id)
    const from = order.indexOf(fromId)
    const to = order.indexOf(toId)
    if (from === -1 || to === -1 || from === to) return
    order.splice(to, 0, ...order.splice(from, 1))
    const next = squad!.map(p => {
      const idx = order.indexOf(p.player_id)
      return idx === -1 ? p : { ...p, bench_priority: idx + 1 }
    })
    setSquad(next)
    void persist(next)
  }

  /**
   * What a drag would do, if anything. Bench onto bench reorders; across the
   * line it is a substitution, which is same-position only and needs both men
   * free — the same rule the player sheet applies, asked from the other end.
   */
  const canDropOn = useCallback((fromId: number, toId: number) => {
    const a = (squad ?? []).find(p => p.player_id === fromId)
    const b = (squad ?? []).find(p => p.player_id === toId)
    if (!a || !b || !isMine || a.locked || b.locked) return false
    const aStart = a.lineup_status === 'starter'
    const bStart = b.lineup_status === 'starter'
    if (!aStart && !bStart) return true
    if (aStart && bStart) return false
    return a.position === b.position
  }, [squad, isMine])

  const onDropOn = useCallback((fromId: number, toId: number) => {
    const a = (squad ?? []).find(p => p.player_id === fromId)
    const b = (squad ?? []).find(p => p.player_id === toId)
    if (!a || !b) return
    if (a.lineup_status !== 'starter' && b.lineup_status !== 'starter') {
      reorderBench(fromId, toId)
    } else {
      swap(fromId, toId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad])

  const { drag, bind } = useDragSwap({
    canDrop: canDropOn,
    onDrop: onDropOn,
    onTap: setOpenId,
    locked: id => !isMine || !!(squad ?? []).find(p => p.player_id === id)?.locked
  })

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
          // The gameweek switch belongs to the number it changes. It used to
          // sit in the row below, next to the squad switcher — two joined
          // tracks eight pixels apart, each with its own filled cell, which
          // reads as one control with two selections. Up here it replaces the
          // static "Gameweek 1" caption rather than repeating it, and the row
          // below is left with a single control and a single purple block.
          <div className="stack gap-8" style={{ alignItems: 'flex-end' }}>
            <div className="figure" style={{ fontSize: 'clamp(44px, 11vw, 64px)' }}>
              {gwPoints}
            </div>
            {subCount > 0 && (
              <div className="tiny muted">
                after {subCount} automatic sub{subCount > 1 ? 's' : ''}
              </div>
            )}
            {gwOptions.length > 1
              ? <Segmented value={String(gw)} onChange={v => setGw(Number(v))} options={gwOptions} />
              : <div className="eyebrow">Gameweek {gw}</div>}
          </div>
        } />

      <div className="seg" role="group" aria-label="Whose squad">
        {members.map(m => (
          <button key={m.id} aria-pressed={m.id === viewing.id}
            onClick={() => navigate(m.id === me.id
              ? `/l/${league.id}/team`
              : `/l/${league.id}/team/${m.id}`)}>
            {m.id === me.id ? 'You' : m.team_name}
          </button>
        ))}
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
                bind={bind}
                dragId={drag.id}
                overId={drag.over}
                locked={id => !!squad!.find(x => x.player_id === id)?.locked}
                points={id => squad!.find(x => x.player_id === id)?.gw_points}
                subbedOut={id => !!squad!.find(x => x.player_id === id)?.subbed_out}
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
                      note={p.subbed_in
                        ? `On for ${nameById.get(p.sub_partner ?? -1) ?? 'a starter'}`
                        : undefined}
                      lead={<span className="num tiny muted" style={{ width: 16 }}>{i + 1}</span>}
                      bind={isMine && !p.locked ? bind : undefined}
                      dragging={drag.id === p.player_id}
                      over={drag.over === p.player_id}
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
                  takes their place automatically — once that starter’s match is over,
                  not before it kicks off.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* What you are holding. Rendered at the root so no ancestor's overflow or
          stacking context can clip it out of the drag. */}
      {drag.id !== null && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {squad?.find(p => p.player_id === drag.id)?.web_name}
        </div>
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
        .sub-badge {
          margin-left: 7px;
          padding: 2px 6px;
          border-radius: var(--r-sm);
          border: 1px solid var(--uv-line);
          background: var(--uv-block);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: -.01em;
          white-space: nowrap;
          vertical-align: 1px;
        }
        /* The grip. Dim until the row is hovered, because five of these down a
           list is a texture and the list is meant to read as names. */
        .drag-ghost {
          position: fixed;
          z-index: 80;
          /* Above the pointer, not on it. Centred, the label covers the slot
             you are aiming at — the one thing you need to see to know whether
             to let go. */
          transform: translate(-50%, calc(-100% - 14px));
          pointer-events: none;
          padding: 7px 11px;
          border-radius: var(--r-sm);
          border: 1px solid var(--uv);
          background: var(--uv);
          color: var(--uv-ink);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -.01em;
          white-space: nowrap;
        }
        .grip {
          display: inline-flex;
          color: var(--fg-3);
          opacity: .35;
          touch-action: none;
          cursor: grab;
          margin-right: 2px;
          transition: opacity .15s var(--ease);
        }
        .list-row:hover .grip { opacity: .8; }
        .grip:active { cursor: grabbing; }
        li.is-dragging { opacity: .35; }
        /* The gap the row would drop into, drawn on the row it would displace. */
        li.is-over .list-row {
          background: var(--uv-block);
          box-shadow: inset 0 2px 0 var(--uv);
        }
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
  p, lead, trailing, onTap, crest, note, bind, dragging, over
}: {
  p: SquadPlayer
  crest?: number
  lead?: React.ReactNode
  trailing?: React.ReactNode
  /** "On for Pedro Porro" — the substitution, said on the row it happened to. */
  note?: string
  bind?: (id: number) => Record<string, unknown>
  dragging?: boolean
  over?: boolean
  onTap: () => void
}) {
  const flag = availability(p.status)
  const fixture = gwFixtureLabel(p)
  return (
    // The reorder controls sit *beside* the row's hit target, not inside it.
    // Nested buttons are invalid HTML, and a browser that recovers from them
    // does so by making the inner control unreachable by keyboard.
    <li className={[trailing && 'row-with-aside', dragging && 'is-dragging',
                    over && 'is-over'].filter(Boolean).join(' ') || undefined}>
      {/* A locked row still opens: it can't be moved, but it is the row whose
          points you most want itemised. */}
      <button className={`list-row ${p.locked ? 'is-disabled' : ''}`}
        {...(bind ? bind(p.player_id) : { onClick: onTap })}>
        {lead}
        {/* On touch only a handle starts a drag, so the list can still be
            scrolled by touching a row. A mouse drags from anywhere on it, so
            this is a grip on phones and an affordance on desktop. */}
        {bind && (
          <span className="grip" data-drag-handle aria-hidden="true">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              {[0, 1].map(c => [0, 1, 2].map(r => (
                <circle key={`${c}-${r}`} cx={1.5 + c * 7} cy={3 + r * 5} r="1.35" />
              )))}
            </svg>
          </span>
        )}
        <Crest code={crest} size={18} alt={p.club_short ?? ''} />
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="name truncate" style={{ display: 'block' }}>
            {p.web_name}
            {note && <span className="sub-badge">{note}</span>}
          </span>
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

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
import { FORMATIONS, POSITIONS, canSubIn, countByPos, formationLabel, xiShape } from '../lib/types'
import type { PosCount, SquadPlayer } from '../lib/types'

export default function Squad () {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const { league, members, me, gameweeks, currentGw, nextGw } = useLeague()
  const { fail } = useToast()
  const crests = useCrests()

  const viewing = members.find(m => m.id === memberId) ?? me
  const isMine = viewing.id === me.id

  const [gw, setGw] = useState(currentGw)
  const [squad, setSquad] = useState<SquadPlayer[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // A gameweek that has kicked off keeps the shape it kicked off with, so this
  // decides whether a substitution may change the formation or only fill a
  // like-for-like slot. See 19_flex_formations.sql.
  const [frozen, setFrozen] = useState(false)

  const load = useCallback(async () => {
    // ensure_lineup is idempotent; calling it here means a squad always has a
    // lineup to show, even for a gameweek nobody has opened yet.
    if (isMine) await api.ensureLineup(viewing.id, gw).catch(() => {})
    const [rows, started] = await Promise.all([
      api.getSquad(viewing.id, gw), api.gwStarted(gw)])
    setSquad(rows)
    setFrozen(started)
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

  // The formation, which is now a fact about the lineup rather than a constant.
  const xi = useMemo(() => countByPos(starters), [starters])

  const nameById = useMemo(
    () => new Map((squad ?? []).map(p => [p.player_id, p.web_name])), [squad])
  const subCount = useMemo(
    () => (squad ?? []).filter(p => p.subbed_in).length, [squad])
  const problem = squad ? xiProblem(starters) : null
  // Over, as opposed to merely begun. Both are frozen, but only one of them
  // still has football left to swap a player into.
  const played = gw < currentGw

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

  /**
   * Can this substitute come on for that starter? Same position always can, and
   * that is the only swap a gameweek already under way accepts: it keeps the
   * shape it kicked off with. Otherwise the formation it would leave has to be
   * one you are allowed to field.
   */
  const canSub = useCallback((starter: SquadPlayer, sub: SquadPlayer) =>
    starter.position === sub.position ||
    (!frozen && canSubIn(xi, starter.position, sub.position)), [frozen, xi])

  /**
   * The eleven this squad would field in a given shape, or null if it can't
   * field it at all.
   *
   * Reaching a formation by swapping one man at a time works and is still how
   * you do it on the pitch, but it makes you solve for the route: 4-4-2 to
   * 5-2-3 is two swaps through 5-3-2, and picking the wrong first one leaves
   * you at a shape the next swap is refused from. Naming the destination is the
   * thing a manager actually wants, so this computes the whole XI at once.
   *
   * Locked men are the only real difficulty. One whose match has kicked off
   * cannot cross the line in either direction, so a locked starter is in the XI
   * whatever you pick and a locked substitute is out of it whatever you pick —
   * which is what makes some shapes unreachable on a Sunday and is why this
   * returns null rather than an approximation. Everyone else is free, and is
   * taken current starters first so that changing shape moves as few players as
   * it can: go 4-4-2 to 4-3-3 and your back four and your two forwards stay
   * exactly where they were.
   */
  const xiFor = useCallback((shape: PosCount): SquadPlayer[] | null => {
    if (!squad) return null
    const picked: SquadPlayer[] = []
    for (const pos of POSITIONS) {
      const at = squad.filter(p => p.position === pos)
      const fixed = at.filter(p => p.locked && p.lineup_status === 'starter')
      if (fixed.length > shape[pos]) return null
      const free = at.filter(p => !p.locked).sort((a, b) =>
        Number(b.lineup_status === 'starter') - Number(a.lineup_status === 'starter') ||
        (a.bench_priority ?? 0) - (b.bench_priority ?? 0))
      const want = shape[pos] - fixed.length
      if (free.length < want) return null
      picked.push(...fixed, ...free.slice(0, want))
    }
    return picked
  }, [squad])

  /** Every shape in the band, and whether this squad can be put into it today. */
  const shapes = useMemo(
    () => FORMATIONS.map(f => ({ shape: f, label: formationLabel(f), can: !!xiFor(f) })),
    [xiFor])

  /** Put the XI into this shape. */
  function reshape (shape: PosCount) {
    const picked = xiFor(shape)
    if (!picked) return
    const starting = new Set(picked.map(p => p.player_id))
    // Whoever was already a substitute keeps his place in the order, and
    // whoever has just been dropped into it joins at the back. Bench order is a
    // decision in its own right, and changing formation is not a reason to
    // throw away the one you made.
    const order = squad!
      .filter(p => !starting.has(p.player_id))
      .sort((a, b) =>
        Number(a.lineup_status === 'starter') - Number(b.lineup_status === 'starter') ||
        (a.bench_priority ?? 99) - (b.bench_priority ?? 99))
      .map(p => p.player_id)

    const next = squad!.map(p => starting.has(p.player_id)
      ? { ...p, lineup_status: 'starter' as const, bench_priority: null }
      : { ...p, lineup_status: 'substitute' as const,
          bench_priority: order.indexOf(p.player_id) + 1 })
    setSquad(next)
    setOpenId(null)
    void persist(next)
  }

  /** Swap a starter with a bench player: he comes on, that one goes off. */
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
   * line it is a substitution, which needs both men free and has to leave a
   * legal shape behind — the same rule the player sheet applies, asked from
   * the other end.
   */
  const canDropOn = useCallback((fromId: number, toId: number) => {
    const a = (squad ?? []).find(p => p.player_id === fromId)
    const b = (squad ?? []).find(p => p.player_id === toId)
    if (!a || !b || !isMine || a.locked || b.locked) return false
    const aStart = a.lineup_status === 'starter'
    const bStart = b.lineup_status === 'starter'
    if (!aStart && !bStart) return true
    if (aStart && bStart) return false
    return canSub(aStart ? a : b, aStart ? b : a)
  }, [squad, isMine, canSub])

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

  /**
   * Can this substitute move a place? The bench order is what decides who
   * covers a blank, so it is part of the lineup and locks the way the rest of
   * it does: a man whose match has kicked off cannot be moved past another man
   * whose match has kicked off. That would be choosing the substitution after
   * watching the football. Two who are both still to play may swap all week —
   * neither of them can come on, so nothing about the week turns on it.
   *
   * Mirrors the check in set_lineup(); see 20_settled_subs.sql.
   */
  const canMoveBench = (i: number, dir: -1 | 1) => {
    const a = bench[i]
    const b = bench[i + dir]
    return !!a && !!b && !(a.locked && b.locked)
  }

  function moveBench (playerId: number, dir: -1 | 1) {
    const order = bench.map(p => p.player_id)
    const i = order.indexOf(playerId)
    const j = i + dir
    if (j < 0 || j >= order.length || !canMoveBench(i, dir)) return
    ;[order[i], order[j]] = [order[j], order[i]]
    const next = squad!.map(p => {
      const idx = order.indexOf(p.player_id)
      return idx === -1 ? p : { ...p, bench_priority: idx + 1 }
    })
    setSquad(next)
    void persist(next)
  }

  /**
   * Who could take this player's place: the other side of the line, movable,
   * and leaving a formation you are allowed to field.
   */
  const swapTargets = (p: SquadPlayer) => (squad ?? []).filter(o => {
    if (o.player_id === p.player_id || o.locked) return false
    const pStart = p.lineup_status === 'starter'
    if ((o.lineup_status === 'starter') === pStart) return false
    return canSub(pStart ? p : o, pStart ? o : p)
  })

  /** The formation a cross-position substitution would leave, or nothing. */
  const shapeAfter = (starter: SquadPlayer, sub: SquadPlayer) =>
    starter.position === sub.position
      ? undefined
      : formationLabel({ ...xi, [starter.position]: xi[starter.position] - 1,
                              [sub.position]: xi[sub.position] + 1 })

  const opened = squad?.find(p => p.player_id === openId) ?? null
  const crestOf = (p: SquadPlayer) => crests.shortCode.get(p.club_short ?? '')

  // Every gameweek the league has scored, plus the one being built.
  //
  // This used to offer the current gameweek and the next one and nothing else,
  // which quietly made the season unreadable: a played gameweek keeps the XI it
  // kicked off with — that is the whole point of the freeze in
  // 16_signings_next_week.sql — and there was no way to look at it. member_squad
  // takes any gameweek and always could; only the picker was short.
  //
  // Scoring start is the floor because gameweeks before it are not part of this
  // league's season, and min() with the current one keeps the control honest if
  // scoring hasn't begun yet.
  const firstGw = Math.min(league.scoring_start_gw, currentGw)
  const gwOptions = useMemo(() => {
    const ids = gameweeks
      .map(g => g.id)
      .filter(id => id >= firstGw && id <= Math.max(currentGw, nextGw))
      .sort((a, b) => a - b)
    return (ids.length ? ids : [currentGw]).map(id => ({ value: String(id), label: `GW ${id}` }))
  }, [gameweeks, firstGw, currentGw, nextGw])

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
                ? <Notice kind="warn">
                    {problem} — an XI is 1 GK, 3–5 DEF, 2–5 MID and 1–3 FWD.
                  </Notice>
                // The how-to lives under the pitch, where the tapping
                // happens. These slots are for the rules you cannot see.
                // A gameweek in the past is a record, not a team sheet, and
                // telling its manager that like-for-like swaps still go through
                // would be false in the one case it most looks true.
                : played
                  ? <Notice>
                      Gameweek {gw} has been played, and this is the {formationLabel(xi)} it
                      was scored in — a gameweek keeps the XI and the shape it kicked off
                      with. Pick your formation in{' '}
                      <button className="rules-link" onClick={() => setGw(nextGw)}>
                        gameweek {nextGw}
                      </button>.
                    </Notice>
                  : frozen
                    ? <Notice>
                        Gameweek {gw} has kicked off, so it keeps its {formationLabel(xi)}.
                        Like-for-like swaps still go through until each player’s own
                        match starts; change shape in a gameweek that hasn’t begun.{' '}
                        <Link className="rules-link" to="/rules#lineups">How locking works</Link>
                      </Notice>
                    : <Notice>
                        Play any of the eight formations — pick one under the pitch, or
                        drag a substitute onto the man he replaces. Each player locks when
                        his own match kicks off, in that gameweek only.{' '}
                        <Link className="rules-link" to="/rules#squad">Which shapes are legal?</Link>
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
              <Eyebrow>Starting XI · {formationLabel(xi)}</Eyebrow>
              <SquadPitch
                capacity={xiShape(xi)}
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
              {/* The shape, named rather than assembled. Directly under the
                  pitch because the pitch is what it rearranges — press one and
                  the rows above redraw. */}
              {isMine && !frozen && (
                <>
                  <div className="seg formations" role="group" aria-label="Formation">
                    {shapes.map(s => (
                      <button key={s.label}
                        aria-pressed={s.label === formationLabel(xi)}
                        disabled={saving || !s.can}
                        title={s.can
                          ? `Play ${s.label}`
                          : `${s.label} isn’t reachable now — too many of your players have already kicked off to move into it.`}
                        onClick={() => reshape(s.shape)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {shapes.some(s => !s.can) && (
                    <p className="tiny muted" style={{ marginTop: 8 }}>
                      The shapes you can’t press need players who have already kicked
                      off to change places. They open up again next gameweek.
                    </p>
                  )}
                </>
              )}
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
                            disabled={i === 0 || saving || !canMoveBench(i, -1)}
                            title={i > 0 && !canMoveBench(i, -1)
                              ? 'Both matches have kicked off, so this order is settled.'
                              : undefined}
                            onClick={() => moveBench(p.player_id, -1)}><IconChevron dir="up" size={13} /></button>
                          <button className="nudge" aria-label={`Move ${p.web_name} down the bench`}
                            disabled={i === bench.length - 1 || saving || !canMoveBench(i, 1)}
                            title={i < bench.length - 1 && !canMoveBench(i, 1)
                              ? 'Both matches have kicked off, so this order is settled.'
                              : undefined}
                            onClick={() => moveBench(p.player_id, 1)}><IconChevron dir="down" size={13} /></button>
                        </span>
                      ) : undefined} />
                  ))}
                </ul>
                <p className="tiny muted mt-8">
                  If a starter doesn’t play, the first eligible substitute in this order
                  takes their place automatically — once that starter’s match is over,
                  not before it kicks off.
                  {frozen && ' A substitute whose own match has started keeps his place'
                    + ' in the order: the cover is decided before the football, not after.'}
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
          swapNote={other => opened.lineup_status === 'starter'
            ? shapeAfter(opened, other)
            : shapeAfter(other, opened)}
          onSwap={other => swap(opened.player_id, other)}
          onClose={() => setOpenId(null)} />
      )}

      <style>{`
        .squad-grid { display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr); }
        /* Eight cells of "3-4-3" outrun a 300px pitch column, and .seg already
           scrolls and already brings its selection back into view. */
        .formations { margin-top: 14px; }
        /* Unreachable rather than absent: the band is eight shapes whether or
           not Saturday has happened, and dropping the ones you can't have this
           afternoon would make the control a different length every day. */
        .formations button:disabled { opacity: .28; cursor: not-allowed; }
        .formations button:disabled:hover { background: transparent; color: var(--fg-3); }
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

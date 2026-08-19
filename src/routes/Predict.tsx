import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Crest, Empty, Eyebrow, IconChevron, Loading, Notice, PageHead } from '../components/ui'
import type { PredictionRow, PredictionStanding, TableTeam } from '../lib/types'

/**
 * Table predictions.
 *
 * One guess a season, made before a ball is kicked: the twenty clubs in the
 * order you think they will finish. Scored all season against the real table
 * as the sum of |predicted - actual| across the twenty, and paid as a bonus on
 * top of your squad's points.
 *
 * Two screens, not one, because the job changes completely at the deadline.
 * Before it this is an editor — order the clubs, nobody can see your order but
 * you. After it there is nothing to edit ever again, so it becomes a results
 * page: your guess against what happened, club by club, and everyone else's
 * accuracy beside it.
 */

/** How far out a club can be before the miss is worth calling out. */
function deltaTone (d: number): string {
  const off = Math.abs(d)
  if (off === 0) return 'var(--gold)'
  if (off <= 2) return 'var(--green)'
  if (off <= 5) return 'var(--fg-2)'
  return 'var(--red)'
}

/**
 * What the two ends of a real table mean, marked where they fall. Twenty
 * identical rows hide the only thing that makes position 4 different from
 * position 5, and it is where most of the argument lives.
 */
const BANDS: Record<number, string> = {
  0: 'Champions League',
  4: 'Europa places',
  17: 'Relegation'
}

const deadlineLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
  })

export default function Predict () {
  const { league, members, me } = useLeague()
  const { fail } = useToast()

  const [table, setTable] = useState<TableTeam[] | null>(null)
  const [open, setOpen] = useState(true)
  const [deadline, setDeadline] = useState<string | null>(null)
  const [board, setBoard] = useState<PredictionStanding[]>([])
  const [bonusMax, setBonusMax] = useState(100)

  // Editor state (before the deadline): team ids, first to twentieth.
  const [order, setOrder] = useState<number[]>([])
  const [savedOrder, setSavedOrder] = useState<number[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Results state (after it).
  const [viewing, setViewing] = useState(me.id)
  const [entry, setEntry] = useState<PredictionRow[] | null>(null)

  const load = useCallback(async () => {
    const [t, isOpen, dl, rows, mine, max] = await Promise.all([
      api.getEplTable(),
      api.predictionsOpen(league.id),
      api.predictionsDeadline(league.id),
      api.getLeaguePredictions(league.id).catch(() => [] as PredictionStanding[]),
      api.getPrediction(me.id).catch(() => [] as PredictionRow[]),
      api.predictionBonusMax().catch(() => 100)
    ])
    setTable(t)
    setOpen(isOpen)
    setDeadline(dl)
    setBoard(rows)
    setBonusMax(max)

    const submitted = mine.length ? mine.map(r => r.team_id) : null
    setSavedOrder(submitted)
    // An untouched entry starts from the real table rather than from nothing:
    // twenty empty slots is a form, and nobody fills in a form for fun.
    setOrder(submitted ?? t.map(x => x.team_id))
  }, [league.id, me.id])

  useEffect(() => { load().catch(fail) }, [load, fail])

  // The results view can be pointed at any manager once the picks are out.
  useEffect(() => {
    if (open) return
    api.getPrediction(viewing).then(setEntry).catch(() => setEntry([]))
  }, [open, viewing])

  // ------------------------------------------------------------- editing ---

  const dirty = useMemo(
    () => !savedOrder || order.some((id, i) => savedOrder[i] !== id),
    [order, savedOrder]
  )

  const save = useCallback(() => {
    setSaving(true)
    return api.setPredictions(league.id, order)
      .then(() => { setSavedOrder(order); return api.getLeaguePredictions(league.id) })
      .then(setBoard)
      .catch(e => { fail(e); void load() })
      .finally(() => setSaving(false))
  }, [league.id, order, fail, load])

  // Once an entry exists, every nudge autosaves, like the lineup editor: a
  // Save button at the end of twenty small moves is a Save button somebody
  // forgets to press. Before it exists, though, entering is a decision — the
  // screen must not sign you up for the order it happened to load with.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!open || !savedOrder || !dirty || order.length === 0) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save() }, 700)
    return () => window.clearTimeout(timer.current)
  }, [order, dirty, open, savedOrder, save])

  const swap = (a: number, b: number) => {
    setOrder(prev => {
      const next = [...prev]
      const i = next.indexOf(a); const j = next.indexOf(b)
      if (i < 0 || j < 0) return prev
      next[i] = b; next[j] = a
      return next
    })
  }

  const move = (id: number, by: -1 | 1) => {
    setOrder(prev => {
      const i = prev.indexOf(id)
      const j = i + by
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      next[i] = next[j]; next[j] = id
      return next
    })
    setPicked(null)
  }

  const tap = (id: number) => {
    if (picked === null) { setPicked(id); return }
    if (picked === id) { setPicked(null); return }
    swap(picked, id)
    setPicked(null)
  }

  // ------------------------------------------------------------- derived ---

  const byId = useMemo(
    () => new Map((table ?? []).map(t => [t.team_id, t])),
    [table]
  )
  const mine = board.find(b => b.member_id === me.id)
  const entered = board.filter(b => b.submitted).length
  const viewingName = members.find(m => m.id === viewing)?.team_name ?? 'Manager'
  const totalError = entry?.reduce((s, r) => s + Math.abs(r.delta), 0) ?? null
  const seasonStarted = (table ?? []).some(t => t.played > 0)

  if (table === null) return <div className="page narrow"><Loading rows={8} /></div>

  if (table.length === 0) {
    return (
      <div className="page narrow">
        <PageHead title="Predictions" meta="Guess the final Premier League table." />
        <Empty>Next season’s fixtures haven’t landed yet. Come back once they do.</Empty>
      </div>
    )
  }

  return (
    <div className="page narrow">
      <PageHead
        title="Predictions"
        meta={open
          ? 'Put the twenty clubs where you think they’ll finish. One guess, scored all season.'
          : 'Your guess against the real table, scored all season.'}
        aside={open ? undefined : (
          <div style={{ textAlign: 'right' }}>
            <div className="figure" style={{ fontSize: 'clamp(38px, 9vw, 56px)' }}>
              {mine?.submitted ? mine.bonus : '0'}
            </div>
            <span className="eyebrow">Your bonus</span>
          </div>
        )} />

      {open ? (
        <>
          {/* The deadline is the whole reason this screen is urgent, so it is
              the block, not a footnote under the list. */}
          <div className="slab green">
            <div className="eyebrow">Locks at</div>
            <div className="figure" style={{
              fontSize: 'clamp(24px, 6vw, 38px)', marginTop: 8, color: 'var(--fg)'
            }}>
              {deadline ? deadlineLabel(deadline) : 'the first kickoff'}
            </div>
            <p className="small mt-16" style={{ maxWidth: '52ch' }}>
              Your order is yours alone until then — nobody else in the league can see it.
              After the first kickoff it is fixed for the season, and everyone’s picks
              are revealed.
            </p>
            <div className="row gap-12 wrap mt-16">
              {savedOrder ? (
                <>
                  <span className="status-tag">{entered} of {members.length} entered</span>
                  <span className="tiny" style={{ color: saving ? 'var(--fg)' : undefined }}>
                    {saving ? 'Saving…' : dirty ? 'Saving in a moment…' : 'Saved · every change from here saves itself'}
                  </span>
                </>
              ) : (
                <>
                  <button className="btn" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Entering…' : 'Enter this table'}
                  </button>
                  <span className="tiny">
                    {entered} of {members.length} entered · you can keep changing it until the deadline
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="mt-32">
            <Eyebrow>Your table · 1st to 20th</Eyebrow>
            <p className="tiny muted" style={{ margin: '-8px 0 12px' }}>
              {picked !== null
                ? `Tap another club to swap it with ${byId.get(picked)?.name ?? 'it'}.`
                : 'Tap two clubs to swap them, or use the arrows to nudge one place.'}
            </p>
            <ul className="list">
              {order.map((id, i) => {
                const t = byId.get(id)
                if (!t) return null
                return (
                  <Fragment key={id}>
                  {BANDS[i] && <li className="predict-band">{BANDS[i]}</li>}
                  <li className="row-with-aside">
                    <button
                      className={`list-row${picked === id ? ' is-selected' : ''}`}
                      onClick={() => tap(id)}
                      aria-label={`${t.name}, predicted ${i + 1}`}>
                      <span className="figure predict-pos">{i + 1}</span>
                      <Crest code={t.code} size={20} alt="" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>{t.name}</span>
                      </span>
                      {picked === id && <span className="tiny" style={{ color: 'var(--uv-lift)' }}>Swapping</span>}
                    </button>
                    <span className="row-aside">
                      <button className="nudge" aria-label={`Move ${t.name} up`}
                        disabled={i === 0} onClick={() => move(id, -1)}>
                        <IconChevron dir="up" size={13} />
                      </button>
                      <button className="nudge" aria-label={`Move ${t.name} down`}
                        disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                        <IconChevron dir="down" size={13} />
                      </button>
                    </span>
                  </li>
                  </Fragment>
                )
              })}
            </ul>
          </div>

          <div className="mt-24">
            <Scoring bonusMax={bonusMax} />
          </div>
        </>
      ) : (
        <>
          {!mine?.submitted && (
            <div className="mt-8">
              <Notice kind="warn">
                You didn’t enter before the first kickoff, so there’s no bonus for you this
                season. You can still see how everyone else is doing.
              </Notice>
            </div>
          )}

          {/* Everyone's accuracy, which is the competitive part. Ordered by
              bonus, because that is the number that moves the league table. */}
          <div className="mt-24">
            <Eyebrow>Bonus{seasonStarted ? '' : ' · once matches are played'}</Eyebrow>
            <div className="thead">
              <span className="grow">Manager</span>
              <span style={{ width: 62, textAlign: 'right' }}>Error</span>
              <span style={{ width: 62, textAlign: 'right' }}>Bonus</span>
            </div>
            <ul>
              {board.map(b => (
                <li key={b.member_id}>
                  <button
                    className={`list-row${b.member_id === viewing ? ' is-selected' : ''}${b.member_id === me.id ? ' is-you' : ''}`}
                    onClick={() => setViewing(b.member_id)}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name truncate" style={{ display: 'block' }}>
                        {b.team_name}
                        {b.member_id === me.id && <span className="tiny muted"> · you</span>}
                      </span>
                      <span className="tiny muted truncate">
                        {b.submitted ? b.manager_name : `${b.manager_name} · didn’t enter`}
                      </span>
                    </span>
                    <span className="num small muted" style={{ width: 62, textAlign: 'right' }}>
                      {b.submitted && b.error !== null ? b.error : '—'}
                    </span>
                    <span className="figure" style={{ width: 62, textAlign: 'right', fontSize: 21 }}>
                      {b.submitted ? b.bonus : '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-40">
            <Eyebrow>
              {viewing === me.id ? 'Your table' : `${viewingName}’s table`}
              {totalError !== null && (totalError === 0 ? ' · spot on' : ` · ${totalError} places out`)}
            </Eyebrow>
            {entry === null ? <Loading rows={6} /> : entry.length === 0 ? (
              <Empty>No entry from this manager.</Empty>
            ) : (
              <>
                <div className="thead">
                  <span style={{ width: 34 }}>Said</span>
                  <span className="grow">Club</span>
                  <span style={{ width: 34, textAlign: 'right' }}>Now</span>
                  <span style={{ width: 52, textAlign: 'right', whiteSpace: 'nowrap' }}>Out by</span>
                </div>
                <ul className="list">
                  {entry.map(r => (
                    <li key={r.team_id} className="list-row">
                      <span className="figure predict-pos">{r.predicted_pos}</span>
                      <Crest code={r.code} size={20} alt="" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>{r.name}</span>
                        <span className="tiny muted">
                          {r.played} played · {r.points} pts
                        </span>
                      </span>
                      <span className="num small muted" style={{ width: 34, textAlign: 'right' }}>
                        {r.actual_pos}
                      </span>
                      {/* Signed, because "out by 3" hides whether the club is
                          over- or under-performing your guess, and that is the
                          bit people argue about. */}
                      <span className="num" style={{
                        width: 52, textAlign: 'right', fontWeight: 700, color: deltaTone(r.delta)
                      }}>
                        {r.delta === 0 ? '✓' : r.delta > 0 ? `↑${r.delta}` : `↓${-r.delta}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tiny muted mt-8">
                  ↑ means the club is doing better than this guess, ↓ worse.
                </p>
              </>
            )}
          </div>

          <div className="mt-24">
            <Scoring bonusMax={bonusMax} />
          </div>
        </>
      )}

      <p className="tiny muted mt-24">
        The bonus is part of the <Link className="rules-link" to={`/l/${league.id}/table`}>league
        table</Link> total, and the rules are in the{' '}
        <Link className="rules-link" to="/rules#predictions">rulebook</Link>.
      </p>

      <style>{`
        .predict-band {
          padding: 16px 0 6px;
          font-stretch: 88%;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--fg-3);
        }
        .predict-pos {
          width: 30px; flex: none;
          font-size: 19px;
          color: var(--fg-3);
          text-align: right;
        }
        .list-row.is-selected .predict-pos { color: var(--uv-lift); }
      `}</style>
    </div>
  )
}

/**
 * The formula, said in words. A bonus nobody can predict the size of is a
 * bonus people assume is rigged.
 */
function Scoring ({ bonusMax }: { bonusMax: number }) {
  return (
    <Notice>
      <span>
      <strong style={{ fontWeight: 650 }}>How it scores.</strong> Every club’s error is how
      many places out you were; your total is those twenty numbers added up, so lower is
      better. A perfect table is worth {bonusMax} bonus points and a random shuffle — which
      averages 133 out — is worth nothing, with everything in between shared out evenly.
      A good guess is usually around 40 out, or about {Math.round(bonusMax * (1 - 40 / 133))} points.
      </span>
    </Notice>
  )
}

import { Link } from 'react-router-dom'
import { Crest, Eyebrow, IconLock, Notice, PosChip, Sheet } from './ui'
import { availability, gwFixtureLabel, kickoffLabel, pointsLines } from '../lib/format'
import type { SquadPlayer } from '../lib/types'

/**
 * One player, opened from the squad screen.
 *
 * The squad was a wall of totals: eleven names, eleven numbers, and no way to
 * ask why. A points total is the one number in this game nobody can check by
 * eye — it is minutes plus goals plus a clean sheet minus a card, and FPL sends
 * that itemisation on the same payload as the total. So the sheet answers the
 * two questions a number provokes: how did he get that, and can I still do
 * something about it.
 *
 * Which is also why the substitution lives here rather than in a tap-tap dance
 * on the pitch: by the time you have opened a player you know his fixture and
 * whether he played, and the manager you would bring on is listed with his own
 * fixture beside him. Choosing a sub blind was the old flow.
 */
export default function PlayerSheet ({
  p, gw, isMine, swapTargets, onSwap, onClose, crestOf, busy
}: {
  p: SquadPlayer
  gw: number
  isMine: boolean
  /** Same position, other side of the line, not locked. Empty is normal late. */
  swapTargets: SquadPlayer[]
  onSwap: (otherId: number) => void
  onClose: () => void
  crestOf: (p: SquadPlayer) => number | undefined
  busy: boolean
}) {
  const lines = pointsLines(p.breakdown)
  const flag = availability(p.status)
  const fixture = gwFixtureLabel(p)
  const isStarter = p.lineup_status === 'starter'

  // Why there is nothing to itemise. Four different reasons, and telling them
  // apart is the whole value: a blank gameweek is not the same as a substitute
  // who never came on, and neither is the same as bonus points that FPL has
  // not settled yet.
  const nothingYet =
    p.fixture_count === 0
      ? `No fixture in gameweek ${gw}. A blank week scores nothing, and the first eligible substitute takes the slot.`
      : !p.locked
        ? `Not played yet — ${p.kickoff ? `kicks off ${kickoffLabel(p.kickoff)}` : 'no kick-off time yet'}.`
        : p.minutes === 0
          ? 'No minutes. If he started for you, the first eligible substitute takes his place automatically.'
          : 'Points are in, but FPL has not published the breakdown for this match yet.'

  return (
    <Sheet title={p.web_name} onClose={onClose}>
      <div className="pd-head">
        <Crest code={crestOf(p)} size={38} alt={p.club_short ?? ''} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-6 wrap">
            <span className="club">{p.club_short ?? '—'}</span>
            <PosChip pos={p.position} />
            <span className="fixture">{fixture || '—'}</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 5 }}>
            {p.locked
              ? <span className="locked"><IconLock /> {p.minutes > 0 ? `${p.minutes} minutes` : 'Kicked off'}</span>
              : kickoffLabel(p.kickoff)}
            {isStarter ? ' · Starting' : p.lineup_status ? ` · Bench ${p.bench_priority ?? ''}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="figure" style={{ fontSize: 'clamp(30px, 8vw, 40px)' }}>{p.gw_points}</div>
          <div className="eyebrow" style={{ marginTop: 4 }}>GW {gw}</div>
        </div>
      </div>

      {flag && (
        <div className="mt-16">
          <Notice kind={p.status === 'd' ? 'warn' : 'error'}>
            <strong>{flag.label}.</strong>{p.news ? ` ${p.news}` : ''}
          </Notice>
        </div>
      )}

      <div className="mt-24">
        <Eyebrow>How he scored</Eyebrow>
        {lines.length ? (
          <ul className="pd-lines">
            {lines.map(l => (
              <li key={l.identifier}>
                <span className="grow">
                  {l.label}
                  {l.detail && <span className="muted"> {l.detail}</span>}
                </span>
                <span className="num pd-pts">{l.points > 0 ? `+${l.points}` : l.points}</span>
              </li>
            ))}
            <li className="is-total">
              <span className="grow">Gameweek {gw}</span>
              <span className="num pd-pts">{p.gw_points}</span>
            </li>
          </ul>
        ) : (
          <p className="small muted" style={{ marginTop: 10, maxWidth: '52ch' }}>{nothingYet}</p>
        )}
        <p className="tiny muted" style={{ marginTop: 12 }}>
          {p.total_points} points this season, all competitions counted by FPL.
        </p>
      </div>

      {isMine && (
        <div className="mt-24">
          {p.locked ? (
            <Notice>
              His match has kicked off, so he is fixed in your gameweek {gw} lineup.{' '}
              <Link className="rules-link" to="/rules#lineups">How locking works</Link>
            </Notice>
          ) : swapTargets.length === 0 ? (
            <Notice>
              Nobody else in your squad can take his place: every other {p.position} is
              already locked into this gameweek.
            </Notice>
          ) : (
            <>
              <Eyebrow>{isStarter ? 'Bench him for' : 'Start him instead of'}</Eyebrow>
              <ul className="list">
                {swapTargets.map(t => (
                  <li key={t.player_id}>
                    <button className="list-row" disabled={busy}
                      onClick={() => onSwap(t.player_id)}>
                      <Crest code={crestOf(t)} size={18} alt={t.club_short ?? ''} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="name truncate" style={{ display: 'block' }}>{t.web_name}</span>
                        <span className="row gap-6 tiny muted" style={{ marginTop: 2 }}>
                          <span className="club">{t.club_short ?? '—'}</span>
                          <span>{kickoffLabel(t.kickoff)}</span>
                          <span className="fixture">{gwFixtureLabel(t)}</span>
                          {availability(t.status) &&
                            <span style={{ color: availability(t.status)!.tone }}>
                              · {availability(t.status)!.label}
                            </span>}
                        </span>
                      </span>
                      <span className="num pd-pts">{t.gw_points}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="tiny muted mt-8">
                {isStarter
                  ? 'He takes that player’s place on the bench; that player starts.'
                  : 'He starts; that player takes his place in the bench order.'}
              </p>
            </>
          )}
        </div>
      )}

      <style>{`
        .pd-head { display: flex; align-items: flex-start; gap: 12px; }
        .pd-lines { border-top: 1px solid var(--rule); margin-top: 10px; }
        .pd-lines li {
          display: flex; align-items: baseline; gap: 12px;
          padding: 9px 2px;
          border-bottom: 1px solid var(--rule);
          font-size: 13.5px;
        }
        /* The total is the number the pitch already showed. Weighting it is
           what makes the rows above read as its parts rather than a list. */
        .pd-lines li.is-total {
          border-bottom: 0;
          font-weight: 650;
          border-top: 1px solid var(--rule-2);
        }
        .pd-pts { font-weight: 700; font-variant-numeric: tabular-nums; }
      `}</style>
    </Sheet>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Loading, Notice, PageHead, Sparkline } from '../components/ui'
import { relativeTime } from '../lib/format'
import type { LeaguePlayer, Standing, Txn } from '../lib/types'

const TXN_VERB: Record<Txn['type'], string> = {
  draft: 'drafted', add: 'signed', drop: 'released', add_drop: 'signed',
  trade: 'received', commissioner: 'commissioner'
}

export default function Table () {
  const { league, members, me, currentGw } = useLeague()
  const { fail } = useToast()
  const [rows, setRows] = useState<Standing[] | null>(null)
  const [txns, setTxns] = useState<Txn[]>([])
  const [players, setPlayers] = useState<LeaguePlayer[]>([])
  const [scores, setScores] = useState<{ member_id: string; gw: number; points: number }[]>([])

  useEffect(() => {
    Promise.all([
      api.getStandings(league.id),
      api.getTransactions(league.id, 40),
      api.getLeaguePlayers(league.id).catch(() => [] as LeaguePlayer[]),
      api.getMemberScores(league.id).catch(() => [])
    ]).then(([s, t, p, sc]) => { setRows(s); setTxns(t); setPlayers(p); setScores(sc) }).catch(fail)
  }, [league.id, fail])

  const nameOf = useMemo(() => new Map(members.map(m => [m.id, m.team_name])), [members])
  const playerName = useMemo(() => new Map(players.map(p => [p.id, p.web_name])), [players])

  // Equal totals share a rank; the spec says show them level rather than invent
  // a tiebreak.
  const ranked = useMemo(() => {
    if (!rows) return []
    let lastPoints = Number.NaN
    let lastRank = 0
    return rows.map((r, i) => {
      const rank = r.total_points === lastPoints ? lastRank : i + 1
      lastPoints = r.total_points; lastRank = rank
      return { ...r, rank }
    })
  }, [rows])

  const tied = ranked.some((r, i) => i > 0 && r.rank === ranked[i - 1].rank)

  // Draft picks already have a whole screen of their own, and 96 of them would
  // bury every real move. This feed is for what happens after the draft.
  const activity = useMemo(() => txns.filter(t => t.type !== 'draft'), [txns])

  /** Points per gameweek per manager, in gameweek order, for the sparkline. */
  const trend = useMemo(() => {
    const by = new Map<string, number[]>()
    for (const s of scores) {
      if (s.gw < league.scoring_start_gw) continue
      const list = by.get(s.member_id) ?? []
      list.push(s.points)
      by.set(s.member_id, list)
    }
    return by
  }, [scores, league.scoring_start_gw])

  return (
    <div className="page narrow">
      <PageHead
        title="Table"
        meta={`Official FPL points, counted from gameweek ${league.scoring_start_gw}.`} />

      {rows === null ? <Loading rows={6} /> : (
        <>
          {/* The leader, set as a block. A two-manager league is two rows in a
              1440px page, which read as an accident rather than a standing;
              giving the top of the table its own surface means the screen has
              a subject however few managers there are. */}
          {ranked[0] && (
            <div className="leader">
              <div>
                <span className="eyebrow">
                  {league.status === 'completed' ? 'Champion' : 'Leading'}
                </span>
                <h2 className="leader-name">{ranked[0].team_name}</h2>
                <p className="tiny muted" style={{ marginTop: 4 }}>
                  {ranked[0].manager_name}
                  {tied && ' · level on points'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="figure leader-total">{ranked[0].total_points}</div>
                <span className="eyebrow">Points</span>
                {/* Two numbers make one total; a leader who is ahead purely on
                    a prediction bonus should not look like they out-scored
                    everybody on the pitch. */}
                {ranked[0].bonus_points > 0 && (
                  <p className="tiny" style={{ marginTop: 6, color: '#B79BC6' }}>
                    {ranked[0].squad_points} squad + {ranked[0].bonus_points} predicted
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="mt-32">
            <div className="thead">
              <span style={{ width: 26 }}>#</span>
              <span className="grow">Team</span>
              <span className="spark-head" style={{ width: 96 }}>Form</span>
              <span style={{ width: 46, textAlign: 'right' }}>GW{currentGw}</span>
              <span style={{ width: 58, textAlign: 'right' }}>Total</span>
            </div>
            <ul>
              {ranked.map(r => (
                <li key={r.member_id}>
                  {/* Your own row is the first thing anyone looks for in a
                      table, and "· you" in 12px grey is not findable at a
                      glance. Marking the row means you never have to read
                      the names to locate yourself. */}
                  <Link
                    className={`list-row${r.member_id === me.id ? ' is-you' : ''}`}
                    to={r.member_id === me.id
                      ? `/l/${league.id}/team`
                      : `/l/${league.id}/team/${r.member_id}`}>
                    {/* Position and total are the two numbers anyone reads a
                        table for, so they are the two that get set large. */}
                    <span className="figure" style={{
                      width: 26, fontSize: 21,
                      color: r.rank === 1 ? 'var(--gold)' : 'var(--fg-3)'
                    }}>{r.rank}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name truncate" style={{ display: 'block' }}>
                        {r.team_name}{r.member_id === me.id && <span className="tiny muted"> · you</span>}
                      </span>
                      <span className="tiny muted truncate">
                        {r.manager_name}
                        {r.bonus_points > 0 && ` · +${r.bonus_points} predicted`}
                      </span>
                    </span>
                    <Sparkline values={trend.get(r.member_id) ?? []} />
                    <span className="num small muted" style={{ width: 46, textAlign: 'right' }}>
                      {r.gw_points}
                    </span>
                    <span className="figure" style={{ width: 62, textAlign: 'right', fontSize: 21 }}>
                      {r.total_points}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {tied && (
            <div className="mt-16">
              <Notice>Managers on the same total are shown level — there’s no tiebreaker.</Notice>
            </div>
          )}

        </>
      )}

      <div className="mt-40">
        <Eyebrow>League activity</Eyebrow>
        {activity.length === 0 ? (
          <div className="empty">No moves yet. Signings and trades show up here.</div>
        ) : (
          <ul className="list">
            {activity.map(t => (
              <li key={t.id} className="list-row">
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="small truncate" style={{ display: 'block' }}>
                    <strong style={{ fontWeight: 600 }}>
                      {t.member_id ? nameOf.get(t.member_id) ?? 'A manager' : 'Commissioner'}
                    </strong>
                    {' '}{TXN_VERB[t.type]}{' '}
                    {t.player_in_id ? playerName.get(t.player_in_id) ?? `#${t.player_in_id}` : ''}
                    {t.player_out_id && t.type === 'add_drop'
                      ? <span className="muted">, dropped {playerName.get(t.player_out_id) ?? `#${t.player_out_id}`}</span>
                      : null}
                  </span>
                  {t.note && <span className="tiny muted">{t.note}</span>}
                </span>
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  {relativeTime(t.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

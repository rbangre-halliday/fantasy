import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { useToast } from '../lib/toast'
import { useLeague } from '../components/LeagueLayout'
import { Eyebrow, Loading, Notice, PageHead } from '../components/ui'
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

  useEffect(() => {
    Promise.all([
      api.getStandings(league.id),
      api.getTransactions(league.id, 40),
      api.getLeaguePlayers(league.id).catch(() => [] as LeaguePlayer[])
    ]).then(([s, t, p]) => { setRows(s); setTxns(t); setPlayers(p) }).catch(fail)
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

  return (
    <div className="page narrow">
      <PageHead
        title="Table"
        meta={`Official FPL points, counted from gameweek ${league.scoring_start_gw}.`} />

      {rows === null ? <Loading rows={6} /> : (
        <>
          <div>
            <div className="thead">
              <span style={{ width: 26 }}>#</span>
              <span className="grow">Team</span>
              <span style={{ width: 46, textAlign: 'right' }}>GW{currentGw}</span>
              <span style={{ width: 58, textAlign: 'right' }}>Total</span>
            </div>
            <ul>
              {ranked.map(r => (
                <li key={r.member_id}>
                  <Link
                    className="list-row"
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
                      <span className="tiny muted truncate">{r.manager_name}</span>
                    </span>
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

          {league.status === 'completed' && ranked[0] && (
            <div className="slab green mt-32">
              <h2 className="h2">{ranked[0].team_name}</h2>
              <p className="small muted mt-8">
                Champion · {ranked[0].manager_name} · {ranked[0].total_points} points
              </p>
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

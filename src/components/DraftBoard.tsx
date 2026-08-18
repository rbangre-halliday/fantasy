import type { DraftPick, LeaguePlayer, Member } from '../lib/types'

/**
 * The draft as a grid: managers across the top, rounds down the side, every
 * pick a cell.
 *
 * This is the artifact a draft actually produces, and it answers questions a
 * reverse-chronological feed cannot — who has taken what, how a squad is
 * shaping up, how long until it comes back round to you. The snake is visible
 * in the shape itself: read a round left to right, the next one right to left.
 *
 * A feed only ever shows you the last few picks, which is the least
 * interesting slice of it.
 */
export default function DraftBoard ({
  members, picks, players, currentPick, totalRounds, meId
}: {
  members: Member[]
  picks: DraftPick[]
  players: LeaguePlayer[] | null
  currentPick: number
  totalRounds: number
  meId: string
}) {
  // Draft order is the column order. Anyone without a slot yet sorts last so a
  // lobby-state board still renders something sane.
  const columns = [...members].sort(
    (a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99))
  const n = columns.length || 1

  const byId = new Map((players ?? []).map(p => [p.id, p]))
  // pick_number -> pick, so a cell is a lookup rather than a scan.
  const byNumber = new Map(picks.map(p => [p.pick_number, p]))

  /** The overall pick number at (round, column) under snake order. */
  const pickNumberAt = (round: number, col: number) => {
    const idx = round % 2 === 1 ? col : n - 1 - col      // reversed on even rounds
    return (round - 1) * n + idx + 1
  }

  /**
   * "2.2" — the pick's place within its round. Not the column index: on an
   * even round the first column picks last, so labelling by column had the
   * first cell of round two reading 2.1 when it was the round's second pick.
   */
  const label = (round: number, no: number) => `${round}.${no - (round - 1) * n}`

  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1)

  return (
    <div className="board-wrap">
      <table className="board">
        <thead>
          <tr>
            <th className="board-round" scope="col"><span className="visually-hidden">Round</span></th>
            {columns.map(m => (
              <th key={m.id} scope="col" className={m.id === meId ? 'is-you' : ''}>
                <span className="board-team truncate">{m.team_name}</span>
                <span className="board-manager truncate">
                  {m.id === meId ? 'you' : m.profiles?.name ?? ''}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map(round => (
            <tr key={round}>
              <th scope="row" className="board-round num">{round}</th>
              {columns.map((m, col) => {
                const no = pickNumberAt(round, col)
                const pick = byNumber.get(no)
                const player = pick ? byId.get(pick.player_id) : undefined
                const isNow = no === currentPick
                const cls = [
                  'board-cell',
                  pick && 'is-taken',
                  isNow && 'is-now',
                  m.id === meId && 'is-mine'
                ].filter(Boolean).join(' ')

                return (
                  <td key={m.id} className={cls}>
                    {pick ? (
                      <>
                        <span className="board-pick num">{label(round, no)}</span>
                        <span className="board-name truncate">
                          {player?.web_name ?? `#${pick.player_id}`}
                        </span>
                        <span className="board-meta">
                          {player && <span className={`pos ${player.position}`}>{player.position}</span>}
                          {pick.auto_pick && <span className="board-auto">auto</span>}
                        </span>
                      </>
                    ) : isNow ? (
                      <span className="board-now">On the clock</span>
                    ) : (
                      <span className="board-pick num board-faint">{label(round, no)}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

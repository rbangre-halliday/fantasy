export type Position = 'GK' | 'DEF' | 'MID' | 'FWD'
export type LeagueStatus = 'lobby' | 'drafting' | 'active' | 'completed'
/** live = two-minute clock with auto-pick; async = turn-based, no deadline. */
export type DraftMode = 'live' | 'async'
export type DraftStatus = 'pending' | 'running' | 'paused' | 'complete'
export type LineupStatus = 'starter' | 'substitute'
export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled'

/**
 * The squad floor: fifteen of the sixteen. The sixteenth is a flex and may go
 * anywhere, so there is no single "squad shape" any more — 3/5/5/3, 2/6/5/3,
 * 2/5/6/3 and 2/5/5/4 are all legal, and which one you hold is your business.
 */
export const POS_MIN: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 }
/** The most you could ever hold at one position — the floor plus the flex. */
export const POS_MAX: Record<Position, number> = { GK: 3, DEF: 6, MID: 6, FWD: 4 }
/**
 * The XI is a band rather than a shape: exactly one keeper, three to five
 * defenders, two to five midfielders, one to three forwards, eleven in all.
 * Eight formations — 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-2-3, 5-3-2, 5-4-1.
 *
 * Every one of them is playable out of every legal squad by construction, not
 * by luck: the ceilings sum to 1/5/5/3 and the squad floor is 2/5/5/3, so no
 * shape can ask for more of a position than a squad must hold. Which is why
 * nothing here ever has to say "you can't play that formation with this squad".
 *
 * Mirrors xi_min() and xi_max() in 19_flex_formations.sql.
 */
export const XI_MIN: Record<Position, number> = { GK: 1, DEF: 3, MID: 2, FWD: 1 }
export const XI_MAX: Record<Position, number> = { GK: 1, DEF: 5, MID: 5, FWD: 3 }
export const XI_SIZE = 11
export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD']
export const SQUAD_SIZE = 16

export type PosCount = Record<Position, number>

export const countByPos = (players: { position: Position }[]): PosCount =>
  players.reduce((c, p) => ({ ...c, [p.position]: c[p.position] + 1 }),
    { GK: 0, DEF: 0, MID: 0, FWD: 0 } as PosCount)

/**
 * Players held above the floor. This one number is the whole roster rule: a
 * squad can be completed to sixteen legal players exactly when it is 0 or 1.
 * (Fifteen floor slots and sixteen players, so holding t with f spent leaves
 * 15 - t + f floor slots for 16 - t picks, which needs f <= 1.) The server
 * computes the same thing in squad_flex_after(); this is only so the interface
 * can refuse a move before the server has to.
 */
export const flexUsed = (c: PosCount): number =>
  POSITIONS.reduce((n, p) => n + Math.max(0, c[p] - POS_MIN[p]), 0)

/** Could this squad take one more at this position? */
export const canAdd = (c: PosCount, pos: Position): boolean =>
  flexUsed({ ...c, [pos]: c[pos] + 1 }) <= 1

/** Would signing one and dropping the other leave a squad you may hold? */
export const canSwap = (c: PosCount, add: Position, drop: Position): boolean => {
  if (c[drop] <= 0) return false
  // Applied one after the other, not as two computed keys in one object
  // literal. `{ ...c, [drop]: c[drop] - 1, [add]: c[add] + 1 }` looks right and
  // silently loses the decrement whenever add and drop are the same position:
  // the later key wins, the squad reads one player heavier than it is, and
  // every like-for-like swap gets refused. Which is the one swap that is always
  // legal.
  const next = { ...c }
  next[drop] -= 1
  next[add] += 1
  return flexUsed(next) <= 1
}

/**
 * Slots to draw for a squad: the floor at every position, widened wherever the
 * flex has actually been spent. An incomplete squad draws fifteen and grows its
 * sixteenth slot the moment you commit the flex, which is the honest picture —
 * until then there is no telling which row it belongs in.
 */
export const squadShape = (c: PosCount): PosCount =>
  POSITIONS.reduce((s, p) => ({ ...s, [p]: Math.max(POS_MIN[p], c[p]) }),
    {} as PosCount)

/** Slots to draw for an XI: the shape it is in, never fewer than the floor. */
export const xiShape = (c: PosCount): PosCount =>
  POSITIONS.reduce((s, p) => ({ ...s, [p]: Math.max(XI_MIN[p], c[p]) }),
    {} as PosCount)

/** "3-5-2" — a formation the way it is said, the keeper taken as read. */
export const formationLabel = (c: PosCount): string => `${c.DEF}-${c.MID}-${c.FWD}`

/**
 * Every shape the band permits, fewest defenders first — 3-4-3, 3-5-2, 4-3-3,
 * 4-4-2, 4-5-1, 5-2-3, 5-3-2, 5-4-1.
 *
 * Enumerated from XI_MIN/XI_MAX rather than written out, so the list cannot
 * drift from the rule it illustrates: widen the band and the formations it
 * implies appear here, on the squad screen and in nothing else that has to be
 * remembered. The forward count is what is left over once the keeper, the
 * defenders and the midfielders are counted, which is why only two loops are
 * needed for three positions.
 */
export const FORMATIONS: PosCount[] = (() => {
  const out: PosCount[] = []
  for (let def = XI_MIN.DEF; def <= XI_MAX.DEF; def++) {
    for (let mid = XI_MIN.MID; mid <= XI_MAX.MID; mid++) {
      const fwd = XI_SIZE - XI_MIN.GK - def - mid
      if (fwd >= XI_MIN.FWD && fwd <= XI_MAX.FWD) {
        out.push({ GK: XI_MIN.GK, DEF: def, MID: mid, FWD: fwd })
      }
    }
  }
  return out
})()

/**
 * Can this bench player take that starter's place? Same position always can —
 * it cannot change the shape, which is why it is also the only swap a gameweek
 * already under way will accept. Across positions, the man going out has to
 * leave his position above its floor and the man coming on has to find his
 * below its ceiling. The server asks the same question in set_lineup() and,
 * for automatic substitutions, in member_gw_subs().
 */
export const canSubIn = (xi: PosCount, out: Position, into: Position): boolean =>
  out === into || (xi[out] - 1 >= XI_MIN[out] && xi[into] + 1 <= XI_MAX[into])

export interface League {
  id: string
  name: string
  commissioner_id: string
  invite_code: string
  status: LeagueStatus
  scoring_start_gw: number
  max_managers: number
  pick_seconds: number
  draft_mode: DraftMode
  created_at: string
}

export interface Member {
  id: string
  league_id: string
  user_id: string
  team_name: string
  draft_position: number | null
  joined_at: string
  profiles?: { name: string } | null
}

export interface Draft {
  id: string
  league_id: string
  status: DraftStatus
  current_round: number
  current_pick: number
  current_member_id: string | null
  pick_deadline: string | null
  paused_remaining_ms: number | null
  total_rounds: number
}

export interface DraftPick {
  id: string
  round: number
  pick_number: number
  member_id: string
  player_id: number
  auto_pick: boolean
  created_at: string
}

/** Row shape of the league_players() RPC. */
export interface LeaguePlayer {
  id: number
  web_name: string
  first_name: string | null
  second_name: string | null
  position: Position
  team_id: number | null
  club: string | null
  club_short: string | null
  prev_season_points: number
  current_season_points: number
  status: string | null
  news: string | null
  owner_member_id: string | null
  owner_team_name: string | null
  locked: boolean
}

/**
 * One line of FPL's own itemisation of a score: "goals_scored, value 2, points
 * 8". Stored raw, so the app never has to hold a copy of the scoring rules.
 */
export interface PointsItem {
  identifier: string
  points: number
  value: number
}

/** Row shape of the member_squad() RPC. */
export interface SquadPlayer {
  player_id: number
  web_name: string
  position: Position
  club_short: string | null
  lineup_status: LineupStatus | null
  bench_priority: number | null
  gw_points: number
  minutes: number
  total_points: number
  locked: boolean
  kickoff: string | null
  status: string | null
  news: string | null
  /** This gameweek's opponent — not the club's next fixture. Null on a blank. */
  opp_short: string | null
  is_home: boolean | null
  /** 0 on a blank gameweek, 2 on a double. */
  fixture_count: number
  /** One entry per fixture played, or null until the sync job has been by. */
  breakdown: { fixture: number; stats: PointsItem[] }[] | null
  /** A starter whose gameweek ended with no minutes, replaced off the bench. */
  subbed_out: boolean
  /** A substitute the bench order brought on for one of them. */
  subbed_in: boolean
  /** The other half of that pair — who came on for him, or who he came on for. */
  sub_partner: number | null
}

export interface Standing {
  member_id: string
  user_id: string
  team_name: string
  manager_name: string
  /** Points from the squad alone. */
  squad_points: number
  /** The table-prediction bonus, already included in total_points. */
  bonus_points: number
  total_points: number
  gw_points: number
}

/** A row of the real Premier League table, from the epl_table view. */
export interface TableTeam {
  team_id: number
  name: string
  short_name: string
  code: number | null
  played: number
  points: number
  goal_diff: number
  scored: number
  position: number
}

/** One club in a manager's predicted order, beside where it actually sits. */
export interface PredictionRow {
  team_id: number
  name: string
  short_name: string
  code: number | null
  predicted_pos: number
  actual_pos: number
  played: number
  points: number
  /** predicted - actual: negative means the club is doing better than you said. */
  delta: number
}

/** Row shape of league_predictions(): how everyone's guess is going. */
export interface PredictionStanding {
  member_id: string
  team_name: string
  manager_name: string
  submitted: boolean
  error: number | null
  bonus: number
  revealed: boolean
}

export interface Trade {
  id: string
  league_id: string
  proposer_id: string
  receiver_id: string
  status: TradeStatus
  created_at: string
  resolved_at: string | null
}

export interface TradePlayerRow {
  id: string
  trade_id: string
  player_id: number
  from_member: string
  to_member: string
}

export interface Txn {
  id: string
  member_id: string | null
  type: 'draft' | 'add' | 'drop' | 'add_drop' | 'trade' | 'commissioner'
  player_in_id: number | null
  player_out_id: number | null
  note: string | null
  created_at: string
}

/** Row shape of free_agent_moves(): one signing, with both players named. */
export interface Move {
  id: string
  member_id: string | null
  team_name: string | null
  manager_name: string | null
  in_id: number | null
  in_name: string | null
  in_pos: Position | null
  in_club: string | null
  in_code: number | null
  out_id: number | null
  out_name: string | null
  out_pos: Position | null
  out_club: string | null
  out_code: number | null
  created_at: string
}

export interface Gameweek {
  id: number
  name: string
  deadline: string
  is_current: boolean
  is_next: boolean
  finished: boolean
}

export interface Message {
  id: string
  league_id: string
  member_id: string
  body: string
  created_at: string
}

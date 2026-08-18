export type Position = 'GK' | 'DEF' | 'MID' | 'FWD'
export type LeagueStatus = 'lobby' | 'drafting' | 'active' | 'completed'
/** live = two-minute clock with auto-pick; async = turn-based, no deadline. */
export type DraftMode = 'live' | 'async'
export type DraftStatus = 'pending' | 'running' | 'paused' | 'complete'
export type LineupStatus = 'starter' | 'substitute'
export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled'

/** Squad shape and starting XI — the two numbers the whole game hangs off. */
export const SQUAD_CAPS: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 4 }
export const XI_SHAPE: Record<Position, number> = { GK: 1, DEF: 4, MID: 4, FWD: 2 }
export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD']
export const SQUAD_SIZE = 16

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
}

export interface Standing {
  member_id: string
  user_id: string
  team_name: string
  manager_name: string
  total_points: number
  gw_points: number
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

export interface Gameweek {
  id: number
  name: string
  deadline: string
  is_current: boolean
  is_next: boolean
  finished: boolean
}

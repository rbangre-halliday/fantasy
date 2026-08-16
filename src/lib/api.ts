import { supabase } from './supabase'
import type {
  Draft, DraftPick, Gameweek, League, LeaguePlayer, Member,
  SquadPlayer, Standing, Trade, TradePlayerRow, Txn
} from './types'

/** Unwrap a PostgREST result, throwing the server's own message on failure. */
async function ok<T> (p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  ok(supabase.rpc(fn, args) as never)

// ------------------------------------------------------------------ reads --

export const getGameweeks = () =>
  ok<Gameweek[]>(supabase.from('gameweeks').select('*').order('id'))

// Selecting leagues directly is already scoped to the ones you belong to by the
// leagues_read RLS policy. Going via league_members instead would return one
// row per *manager* in each league - the same league repeated - because that
// table's policy exposes every membership row in a league you're part of.
export const getMyLeagues = () =>
  ok<League[]>(supabase.from('leagues').select('*').order('created_at'))

export const getLeague = (id: string) =>
  ok<League>(supabase.from('leagues').select('*').eq('id', id).single())

export const getMembers = (leagueId: string) =>
  ok<Member[]>(
    supabase.from('league_members')
      .select('*, profiles(name)')
      .eq('league_id', leagueId)
      .order('draft_position', { ascending: true, nullsFirst: false })
      .order('joined_at')
  )

export const getDraft = async (leagueId: string): Promise<Draft | null> =>
  ok<Draft | null>(
    supabase.from('drafts').select('*').eq('league_id', leagueId).maybeSingle()
  )

export const getPicks = (leagueId: string) =>
  ok<DraftPick[]>(
    supabase.from('draft_picks').select('*')
      .eq('league_id', leagueId).order('pick_number')
  )

export const getLeaguePlayers = (leagueId: string) =>
  rpc('league_players', { p_league: leagueId }) as Promise<LeaguePlayer[]>

export const getSquad = (memberId: string, gw: number) =>
  rpc('member_squad', { p_member: memberId, p_gw: gw }) as Promise<SquadPlayer[]>

export const getStandings = (leagueId: string) =>
  ok<Standing[]>(
    supabase.from('league_standings').select('*')
      .eq('league_id', leagueId)
      .order('total_points', { ascending: false })
  )

export const getTrades = (leagueId: string) =>
  ok<Trade[]>(
    supabase.from('trades').select('*')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
  )

export const getTradePlayers = (leagueId: string) =>
  ok<TradePlayerRow[]>(
    supabase.from('trade_players')
      .select('*, trades!inner(league_id)')
      .eq('trades.league_id', leagueId)
  )

export const getTransactions = (leagueId: string, limit = 60) =>
  ok<Txn[]>(
    supabase.from('transactions').select('*')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(limit)
  )

export const currentGw = () => rpc('current_gw') as Promise<number>
export const nextGw    = () => rpc('next_gw')    as Promise<number>

/** Milliseconds to add to Date.now() to get the database's clock. */
export async function clockOffset (): Promise<number> {
  const before = Date.now()
  const iso = await rpc('server_now') as unknown as string
  const rtt = Date.now() - before
  return new Date(iso).getTime() + rtt / 2 - Date.now()
}

// ----------------------------------------------------------------- writes --

export const createLeague = (name: string, teamName: string) =>
  rpc('create_league', { p_name: name, p_team_name: teamName }) as Promise<string>

export const joinLeague = (code: string, teamName: string) =>
  rpc('join_league', { p_code: code, p_team_name: teamName }) as Promise<string>

export const renameTeam = (leagueId: string, teamName: string) =>
  rpc('rename_team', { p_league: leagueId, p_team_name: teamName })

export const leaveLeague  = (leagueId: string) => rpc('leave_league',  { p_league: leagueId })
export const deleteLeague = (leagueId: string) => rpc('delete_league', { p_league: leagueId })

export const removeManager = (leagueId: string, memberId: string) =>
  rpc('remove_manager', { p_league: leagueId, p_member: memberId })

export const startDraft   = (leagueId: string) => rpc('start_draft',    { p_league: leagueId })
export const pauseDraft   = (leagueId: string) => rpc('pause_draft',    { p_league: leagueId })
export const resumeDraft  = (leagueId: string) => rpc('resume_draft',   { p_league: leagueId })
export const undoLastPick = (leagueId: string) => rpc('undo_last_pick', { p_league: leagueId })
export const draftTick    = (leagueId: string) => rpc('draft_tick',     { p_league: leagueId })

export const makePick = (leagueId: string, playerId: number) =>
  rpc('make_pick', { p_league: leagueId, p_player: playerId })

export const setLineup = (leagueId: string, gw: number, starters: number[], bench: number[]) =>
  rpc('set_lineup', { p_league: leagueId, p_gw: gw, p_starters: starters, p_bench: bench })

export const ensureLineup = (memberId: string, gw: number) =>
  rpc('ensure_lineup', { p_member: memberId, p_gw: gw })

export const addDrop = (leagueId: string, addId: number, dropId: number) =>
  rpc('add_drop', { p_league: leagueId, p_add: addId, p_drop: dropId })

export const proposeTrade = (leagueId: string, receiver: string, offer: number[], request: number[]) =>
  rpc('propose_trade', {
    p_league: leagueId, p_receiver: receiver, p_offer: offer, p_request: request
  }) as Promise<string>

export const respondTrade = (tradeId: string, accept: boolean) =>
  rpc('respond_trade', { p_trade: tradeId, p_accept: accept })

export const cancelTrade = (tradeId: string) => rpc('cancel_trade', { p_trade: tradeId })

export const commishMovePlayer = (leagueId: string, playerId: number, toMember: string | null) =>
  rpc('commish_move_player', { p_league: leagueId, p_player: playerId, p_to_member: toMember })

export const commishReverseTrade = (tradeId: string) =>
  rpc('commish_reverse_trade', { p_trade: tradeId })

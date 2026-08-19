-- ============================================================================
--  Free agency, made visible.
--
--  Signings already left a row in `transactions`, but the only place they
--  surfaced was a mixed activity feed at the bottom of the table screen. The
--  market is first come, first served: who just signed whom, and who has just
--  been dropped back into the pool, are the two things a manager on the
--  players screen actually needs — and they need them without a refresh.
--
--  Safe to run more than once.
-- ============================================================================

-- One round trip for the feed: the move, who made it, and both players with
-- their clubs. Doing this client-side meant three lookups against a 600-row
-- player list for every line.
create or replace function free_agent_moves(p_league uuid, p_limit int default 20)
returns table (
  id           uuid,
  member_id    uuid,
  team_name    text,
  manager_name text,
  in_id        int,
  in_name      text,
  in_pos       player_pos,
  in_club      text,
  in_code      int,
  out_id       int,
  out_name     text,
  out_pos      player_pos,
  out_club     text,
  out_code     int,
  created_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    t.id, t.member_id, m.team_name, pr.name,
    pin.id, pin.web_name, pin.position, tin.short_name, tin.code,
    pout.id, pout.web_name, pout.position, tout.short_name, tout.code,
    t.created_at
  from transactions t
  left join league_members m   on m.id = t.member_id
  left join profiles pr        on pr.id = m.user_id
  left join epl_players pin    on pin.id = t.player_in_id
  left join epl_teams   tin    on tin.id = pin.team_id
  left join epl_players pout   on pout.id = t.player_out_id
  left join epl_teams   tout   on tout.id = pout.team_id
  where t.league_id = p_league
    and t.type in ('add', 'drop', 'add_drop')
    and is_league_member(p_league)
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function free_agent_moves(uuid, int) to authenticated;

-- A signing anyone can see a minute late is a signing they lost. The players
-- screen already watches roster_players for ownership; this is what carries
-- the *story* of the move — who did it, and what they dropped to do it.
do $$ begin
  execute 'alter publication supabase_realtime add table transactions';
exception when duplicate_object then null; end $$;

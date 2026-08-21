-- ============================================================================
--  A gameweek's squad, told about that gameweek.
--
--  The squad screen has a gameweek switch, but three of the things it showed
--  ignored it. The opponent came from a client-side "next unfinished fixture"
--  lookup, so a GW1 row printed GW1's kick-off time beside GW2's opponent. The
--  lock came from is_player_locked(), which only ever asks about the *live*
--  gameweek — so a player whose GW1 match had started showed as locked, and was
--  refused by set_lineup, while you were editing your GW2 XI. And a points
--  total with nothing behind it is a number you have to trust: FPL publishes the
--  itemised breakdown on the same payload we already read, and we were throwing
--  it away.
--
--  So: locking takes a gameweek, member_squad answers for the gameweek it was
--  asked about, and player_gw_points keeps the breakdown.
--
--  Safe to run more than once. Supersedes the member_squad and set_lineup in
--  03_functions.sql.
-- ============================================================================

-- FPL's own itemisation of a score: [{fixture, stats:[{identifier, points,
-- value}]}], one entry per fixture the player had that gameweek. Storing it raw
-- means the app never has to know the scoring rules — which change between
-- seasons — to show how a score was arrived at.
alter table player_gw_points add column if not exists breakdown jsonb;

-- ---------------------------------------------------------------- locking ---

-- Has this player's match in *this* gameweek kicked off?
--
-- A future gameweek is never locked, and a finished one always is: you cannot
-- rewrite a lineup for matches that have been played. The one-argument version
-- above this keeps its own meaning — "locked right now, in the live gameweek" —
-- because that is the right question for signings and trades, which happen in
-- the present tense.
create or replace function is_player_locked(p_player int, p_gw int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from fixtures f
    join epl_players p on p.id = p_player
    where f.gw = p_gw
      and (f.home_team = p.team_id or f.away_team = p.team_id)
      and (f.started or (f.kickoff is not null and f.kickoff <= now()))
  );
$$;

grant execute on function is_player_locked(int,int) to authenticated;

-- --------------------------------------------------------------- lineups ---

-- Unchanged but for the lock check, which now asks about p_gw rather than the
-- live gameweek. Editing next week's XI was being refused because this week's
-- matches had started.
create or replace function set_lineup(p_league uuid, p_gw int, p_starters int[], p_bench int[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; pos player_pos; c int; pid int; i int; old_status lineup_status;
begin
  me := assert_member(p_league);

  if array_length(p_starters, 1) <> 11 then raise exception 'You must start exactly 11 players.'; end if;
  if array_length(p_bench, 1) <> 5      then raise exception 'You must bench exactly 5 players.'; end if;

  if exists (select 1 from unnest(p_starters || p_bench) x
             where not exists (select 1 from roster_players r
                                where r.member_id = me and r.player_id = x)) then
    raise exception 'That player is not in your squad.';
  end if;

  if (select count(distinct x) from unnest(p_starters || p_bench) x) <> 16 then
    raise exception 'Duplicate players in the lineup.';
  end if;

  foreach pos in array array['GK','DEF','MID','FWD']::player_pos[] loop
    select count(*) into c from unnest(p_starters) x
     join epl_players p on p.id = x where p.position = pos;
    if c <> pos_start(pos) then
      raise exception 'A valid XI is 1 GK, 4 DEF, 4 MID, 2 FWD — you have % %.', c, pos;
    end if;
  end loop;

  -- A player whose match in this gameweek has kicked off cannot change status.
  foreach pid in array (p_starters || p_bench) loop
    select status into old_status from lineups
     where member_id = me and gw = p_gw and player_id = pid;
    if old_status is not null and is_player_locked(pid, p_gw) then
      if (old_status = 'starter') <> (pid = any(p_starters)) then
        raise exception 'That player''s match has already started.';
      end if;
    end if;
  end loop;

  delete from lineups where member_id = me and gw = p_gw;

  insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
  select p_league, me, p_gw, x, 'starter', null from unnest(p_starters) x;

  i := 0;
  foreach pid in array p_bench loop
    i := i + 1;
    insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
    values (p_league, me, p_gw, pid, 'substitute', i);
  end loop;
end $$;

grant execute on function set_lineup(uuid,int,int[],int[]) to authenticated;

-- -------------------------------------------------------------- read API ---

-- The squad for one gameweek: lineup, points, availability, and — new here —
-- that gameweek's own fixture and the itemised score behind the total.
--
-- The fixture and the kick-off time now come out of the same row, so they can
-- no longer disagree with each other. A double gameweek reports the first match
-- and how many there are; a blank one reports nothing, which is the truth.
drop function if exists member_squad(uuid, int);

create function member_squad(p_member uuid, p_gw int)
returns table (
  player_id int, web_name text, "position" player_pos, club_short text,
  lineup_status lineup_status, bench_priority int,
  gw_points int, minutes int, total_points int, locked boolean,
  kickoff timestamptz, status text, news text,
  opp_short text, is_home boolean, fixture_count int, breakdown jsonb
)
language sql stable security definer set search_path = public as $$
  select p.id, p.web_name, p.position, t.short_name,
         ln.status, ln.bench_priority,
         coalesce(pts.points, 0), coalesce(pts.minutes, 0),
         p.current_season_points,
         is_player_locked(p.id, p_gw),
         fx.kickoff, p.status, p.news,
         fx.opp, fx.is_home, coalesce(fx.n, 0), pts.breakdown
  from roster_players r
  join epl_players p on p.id = r.player_id
  left join epl_teams t on t.id = p.team_id
  left join lineups ln on ln.member_id = r.member_id and ln.gw = p_gw and ln.player_id = p.id
  left join player_gw_points pts on pts.player_id = p.id and pts.gw = p_gw
  left join lateral (
    select min(f.kickoff) as kickoff,
           count(*)::int  as n,
           (array_agg(opp.short_name order by f.kickoff nulls last))[1]      as opp,
           (array_agg(f.home_team = p.team_id order by f.kickoff nulls last))[1] as is_home
    from fixtures f
    join epl_teams opp
      on opp.id = case when f.home_team = p.team_id then f.away_team else f.home_team end
    where f.gw = p_gw and (f.home_team = p.team_id or f.away_team = p.team_id)
  ) fx on true
  where r.member_id = p_member
    and is_league_member(r.league_id)
  order by
    case p.position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
    (ln.status = 'starter') desc nulls last, ln.bench_priority nulls last,
    p.prev_season_points desc;
$$;

grant execute on function member_squad(uuid,int) to authenticated;

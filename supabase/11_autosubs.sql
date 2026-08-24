-- ============================================================================
--  Automatic substitutions: when they happen, and who can see them.
--
--  Three separate faults, one subject.
--
--  1. Subs fired before the player had kicked off. member_gw_score() read
--     "zero minutes" as "didn't play", but a starter whose match is still to
--     come also has zero minutes. GW1 had João Pedro subbed out on the Sunday
--     for a Monday night kick-off, and the bench slot spent on him. The rule
--     the rules page states is "once the gameweek's results land", so the test
--     has to be "his match is over and he has no minutes", not "no minutes".
--
--     The flag for that is not fixtures.finished: FPL leaves that false until
--     bonus is confirmed, so nine played GW1 fixtures still said false two days
--     later. finished_provisional is the one that means the whistle has gone,
--     and we weren't storing it.
--
--  2. The squad screen didn't apply subs at all — it summed the eleven
--     starters, so it read 48 where the table read 61 for the same team and
--     gameweek. The substitution existed only inside a scoring function that
--     returned one integer, so nothing else could show it. It is now a
--     relation, member_gw_subs(), and both the score and the screen are read
--     off it: they cannot disagree again.
--
--  3. recompute_scores() re-ran ensure_lineup() over *finished* gameweeks.
--     ensure_lineup drops lineup rows for players no longer on the roster and
--     backfills from the current squad — so the first free agent signing would
--     have quietly rewritten every past gameweek's XI and rescored it. Past
--     gameweeks are now left alone unless they have no lineup at all.
--
--  Safe to re-run. Supersedes member_gw_score, recompute_scores and
--  member_squad as they stand in 03_functions.sql / 10_player_detail.sql.
-- ============================================================================

-- ---------------------------------------------------------------- fixtures ---

-- FPL's fixture.finished flips only once bonus points are confirmed, which can
-- be a day after the match. finished_provisional flips at full time. For "has
-- this player finished playing this gameweek" the second is the honest one.
alter table fixtures add column if not exists finished_provisional boolean not null default false;

-- Has this player got no football left this gameweek? True when every fixture
-- his club has in the gameweek is over — and true for a blank gameweek, where
-- there was never any to come.
create or replace function player_gw_done(p_player int, p_gw int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from fixtures f
    join epl_players p on p.id = p_player
    where f.gw = p_gw
      and (f.home_team = p.team_id or f.away_team = p.team_id)
      and not (f.finished or f.finished_provisional)
  );
$$;

grant execute on function player_gw_done(int,int) to authenticated;

-- ------------------------------------------------------------ the subs ------

-- Which substitutions this manager's bench makes in this gameweek, as pairs.
--
-- A starter is replaced when his gameweek is over and he played no part in it.
-- The replacement is the highest-priority substitute in the same position who
-- actually played, and each substitute can only come on once — so the walk is
-- ordered, and the order is fixed (GK, DEF, MID, FWD, then player id) rather
-- than left to whatever the planner returns. The totals were the same either
-- way, but the *pairs* are shown on screen now, and a screen that reshuffles
-- itself between two identical loads is a bug report waiting to happen.
create or replace function member_gw_subs(p_member uuid, p_gw int)
returns table (out_player int, in_player int)
language plpgsql stable security definer set search_path = public as $$
declare
  used int[] := '{}';
  st   record;
  sub  record;
begin
  for st in
    select ln.player_id, p.position
    from lineups ln
    join epl_players p on p.id = ln.player_id
    left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
      and coalesce(pts.minutes, 0) = 0
      and player_gw_done(ln.player_id, p_gw)
    order by case p.position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
             ln.player_id
  loop
    -- An inner join on the points row: a substitute with no row at all has not
    -- played, whatever else is true of him.
    select ln.player_id as pid into sub
    from lineups ln
    join epl_players p on p.id = ln.player_id
    join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'substitute'
      and p.position = st.position
      and pts.minutes > 0
      and not (ln.player_id = any(used))
    order by ln.bench_priority nulls last, ln.player_id
    limit 1;

    if found then
      used       := used || sub.pid;
      out_player := st.player_id;
      in_player  := sub.pid;
      return next;
    end if;
    -- else: nobody qualifies, and the slot keeps its nil.
  end loop;
end $$;

grant execute on function member_gw_subs(uuid,int) to authenticated;

-- The gameweek score: the starting XI, with the substitutions above applied.
-- Defined in terms of member_gw_subs so the number and the screen are the same
-- answer to the same question.
create or replace function member_gw_score(p_member uuid, p_gw int)
returns int language sql stable security definer set search_path = public as $$
  with subs as (select * from member_gw_subs(p_member, p_gw))
  select coalesce(sum(pts), 0)::int from (
    select coalesce(pt.points, 0) as pts
      from lineups ln
      left join player_gw_points pt on pt.player_id = ln.player_id and pt.gw = p_gw
     where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
       and ln.player_id not in (select out_player from subs)
    union all
    select coalesce(pt.points, 0)
      from subs s
      left join player_gw_points pt on pt.player_id = s.in_player and pt.gw = p_gw
  ) x;
$$;

-- ------------------------------------------------------------ recompute -----

-- As before, except that a gameweek already played is not re-materialised.
--
-- ensure_lineup() answers "what should this manager's XI be, given the squad he
-- has now" — which is the right question for this week and next week, and the
-- wrong one for a week that has been played. Running it over history meant the
-- moment somebody dropped a player, that player left every past lineup he was
-- in and the weeks he had scored in were rescored without him. A past gameweek
-- is only touched when it has no lineup at all, where a reconstruction from the
-- current squad beats scoring it as a nil.
create or replace function recompute_scores()
returns void language plpgsql security definer set search_path = public as $$
declare m record; g int; live int;
begin
  live := current_gw();

  for m in
    select lm.id as member_id, lm.league_id, l.scoring_start_gw
    from league_members lm
    join leagues l on l.id = lm.league_id
    where l.status in ('active','completed')
  loop
    for g in
      select distinct gw from player_gw_points where gw >= m.scoring_start_gw
    loop
      if g >= live or not exists (
           select 1 from lineups where member_id = m.member_id and gw = g) then
        perform ensure_lineup(m.member_id, g);
      end if;

      insert into member_gw_scores (league_id, member_id, gw, points)
      values (m.league_id, m.member_id, g, member_gw_score(m.member_id, g))
      on conflict (member_id, gw) do update set points = excluded.points;
    end loop;
  end loop;

  update leagues set status = 'completed'
   where status = 'active'
     and not exists (select 1 from gameweeks where not finished);
end $$;

-- ------------------------------------------------------------ read API ------

-- The squad for one gameweek, now saying which two players the automatic
-- substitution moved.
--
-- The player set also comes from the lineup for a gameweek already played,
-- rather than from today's roster. Those were the same list until the recompute
-- fix above stopped evicting departed players from history; now a manager who
-- has since sold a striker can still open the week that striker scored in and
-- find him there, which is what the score he was paid says happened.
drop function if exists member_squad(uuid, int);

create function member_squad(p_member uuid, p_gw int)
returns table (
  player_id int, web_name text, "position" player_pos, club_short text,
  lineup_status lineup_status, bench_priority int,
  gw_points int, minutes int, total_points int, locked boolean,
  kickoff timestamptz, status text, news text,
  opp_short text, is_home boolean, fixture_count int, breakdown jsonb,
  subbed_out boolean, subbed_in boolean, sub_partner int
)
language sql stable security definer set search_path = public as $$
  with base as (
    select ln.player_id, ln.league_id
      from lineups ln
     where ln.member_id = p_member and ln.gw = p_gw
    union
    select r.player_id, r.league_id
      from roster_players r
     where r.member_id = p_member and p_gw >= current_gw()
  ),
  subs as (select * from member_gw_subs(p_member, p_gw))
  select p.id, p.web_name, p.position, t.short_name,
         ln.status, ln.bench_priority,
         coalesce(pts.points, 0), coalesce(pts.minutes, 0),
         p.current_season_points,
         is_player_locked(p.id, p_gw),
         fx.kickoff, p.status, p.news,
         fx.opp, fx.is_home, coalesce(fx.n, 0), pts.breakdown,
         exists (select 1 from subs s where s.out_player = p.id),
         exists (select 1 from subs s where s.in_player  = p.id),
         -- The other half of the pair, either way round. "On for Pedro Porro"
         -- is a substitution; "on" on its own is a badge.
         coalesce((select s.in_player  from subs s where s.out_player = p.id),
                  (select s.out_player from subs s where s.in_player  = p.id))
  from base b
  join epl_players p on p.id = b.player_id
  left join epl_teams t on t.id = p.team_id
  left join lineups ln on ln.member_id = p_member and ln.gw = p_gw and ln.player_id = p.id
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
  where is_league_member(b.league_id)
  order by
    case p.position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
    (ln.status = 'starter') desc nulls last, ln.bench_priority nulls last,
    p.prev_season_points desc;
$$;

grant execute on function member_squad(uuid,int) to authenticated;

-- ============================================================================
--  Automatic substitutions that can actually cover a blank.
--
--  Three things were wrong.
--
--  1. Same position only. The squad caps (2/5/5/4) and the fixed XI (1/4/4/2)
--     leave a bench of exactly one GK, one DEF, one MID and two FWD. So "same
--     position only" means a defender who doesn't play is covered by precisely
--     one man, and if he didn't play either the slot takes a nil — while a
--     substitute forward who hauled sits there unused. Half the time the rule
--     had nothing to work with. It now follows FPL's own rule: the bench is
--     walked in priority order and the first man who keeps the XI legal comes
--     on. Legal is one keeper, three at the back, two in midfield, one up top.
--
--  2. Substitutions ran live. The trigger was `minutes = 0` and nothing else,
--     so a starter kicking off on Monday night looked exactly like a starter
--     who was dropped: from Saturday lunchtime he was substituted, and on
--     Monday he was substituted back. Totals moved in both directions all
--     weekend. A starter is now only replaced once he has no unplayed fixture
--     left in the gameweek, which is what the rulebook already promised.
--
--  3. Nothing said a substitution had happened. The squad screen added up the
--     eleven names on the pitch, so it disagreed with the league table and
--     gave a manager no way to see his bench had covered for him.
--
--  The scoring rule now lives in one place — member_gw_xi() returns the eleven
--  slots and who actually scored each one. member_gw_score() sums it and
--  member_squad() joins to it, so the number on the squad screen and the
--  number in the table cannot drift apart again.
--
--  Safe to run more than once. Supersedes member_gw_score and member_squad.
-- ============================================================================

-- ------------------------------------------------------------- formation ---

-- FPL's floors, in one place. A substitution may leave the XI in any shape
-- that satisfies these; it may not leave it in one that doesn't.
create or replace function xi_legal(p_gk int, p_def int, p_mid int, p_fwd int)
returns boolean language sql immutable as $$
  select p_gk = 1 and p_def >= 3 and p_mid >= 2 and p_fwd >= 1
     and p_gk + p_def + p_mid + p_fwd = 11;
$$;

-- Has this player's gameweek finished? A man whose club still has a match to
-- play in this gameweek might yet appear, so zero minutes doesn't mean he was
-- left out. A blank gameweek settles immediately: there is no match coming.
create or replace function player_gw_settled(p_player int, p_gw int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from fixtures f
    join epl_players p on p.id = p_player
    where f.gw = p_gw
      and (f.home_team = p.team_id or f.away_team = p.team_id)
      and not f.finished
  );
$$;

-- ------------------------------------------------------------------- the XI ---

-- The eleven scoring slots for one manager in one gameweek, after automatic
-- substitutions. One row per slot: the man who was picked, the man who ends up
-- scoring it (the same man, unless he was replaced), and the points.
--
-- Two passes over the vacancies, and the order matters. The first fills each
-- one from the bench in the same position, which can never change the shape —
-- so a like-for-like cover is never spent on a slot that a cross-position
-- substitute could have taken. Only then does the second pass go looking
-- outside the position, and only where the shape survives it.
create or replace function member_gw_xi(p_member uuid, p_gw int)
returns table (slot_player_id int, scoring_player_id int, points int)
language plpgsql stable security definer set search_path = public as $$
declare
  st      record;
  cand    record;
  used    int[]  := '{}';       -- substitutes already brought on
  vac_id  int[]  := '{}';       -- starters needing cover, null once covered
  vac_pos text[] := '{}';
  n_gk int := 0; n_def int := 0; n_mid int := 0; n_fwd int := 0;
  c_gk int; c_def int; c_mid int; c_fwd int;
  i int;
begin
  for st in
    select ln.player_id, p.position::text as position,
           coalesce(pts.points, 0)  as points,
           coalesce(pts.minutes, 0) as minutes,
           player_gw_settled(ln.player_id, p_gw) as settled
    from lineups ln
    join epl_players p on p.id = ln.player_id
    left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
    order by ln.player_id
  loop
    -- The picked XI is the shape we start from, and an uncovered slot keeps
    -- its man, so these counts hold whatever happens below.
    case st.position
      when 'GK'  then n_gk  := n_gk  + 1;
      when 'DEF' then n_def := n_def + 1;
      when 'MID' then n_mid := n_mid + 1;
      else            n_fwd := n_fwd + 1;
    end case;

    if st.minutes > 0 or not st.settled then
      -- He played, or he still might. Either way the slot is his.
      slot_player_id := st.player_id; scoring_player_id := st.player_id;
      points := st.points;
      return next;
    else
      vac_id  := vac_id  || st.player_id;
      vac_pos := vac_pos || st.position;
    end if;
  end loop;

  -- Pass one: like for like. The shape cannot change, so no legality check.
  for i in 1 .. coalesce(array_length(vac_id, 1), 0) loop
    select ln.player_id, coalesce(pts.points, 0) as points into cand
    from lineups ln
    join epl_players p on p.id = ln.player_id
    left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'substitute'
      and p.position::text = vac_pos[i]
      and coalesce(pts.minutes, 0) > 0
      and not (ln.player_id = any(used))
    order by ln.bench_priority nulls last, ln.player_id
    limit 1;

    if found then
      used := used || cand.player_id;
      slot_player_id := vac_id[i]; scoring_player_id := cand.player_id;
      points := cand.points;
      return next;
      vac_id[i] := null;
    end if;
  end loop;

  -- Pass two: anyone on the bench who played, in bench order, provided the XI
  -- he leaves behind is one a manager could have picked.
  for i in 1 .. coalesce(array_length(vac_id, 1), 0) loop
    continue when vac_id[i] is null;

    for cand in
      select ln.player_id, p.position::text as position,
             coalesce(pts.points, 0) as points
      from lineups ln
      join epl_players p on p.id = ln.player_id
      left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
      where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'substitute'
        and coalesce(pts.minutes, 0) > 0
        and not (ln.player_id = any(used))
      order by ln.bench_priority nulls last, ln.player_id
    loop
      c_gk  := n_gk  - (case when vac_pos[i] = 'GK'  then 1 else 0 end)
                     + (case when cand.position = 'GK'  then 1 else 0 end);
      c_def := n_def - (case when vac_pos[i] = 'DEF' then 1 else 0 end)
                     + (case when cand.position = 'DEF' then 1 else 0 end);
      c_mid := n_mid - (case when vac_pos[i] = 'MID' then 1 else 0 end)
                     + (case when cand.position = 'MID' then 1 else 0 end);
      c_fwd := n_fwd - (case when vac_pos[i] = 'FWD' then 1 else 0 end)
                     + (case when cand.position = 'FWD' then 1 else 0 end);

      if xi_legal(c_gk, c_def, c_mid, c_fwd) then
        n_gk := c_gk; n_def := c_def; n_mid := c_mid; n_fwd := c_fwd;
        used := used || cand.player_id;
        slot_player_id := vac_id[i]; scoring_player_id := cand.player_id;
        points := cand.points;
        return next;
        vac_id[i] := null;
        exit;
      end if;
    end loop;
  end loop;

  -- Whatever is left found nobody: the slot keeps its man and his nil.
  for i in 1 .. coalesce(array_length(vac_id, 1), 0) loop
    continue when vac_id[i] is null;
    slot_player_id := vac_id[i]; scoring_player_id := vac_id[i];
    points := 0;
    return next;
  end loop;
end $$;

-- --------------------------------------------------------------- scoring ---

-- A manager's points for one gameweek: the eleven slots, added up.
create or replace function member_gw_score(p_member uuid, p_gw int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int from member_gw_xi(p_member, p_gw);
$$;

-- -------------------------------------------------------------- read API ---

-- The squad for one gameweek, now including what the substitution rule did to
-- it: which starter it took off, and which substitute it brought on. Unchanged
-- otherwise.
--
-- member_gw_xi is deliberately not granted to clients — it answers for any
-- member id it is handed. It is reached through here, which checks the league
-- first, and through recompute_scores, which is the service role's.
drop function if exists member_squad(uuid, int);

create function member_squad(p_member uuid, p_gw int)
returns table (
  player_id int, web_name text, "position" player_pos, club_short text,
  lineup_status lineup_status, bench_priority int,
  gw_points int, minutes int, total_points int, locked boolean,
  kickoff timestamptz, status text, news text,
  opp_short text, is_home boolean, fixture_count int, breakdown jsonb,
  auto_sub_out boolean, auto_sub_in boolean
)
language sql stable security definer set search_path = public as $$
  with xi as (
    select * from member_gw_xi(p_member, p_gw)
     where scoring_player_id <> slot_player_id
  )
  select p.id, p.web_name, p.position, t.short_name,
         ln.status, ln.bench_priority,
         coalesce(pts.points, 0), coalesce(pts.minutes, 0),
         p.current_season_points,
         is_player_locked(p.id, p_gw),
         fx.kickoff, p.status, p.news,
         fx.opp, fx.is_home, coalesce(fx.n, 0), pts.breakdown,
         exists (select 1 from xi where xi.slot_player_id = p.id),
         exists (select 1 from xi where xi.scoring_player_id = p.id)
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
grant execute on function player_gw_settled(int,int) to authenticated;
-- Not for clients: it answers for any member id it is handed, with no league
-- check of its own. `from public` matters — execute is granted to PUBLIC by
-- default, and both authenticated and anon inherit it, so revoking from those
-- two alone leaves the function reachable.
revoke execute on function member_gw_xi(uuid,int) from public, authenticated, anon;

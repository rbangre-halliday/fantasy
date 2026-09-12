-- ============================================================================
--  Formations.
--
--  The XI was a fixed 1 GK, 4 DEF, 4 MID, 2 FWD, and — like the old fixed
--  2/5/5/4 squad in 14_flex_bench.sql — that was never a decision anybody
--  made. It was arithmetic. The squad had exactly enough of each position to
--  fill 4-4-2 and cover it once on the bench, so "the XI is 4-4-2" and "the
--  squad is legal" were the same statement, and the rulebook stated the shape
--  as though it were a rule: "there's no 3-5-2 and no 4-3-3".
--
--  There is now. The XI is any eleven inside a band:
--
--      GK  exactly 1        DEF  3 to 5        MID  2 to 5        FWD  1 to 3
--
--  which is FPL's own band, and gives eight formations:
--
--      3-4-3   3-5-2   4-3-3   4-4-2   4-5-1   5-2-3   5-3-2   5-4-1
--
--  Every one of them is playable out of every legal squad, and that is not a
--  coincidence to be checked at runtime — it is true by construction. The band
--  maxes at 1/5/5/3 and the squad floor is 2/5/5/3, so the most an XI can ever
--  ask for at a position is no more than the fewest a squad can hold there.
--  No shape in the band can be short of bodies, whichever position the flex
--  went to, which is why there is no "you can't play that formation with this
--  squad" error anywhere below.
--
--  Three functions have to change, and the third is the interesting one.
--
--  set_lineup() checked the shape against pos_start() and now checks it
--  against the band.
--
--  ensure_lineup() topped up each position to pos_start(). Under a band there
--  is no single number to top up *to*, so it has to hold on to a shape rather
--  than impose one: it counts the XI's shape before the departed players are
--  taken out of it, and refills at the position the gap opened at. Drop a
--  starting defender out of a 3-5-2 and you are still playing 3-5-2 with a
--  different defender — not 4-4-2, and not "whichever eleven rank highest".
--  A squad with no lineup at all still starts life 4-4-2, because a default has
--  to be something and that is the shape every squad in the league is holding
--  today.
--
--  member_gw_subs() is the one that would have quietly broken. It replaced a
--  blanking starter with a substitute *in the same position*, which was very
--  nearly always possible when the bench was one of each: cover for 4-4-2 was
--  a GK, a DEF, a MID, a FWD and the flex. Under a band it stops being true.
--  Play 4-3-3 out of a 2/5/5/3 squad and your bench is a GK, a DEF and two
--  MIDs — no forward at all. A forward blanks, same-position finds nobody, and
--  the slot takes a nil with two midfielders sitting on the bench who played.
--  The formation you were invited to choose would have silently cost you the
--  cover you used to have.
--
--  So the rule becomes the one the squad screen has claimed all along — "the
--  first eligible substitute in this order" — with eligibility widened from
--  "same position" to "the XI is still legal afterwards". Same position always
--  qualifies, because it cannot change the shape. A different position
--  qualifies when the outgoing man's position is above its floor and the
--  incoming man's is below its ceiling: 4-3-3 losing a forward goes to 4-4-2,
--  which is legal, so the midfielder comes on. 3-5-2 losing a defender does
--  not — three at the back is the floor — so only a defender can cover there,
--  which is the honest cost of playing three at the back and is worth knowing
--  before you pick the shape.
--
--  A keeper needs no special case despite being one in FPL: exactly 1 both
--  ways means a GK can only ever come on for a GK, and can never come on for
--  anyone else, which falls out of the band for free.
--
--  Finally, when this lands. A gameweek that has kicked off keeps the shape it
--  kicked off with, exactly as it keeps the XI it kicked off with
--  (16_signings_next_week.sql). So the new formations apply from the next
--  gameweek that has not started, and mid-week you can still do what you could
--  always do: swap like for like, up to each player's own kickoff. Reshaping
--  the week being played would move no points — locked players cannot move at
--  all — but "the shape of a gameweek under way is settled" is an invariant
--  this codebase already keeps in three other places, and it is not worth
--  spending to save someone four days of waiting.
--
--  Safe to re-run. Supersedes set_lineup (10_player_detail.sql), ensure_lineup
--  (16_signings_next_week.sql) and member_gw_subs (11_autosubs.sql).
-- ============================================================================

-- ------------------------------------------------------------- the band -----

-- The fewest and the most of one position a legal XI may start. Eleven in
-- total is checked separately: the band alone permits 7 through 14.
create or replace function xi_min(p player_pos)
returns int language sql immutable as $$
  select case p when 'GK' then 1 when 'DEF' then 3 when 'MID' then 2 when 'FWD' then 1 end;
$$;

create or replace function xi_max(p player_pos)
returns int language sql immutable as $$
  select case p when 'GK' then 1 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 3 end;
$$;

grant execute on function xi_min(player_pos) to authenticated;
grant execute on function xi_max(player_pos) to authenticated;

-- pos_start() survives as what it always numerically was and is now only
-- claimed to be: the shape a lineup is set out in before anybody has an
-- opinion. It is no longer the shape an XI must hold.

-- ------------------------------------------------------------- lineups ------

-- Unchanged but for the shape rules: the fixed 1/4/4/2 becomes the band, and a
-- gameweek already under way additionally keeps the shape it kicked off with.
create or replace function set_lineup(p_league uuid, p_gw int, p_starters int[], p_bench int[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid; pos player_pos; c int; was int; pid int; i int;
  old_status lineup_status; had_lineup boolean;
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

  -- Counted before the delete below, because it is what the gameweek was set
  -- out in and the freeze is measured against it.
  had_lineup := exists (select 1 from lineups
                         where member_id = me and gw = p_gw and status = 'starter');

  foreach pos in array array['GK','DEF','MID','FWD']::player_pos[] loop
    select count(*) into c from unnest(p_starters) x
     join epl_players p on p.id = x where p.position = pos;

    if c < xi_min(pos) then
      raise exception 'An XI needs at least % %, and yours has %.', xi_min(pos), pos, c;
    end if;
    if c > xi_max(pos) then
      raise exception 'An XI can start at most % %, and yours has %.', xi_max(pos), pos, c;
    end if;

    -- A gameweek being played is settled. Like-for-like swaps still go
    -- through, which is every change that keeps these four counts.
    if had_lineup and gw_started(p_gw) then
      select count(*) into was from lineups ln join epl_players p on p.id = ln.player_id
       where ln.member_id = me and ln.gw = p_gw and ln.status = 'starter' and p.position = pos;
      if c <> was then
        raise exception
          'Gameweek % has kicked off, so it keeps the shape it started in. Swap like for like this week, or change your formation in a gameweek that has not begun.',
          p_gw;
      end if;
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

-- Unchanged but for the middle: the top-up holds the shape the XI was in
-- rather than restoring 4-4-2, and there is a pass afterwards to guarantee
-- eleven whatever the stored shape said.
create or replace function ensure_lineup(p_member uuid, p_gw int)
returns void language plpgsql security definer set search_path = public as $$
declare
  l_id uuid; src_gw int; pos player_pos; need int; bench_n int := 0; rec record;
  shape jsonb; total int;
begin
  if gw_started(p_gw)
     and exists (select 1 from lineups where member_id = p_member and gw = p_gw) then
    return;
  end if;

  select league_id into l_id from league_members where id = p_member;
  if l_id is null then return; end if;
  if (select count(*) from roster_players where member_id = p_member) < 16 then return; end if;

  -- Seed from the most recent gameweek that has a lineup, if this one doesn't.
  if not exists (select 1 from lineups where member_id = p_member and gw = p_gw) then
    select max(gw) into src_gw from lineups where member_id = p_member and gw < p_gw;
    if src_gw is not null then
      insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
      select l_id, p_member, p_gw, ln.player_id, ln.status, ln.bench_priority
      from lineups ln
      join roster_players r on r.member_id = p_member and r.player_id = ln.player_id
      where ln.member_id = p_member and ln.gw = src_gw;
    end if;
  end if;

  -- The shape to hold, counted *before* the departed are removed from the XI.
  -- After the delete a 3-5-2 that has lost a defender is indistinguishable
  -- from a 2-5-2 nobody ever chose, and refilling it by rank would quietly
  -- reshape the team of anyone who had stopped playing four at the back.
  select coalesce(jsonb_object_agg(t.pos, t.n), '{}'::jsonb) into shape
    from (select p.position::text as pos, count(*)::int as n
            from lineups ln join epl_players p on p.id = ln.player_id
           where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
           group by 1) t;

  -- Drop rows for players no longer on the squad.
  delete from lineups ln
   where ln.member_id = p_member and ln.gw = p_gw
     and not exists (select 1 from roster_players r
                      where r.member_id = p_member and r.player_id = ln.player_id);

  -- Top up position by position, best previous-season points first, but never
  -- reaching for a man who has already played if anyone else will do.
  --
  -- The target is the shape above, held inside the band. A squad with no
  -- lineup at all has no shape to hold and is set out 4-4-2.
  foreach pos in array array['GK','DEF','MID','FWD']::player_pos[] loop
    select least(greatest(coalesce((shape->>pos::text)::int, pos_start(pos)),
                          xi_min(pos)), xi_max(pos))
           - count(*) into need
      from lineups ln join epl_players p on p.id = ln.player_id
     where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter' and p.position = pos;

    if need > 0 then
      for rec in
        select r.player_id from roster_players r join epl_players p on p.id = r.player_id
         where r.member_id = p_member and p.position = pos
           and not exists (select 1 from lineups ln
                            where ln.member_id = p_member and ln.gw = p_gw
                              and ln.player_id = r.player_id and ln.status = 'starter')
         order by is_player_locked(r.player_id, p_gw),
                  p.prev_season_points desc, p.current_season_points desc
         limit need
      loop
        insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
        values (l_id, p_member, p_gw, rec.player_id, 'starter', null)
        on conflict (member_id, gw, player_id)
          do update set status = 'starter', bench_priority = null;
      end loop;
    end if;
  end loop;

  -- Eleven, whatever the shape said. Every lineup this app has ever written is
  -- eleven and inside the band, so this finds nothing to do; it is here so that
  -- a lineup from anywhere else — a hand-edited row, a shape from a future
  -- version of the band — cannot leave a ten-man XI scoring ten men.
  loop
    select count(*) into total from lineups
     where member_id = p_member and gw = p_gw and status = 'starter';
    exit when total >= 11;

    select r.player_id into rec
      from roster_players r join epl_players p on p.id = r.player_id
     where r.member_id = p_member
       and not exists (select 1 from lineups ln
                        where ln.member_id = p_member and ln.gw = p_gw
                          and ln.player_id = r.player_id and ln.status = 'starter')
       and (select count(*) from lineups ln join epl_players q on q.id = ln.player_id
             where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
               and q.position = p.position) < xi_max(p.position)
     order by is_player_locked(r.player_id, p_gw),
              p.prev_season_points desc, p.current_season_points desc
     limit 1;
    exit when not found;

    insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
    values (l_id, p_member, p_gw, rec.player_id, 'starter', null)
    on conflict (member_id, gw, player_id)
      do update set status = 'starter', bench_priority = null;
  end loop;

  loop
    select count(*) into total from lineups
     where member_id = p_member and gw = p_gw and status = 'starter';
    exit when total <= 11;

    select ln.player_id into rec
      from lineups ln join epl_players p on p.id = ln.player_id
     where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
       and (select count(*) from lineups l2 join epl_players q on q.id = l2.player_id
             where l2.member_id = p_member and l2.gw = p_gw and l2.status = 'starter'
               and q.position = p.position) > xi_min(p.position)
     order by is_player_locked(ln.player_id, p_gw),
              p.prev_season_points, p.current_season_points
     limit 1;
    exit when not found;

    update lineups set status = 'substitute', bench_priority = 99
     where member_id = p_member and gw = p_gw and player_id = rec.player_id;
  end loop;

  -- Everyone else is a substitute, in ranked order.
  for rec in
    select r.player_id from roster_players r join epl_players p on p.id = r.player_id
     where r.member_id = p_member
       and not exists (select 1 from lineups ln
                        where ln.member_id = p_member and ln.gw = p_gw
                          and ln.player_id = r.player_id and ln.status = 'starter')
     order by coalesce((select bench_priority from lineups ln
                         where ln.member_id = p_member and ln.gw = p_gw
                           and ln.player_id = r.player_id), 99),
              p.prev_season_points desc
  loop
    bench_n := bench_n + 1;
    insert into lineups (league_id, member_id, gw, player_id, status, bench_priority)
    values (l_id, p_member, p_gw, rec.player_id, 'substitute', bench_n)
    on conflict (member_id, gw, player_id)
      do update set status = 'substitute', bench_priority = bench_n;
  end loop;
end $$;

-- --------------------------------------------------------------- the subs ---

-- Unchanged but for who is eligible, which was "the same position" and is now
-- "any position the XI can still be legal without and legal with". The XI's
-- shape is carried through the walk, so the third substitution is judged
-- against the shape the first two left behind — otherwise two midfielders
-- coming on for two forwards out of 4-3-3 would each be checked against 3
-- forwards and the second one would take the XI to 4-5-... 1 forward, which is
-- legal, or below the floor, which is not.
create or replace function member_gw_subs(p_member uuid, p_gw int)
returns table (out_player int, in_player int)
language plpgsql stable security definer set search_path = public as $$
declare
  used  int[] := '{}';
  shape jsonb;
  st    record;
  sub   record;
begin
  select coalesce(jsonb_object_agg(t.pos, t.n), '{}'::jsonb) into shape
    from (select p.position::text as pos, count(*)::int as n
            from lineups ln join epl_players p on p.id = ln.player_id
           where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
           group by 1) t;

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
    select ln.player_id as pid, p.position as pos into sub
    from lineups ln
    join epl_players p on p.id = ln.player_id
    join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'substitute'
      and pts.minutes > 0
      and not (ln.player_id = any(used))
      and (p.position = st.position
           or (coalesce((shape->>st.position::text)::int, 0) - 1 >= xi_min(st.position)
               and coalesce((shape->>p.position::text)::int, 0) + 1 <= xi_max(p.position)))
    order by ln.bench_priority nulls last, ln.player_id
    limit 1;

    if found then
      used := used || sub.pid;
      if sub.pos <> st.position then
        shape := jsonb_set(shape, array[st.position::text],
                   to_jsonb(coalesce((shape->>st.position::text)::int, 0) - 1));
        shape := jsonb_set(shape, array[sub.pos::text],
                   to_jsonb(coalesce((shape->>sub.pos::text)::int, 0) + 1));
      end if;
      out_player := st.player_id;
      in_player  := sub.pid;
      return next;
    end if;
    -- else: nobody qualifies, and the slot keeps its nil.
  end loop;
end $$;

grant execute on function member_gw_subs(uuid,int) to authenticated;

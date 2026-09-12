-- ============================================================================
--  A gameweek that has been played keeps the substitutions it was played under.
--
--  Two separate ways a settled gameweek could still move, both visible on the
--  same screen: TzolisGoat69's gameweek 3, finished and scored, showing
--  "Evanilson · On for O'Reilly" under a banner saying the week keeps its 4-4-2.
--
--  1. 19_flex_formations.sql widened who may come on — from "a substitute in
--     the same position" to "any substitute the XI is still legal without and
--     legal with" — and member_gw_subs() is a live read, recomputed from the
--     lineup rows every time anyone asks. So the widening did not apply from
--     the next gameweek. It applied to every gameweek ever played.
--
--     Gameweek 3 was set out 4-4-2. O'Reilly blanked at the back, and under the
--     rule in force that weekend the only cover was J.Timber, a defender who
--     also did not play: the slot took a nil, and that is the week the manager
--     watched and the score the table paid. Four days later formations landed
--     and Evanilson qualified — 4-4-2 less a defender plus a forward is 3-4-3,
--     which is legal — came on for two points, and a finished gameweek's score
--     moved. The same file's header says the new shapes "apply from the next
--     gameweek that has not started". The sub rule is half of that change and
--     did not.
--
--     So: a gameweek's substitutions run under the rule that was in force when
--     it kicked off. Which needs a date, and a date is the one thing the schema
--     cannot derive from itself, so it is written down once — rule_epochs, the
--     first gameweek that had not started when the rule landed. Re-running this
--     file does not move it, and a fresh install records its own.
--
--  2. Bench order was never locked at all. is_player_locked stops a man who has
--     kicked off crossing the line in either direction, and set_lineup checks
--     exactly that: starter stays starter, substitute stays substitute. Where
--     he sits *within* the bench was left free, because it used to be worth
--     almost nothing — the bench was one of each position and the same-position
--     rule meant at most one substitute could ever cover a given blank, so the
--     order was a tiebreak that rarely broke a tie.
--
--     Under a band the bench is variable and the order is the whole decision:
--     four of the five could be eligible for one blank. And the nudges on the
--     squad screen were live on a gameweek already played, so a manager could
--     watch every match, see Enzo's 3 and Evanilson's 2, and move Enzo up — and
--     the sub, and the score, would follow. Deciding after the football who came
--     on for you is the one thing automatic substitution exists to not be.
--
--     The rule is the one this app already applies everywhere else, extended to
--     the place it had not reached: a player whose match in this gameweek has
--     kicked off cannot be moved. Not out of the XI, not into it, and not past
--     another man who has also kicked off. Two substitutes who are both still to
--     play may still be reordered freely — neither can come on, so nothing about
--     the week is decided by it, and the per-player freedom this app is built on
--     is worth keeping wherever it costs nothing.
--
--  Safe to re-run. Supersedes set_lineup and member_gw_subs in
--  19_flex_formations.sql.
-- ============================================================================

-- ------------------------------------------------------------- the epoch ----

-- When a rule landed, in gameweeks. Not a settings table and not a feature
-- flag: a row here is a fact about history that cannot be recovered from the
-- data once the moment has passed, so it is recorded at the moment it is true.
create table if not exists rule_epochs (
  rule        text primary key,
  from_gw     int not null,
  recorded_at timestamptz not null default now()
);

alter table rule_epochs enable row level security;
drop policy if exists rule_epochs_read on rule_epochs;
create policy rule_epochs_read on rule_epochs for select to authenticated using (true);
grant select on rule_epochs to authenticated;

-- The first gameweek that has not kicked off is the first one the widened
-- substitution rule may speak for. `on conflict do nothing` is what makes this
-- file re-runnable: the epoch is whenever it was first recorded, not whenever
-- somebody last pasted the file into the SQL editor.
insert into rule_epochs (rule, from_gw)
select 'cross_position_subs',
       coalesce((select min(id) from gameweeks where not gw_started(id)), 1)
on conflict (rule) do nothing;

create or replace function rule_from_gw(p_rule text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select from_gw from rule_epochs where rule_epochs.rule = p_rule), 1);
$$;

grant execute on function rule_from_gw(text) to authenticated;

-- ------------------------------------------------------------- lineups -----

-- Unchanged but for one block: a substitute whose match has started keeps his
-- place in the order relative to the other substitutes whose matches have
-- started.
create or replace function set_lineup(p_league uuid, p_gw int, p_starters int[], p_bench int[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid; pos player_pos; c int; was int; pid int; i int;
  old_status lineup_status; had_lineup boolean;
  was_order int[]; now_order int[];
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

  -- Nor can he change where he stands in the bench order, which is the rest of
  -- what "he cannot be moved" has to mean now that the order decides who covers
  -- a blank. Only the men who have kicked off are compared: two substitutes
  -- still to play can be reordered all week, because neither of them can come
  -- on and the week turns on none of it.
  if had_lineup and gw_started(p_gw) then
    select coalesce(array_agg(ln.player_id order by ln.bench_priority nulls last, ln.player_id), '{}')
      into was_order
      from lineups ln
     where ln.member_id = me and ln.gw = p_gw and ln.status = 'substitute'
       and is_player_locked(ln.player_id, p_gw);

    select coalesce(array_agg(t.x order by t.ord), '{}')
      into now_order
      from unnest(p_bench) with ordinality as t(x, ord)
     where is_player_locked(t.x, p_gw);

    if was_order <> now_order then
      raise exception
        'Gameweek % has kicked off. A substitute whose own match has started keeps his place in the bench order.',
        p_gw;
    end if;
  end if;

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

-- --------------------------------------------------------------- the subs ---

-- Unchanged but for the epoch: a substitute from another position is eligible
-- only in a gameweek that kicked off after cross-position cover became a rule.
-- Same position always qualifies, in every gameweek there has ever been — that
-- rule has not changed and neither have the weeks it decided.
create or replace function member_gw_subs(p_member uuid, p_gw int)
returns table (out_player int, in_player int)
language plpgsql stable security definer set search_path = public as $$
declare
  used      int[] := '{}';
  shape     jsonb;
  flex_from int;
  st        record;
  sub       record;
begin
  flex_from := rule_from_gw('cross_position_subs');

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
           or (p_gw >= flex_from
               and coalesce((shape->>st.position::text)::int, 0) - 1 >= xi_min(st.position)
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

-- ============================================================================
--  What a player has actually been scoring, on the screen where you sign him.
--
--  The market listed two numbers: this season's total and last season's. Both
--  are cumulative, and a cumulative total cannot tell a steady six a week from
--  fourteen on the opening day followed by four blanks — which is precisely the
--  distinction you are making when you decide whether to spend your one drop on
--  somebody. The per-gameweek numbers existed all along in player_gw_points;
--  nothing exposed them outside a single player's detail sheet.
--
--  Returned as one jsonb object rather than one row per player, deliberately.
--  PostgREST truncates a result set at 1000 rows and says so only in a
--  Content-Range header nobody reads: selecting player_gw_points directly for
--  two gameweeks is already 1236 rows, so a third of the league would have come
--  back with no history and drawn as "did not feature" — wrong, silently, and
--  worse than showing nothing. A set-returning function has the same ceiling
--  (626 players is under it today and is not a margin worth relying on). One
--  row cannot be truncated.
--
--  The array is positional: index i is gameweek p_from + i, and a null means
--  no row for that gameweek — he did not feature, which the client draws
--  differently from a nil.
--
--  Safe to re-run.
-- ============================================================================

create or replace function player_recent_points(p_from int, p_to int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.id, t.pts), '{}'::jsonb)
  from (
    select p.id,
           array(
             select pts.points
             from generate_series(p_from, p_to) as g(gw)
             left join player_gw_points pts
               on pts.player_id = p.id and pts.gw = g.gw
             order by g.gw
           ) as pts
    from epl_players p
  ) t;
$$;

grant execute on function player_recent_points(int,int) to authenticated;

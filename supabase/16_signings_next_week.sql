-- ============================================================================
--  Let people build next week's squad while this week is being played.
--
--  548 of 609 active players were unsignable. Not a cap, not ownership — the
--  lock. is_player_locked(player) asks about the live gameweek and holds until
--  the *gameweek* closes, not until that player's match does:
--
--      where f.gw = current_gw() and not g.finished and f.started
--
--  Eighteen of twenty clubs had played, and gameweek 1 stays unfinished until
--  Monday's match and then until FPL confirms bonus — so free agency shuts from
--  Friday's first kickoff to Tuesday, every week. The market is open Tuesday to
--  Friday and closed the entire time anyone is actually watching football.
--
--  The lock's duration is right; what it was attached to was wrong. It exists
--  so nobody can watch a man score fifteen and then sign him into *that*
--  gameweek. It was never meant to stop you assembling the next one. This is
--  the same fault 10_player_detail.sql fixed for lineups — is_player_locked
--  (player) versus is_player_locked(player, gw) — which was fixed there and
--  never carried across to signings and trades.
--
--  So a squad change now lands on the first gameweek it can honestly affect:
--
--    * nothing has kicked off      -> this gameweek, as before
--    * like-for-like, neither has  -> this gameweek: renaming a row keeps the
--      played                         XI's shape exactly, so the injured
--                                     Sunday striker can still be replaced
--    * anything else               -> next gameweek
--
--  and a gameweek that has kicked off keeps the lineup it kicked off with. Drop
--  a man who has already played and his points stay yours — he was yours when
--  he earned them. He is a free agent at once, but whoever signs him also only
--  has him from next week, so he cannot score for two managers in one week.
--
--  That last invariant is enforced in one place. ensure_lineup() answers "what
--  should this XI be given the squad you hold now", which is the wrong question
--  for a gameweek being played, and it is called from six places — add_drop,
--  respond_trade, refresh_lineups, recompute_scores, the commissioner tools and
--  the squad screen itself. Rather than teach all six, it now declines: a
--  gameweek that has started and already has a lineup is frozen.
--
--  Safe to re-run. Supersedes ensure_lineup and add_drop (15_flex_lineups.sql),
--  validate_trade_sides (14_flex_bench.sql), respond_trade (03_functions.sql)
--  and member_squad (11_autosubs.sql).
-- ============================================================================

-- Has a ball been kicked in this gameweek?
create or replace function gw_started(p_gw int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fixtures f
     where f.gw = p_gw
       and (f.started or (f.kickoff is not null and f.kickoff <= now()))
  );
$$;

grant execute on function gw_started(int) to authenticated;

-- The soonest gameweek a squad change can honestly land on. Never a gameweek
-- being played: the greatest() is for the end of the season, where next_gw()
-- falls back to the current one and would otherwise hand back a live week.
create or replace function next_open_gw()
returns int language sql stable security definer set search_path = public as $$
  select case when gw_started(current_gw())
              then greatest(next_gw(), current_gw() + 1)
              else current_gw() end;
$$;

grant execute on function next_open_gw() to authenticated;

-- ------------------------------------------------------------- the freeze ---

-- Unchanged but for the first four lines, which are the whole point: a
-- gameweek that has kicked off and has a lineup is done being reasoned about.
-- Without this, every squad change would ripple backwards into the week being
-- played — recompute_scores alone would strip a departed player out of the XI
-- he is still scoring in, twenty minutes later, with no trace of why.
--
-- A started gameweek with no lineup at all is still built, because scoring it
-- as a nil is worse than reconstructing it.
create or replace function ensure_lineup(p_member uuid, p_gw int)
returns void language plpgsql security definer set search_path = public as $$
declare
  l_id uuid; src_gw int; pos player_pos; need int; bench_n int := 0; rec record;
begin
  if gw_started(p_gw)
     and exists (select 1 from lineups where member_id = p_member and gw = p_gw) then
    return;
  end if;

  select league_id into l_id from league_members where id = p_member;
  if l_id is null then return; end if;
  if (select count(*) from roster_players where member_id = p_member) < 16 then return; end if;

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

  delete from lineups ln
   where ln.member_id = p_member and ln.gw = p_gw
     and not exists (select 1 from roster_players r
                      where r.member_id = p_member and r.player_id = ln.player_id);

  foreach pos in array array['GK','DEF','MID','FWD']::player_pos[] loop
    select pos_start(pos) - count(*) into need
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

-- ------------------------------------------------------------ free agency ---

create or replace function add_drop(p_league uuid, p_add int, p_drop int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; add_pos player_pos; drop_pos player_pos; v_gw int;
begin
  me := assert_member(p_league);

  if (select status from leagues where id = p_league) <> 'active' then
    raise exception 'Transactions open once the draft is complete.';
  end if;

  select position into add_pos  from epl_players where id = p_add  and active;
  select position into drop_pos from epl_players where id = p_drop and active;
  if add_pos is null then raise exception 'Unknown player.'; end if;

  if not exists (select 1 from roster_players
                  where member_id = me and player_id = p_drop) then
    raise exception 'You do not own the player you are dropping.';
  end if;

  if exists (select 1 from roster_players where league_id = p_league and player_id = p_add) then
    raise exception 'That player is already owned in this league.';
  end if;

  if squad_flex_after(me, array[add_pos], array[drop_pos]) > 1 then
    raise exception
      'That would leave you short at %. You can only carry one player above the 2/5/5/3 minimum, and yours is already spoken for.',
      drop_pos;
  end if;

  -- When the move takes hold. A like-for-like swap of two men who have not
  -- played is the only mid-gameweek change that is safe: it is one row renamed,
  -- so the XI keeps its shape and no points move. Everything else waits.
  if not gw_started(current_gw()) then
    v_gw := current_gw();
  elsif add_pos = drop_pos
        and not is_player_locked(p_add) and not is_player_locked(p_drop) then
    v_gw := current_gw();
  else
    v_gw := next_open_gw();
  end if;

  delete from roster_players where member_id = me and player_id = p_drop;

  begin
    insert into roster_players (league_id, member_id, player_id, acquired_via)
    values (p_league, me, p_add, 'free_agent');
  exception when unique_violation then
    raise exception 'Someone signed that player a moment before you did.';
  end;

  insert into transactions (league_id, member_id, type, player_in_id, player_out_id)
  values (p_league, me, 'add_drop', p_add, p_drop);

  if add_pos = drop_pos then
    -- Like-for-like: the new player takes the exact slot, bench priority and all.
    update lineups set player_id = p_add
     where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  else
    -- A midfielder cannot stand in a forward's starting slot. Clear it and let
    -- the XI re-form, the way it does after a trade.
    delete from lineups where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  end if;

  perform ensure_lineup(me, v_gw);
  perform ensure_lineup(me, next_gw());
end $$;

-- ----------------------------------------------------------------- trades ---

-- The lock checks are gone: a trade involving someone who has played is not
-- illegal, it is next week's trade. Both squads must still be legal, and still
-- must be so again at the moment it is accepted.
create or replace function validate_trade_sides(
  p_league uuid, p_a uuid, p_b uuid, p_offer int[], p_request int[])
returns void language plpgsql stable security definer set search_path = public as $$
declare pid int; a_out player_pos[]; a_in player_pos[];
begin
  foreach pid in array p_offer loop
    if not exists (select 1 from roster_players where member_id = p_a and player_id = pid) then
      raise exception 'A player in this trade is no longer owned by the proposer.';
    end if;
  end loop;

  foreach pid in array p_request loop
    if not exists (select 1 from roster_players where member_id = p_b and player_id = pid) then
      raise exception 'A player in this trade is no longer owned by the other manager.';
    end if;
  end loop;

  if coalesce(array_length(p_offer, 1), 0) <> coalesce(array_length(p_request, 1), 0) then
    raise exception 'A trade must send as many players as it receives.';
  end if;

  select array_agg(p.position) into a_out from unnest(p_offer)   x join epl_players p on p.id = x;
  select array_agg(p.position) into a_in  from unnest(p_request) x join epl_players p on p.id = x;

  if squad_flex_after(p_a, a_in, a_out) > 1 then
    raise exception 'That trade would leave the proposer with an illegal squad — only one player may sit above the 2/5/5/3 minimum.';
  end if;
  if squad_flex_after(p_b, a_out, a_in) > 1 then
    raise exception 'That trade would leave the other manager with an illegal squad — only one player may sit above the 2/5/5/3 minimum.';
  end if;
end $$;

-- Unchanged but for which gameweek the two lineups are rebuilt for. A trade
-- touching anyone who has played lands next week for both sides at once —
-- never one squad this week and the other the next.
create or replace function respond_trade(p_trade uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t trades%rowtype; me uuid; tp record; gw int; touched_live boolean;
begin
  select * into t from trades where id = p_trade for update;
  if not found then raise exception 'Trade not found.'; end if;
  if t.status <> 'pending' then raise exception 'That trade is no longer pending.'; end if;

  me := assert_member(t.league_id);
  if me <> t.receiver_id then raise exception 'Only the receiving manager can respond.'; end if;

  if not p_accept then
    update trades set status = 'rejected', resolved_at = now() where id = t.id;
    return;
  end if;

  perform validate_trade_sides(
    t.league_id, t.proposer_id, t.receiver_id,
    array(select player_id from trade_players where trade_id = t.id and from_member = t.proposer_id),
    array(select player_id from trade_players where trade_id = t.id and from_member = t.receiver_id));

  select bool_or(is_player_locked(tp2.player_id)) into touched_live
    from trade_players tp2 where tp2.trade_id = t.id;

  for tp in select * from trade_players where trade_id = t.id loop
    update roster_players
       set member_id = tp.to_member, acquired_via = 'trade', acquired_at = now()
     where league_id = t.league_id and player_id = tp.player_id;

    insert into transactions (league_id, member_id, type, player_in_id)
    values (t.league_id, tp.to_member, 'trade', tp.player_id);
  end loop;

  update trades set status = 'accepted', resolved_at = now() where id = t.id;

  update trades set status = 'cancelled', resolved_at = now()
   where league_id = t.league_id and status = 'pending' and id <> t.id
     and exists (select 1 from trade_players tp2
                  where tp2.trade_id = trades.id
                    and tp2.player_id in (select player_id from trade_players where trade_id = t.id));

  gw := case when coalesce(touched_live, false) then next_open_gw() else current_gw() end;
  perform ensure_lineup(t.proposer_id, gw);
  perform ensure_lineup(t.receiver_id, gw);
  perform ensure_lineup(t.proposer_id, next_gw());
  perform ensure_lineup(t.receiver_id, next_gw());
end $$;

-- ---------------------------------------------------------------- read API ---

-- The player set for a gameweek being played is the lineup it kicked off with,
-- not the squad you hold now — otherwise a manager who signed on the Saturday
-- would open Saturday's XI and find seventeen names in it: the man still
-- scoring for him and the man who does not play for him until Tuesday.
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
     where r.member_id = p_member
       and (not gw_started(p_gw)
            or not exists (select 1 from lineups l2
                            where l2.member_id = p_member and l2.gw = p_gw))
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

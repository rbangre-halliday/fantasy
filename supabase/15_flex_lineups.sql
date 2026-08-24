-- ============================================================================
--  Keep the XI at eleven when a signing changes position.
--
--  add_drop inherited the dropped player's lineup slot by renaming the row:
--
--      update lineups set player_id = p_add where ... player_id = p_drop
--
--  which was exactly right while signings were like-for-like, and is wrong the
--  moment they are not. Sign a midfielder for a starting forward and that
--  midfielder is now standing in a forward's starting slot. ensure_lineup()
--  cannot see the problem — it removes rows for players you no longer own, and
--  you do own him — so it reads the XI as a forward short, promotes one off the
--  bench, and leaves you starting twelve. Caught by counting starters after a
--  MID-for-FWD swap in a rolled-back transaction: 12.
--
--  Trades never had this, because a traded player leaves the roster and
--  ensure_lineup deletes his rows before rebuilding. So a cross-position
--  signing should behave the way a trade does: the outgoing player's rows go,
--  and the XI re-forms around what is left. The dropped player's position is
--  then a starter short and the best bench player there is promoted, while the
--  arrival lands on the bench where a new signing belongs.
--
--  A same-position signing still inherits the slot exactly, bench priority and
--  all. That is the documented behaviour and the only one that preserves what
--  the manager actually chose.
--
--  Safe to re-run. Supersedes add_drop (14_flex_bench.sql) and ensure_lineup
--  (03_functions.sql).
-- ============================================================================

-- Unchanged but for the order the top-up promotes in: a player whose match has
-- already kicked off is now the last resort rather than the first choice.
-- Promotion used to be rare — only a trade could cause one — and is about to be
-- routine, because every cross-position signing ends in one. Pulling a man who
-- has already played into your XI mid-gameweek would hand you points from a
-- match you watched before deciding to make the move.
create or replace function ensure_lineup(p_member uuid, p_gw int)
returns void language plpgsql security definer set search_path = public as $$
declare
  l_id uuid; src_gw int; pos player_pos; need int; bench_n int := 0; rec record;
begin
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

  -- Drop rows for players no longer on the squad.
  delete from lineups ln
   where ln.member_id = p_member and ln.gw = p_gw
     and not exists (select 1 from roster_players r
                      where r.member_id = p_member and r.player_id = ln.player_id);

  -- Top up starters position by position, best previous-season points first,
  -- but never reaching for a man who has already played if anyone else will do.
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

  -- The squad minimum is 2/5/5/3 and the sixteenth man is a flex, so a signing
  -- may change your mix — as long as the mix it leaves you with is one you are
  -- allowed to hold.
  if squad_flex_after(me, array[add_pos], array[drop_pos]) > 1 then
    raise exception
      'That would leave you short at %. You can only carry one player above the 2/5/5/3 minimum, and yours is already spoken for.',
      drop_pos;
  end if;

  if is_player_locked(p_add)  then raise exception 'That player''s match has already started.'; end if;
  if is_player_locked(p_drop) then raise exception 'You cannot drop a player whose match has started.'; end if;

  delete from roster_players where member_id = me and player_id = p_drop;

  begin
    insert into roster_players (league_id, member_id, player_id, acquired_via)
    values (p_league, me, p_add, 'free_agent');
  exception when unique_violation then
    -- Lost the race. Raising rolls the whole function back, including the drop
    -- above, so the loser's squad is left exactly as it was.
    raise exception 'Someone signed that player a moment before you did.';
  end;

  insert into transactions (league_id, member_id, type, player_in_id, player_out_id)
  values (p_league, me, 'add_drop', p_add, p_drop);

  v_gw := current_gw();

  if add_pos = drop_pos then
    -- Like-for-like: the new player takes the exact slot, bench priority and
    -- all, because that is the lineup the manager already chose.
    update lineups set player_id = p_add
     where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  else
    -- Otherwise he cannot stand where the old player stood — a midfielder in a
    -- forward's starting slot is an XI of eleven that is shaped like twelve.
    -- Clear the slot and let the XI re-form, the way it does after a trade.
    delete from lineups where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  end if;

  perform ensure_lineup(me, v_gw);
  perform ensure_lineup(me, next_gw());
end $$;

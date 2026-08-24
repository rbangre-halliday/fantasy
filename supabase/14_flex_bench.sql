-- ============================================================================
--  One flex on the bench.
--
--  The squad was a fixed 2/5/5/4, which made the bench a fixed 1 GK, 1 DEF,
--  1 MID and *two* forwards — a shape nobody chose. It fell out of the caps
--  rather than out of anything anyone wanted: the XI is 1/4/4/2, so whatever
--  the caps were minus the XI was the bench, and the caps had to sum to
--  sixteen. Two forwards is the least useful of the five slots, because the
--  second one only ever comes on for the *other* forward blanking too.
--
--  Now the bench is one of each and one free choice. The squad minimum is
--  2/5/5/3 — fifteen — and the sixteenth player is a flex, at any position
--  including a second outfield-heavy lean or a third keeper. Four legal
--  squads: 3/5/5/3, 2/6/5/3, 2/5/6/3 and 2/5/5/4, which is what every squad
--  in the league already holds. Nobody has to change anything.
--
--  The interesting part is what this does to the rest of the rulebook. "Sign a
--  midfielder, drop a midfielder" was never a policy — it was arithmetic. With
--  caps summing to exactly sixteen, any move that changed your mix left an
--  illegal squad, so like-for-like was the only legal move and the rules said
--  so as though it were a design choice. A flex means a mix *can* change, so
--  the real rule has to be stated for the first time: a move is legal if what
--  you are left with is a legal squad. Sign a midfielder and drop a forward,
--  and the answer depends on where your flex already is.
--
--  All of which reduces to one quantity. Write f = the number of players you
--  hold above the minimum at their position. A squad is completable exactly
--  when f <= 1, at any point in a draft and after any move:
--
--     15 minimum slots, 16 players, so with t held and f of them spent on the
--     flex, t - f minimums are filled and 15 - t + f remain. There are 16 - t
--     picks left, and 16 - t >= 15 - t + f is just f <= 1.
--
--  So squad_flex_after() is the whole rule, and the draft, free agency and
--  trades all ask it the same question.
--
--  Safe to re-run. Supersedes pos_cap, do_pick, best_available, add_drop and
--  validate_trade_sides in 03_functions.sql.
-- ============================================================================

-- The floor at each position: 2/5/5/3, fifteen of the sixteen.
create or replace function pos_min(p player_pos)
returns int language sql immutable as $$
  select case p when 'GK' then 2 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 3 end;
$$;

-- The ceiling is the floor plus the flex, and only one position can be at it.
-- Kept because it is still the honest answer to "how many of these could I
-- possibly hold" — it just is no longer sufficient on its own to say whether a
-- squad is legal, which is what squad_flex_after is for.
create or replace function pos_cap(p player_pos)
returns int language sql immutable as $$
  select pos_min(p) + 1;
$$;

grant execute on function pos_min(player_pos) to authenticated;

-- How far above the minimum this squad would sit after taking p_in and giving
-- up p_out. Zero is a squad with its flex unspent, one is a legal full squad,
-- and anything higher cannot be completed to sixteen legal players.
create or replace function squad_flex_after(
  p_member uuid,
  p_in  player_pos[] default '{}',
  p_out player_pos[] default '{}')
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(0, c - pos_min(pos))), 0)::int
  from (
    select pos,
           (select count(*) from roster_players r
              join epl_players p on p.id = r.player_id
             where r.member_id = p_member and p.position = pos)
         + (select count(*) from unnest(p_in)  x where x = pos)
         - (select count(*) from unnest(p_out) x where x = pos) as c
      from unnest(enum_range(null::player_pos)) pos
  ) t;
$$;

grant execute on function squad_flex_after(uuid, player_pos[], player_pos[]) to authenticated;

-- ------------------------------------------------------------------ draft ---

-- Unchanged but for the cap check, which is now the flex rule. The old message
-- named the position that was full; this one has to explain that the squad is
-- out of *slack*, which is a different and less obvious thing to be out of.
create or replace function do_pick(p_league uuid, p_member uuid, p_player int, p_auto boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; pos player_pos;
begin
  select * into d from drafts where league_id = p_league;

  select position into pos from epl_players where id = p_player and active;
  if pos is null then raise exception 'Unknown player.'; end if;

  if squad_flex_after(p_member, array[pos]) > 1 then
    if (select count(*) from roster_players r join epl_players p on p.id = r.player_id
         where r.member_id = p_member and p.position = pos) >= pos_cap(pos) then
      raise exception 'Your squad is already full at %.', pos;
    else
      raise exception 'You have already used your flex pick, so you still need %s to fill the squad.', pos;
    end if;
  end if;

  -- The unique (league_id, player_id) index is the real race guard here.
  begin
    insert into roster_players (league_id, member_id, player_id, acquired_via)
    values (p_league, p_member, p_player, 'draft');
  exception when unique_violation then
    raise exception 'That player has just been drafted by someone else.';
  end;

  insert into draft_picks (draft_id, league_id, round, pick_number, member_id, player_id, auto_pick)
  values (d.id, p_league, d.current_round, d.current_pick, p_member, p_player, p_auto);

  insert into transactions (league_id, member_id, type, player_in_id)
  values (p_league, p_member, 'draft', p_player);

  perform advance_draft(p_league);
end $$;

-- The best available player who still fits. The counts are gathered once
-- rather than per candidate: this runs against every active player on every
-- auto-pick, and four correlated subqueries a row is six hundred times more
-- work than four subqueries.
create or replace function best_available(p_league uuid, p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  with counts as (
    select pos,
           (select count(*)::int from roster_players r
              join epl_players p on p.id = r.player_id
             where r.member_id = p_member and p.position = pos) as c
      from unnest(enum_range(null::player_pos)) pos
  ),
  flex as (select coalesce(sum(greatest(0, c - pos_min(pos))), 0)::int as used from counts)
  select p.id
  from epl_players p
  join counts cn on cn.pos = p.position
  cross join flex
  where p.active
    and not exists (select 1 from roster_players r
                     where r.league_id = p_league and r.player_id = p.id)
    and flex.used + (case when cn.c >= pos_min(p.position) then 1 else 0 end) <= 1
  order by p.prev_season_points desc, p.current_season_points desc, p.id
  limit 1;
$$;

-- ------------------------------------------------------------ free agency ---

-- Unchanged but for the position rule, which was "the same one" and is now
-- "whatever leaves you legal".
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

  -- Keep the lineup valid: the new player inherits the dropped player's slot.
  -- Where the positions differ that slot may now be the wrong shape, so
  -- ensure_lineup gets the last word rather than the swap.
  v_gw := current_gw();
  update lineups set player_id = p_add
   where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  perform ensure_lineup(me, v_gw);
  perform ensure_lineup(me, next_gw());
end $$;

-- ----------------------------------------------------------------- trades ---

-- Both sides must own what they are sending and nobody may be locked. The
-- position match is gone: a trade is legal when both squads are legal after it,
-- which permits Saka for Saliba if one of the two has a spare defender's worth
-- of flex and refuses it otherwise. Checked on propose and again on accept, so
-- a trade made legal by someone else's signing cannot be accepted later.
create or replace function validate_trade_sides(
  p_league uuid, p_a uuid, p_b uuid, p_offer int[], p_request int[])
returns void language plpgsql stable security definer set search_path = public as $$
declare pid int; a_out player_pos[]; a_in player_pos[];
begin
  foreach pid in array p_offer loop
    if not exists (select 1 from roster_players where member_id = p_a and player_id = pid) then
      raise exception 'A player in this trade is no longer owned by the proposer.';
    end if;
    if is_player_locked(pid) then raise exception 'A player in this trade has already kicked off.'; end if;
  end loop;

  foreach pid in array p_request loop
    if not exists (select 1 from roster_players where member_id = p_b and player_id = pid) then
      raise exception 'A player in this trade is no longer owned by the other manager.';
    end if;
    if is_player_locked(pid) then raise exception 'A player in this trade has already kicked off.'; end if;
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

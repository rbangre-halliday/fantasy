-- ============================================================================
--  Stop a signing rewriting a gameweek that has already been played.
--
--  GoonerParty signed De Cuyper on the Wednesday, and De Cuyper's seventeen
--  points from Saturday appeared in their gameweek 1 XI. Pedro Porro, who was
--  in that XI when it was played, vanished from it. Same again with Gonzalo for
--  Watkins. Their gameweek 1 score went from 61 to 76 for football that happened
--  before either player was theirs.
--
--  16_signings_next_week.sql lets one kind of change land on a gameweek already
--  under way: a like-for-like swap of two players who have not played. That is a
--  single lineup row renamed, the XI keeps its shape, and it is what lets you
--  replace an injured Sunday striker on the Saturday night. The exception is
--  right. The test for it was not:
--
--      not is_player_locked(p_add) and not is_player_locked(p_drop)
--
--  The one-argument is_player_locked asks "is he locked right now", and it
--  releases the lock when the gameweek *finishes* — deliberately, so that next
--  week's lineup becomes editable the moment this week is done. So from the
--  moment FPL confirmed gameweek 1, every player in it read as unlocked, the
--  exception fired for any same-position swap, and the change went into a
--  completed gameweek.
--
--  is_player_locked(player, gw) is the question actually being asked: has his
--  match *in that gameweek* kicked off. It has no opinion about whether the
--  gameweek is over, which is the whole point — a match that has been played
--  stays played. Every other caller was migrated to the two-argument form in
--  10_player_detail.sql; this one was written afterwards and reached for the
--  old one.
--
--  Worth naming the window, because it is wider than it looks. current_gw()
--  follows FPL's is_current, and FPL leaves that on a finished gameweek until
--  the next one's deadline. So "the current gameweek" is a completed gameweek
--  for most of every week — Monday night to Friday evening — and anything that
--  treats current_gw() as "the one still being played" is wrong for four days
--  out of seven. gw_started() and this lock check are both safe against that;
--  it is worth checking against before adding a third.
--
--  Safe to re-run. Supersedes add_drop in 16_signings_next_week.sql.
-- ============================================================================

create or replace function add_drop(p_league uuid, p_add int, p_drop int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; add_pos player_pos; drop_pos player_pos; v_gw int; live int;
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

  live := current_gw();

  -- When the move takes hold. The like-for-like exception asks whether each
  -- man's match *in this gameweek* has kicked off — not whether he happens to
  -- be movable today, which is true again the moment the gameweek is confirmed.
  if not gw_started(live) then
    v_gw := live;
  elsif add_pos = drop_pos
        and not is_player_locked(p_add, live) and not is_player_locked(p_drop, live) then
    v_gw := live;
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
    update lineups set player_id = p_add
     where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  else
    delete from lineups where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  end if;

  perform ensure_lineup(me, v_gw);
  perform ensure_lineup(me, next_gw());
end $$;

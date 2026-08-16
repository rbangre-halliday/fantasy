-- ============================================================================
--  Server-authoritative game logic.
--  Every mutation the client can perform is one of these functions. They run
--  as SECURITY DEFINER (bypassing RLS) and validate before touching state.
--
--  Roster shape: 2 GK / 5 DEF / 5 MID / 4 FWD  = 16
--  Starting XI:  1 GK / 4 DEF / 4 MID / 2 FWD  = 11
--
--  Note on validity: because the positional caps sum to exactly the squad size,
--  "never exceed a cap" is by itself enough to guarantee a completable squad.
--  That is why the checks below are as short as they are.
-- ============================================================================

-- --------------------------------------------------------------- shared ---

create or replace function pos_cap(p player_pos)
returns int language sql immutable as $$
  select case p when 'GK' then 2 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 4 end;
$$;

create or replace function pos_start(p player_pos)
returns int language sql immutable as $$
  select case p when 'GK' then 1 when 'DEF' then 4 when 'MID' then 4 when 'FWD' then 2 end;
$$;

create or replace function current_gw()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from gameweeks where is_current order by id limit 1),
    (select id from gameweeks where is_next    order by id limit 1),
    (select min(id) from gameweeks),
    1);
$$;

create or replace function next_gw()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from gameweeks where is_next order by id limit 1),
    (select id from gameweeks where not finished order by id limit 1),
    current_gw());
$$;

-- A player locks the moment their own team's match in the current gameweek
-- kicks off, and stays locked until that gameweek is finished. Teams that are
-- blank this gameweek are never locked.
create or replace function is_player_locked(p_player int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from fixtures f
    join epl_players p on p.id = p_player
    join gameweeks  g on g.id = f.gw
    where f.gw = current_gw()
      and not g.finished
      and (f.home_team = p.team_id or f.away_team = p.team_id)
      and (f.started or (f.kickoff is not null and f.kickoff <= now()))
  );
$$;

create or replace function my_member_id(p_league uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from league_members where league_id = p_league and user_id = auth.uid();
$$;

create or replace function assert_member(p_league uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare m uuid;
begin
  select my_member_id(p_league) into m;
  if m is null then raise exception 'You are not a member of this league.'; end if;
  return m;
end $$;

create or replace function assert_commissioner(p_league uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from leagues where id = p_league and commissioner_id = auth.uid()) then
    raise exception 'Only the commissioner can do that.';
  end if;
end $$;

create or replace function pos_count(p_member uuid, p_pos player_pos)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from roster_players r join epl_players p on p.id = r.player_id
  where r.member_id = p_member and p.position = p_pos;
$$;

-- ---------------------------------------------------------------- setup ---

create or replace function gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no I/L/O/0/1
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from leagues where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function create_league(p_name text, p_team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;

  insert into leagues (name, commissioner_id, invite_code, scoring_start_gw)
  values (trim(p_name), auth.uid(), gen_invite_code(), next_gw())
  returning id into l_id;

  insert into league_members (league_id, user_id, team_name)
  values (l_id, auth.uid(), trim(p_team_name));

  return l_id;
end $$;

create or replace function join_league(p_code text, p_team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l leagues%rowtype; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;

  select * into l from leagues where invite_code = upper(trim(p_code));
  if not found then raise exception 'No league with that invite code.'; end if;

  if exists (select 1 from league_members where league_id = l.id and user_id = auth.uid()) then
    return l.id; -- idempotent: already in
  end if;

  if l.status <> 'lobby' then
    raise exception 'That league has already started its draft.';
  end if;

  select count(*) into n from league_members where league_id = l.id;
  if n >= l.max_managers then raise exception 'That league is full (% managers).', l.max_managers; end if;

  insert into league_members (league_id, user_id, team_name)
  values (l.id, auth.uid(), trim(p_team_name));

  return l.id;
end $$;

create or replace function rename_team(p_league uuid, p_team_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_member(p_league);
  update league_members set team_name = trim(p_team_name)
  where league_id = p_league and user_id = auth.uid();
end $$;

create or replace function leave_league(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st league_status;
begin
  select status into st from leagues where id = p_league;
  if st <> 'lobby' then raise exception 'You can only leave before the draft starts.'; end if;
  if exists (select 1 from leagues where id = p_league and commissioner_id = auth.uid()) then
    raise exception 'The commissioner cannot leave. Delete the league instead.';
  end if;
  delete from league_members where league_id = p_league and user_id = auth.uid();
end $$;

create or replace function delete_league(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_commissioner(p_league);
  if (select status from leagues where id = p_league) <> 'lobby' then
    raise exception 'A league can only be deleted before the draft starts.';
  end if;
  delete from leagues where id = p_league;
end $$;

create or replace function remove_manager(p_league uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_commissioner(p_league);
  if (select status from leagues where id = p_league) <> 'lobby' then
    raise exception 'Managers can only be removed before the draft starts.';
  end if;
  if exists (select 1 from league_members m join leagues l on l.id = m.league_id
             where m.id = p_member and l.commissioner_id = m.user_id) then
    raise exception 'The commissioner cannot be removed.';
  end if;
  delete from league_members where id = p_member and league_id = p_league;
end $$;

-- ---------------------------------------------------------------- draft ---

-- Which member picks at overall pick number N, snake order.
create or replace function snake_member(p_league uuid, p_pick int)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare n int; rnd int; idx int; slot int;
begin
  select count(*) into n from league_members where league_id = p_league;
  if n = 0 then return null; end if;
  rnd  := ((p_pick - 1) / n) + 1;
  idx  := ((p_pick - 1) % n) + 1;
  slot := case when rnd % 2 = 1 then idx else n + 1 - idx end;
  return (select id from league_members where league_id = p_league and draft_position = slot);
end $$;

create or replace function start_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; d_id uuid; secs int;
begin
  perform assert_commissioner(p_league);

  if (select status from leagues where id = p_league) <> 'lobby' then
    raise exception 'The draft has already started.';
  end if;

  select count(*) into n from league_members where league_id = p_league;
  if n < 2 then raise exception 'You need at least 2 managers to draft.'; end if;

  if (select count(*) from epl_players where active) < n * 16 then
    raise exception 'Player data has not been loaded yet. Try again in a minute.';
  end if;

  -- Randomised draft order, fixed for the whole snake.
  with shuffled as (
    select id, row_number() over (order by random()) as rn
    from league_members where league_id = p_league
  )
  update league_members m set draft_position = s.rn from shuffled s where m.id = s.id;

  select pick_seconds into secs from leagues where id = p_league;

  insert into drafts (league_id, status, current_round, current_pick, current_member_id,
                      pick_deadline, total_rounds)
  values (p_league, 'running', 1, 1, snake_member(p_league, 1), now() + make_interval(secs => secs), 16)
  on conflict (league_id) do update
    set status = 'running', current_round = 1, current_pick = 1,
        current_member_id = snake_member(p_league, 1),
        pick_deadline = now() + make_interval(secs => secs),
        paused_remaining_ms = null
  returning id into d_id;

  update leagues
     set status = 'drafting',
         scoring_start_gw = next_gw()
   where id = p_league;
end $$;

-- Internal: move the draft on one pick, or finish it.
create or replace function advance_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; n int; total int; secs int; nxt int;
begin
  select * into d from drafts where league_id = p_league for update;
  select count(*) into n from league_members where league_id = p_league;
  select pick_seconds into secs from leagues where id = p_league;

  total := n * d.total_rounds;
  nxt   := d.current_pick + 1;

  if nxt > total then
    update drafts set status = 'complete', current_member_id = null, pick_deadline = null
     where id = d.id;
    update leagues set status = 'active' where id = p_league;
    perform ensure_lineup(m.id, current_gw()) from league_members m where m.league_id = p_league;
    perform ensure_lineup(m.id, next_gw())    from league_members m where m.league_id = p_league;
  else
    update drafts
       set current_pick      = nxt,
           current_round     = ((nxt - 1) / n) + 1,
           current_member_id = snake_member(p_league, nxt),
           pick_deadline     = now() + make_interval(secs => secs)
     where id = d.id;
  end if;
end $$;

-- Internal: record a pick. Shared by manual picks, auto-picks and the
-- commissioner's manual assignment.
create or replace function do_pick(p_league uuid, p_member uuid, p_player int, p_auto boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; pos player_pos;
begin
  select * into d from drafts where league_id = p_league;

  select position into pos from epl_players where id = p_player and active;
  if pos is null then raise exception 'Unknown player.'; end if;

  if pos_count(p_member, pos) >= pos_cap(pos) then
    raise exception 'Your squad is already full at %.', pos;
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

create or replace function make_pick(p_league uuid, p_player int)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; me uuid;
begin
  me := assert_member(p_league);

  select * into d from drafts where league_id = p_league for update;
  if d.status <> 'running' then raise exception 'The draft is not running.'; end if;

  -- Someone may have run out of time while this request was in flight.
  if d.pick_deadline is not null and now() > d.pick_deadline then
    perform draft_tick(p_league);
    select * into d from drafts where league_id = p_league for update;
  end if;

  if d.current_member_id <> me then raise exception 'It is not your pick.'; end if;

  perform do_pick(p_league, me, p_player, false);
end $$;

-- The best available player who still fits a given manager's squad.
create or replace function best_available(p_league uuid, p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  select p.id
  from epl_players p
  where p.active
    and not exists (select 1 from roster_players r
                     where r.league_id = p_league and r.player_id = p.id)
    and pos_count(p_member, p.position) < pos_cap(p.position)
  order by p.prev_season_points desc, p.current_season_points desc, p.id
  limit 1;
$$;

-- Called by every connected client roughly once a second. The server clock is
-- the only clock that matters; the call is a no-op unless the deadline has
-- genuinely passed. Loops so a disconnected league still catches up.
create or replace function draft_tick(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; pick int; guard int := 0;
begin
  loop
    guard := guard + 1;
    exit when guard > 200;

    select * into d from drafts where league_id = p_league for update;
    exit when not found;
    exit when d.status <> 'running';
    exit when d.pick_deadline is null or now() <= d.pick_deadline;

    pick := best_available(p_league, d.current_member_id);
    if pick is null then
      -- Should be unreachable, but never wedge the draft on it.
      perform advance_draft(p_league);
    else
      perform do_pick(p_league, d.current_member_id, pick, true);
    end if;
  end loop;
end $$;

create or replace function pause_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype;
begin
  perform assert_commissioner(p_league);
  select * into d from drafts where league_id = p_league for update;
  if d.status <> 'running' then raise exception 'The draft is not running.'; end if;
  update drafts
     set status = 'paused',
         paused_remaining_ms = greatest(0, extract(epoch from (d.pick_deadline - now())) * 1000)::int,
         pick_deadline = null
   where id = d.id;
end $$;

create or replace function resume_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype;
begin
  perform assert_commissioner(p_league);
  select * into d from drafts where league_id = p_league for update;
  if d.status <> 'paused' then raise exception 'The draft is not paused.'; end if;
  update drafts
     set status = 'running',
         pick_deadline = now() + make_interval(secs => coalesce(d.paused_remaining_ms, 0) / 1000.0),
         paused_remaining_ms = null
   where id = d.id;
end $$;

create or replace function undo_last_pick(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; lp draft_picks%rowtype; n int; secs int;
begin
  perform assert_commissioner(p_league);
  select * into d from drafts where league_id = p_league for update;

  select * into lp from draft_picks
   where draft_id = d.id order by pick_number desc limit 1;
  if not found then raise exception 'There are no picks to undo.'; end if;

  select count(*) into n from league_members where league_id = p_league;
  select pick_seconds into secs from leagues where id = p_league;

  delete from roster_players where league_id = p_league and player_id = lp.player_id;
  delete from transactions
   where league_id = p_league and type = 'draft' and player_in_id = lp.player_id;
  delete from draft_picks where id = lp.id;

  update drafts
     set current_pick      = lp.pick_number,
         current_round     = lp.round,
         current_member_id = lp.member_id,
         status            = case when d.status = 'complete' then 'running' else d.status end,
         pick_deadline     = case when d.status = 'paused' then null
                                  else now() + make_interval(secs => secs) end
   where id = d.id;

  update leagues set status = 'drafting' where id = p_league and status = 'active';
end $$;

-- --------------------------------------------------------------- lineup ---

-- Guarantees a member has a complete, valid lineup row-set for a gameweek.
-- Carries the previous gameweek's choices forward where the players are still
-- owned, then fills any gaps with the best-ranked eligible squad members.
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

  -- Top up starters position by position, best previous-season points first.
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
         order by p.prev_season_points desc, p.current_season_points desc
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

-- p_starters must be 11 player ids forming 1/4/4/2. p_bench is the remaining 5
-- in substitution-priority order.
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

  -- A player whose match has kicked off cannot change status this gameweek.
  foreach pid in array (p_starters || p_bench) loop
    select status into old_status from lineups
     where member_id = me and gw = p_gw and player_id = pid;
    if old_status is not null and is_player_locked(pid) then
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

-- -------------------------------------------------------- free agents -----

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

  -- Squad size is fixed at 16 and the caps sum to 16, so the incoming and
  -- outgoing player must share a position for the squad to stay valid.
  if add_pos <> drop_pos then
    raise exception 'You must drop a % to sign a %.', add_pos, add_pos;
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
  v_gw := current_gw();
  update lineups set player_id = p_add
   where member_id = me and lineups.gw >= v_gw and player_id = p_drop;
  perform ensure_lineup(me, v_gw);
  perform ensure_lineup(me, next_gw());
end $$;

-- ---------------------------------------------------------------- trades ---

create or replace function propose_trade(p_league uuid, p_receiver uuid, p_offer int[], p_request int[])
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; t_id uuid; pid int;
begin
  me := assert_member(p_league);

  if (select status from leagues where id = p_league) <> 'active' then
    raise exception 'Trading opens once the draft is complete.';
  end if;
  if p_receiver = me then raise exception 'You cannot trade with yourself.'; end if;
  if coalesce(array_length(p_offer, 1), 0)   not between 1 and 3
     or coalesce(array_length(p_request, 1), 0) not between 1 and 3 then
    raise exception 'A trade must involve 1 to 3 players on each side.';
  end if;
  if not exists (select 1 from league_members where id = p_receiver and league_id = p_league) then
    raise exception 'That manager is not in this league.';
  end if;

  perform validate_trade_sides(p_league, me, p_receiver, p_offer, p_request);

  insert into trades (league_id, proposer_id, receiver_id)
  values (p_league, me, p_receiver) returning id into t_id;

  foreach pid in array p_offer loop
    insert into trade_players (trade_id, player_id, from_member, to_member)
    values (t_id, pid, me, p_receiver);
  end loop;
  foreach pid in array p_request loop
    insert into trade_players (trade_id, player_id, from_member, to_member)
    values (t_id, pid, p_receiver, me);
  end loop;

  return t_id;
end $$;

-- Both sides must own what they are sending, nobody may be locked, and because
-- squad size and caps are fixed, each position given up must be matched.
create or replace function validate_trade_sides(
  p_league uuid, p_a uuid, p_b uuid, p_offer int[], p_request int[])
returns void language plpgsql stable security definer set search_path = public as $$
declare pid int; pos player_pos; c_out int; c_in int;
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

  foreach pos in array array['GK','DEF','MID','FWD']::player_pos[] loop
    select count(*) into c_out from unnest(p_offer)   x join epl_players p on p.id = x where p.position = pos;
    select count(*) into c_in  from unnest(p_request) x join epl_players p on p.id = x where p.position = pos;
    if c_out <> c_in then
      raise exception 'Squads are a fixed 2/5/5/4, so each side must trade the same positions. Mismatch at %.', pos;
    end if;
  end loop;
end $$;

create or replace function respond_trade(p_trade uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t trades%rowtype; me uuid; tp record; gw int;
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

  for tp in select * from trade_players where trade_id = t.id loop
    update roster_players
       set member_id = tp.to_member, acquired_via = 'trade', acquired_at = now()
     where league_id = t.league_id and player_id = tp.player_id;

    insert into transactions (league_id, member_id, type, player_in_id)
    values (t.league_id, tp.to_member, 'trade', tp.player_id);
  end loop;

  update trades set status = 'accepted', resolved_at = now() where id = t.id;

  -- Cancel any other pending trades that involved the players just moved.
  update trades set status = 'cancelled', resolved_at = now()
   where league_id = t.league_id and status = 'pending' and id <> t.id
     and exists (select 1 from trade_players tp2
                  where tp2.trade_id = trades.id
                    and tp2.player_id in (select player_id from trade_players where trade_id = t.id));

  gw := current_gw();
  perform ensure_lineup(t.proposer_id, gw);
  perform ensure_lineup(t.receiver_id, gw);
  perform ensure_lineup(t.proposer_id, next_gw());
  perform ensure_lineup(t.receiver_id, next_gw());
end $$;

create or replace function cancel_trade(p_trade uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t trades%rowtype; me uuid;
begin
  select * into t from trades where id = p_trade for update;
  if not found then raise exception 'Trade not found.'; end if;
  me := assert_member(t.league_id);
  if me <> t.proposer_id then raise exception 'Only the proposing manager can cancel.'; end if;
  if t.status <> 'pending' then raise exception 'That trade is no longer pending.'; end if;
  update trades set status = 'cancelled', resolved_at = now() where id = t.id;
end $$;

-- -------------------------------------------------- commissioner repair ---

create or replace function commish_move_player(p_league uuid, p_player int, p_to_member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_commissioner(p_league);

  if p_to_member is null then
    delete from roster_players where league_id = p_league and player_id = p_player;
    insert into transactions (league_id, type, player_out_id, note)
    values (p_league, 'commissioner', p_player, 'Commissioner released player');
  else
    if pos_count(p_to_member, (select position from epl_players where id = p_player))
       >= pos_cap((select position from epl_players where id = p_player))
       and not exists (select 1 from roster_players
                        where member_id = p_to_member and player_id = p_player) then
      raise exception 'That squad is already full at this position.';
    end if;
    insert into roster_players (league_id, member_id, player_id, acquired_via)
    values (p_league, p_to_member, p_player, 'commissioner')
    on conflict (league_id, player_id)
      do update set member_id = p_to_member, acquired_via = 'commissioner', acquired_at = now();
    insert into transactions (league_id, member_id, type, player_in_id, note)
    values (p_league, p_to_member, 'commissioner', p_player, 'Commissioner assigned player');
    perform ensure_lineup(p_to_member, current_gw());
  end if;
end $$;

create or replace function commish_reverse_trade(p_trade uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t trades%rowtype; tp record;
begin
  select * into t from trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform assert_commissioner(t.league_id);
  if t.status <> 'accepted' then raise exception 'Only an accepted trade can be reversed.'; end if;

  for tp in select * from trade_players where trade_id = t.id loop
    update roster_players set member_id = tp.from_member, acquired_via = 'commissioner'
     where league_id = t.league_id and player_id = tp.player_id;
  end loop;

  update trades set status = 'cancelled', resolved_at = now() where id = t.id;
  insert into transactions (league_id, type, note)
  values (t.league_id, 'commissioner', 'Commissioner reversed a trade');

  perform ensure_lineup(t.proposer_id, current_gw());
  perform ensure_lineup(t.receiver_id, current_gw());
end $$;

-- -------------------------------------------------------------- scoring ---

-- A manager's points for one gameweek, with automatic substitutions applied.
-- A starter who did not appear is replaced by the highest-priority bench player
-- in the same position who did appear; the formation never changes.
create or replace function member_gw_score(p_member uuid, p_gw int)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  total int := 0;
  used  int[] := '{}';
  st    record;
  sub   record;
begin
  for st in
    select ln.player_id, p.position,
           coalesce(pts.points, 0)  as points,
           coalesce(pts.minutes, 0) as minutes
    from lineups ln
    join epl_players p on p.id = ln.player_id
    left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
    where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'starter'
  loop
    if st.minutes > 0 then
      total := total + st.points;
    else
      select ln.player_id, coalesce(pts.points, 0) as points into sub
      from lineups ln
      join epl_players p on p.id = ln.player_id
      left join player_gw_points pts on pts.player_id = ln.player_id and pts.gw = p_gw
      where ln.member_id = p_member and ln.gw = p_gw and ln.status = 'substitute'
        and p.position = st.position
        and coalesce(pts.minutes, 0) > 0
        and not (ln.player_id = any(used))
      order by ln.bench_priority
      limit 1;

      if found then
        total := total + sub.points;
        used  := used || sub.player_id;
      end if;
      -- else: no valid replacement, the slot scores 0.
    end if;
  end loop;

  return total;
end $$;

-- Recompute every finished/in-progress gameweek for every active league.
-- Called by the GitHub Actions sync job after new FPL data lands.
create or replace function recompute_scores()
returns void language plpgsql security definer set search_path = public as $$
declare m record; g int;
begin
  for m in
    select lm.id as member_id, lm.league_id, l.scoring_start_gw
    from league_members lm
    join leagues l on l.id = lm.league_id
    where l.status in ('active','completed')
  loop
    for g in
      select distinct gw from player_gw_points where gw >= m.scoring_start_gw
    loop
      perform ensure_lineup(m.member_id, g);
      insert into member_gw_scores (league_id, member_id, gw, points)
      values (m.league_id, m.member_id, g, member_gw_score(m.member_id, g))
      on conflict (member_id, gw) do update set points = excluded.points;
    end loop;
  end loop;

  -- Season over once the final gameweek is finished.
  update leagues set status = 'completed'
   where status = 'active'
     and not exists (select 1 from gameweeks where not finished);
end $$;

-- Keeps lineups materialised for the current and next gameweek. Also run by
-- the sync job so nobody's squad is ever missing a lineup.
create or replace function refresh_lineups()
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select lm.id from league_members lm join leagues l on l.id = lm.league_id
           where l.status = 'active'
  loop
    perform ensure_lineup(m.id, current_gw());
    perform ensure_lineup(m.id, next_gw());
  end loop;
end $$;

-- ------------------------------------------------------------- read API ---

-- One round-trip for the player list: ranking, ownership and lock state.
create or replace function league_players(p_league uuid)
returns table (
  id int, web_name text, first_name text, second_name text,
  "position" player_pos, team_id int, club text, club_short text,
  prev_season_points int, current_season_points int,
  status text, news text,
  owner_member_id uuid, owner_team_name text, locked boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.web_name, p.first_name, p.second_name,
         p.position, p.team_id, t.name, t.short_name,
         p.prev_season_points, p.current_season_points,
         p.status, p.news,
         r.member_id, lm.team_name,
         is_player_locked(p.id)
  from epl_players p
  left join epl_teams t on t.id = p.team_id
  left join roster_players r on r.league_id = p_league and r.player_id = p.id
  left join league_members lm on lm.id = r.member_id
  where p.active and is_league_member(p_league)
  order by p.prev_season_points desc, p.current_season_points desc, p.web_name;
$$;

create or replace function member_squad(p_member uuid, p_gw int)
returns table (
  player_id int, web_name text, "position" player_pos, club_short text,
  lineup_status lineup_status, bench_priority int,
  gw_points int, minutes int, total_points int, locked boolean,
  kickoff timestamptz, status text, news text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.web_name, p.position, t.short_name,
         ln.status, ln.bench_priority,
         coalesce(pts.points, 0), coalesce(pts.minutes, 0),
         p.current_season_points,
         is_player_locked(p.id),
         (select min(f.kickoff) from fixtures f
           where f.gw = p_gw and (f.home_team = p.team_id or f.away_team = p.team_id)),
         p.status, p.news
  from roster_players r
  join epl_players p on p.id = r.player_id
  left join epl_teams t on t.id = p.team_id
  left join lineups ln on ln.member_id = r.member_id and ln.gw = p_gw and ln.player_id = p.id
  left join player_gw_points pts on pts.player_id = p.id and pts.gw = p_gw
  where r.member_id = p_member
    and is_league_member(r.league_id)
  order by
    case p.position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
    (ln.status = 'starter') desc nulls last, ln.bench_priority nulls last,
    p.prev_season_points desc;
$$;

-- The draft clock must not depend on whether a manager's laptop clock is
-- right. Clients read this once and hold the offset.
create or replace function server_now()
returns timestamptz language sql stable as $$ select now(); $$;

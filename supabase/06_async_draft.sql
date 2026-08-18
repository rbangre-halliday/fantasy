-- ============================================================================
--  Async drafts.
--
--  A live draft runs on a two-minute clock and auto-picks when it expires,
--  which needs everyone in the room at the same time. An async draft has no
--  clock at all: it is simply your turn until you take it. Six friends in
--  different time zones can draft over a week.
--
--  Everything else is identical — same snake order, same positional rules,
--  same auto-pick code path when a commissioner wants to force one through.
--
--  Safe to run more than once.
-- ============================================================================

alter table leagues
  add column if not exists draft_mode text not null default 'live';

do $$ begin
  alter table leagues add constraint leagues_draft_mode_ck
    check (draft_mode in ('live', 'async'));
exception when duplicate_object then null; end $$;

comment on column leagues.draft_mode is
  'live = two-minute clock with auto-pick; async = turn-based, no deadline';

-- ---------------------------------------------------------------------------
-- start_draft: an async draft opens with no deadline on the board.
-- ---------------------------------------------------------------------------
create or replace function start_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; secs int; mode text;
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

  with shuffled as (
    select id, row_number() over (order by random()) as rn
    from league_members where league_id = p_league
  )
  update league_members m set draft_position = s.rn from shuffled s where m.id = s.id;

  select pick_seconds, draft_mode into secs, mode from leagues where id = p_league;

  insert into drafts (league_id, status, current_round, current_pick, current_member_id,
                      pick_deadline, total_rounds)
  values (p_league, 'running', 1, 1, snake_member(p_league, 1),
          case when mode = 'async' then null else now() + make_interval(secs => secs) end,
          16)
  on conflict (league_id) do update
    set status = 'running', current_round = 1, current_pick = 1,
        current_member_id = snake_member(p_league, 1),
        pick_deadline = case when mode = 'async' then null
                             else now() + make_interval(secs => secs) end,
        paused_remaining_ms = null;

  update leagues
     set status = 'drafting',
         scoring_start_gw = next_gw()
   where id = p_league;
end $$;

-- ---------------------------------------------------------------------------
-- advance_draft: same, for every pick after the first.
-- ---------------------------------------------------------------------------
create or replace function advance_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; n int; total int; secs int; nxt int; mode text;
begin
  select * into d from drafts where league_id = p_league for update;
  select count(*) into n from league_members where league_id = p_league;
  select pick_seconds, draft_mode into secs, mode from leagues where id = p_league;

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
           pick_deadline     = case when mode = 'async' then null
                                    else now() + make_interval(secs => secs) end
     where id = d.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- draft_tick: nothing to do without a clock. Clients call this on a timer, so
-- it has to be cheap and harmless in async mode rather than merely correct.
-- ---------------------------------------------------------------------------
create or replace function draft_tick(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; pick int; guard int := 0;
begin
  if (select draft_mode from leagues where id = p_league) = 'async' then
    return;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 200;

    select * into d from drafts where league_id = p_league for update;
    exit when not found;
    exit when d.status <> 'running';
    exit when d.pick_deadline is null or now() <= d.pick_deadline;

    pick := best_available(p_league, d.current_member_id);
    if pick is null then
      perform advance_draft(p_league);
    else
      perform do_pick(p_league, d.current_member_id, pick, true);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- pause/resume are meaningless without a clock, so say so rather than leaving
-- a control that half-works.
-- ---------------------------------------------------------------------------
create or replace function pause_draft(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype;
begin
  perform assert_commissioner(p_league);
  if (select draft_mode from leagues where id = p_league) = 'async' then
    raise exception 'An async draft has no clock to pause.';
  end if;
  select * into d from drafts where league_id = p_league for update;
  if d.status <> 'running' then raise exception 'The draft is not running.'; end if;
  update drafts
     set status = 'paused',
         paused_remaining_ms = greatest(0, extract(epoch from (d.pick_deadline - now())) * 1000)::int,
         pick_deadline = null
   where id = d.id;
end $$;

-- ---------------------------------------------------------------------------
-- The commissioner's nudge: take the pick for whoever is holding everyone up.
-- In a live draft the clock does this; in an async one somebody has to ask.
-- ---------------------------------------------------------------------------
create or replace function force_pick(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d drafts%rowtype; pick int;
begin
  perform assert_commissioner(p_league);
  select * into d from drafts where league_id = p_league for update;
  if not found or d.status <> 'running' then
    raise exception 'The draft is not running.';
  end if;
  pick := best_available(p_league, d.current_member_id);
  if pick is null then raise exception 'No eligible player is available.'; end if;
  perform do_pick(p_league, d.current_member_id, pick, true);
end $$;

grant execute on function force_pick(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_league gains the mode. The old two-argument form is kept so anything
-- still calling it kicks off a live draft exactly as before.
-- ---------------------------------------------------------------------------
create or replace function create_league(p_name text, p_team_name text, p_mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_mode not in ('live', 'async') then raise exception 'Unknown draft mode.'; end if;

  insert into leagues (name, commissioner_id, invite_code, scoring_start_gw, draft_mode)
  values (trim(p_name), auth.uid(), gen_invite_code(), next_gw(), p_mode)
  returning id into l_id;

  insert into league_members (league_id, user_id, team_name)
  values (l_id, auth.uid(), trim(p_team_name));

  return l_id;
end $$;

grant execute on function create_league(text,text,text) to authenticated;

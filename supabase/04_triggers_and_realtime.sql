-- ============================================================================
--  Signup hook, realtime publication, and grants.
--  Run LAST.
-- ============================================================================

-- Every auth user gets a profile row automatically, so the app never has to
-- deal with a half-created account.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------- realtime ---
-- The draft room and every league screen subscribe to these. Postgres changes
-- are broadcast only to clients whose RLS lets them see the row.
do $$
declare t text;
begin
  foreach t in array array[
    'drafts','draft_picks','roster_players','league_members','leagues',
    'trades','transactions','member_gw_scores','lineups'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Realtime needs the old row to route DELETEs against RLS.
alter table roster_players replica identity full;
alter table league_members replica identity full;

-- --------------------------------------------------------------- grants ---
-- Clients may only execute the vetted RPCs; direct table writes stay blocked
-- by RLS (no write policies exist).
do $$
declare f text;
begin
  foreach f in array array[
    'create_league(text,text)',
    'join_league(text,text)',
    'rename_team(uuid,text)',
    'leave_league(uuid)',
    'delete_league(uuid)',
    'remove_manager(uuid,uuid)',
    'start_draft(uuid)',
    'make_pick(uuid,int)',
    'draft_tick(uuid)',
    'pause_draft(uuid)',
    'resume_draft(uuid)',
    'undo_last_pick(uuid)',
    'set_lineup(uuid,int,int[],int[])',
    'ensure_lineup(uuid,int)',
    'add_drop(uuid,int,int)',
    'propose_trade(uuid,uuid,int[],int[])',
    'respond_trade(uuid,boolean)',
    'cancel_trade(uuid)',
    'commish_move_player(uuid,int,uuid)',
    'commish_reverse_trade(uuid)',
    'league_players(uuid)',
    'member_squad(uuid,int)',
    'current_gw()',
    'next_gw()',
    'is_player_locked(int)',
    'server_now()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Scoring/maintenance jobs are service-role only.
revoke execute on function recompute_scores()  from authenticated, anon;
revoke execute on function refresh_lineups()   from authenticated, anon;
revoke execute on function do_pick(uuid,uuid,int,boolean) from authenticated, anon;
revoke execute on function advance_draft(uuid) from authenticated, anon;

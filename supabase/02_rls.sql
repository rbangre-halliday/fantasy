-- ============================================================================
--  Row Level Security
--  Rule of thumb: the client may READ what it is entitled to see, and may
--  WRITE almost nothing directly. Every state change goes through a
--  SECURITY DEFINER function in 03_functions.sql that validates first.
-- ============================================================================

-- Postgres 15+ (which Supabase runs) lets a view respect the caller's RLS.
do $$ begin
  execute 'alter view league_standings set (security_invoker = on)';
exception when others then
  raise notice 'security_invoker unavailable on this server; standings view runs as definer';
end $$;

-- Reference data: readable by anyone signed in, writable only by service role.
alter table epl_teams        enable row level security;
alter table epl_players      enable row level security;
alter table gameweeks        enable row level security;
alter table fixtures         enable row level security;
alter table player_gw_points enable row level security;

do $$
declare t text;
begin
  foreach t in array array['epl_teams','epl_players','gameweeks','fixtures','player_gw_points'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (true)', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: is the current user a member of this league?
-- ---------------------------------------------------------------------------
create or replace function is_league_member(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_members
    where league_id = p_league and user_id = auth.uid()
  );
$$;

create or replace function is_commissioner(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leagues where id = p_league and commissioner_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------- profiles ---
alter table profiles enable row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);

drop policy if exists profiles_upsert_self on profiles;
create policy profiles_upsert_self on profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- -------------------------------------------------------------- leagues ---
alter table leagues enable row level security;

-- A league is visible to its members. Joining by code goes through an RPC,
-- so non-members never need SELECT on a league they aren't in.
drop policy if exists leagues_read on leagues;
create policy leagues_read on leagues for select to authenticated
  using (is_league_member(id) or commissioner_id = auth.uid());

-- ------------------------------------------------- everything else: read ---
do $$
declare t text;
begin
  foreach t in array array[
    'league_members','roster_players','lineups','drafts','draft_picks',
    'trades','transactions','member_gw_scores'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format(
      'create policy %I_read on %I for select to authenticated using (is_league_member(league_id))',
      t, t);
  end loop;
end $$;

-- trade_players has no league_id column, so it is scoped through its trade.
alter table trade_players enable row level security;
drop policy if exists trade_players_read on trade_players;
create policy trade_players_read on trade_players for select to authenticated
  using (exists (select 1 from trades t where t.id = trade_id and is_league_member(t.league_id)));

-- NOTE: no INSERT/UPDATE/DELETE policies exist for any of the tables above.
-- With RLS on and no write policy, all direct client writes are rejected.
-- The SECURITY DEFINER RPCs bypass RLS by design and do the validating.

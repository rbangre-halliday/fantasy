-- ============================================================================
--  EPL Fantasy Draft — schema
--  Run this FIRST in the Supabase SQL editor (or via `supabase db push`).
--  Everything the server must be authoritative about lives here:
--  ownership uniqueness, roster shape, locking, draft order, scoring.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums ----
do $$ begin
  create type league_status  as enum ('lobby','drafting','active','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type draft_status   as enum ('pending','running','paused','complete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type player_pos     as enum ('GK','DEF','MID','FWD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type acquisition    as enum ('draft','free_agent','trade','commissioner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lineup_status  as enum ('starter','substitute');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_status   as enum ('pending','accepted','rejected','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_type       as enum ('draft','add','drop','add_drop','trade','commissioner');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------- global EPL data ---
-- These tables are owned by the sync job (service role). Everyone can read.

create table if not exists epl_teams (
  id          int primary key,             -- FPL team id
  name        text not null,
  short_name  text not null
);

create table if not exists epl_players (
  id                    int primary key,   -- FPL element id (authoritative, stable)
  code                  int,
  first_name            text,
  second_name           text,
  web_name              text not null,
  team_id               int references epl_teams(id),
  position              player_pos not null,
  prev_season_points    int not null default 0,
  current_season_points int not null default 0,
  status                text default 'a',  -- a/d/i/s/u from FPL (available/doubtful/injured/…)
  news                  text default '',
  active                boolean not null default true,
  updated_at            timestamptz not null default now()
);
create index if not exists epl_players_pos_idx  on epl_players(position);
create index if not exists epl_players_rank_idx on epl_players(prev_season_points desc, current_season_points desc);

create table if not exists gameweeks (
  id            int primary key,           -- FPL event id (1..38)
  name          text not null,
  deadline      timestamptz not null,
  is_current    boolean not null default false,
  is_next       boolean not null default false,
  finished      boolean not null default false,
  data_checked  boolean not null default false
);

create table if not exists fixtures (
  id            int primary key,
  gw            int references gameweeks(id),
  kickoff       timestamptz,
  home_team     int references epl_teams(id),
  away_team     int references epl_teams(id),
  started       boolean not null default false,
  finished      boolean not null default false
);
create index if not exists fixtures_gw_idx on fixtures(gw);

-- Per-player, per-gameweek official FPL points. The single source of scoring.
create table if not exists player_gw_points (
  player_id  int not null references epl_players(id) on delete cascade,
  gw         int not null,
  points     int not null default 0,
  minutes    int not null default 0,
  primary key (player_id, gw)
);
create index if not exists pgp_gw_idx on player_gw_points(gw);

-- ------------------------------------------------------------ app data ----

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists leagues (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(trim(name)) between 2 and 40),
  commissioner_id       uuid not null references profiles(id),
  invite_code           text not null unique,
  status                league_status not null default 'lobby',
  scoring_start_gw      int not null default 1,
  max_managers          int not null default 6 check (max_managers between 2 and 6),
  pick_seconds          int not null default 120,
  created_at            timestamptz not null default now()
);

create table if not exists league_members (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  team_name      text not null check (length(trim(team_name)) between 2 and 30),
  draft_position int,
  joined_at      timestamptz not null default now(),
  unique (league_id, user_id),
  unique (league_id, draft_position)
);
create index if not exists lm_user_idx on league_members(user_id);

-- THE ownership table. The unique constraint below is what makes it impossible
-- for two managers in one league to own the same EPL player, no matter how many
-- requests race each other.
create table if not exists roster_players (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues(id) on delete cascade,
  member_id    uuid not null references league_members(id) on delete cascade,
  player_id    int  not null references epl_players(id),
  acquired_via acquisition not null,
  acquired_at  timestamptz not null default now(),
  unique (league_id, player_id)
);
create index if not exists roster_member_idx on roster_players(member_id);

create table if not exists lineups (
  league_id     uuid not null references leagues(id) on delete cascade,
  member_id     uuid not null references league_members(id) on delete cascade,
  gw            int  not null,
  player_id     int  not null references epl_players(id),
  status        lineup_status not null,
  bench_priority int,
  primary key (member_id, gw, player_id)
);
create index if not exists lineups_gw_idx on lineups(league_id, gw);

create table if not exists drafts (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null unique references leagues(id) on delete cascade,
  status              draft_status not null default 'pending',
  current_round       int not null default 1,
  current_pick        int not null default 1,          -- overall pick number, 1-based
  current_member_id   uuid references league_members(id),
  pick_deadline       timestamptz,
  paused_remaining_ms int,                             -- preserved across pause/resume
  total_rounds        int not null default 16,
  created_at          timestamptz not null default now()
);

create table if not exists draft_picks (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references drafts(id) on delete cascade,
  league_id   uuid not null references leagues(id) on delete cascade,
  round       int not null,
  pick_number int not null,
  member_id   uuid not null references league_members(id) on delete cascade,
  player_id   int  not null references epl_players(id),
  auto_pick   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (draft_id, pick_number)
);

create table if not exists trades (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues(id) on delete cascade,
  proposer_id  uuid not null references league_members(id) on delete cascade,
  receiver_id  uuid not null references league_members(id) on delete cascade,
  status       trade_status not null default 'pending',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check (proposer_id <> receiver_id)
);

create table if not exists trade_players (
  id          uuid primary key default gen_random_uuid(),
  trade_id    uuid not null references trades(id) on delete cascade,
  player_id   int  not null references epl_players(id),
  from_member uuid not null references league_members(id) on delete cascade,
  to_member   uuid not null references league_members(id) on delete cascade
);
create index if not exists trade_players_trade_idx on trade_players(trade_id);

create table if not exists transactions (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  member_id     uuid references league_members(id) on delete set null,
  type          txn_type not null,
  player_in_id  int references epl_players(id),
  player_out_id int references epl_players(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists txn_league_idx on transactions(league_id, created_at desc);

-- Materialised weekly scores, recomputed by the sync job after FPL data lands.
create table if not exists member_gw_scores (
  league_id uuid not null references leagues(id) on delete cascade,
  member_id uuid not null references league_members(id) on delete cascade,
  gw        int  not null,
  points    int  not null default 0,
  primary key (member_id, gw)
);
create index if not exists mgs_league_idx on member_gw_scores(league_id);

-- ---------------------------------------------------------------- views ---

create or replace view league_standings as
select
  m.league_id,
  m.id                      as member_id,
  m.user_id,
  m.team_name,
  p.name                    as manager_name,
  coalesce(sum(s.points) filter (where s.gw >= l.scoring_start_gw), 0)::int as total_points,
  coalesce(max(s.points) filter (where s.gw = (select id from gameweeks where is_current limit 1)
                                   and s.gw >= l.scoring_start_gw), 0)::int as gw_points
from league_members m
join leagues  l on l.id = m.league_id
join profiles p on p.id = m.user_id
left join member_gw_scores s on s.member_id = m.id
group by m.league_id, m.id, m.user_id, m.team_name, p.name;

-- ============================================================================
--  Table predictions.
--
--  Before a ball is kicked, every manager puts the twenty clubs in the order
--  they think the real Premier League will finish. All season the app scores
--  that guess against the actual table, and the result is a bonus added to
--  their league total.
--
--  Two things this needs that the schema did not have: real scorelines (the
--  fixtures table stored who and when, never what happened), and a table of
--  the actual standings computed from them.
--
--  Safe to run more than once.
-- ============================================================================

-- ------------------------------------------------------------- scorelines ---
-- FPL serves these on the same /fixtures/ payload the sync job already pulls.
alter table fixtures add column if not exists home_score int;
alter table fixtures add column if not exists away_score int;

-- ------------------------------------------------------- the actual table ---
--
-- Computed, not imported: FPL's own team rows carry played/points/position
-- fields that sit at zero all season, so the only honest source is the results
-- themselves. Three points a win, one a draw, split on goal difference then
-- goals scored — the Premier League's own order, and alphabetical while
-- everyone is still on nothing.
--
-- Scoped to clubs with fixtures this season, so relegated teams left behind in
-- epl_teams by an earlier sync don't turn the table into a 23-club league.
create or replace view epl_table as
with results as (
  select home_team as team, home_score as gf, away_score as ga
    from fixtures where finished and home_score is not null and away_score is not null
  union all
  select away_team as team, away_score as gf, home_score as ga
    from fixtures where finished and home_score is not null and away_score is not null
),
totals as (
  select
    t.id                                                        as team_id,
    t.name,
    t.short_name,
    t.code,
    count(r.team)::int                                          as played,
    coalesce(sum(case when r.gf > r.ga then 3
                      when r.gf = r.ga then 1 else 0 end), 0)::int as points,
    coalesce(sum(r.gf - r.ga), 0)::int                          as goal_diff,
    coalesce(sum(r.gf), 0)::int                                 as scored
  from epl_teams t
  left join results r on r.team = t.id
  where exists (select 1 from fixtures f
                 where f.home_team = t.id or f.away_team = t.id)
  group by t.id, t.name, t.short_name, t.code
)
select
  totals.*,
  row_number() over (order by points desc, goal_diff desc, scored desc, name)::int as position
from totals;

grant select on epl_table to authenticated;

-- --------------------------------------------------------------- the entry ---
create table if not exists predictions (
  league_id     uuid not null references leagues(id) on delete cascade,
  member_id     uuid not null references league_members(id) on delete cascade,
  team_id       int  not null references epl_teams(id),
  predicted_pos int  not null check (predicted_pos between 1 and 20),
  updated_at    timestamptz not null default now(),
  primary key (member_id, team_id),
  -- One club per slot: the two unique constraints together are what make an
  -- entry a permutation rather than a wish list.
  unique (member_id, predicted_pos)
);
create index if not exists predictions_league_idx on predictions(league_id);

-- ---------------------------------------------------------------- deadline ---
--
-- Predictions close when the first match of the league's first scoring
-- gameweek kicks off — the same principle as player locking, one gameweek
-- wider. The gameweek's own FPL deadline is the fallback for a league whose
-- fixtures aren't scheduled yet.
create or replace function predictions_deadline(p_league uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(f.kickoff) from fixtures f
      where f.gw = (select scoring_start_gw from leagues where id = p_league)
        and f.kickoff is not null),
    (select g.deadline from gameweeks g
      where g.id = (select scoring_start_gw from leagues where id = p_league)));
$$;

create or replace function predictions_open(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(now() < predictions_deadline(p_league), true);
$$;

-- Rivals' entries stay hidden until the deadline: an order everyone can read
-- early is an order the last manager to save can copy. Enforced here rather
-- than in the client, so "hidden" means the rows are not sent at all.
alter table predictions enable row level security;

drop policy if exists predictions_read on predictions;
create policy predictions_read on predictions for select to authenticated
  using (
    is_league_member(league_id)
    and (member_id = my_member_id(league_id) or not predictions_open(league_id))
  );

-- Reads only. Writing an entry goes through the function below, which is what
-- stamps the member and enforces the deadline.
grant select on predictions to authenticated;

-- ------------------------------------------------------------------ saving ---
-- p_team_ids is the twenty club ids in predicted finishing order, first to
-- twentieth. Replaces the whole entry: a partial order is not a prediction.
create or replace function set_predictions(p_league uuid, p_team_ids int[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; n int; valid int;
begin
  me := assert_member(p_league);

  if not predictions_open(p_league) then
    raise exception 'The season has started — predictions are locked.';
  end if;

  n := coalesce(array_length(p_team_ids, 1), 0);
  select count(*) into valid from epl_table;

  if valid = 0 then
    raise exception 'Next season''s fixtures have not landed yet.';
  end if;
  if n <> valid then
    raise exception 'Put all % clubs in order — you sent %.', valid, n;
  end if;
  if (select count(distinct x) from unnest(p_team_ids) x) <> n then
    raise exception 'A club appears twice in that order.';
  end if;
  if exists (select 1 from unnest(p_team_ids) x
             where not exists (select 1 from epl_table e where e.team_id = x)) then
    raise exception 'That is not a club in this season''s Premier League.';
  end if;

  delete from predictions where member_id = me;

  insert into predictions (league_id, member_id, team_id, predicted_pos)
  select p_league, me, x.id, x.pos
  from unnest(p_team_ids) with ordinality as x(id, pos);
end $$;

grant execute on function set_predictions(uuid, int[]) to authenticated;

-- ----------------------------------------------------------------- scoring ---
--
--  Error is the sum of |predicted - actual| across all twenty clubs. Nothing
--  else is as simple to check by eye, which for a bet between friends matters
--  more than sophistication.
--
--  The bonus is what that error is worth, and the honest scale is not 0..200.
--  A random shuffle averages an error near 133, so paying out linearly from
--  200 would hand a third of the maximum to somebody who never opened the
--  screen. Chance is therefore worth nothing, a perfect table is worth
--  PREDICTION_BONUS_MAX, and the payout is linear between the two:
--
--      bonus = max(0, round(100 * (1 - error / 133)))
--
--  which puts a good human guess (error around 40) at about 70 points, and a
--  strong one (error around 20) at 85 — meaningful against a season's squad
--  total of a couple of thousand, but never the whole game.
create or replace function prediction_random_error()
returns numeric language sql immutable as $$
  -- Mean total |i - j| over a random permutation of n: n * (n^2 - 1) / (3n).
  select (20 * 20 - 1)::numeric / 3;
$$;

create or replace function prediction_bonus_max()
returns int language sql immutable as $$ select 100; $$;

create or replace function prediction_error(p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  select sum(abs(p.predicted_pos - e.position))::int
  from predictions p
  join epl_table e on e.team_id = p.team_id
  where p.member_id = p_member;
$$;

create or replace function prediction_bonus(p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    -- Nothing to score against until a match has actually been played.
    when not exists (select 1 from fixtures where finished) then 0
    when prediction_error(p_member) is null then 0
    else greatest(0, round(prediction_bonus_max()
           * (1 - prediction_error(p_member) / prediction_random_error())))::int
  end;
$$;

grant execute on function prediction_error(uuid)  to authenticated;
grant execute on function prediction_bonus(uuid)  to authenticated;
grant execute on function predictions_open(uuid)  to authenticated;
grant execute on function predictions_deadline(uuid) to authenticated;
grant execute on function prediction_bonus_max()  to authenticated;

-- ---------------------------------------------------------------- standings ---
-- The bonus is part of the league total, and the breakdown travels with it:
-- a manager who has just been overtaken by somebody's prediction is owed the
-- two numbers, not one.
drop view if exists league_standings;

create view league_standings as
select
  m.league_id,
  m.id                      as member_id,
  m.user_id,
  m.team_name,
  p.name                    as manager_name,
  coalesce(sum(s.points) filter (where s.gw >= l.scoring_start_gw), 0)::int as squad_points,
  prediction_bonus(m.id)                                                    as bonus_points,
  coalesce(sum(s.points) filter (where s.gw >= l.scoring_start_gw), 0)::int
    + prediction_bonus(m.id)                                                as total_points,
  coalesce(max(s.points) filter (where s.gw = (select id from gameweeks where is_current limit 1)
                                   and s.gw >= l.scoring_start_gw), 0)::int as gw_points
from league_members m
join leagues  l on l.id = m.league_id
join profiles p on p.id = m.user_id
left join member_gw_scores s on s.member_id = m.id
group by m.league_id, m.id, m.user_id, m.team_name, p.name;

do $$ begin
  execute 'alter view league_standings set (security_invoker = on)';
exception when others then
  raise notice 'security_invoker unavailable; standings view runs as definer';
end $$;

grant select on league_standings to authenticated;

-- ----------------------------------------------------------------- read API ---
-- Who has entered, and how they are doing. Callable before the deadline
-- precisely because it says nothing about *what* anyone predicted.
create or replace function league_predictions(p_league uuid)
returns table (
  member_id uuid, team_name text, manager_name text,
  submitted boolean, error int, bonus int, revealed boolean
)
language sql stable security definer set search_path = public as $$
  select
    m.id, m.team_name, pr.name,
    exists (select 1 from predictions p where p.member_id = m.id),
    prediction_error(m.id),
    prediction_bonus(m.id),
    not predictions_open(p_league)
  from league_members m
  join profiles pr on pr.id = m.user_id
  where m.league_id = p_league and is_league_member(p_league)
  order by prediction_bonus(m.id) desc, m.team_name;
$$;

grant execute on function league_predictions(uuid) to authenticated;

-- One manager's entry beside the real table. Refuses a rival's entry while the
-- deadline stands, for the same reason the row policy above does.
create or replace function member_prediction(p_member uuid)
returns table (
  team_id int, name text, short_name text, code int,
  predicted_pos int, actual_pos int, played int, points int, delta int
)
language plpgsql stable security definer set search_path = public as $$
declare l_id uuid;
begin
  select league_id into l_id from league_members where id = p_member;
  if l_id is null or not is_league_member(l_id) then
    raise exception 'That is not your league.';
  end if;
  if p_member <> my_member_id(l_id) and predictions_open(l_id) then
    raise exception 'Everyone’s picks are revealed when the season starts.';
  end if;

  return query
    select e.team_id, e.name, e.short_name, e.code,
           p.predicted_pos, e.position, e.played, e.points,
           p.predicted_pos - e.position
    from predictions p
    join epl_table e on e.team_id = p.team_id
    where p.member_id = p_member
    order by p.predicted_pos;
end $$;

grant execute on function member_prediction(uuid) to authenticated;

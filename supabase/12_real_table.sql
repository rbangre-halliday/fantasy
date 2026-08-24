-- ============================================================================
--  The real Premier League table, computed from matches that have been played.
--
--  epl_table counted only fixtures with finished = true. That is not FPL's flag
--  for "the match is over" — it is its flag for "bonus points are confirmed",
--  which lands up to a day later. So two days into gameweek 1, with nine
--  matches played and their scores already in our own fixtures table, the app's
--  Premier League table said all twenty clubs had played nothing and were level
--  on nil, and row_number broke that twenty-way tie alphabetically.
--
--  Everything downstream inherited it. prediction_error() measures a manager's
--  guess against that table, so the Predict screen was reporting each entry's
--  distance from the alphabet. The bonus itself was saved by its own guard —
--  "no finished fixtures, no bonus" — but that guard reads the same flag, so
--  the first confirmation would have started paying out against a table built
--  from the confirmed subset only: Saturday's results in, Sunday's not.
--
--  finished_provisional (added in 11_autosubs.sql) is the whistle. A result is
--  a result whether or not the bonus has settled, and the bonus is already in
--  the score line by then anyway.
--
--  Safe to re-run. Supersedes epl_table and prediction_bonus in
--  08_predictions.sql.
-- ============================================================================

create or replace view epl_table as
with played as (
  -- One row per club per completed match. "Completed" is full time, not
  -- bonus-confirmed; the score is on the row either way.
  select id, home_team, away_team, home_score, away_score
    from fixtures
   where (finished or finished_provisional)
     and home_score is not null and away_score is not null
),
results as (
  select home_team as team, home_score as gf, away_score as ga from played
  union all
  select away_team as team, away_score as gf, home_score as ga from played
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

-- Same guard, same flag as the table it guards: a bonus is only meaningful once
-- there is a real table to be wrong about.
create or replace function prediction_bonus(p_member uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    -- Nothing to score against until a match has actually been played.
    when not exists (select 1 from fixtures where finished or finished_provisional) then 0
    when prediction_error(p_member) is null then 0
    else greatest(0, round(prediction_bonus_max()
           * (1 - prediction_error(p_member) / prediction_random_error())))::int
  end;
$$;

grant execute on function prediction_bonus(uuid) to authenticated;

-- ============================================================================
--  Hold the prediction bonus out of the league table until the real table
--  means something.
--
--  12_real_table.sql made the Premier League table read from matches actually
--  played rather than from matches whose bonus points had settled, which was
--  right — and it immediately started paying a prediction bonus off a table one
--  match old. After a single round, "the table" is: won your game, drew it, or
--  lost it, sorted by goal difference. TzolisGoat69's entry scored 16 points
--  largely for having Hull 19th and Ipswich 20th, both of whom won once and sat
--  5th and 6th on the Saturday night. That is not a good prediction being
--  rewarded, and 16 points was enough to move them from fourth to second.
--
--  The bonus itself is still computed and still shown on the Predict screen —
--  what your entry is worth, live, is the whole point of that screen. It just
--  doesn't count towards the league table yet. Flip prediction_bonus_counts()
--  to true when the season has enough football in it to be worth predicting.
--
--  Safe to re-run. Supersedes league_standings in 08_predictions.sql.
-- ============================================================================

-- The switch, and the only thing to change when the bonus goes live. A function
-- rather than a setting because every reader of the standings has to agree, and
-- because the frontend already hides a zero bonus — turning this on needs no
-- deploy, and neither did turning it off.
create or replace function prediction_bonus_counts()
returns boolean language sql immutable as $$ select false; $$;

grant execute on function prediction_bonus_counts() to authenticated;

drop view if exists league_standings;

create view league_standings as
select
  m.league_id,
  m.id                      as member_id,
  m.user_id,
  m.team_name,
  p.name                    as manager_name,
  coalesce(sum(s.points) filter (where s.gw >= l.scoring_start_gw), 0)::int as squad_points,
  case when prediction_bonus_counts() then prediction_bonus(m.id) else 0 end as bonus_points,
  coalesce(sum(s.points) filter (where s.gw >= l.scoring_start_gw), 0)::int
    + case when prediction_bonus_counts() then prediction_bonus(m.id) else 0 end as total_points,
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

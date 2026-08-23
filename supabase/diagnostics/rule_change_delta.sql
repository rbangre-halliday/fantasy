-- ============================================================================
--  What the new substitution rule changes, before the sync job applies it.
--
--  Run this AFTER 11_auto_subs.sql and BEFORE the next sync (it runs every 20
--  minutes, so don't dawdle). member_gw_scores still holds the numbers the old
--  rule produced; member_gw_score() now answers with the new one. The
--  difference is exactly what the cron is about to write.
--
--  Read-only. If you miss the window, both sides will read the same and every
--  change column will be zero — no harm done, you just can't see the diff any
--  more.
--
--  Paste into the Supabase SQL editor and edit the marked line.
-- ============================================================================

with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as league  -- <<< EDIT
)
select
  pr.name                                        as manager,
  s.gw,
  s.points                                       as old_rule,
  member_gw_score(s.member_id, s.gw)             as new_rule,
  member_gw_score(s.member_id, s.gw) - s.points  as change
from params x
join league_members lm on lm.league_id = x.league
join profiles pr on pr.id = lm.user_id
join member_gw_scores s on s.member_id = lm.id
order by pr.name, s.gw;

-- And the season totals the table will show, before and after.
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as league  -- <<< EDIT
)
select
  pr.name                                                  as manager,
  sum(s.points)                                            as old_total,
  sum(member_gw_score(s.member_id, s.gw))                  as new_total,
  sum(member_gw_score(s.member_id, s.gw)) - sum(s.points)  as change
from params x
join league_members lm on lm.league_id = x.league
join profiles pr on pr.id = lm.user_id
join leagues l on l.id = lm.league_id
join member_gw_scores s on s.member_id = lm.id and s.gw >= l.scoring_start_gw
group by pr.name
order by new_total desc;

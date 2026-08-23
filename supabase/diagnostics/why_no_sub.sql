-- ============================================================================
--  Why didn't the bench cover him?
--
--  For one gameweek, every starter who didn't play, and what the substitution
--  rule had to work with. Read-only, and it depends on none of the scoring
--  functions — so it gives the same answer before and after 11_auto_subs.sql
--  is applied. Run it first to see what last week actually did, and again
--  afterwards to see what changed.
--
--  Paste it into the Supabase SQL editor and edit the two marked lines.
-- ============================================================================

-- Need the league id? Run this on its own first:
--     select id, name from leagues order by created_at desc;

with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as league,  -- <<< EDIT
         1 as gw                                                  -- <<< EDIT
),
blanks as (
  -- Every starter with no minutes. A man whose club still has a match to come
  -- in this gameweek is not a blank yet — he might still play — so the rule
  -- should be leaving him alone, and this says which of the two he is.
  select lm.id as member_id, pr.name as manager, lm.team_name,
         p.id as player_id, p.web_name, p.position::text as position,
         not exists (
           select 1 from fixtures f
           where f.gw = x.gw and not f.finished
             and (f.home_team = p.team_id or f.away_team = p.team_id)
         ) as settled
  from params x
  join league_members lm on lm.league_id = x.league
  join profiles pr on pr.id = lm.user_id
  join lineups ln on ln.member_id = lm.id and ln.gw = x.gw and ln.status = 'starter'
  join epl_players p on p.id = ln.player_id
  left join player_gw_points pts on pts.player_id = p.id and pts.gw = x.gw
  where coalesce(pts.minutes, 0) = 0
),
bench as (
  select ln.member_id, p.web_name, p.position::text as position,
         ln.bench_priority, coalesce(pts.minutes, 0) as minutes,
         coalesce(pts.points, 0) as points
  from params x
  join league_members lm on lm.league_id = x.league
  join lineups ln on ln.member_id = lm.id and ln.gw = x.gw and ln.status = 'substitute'
  join epl_players p on p.id = ln.player_id
  left join player_gw_points pts on pts.player_id = p.id and pts.gw = x.gw
)
select
  b.manager,
  b.web_name  as didnt_play,
  b.position,
  case when b.settled then 'blank' else 'still to play' end as state,
  -- What the OLD rule needed: a substitute in the same position who played.
  -- '— nobody —' on this line is the bug: that slot took a nil. Note a
  -- substitute can only come on once, so if two blanks in the same position
  -- name the same man here, only the first of them was covered.
  coalesce((select bb.web_name
              from bench bb
             where bb.member_id = b.member_id and bb.position = b.position
               and bb.minutes > 0
             order by bb.bench_priority
             limit 1), '— nobody —') as same_position_cover,
  -- What the NEW rule can reach: anyone on the bench who played, in order.
  -- Whether a given man is allowed on still depends on the formation he would
  -- leave behind, which this query doesn't model — but an empty list here
  -- means no cover was possible under any rule, and that one is just bad luck.
  coalesce((select string_agg(bb.web_name || ' (' || bb.position || ' '
                              || bb.points || 'pt)', ', '
                              order by bb.bench_priority)
              from bench bb
             where bb.member_id = b.member_id and bb.minutes > 0),
           '— nobody on the bench played —') as bench_who_played
from blanks b
order by b.manager, b.position, b.web_name;

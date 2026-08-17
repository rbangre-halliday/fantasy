-- ============================================================================
--  Adds the Premier League's own team code, which is what its image CDN keys
--  club badges on. It is not the same number as the FPL team id: Arsenal are
--  team 1 in FPL and badge t3 on the CDN.
--
--  Safe to run more than once. Run it, then `npm run sync` to populate.
-- ============================================================================

alter table epl_teams add column if not exists code int;

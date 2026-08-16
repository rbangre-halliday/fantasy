# The Draft

**Live: https://fantasy-draft-bay.vercel.app**

A private Fantasy Premier League game for two to six friends: a live snake draft,
one owner per real player, fixed 16-man squads, and official FPL points all season.

- **Frontend** — React + Vite, deployed on **Vercel**
- **Backend** — **Supabase** (Postgres, Auth, Realtime). No servers to run: every
  rule lives in the database as a `SECURITY DEFINER` function, and RLS blocks
  direct writes so the client can't cheat.
- **Data** — the official public **FPL API**, pulled by a **GitHub Actions cron**
  every 20 minutes. No key, no scraping, and it keeps the real FPL player ids.

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com) (free tier is plenty),
then open **SQL Editor** and run these four files **in order**:

| File | What it does |
|---|---|
| `supabase/01_schema.sql` | tables, indexes, the standings view |
| `supabase/02_rls.sql` | row-level security — read policies only, no write policies |
| `supabase/03_functions.sql` | the game itself: draft, locking, scoring, trades |
| `supabase/04_triggers_and_realtime.sql` | signup hook, realtime publication, grants |

Then under **Authentication → Providers**, keep **Email** enabled. If you'd rather
skip inbox round-trips with friends, turn **Confirm email** off.

Grab `Project URL`, `anon` key and `service_role` key from **Settings → API**.

### 2. Load the player data

The app needs the FPL player pool before a draft can start.

```bash
cp .env.example .env.local     # fill in all four values
npm install
npm run sync:full              # teams, players, fixtures, gameweeks, prev-season points
```

`sync:full` takes a couple of minutes the first time because previous-season
totals — the draft rankings — come from one request per player.

### 3. Automate the data

Push the repo to GitHub, then add three **repository secrets**
(*Settings → Secrets and variables → Actions*):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`.github/workflows/sync-fpl.yml` then runs every 20 minutes: live gameweek
points, kickoff times (which drive player locking), and a weekly full refresh
that picks up new signings and previous-season totals.

> The sync lives on GitHub Actions rather than Vercel Cron because the Hobby
> plan only runs cron once a day, which is too slow for live scoring.

### 4. Deploy to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new). Vercel detects Vite
automatically; `vercel.json` handles the SPA rewrite. Add two environment
variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Both are publishable — the anon key is designed to sit in the browser bundle, and
RLS plus the vetted RPCs are what actually enforce the rules.

Finally, in Supabase under **Authentication → URL Configuration**, set the Site
URL to your Vercel domain so invite and confirmation links resolve.

Local development is `npm run dev`.

---

## How the rules are enforced

Everything the spec calls "server-authoritative" is a database function. The
client calls RPCs; it cannot write to a table directly.

| Rule | Where it lives |
|---|---|
| One owner per player, per league | `unique (league_id, player_id)` on `roster_players` — two racing signings can't both win |
| Draft turn order | `snake_member()` computes the owner of pick *N* from the randomised `draft_position` |
| The pick clock | `drafts.pick_deadline`, compared against `now()` **on the server**. Clients call `draft_tick()` when their own clock runs out; the server re-checks before auto-picking, so an early or duplicated call is a no-op |
| Auto-pick | `best_available()` — highest previous-season points that still fits the squad |
| Roster validity | The positional caps (2/5/5/4) sum to exactly 16, so "never exceed a cap" is enough on its own to guarantee a completable squad |
| Player locking | `is_player_locked()` — locked from that player's *own* kickoff until the gameweek finishes |
| Auto-substitutions | `member_gw_score()` walks the bench in priority order, same position only, formation unchanged |
| Scoring | `player_gw_points` straight from FPL; only gameweeks `>= scoring_start_gw` count |

Two consequences worth knowing, both falling out of the fixed 16-man squad:

- **A free-agent signing must be like-for-like.** Sign a midfielder, drop a
  midfielder. Any other swap would leave an illegal squad.
- **Trades must be position-balanced.** `Saka + Isak` for `Salah + Watkins`
  works (MID+FWD both ways); `Saka` for `Saliba` does not.

## Design

*Broadsheet Pitch* — a football weekly set in ink on newsprint. Instrument Serif
for headlines, IBM Plex Sans for reading, IBM Plex Mono so every column of
figures lines up. Vermilion is reserved: it only ever means live or irreversible.

Desktop gets a tab strip under the masthead and two-column draft board; phones
get a thumb-reachable bottom bar, bottom sheets instead of dialogs, and 16px
inputs so iOS doesn't zoom. Lineups are edited by tapping two players to swap
them, which means the XI can never enter an invalid state.

## Repo map

```
supabase/          schema, RLS, game logic, triggers   ← the actual backend
scripts/sync-fpl.mjs   official FPL API → Supabase
.github/workflows/ the 20-minute data cron
src/routes/        one file per screen
src/lib/           supabase client, typed API, formatting, auth + toasts
src/styles/        the whole design system, one file
```

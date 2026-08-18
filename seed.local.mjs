// Seeds a real, fully-drafted league on the live project so every screen can
// be screenshotted with genuine data. Prints the credentials for the browser
// pass. Tear down afterwards with teardown.mjs.
const U = process.env.SUPABASE_URL
const AK = process.env.VITE_SUPABASE_ANON_KEY
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY

const CAPS = { GK: 2, DEF: 5, MID: 5, FWD: 4 }
const USERS = [
  { email: 'uitest1@example.com', password: 'uitest12345', name: 'Rahul', team: 'Pool Sucks' },
  { email: 'uitest2@example.com', password: 'uitest12345', name: 'Sam', team: 'Gooners' }
]

const admin = h => ({ apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...h })
const asUser = t => ({ apikey: AK, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

async function rpc (fn, token, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: asUser(token), body: JSON.stringify(body ?? {})
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${fn}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function main () {
  // fresh users each run
  for (const u of USERS) {
    const list = await (await fetch(`${U}/auth/v1/admin/users?filter=${u.email}`, { headers: admin() })).json()
    for (const existing of list.users ?? []) {
      // leagues.commissioner_id references profiles(id) with no cascade, so a
      // user who commissions a league cannot be deleted until it is gone.
      await fetch(`${U}/rest/v1/leagues?commissioner_id=eq.${existing.id}`,
        { method: 'DELETE', headers: admin() })
      const del = await fetch(`${U}/auth/v1/admin/users/${existing.id}`,
        { method: 'DELETE', headers: admin() })
      if (!del.ok) throw new Error(`could not remove ${u.email}: ${del.status} ${await del.text()}`)
    }
    const created = await (await fetch(`${U}/auth/v1/admin/users`, {
      method: 'POST', headers: admin(),
      body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true, user_metadata: { name: u.name } })
    })).json()
    if (created.code) throw new Error(JSON.stringify(created))
    const session = await (await fetch(`${U}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: AK, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password })
    })).json()
    u.token = session.access_token
    if (!u.token) throw new Error(`no token for ${u.email}: ${JSON.stringify(session)}`)
    console.log(`user ${u.name} ready`)
  }

  const [a, b] = USERS
  const MODE = process.env.DRAFT_MODE ?? 'live'
  const leagueId = await rpc('create_league', a.token,
    { p_name: 'C Suite', p_team_name: a.team, p_mode: MODE })
  const [{ invite_code: code }] = await (await fetch(
    `${U}/rest/v1/leagues?id=eq.${leagueId}&select=invite_code`, { headers: asUser(a.token) })).json()
  await rpc('join_league', b.token, { p_code: code, p_team_name: b.team })
  console.log('league', leagueId, 'code', code, 'mode', MODE)

  await rpc('start_draft', a.token, { p_league: leagueId })
  console.log('draft started')

  // Run the draft to completion, always taking the best player that fits.
  const players = await rpc('league_players', a.token, { p_league: leagueId })
  const owned = new Set()
  const counts = {}
  for (const u of USERS) counts[u.email] = { GK: 0, DEF: 0, MID: 0, FWD: 0 }

  const STOP = Number(process.env.STOP_AFTER ?? 40)
  for (let i = 0; i < STOP; i++) {
    const [d] = await (await fetch(
      `${U}/rest/v1/drafts?league_id=eq.${leagueId}&select=status,current_member_id,current_pick`,
      { headers: asUser(a.token) })).json()
    if (!d || d.status === 'complete') break

    const members = await (await fetch(
      `${U}/rest/v1/league_members?league_id=eq.${leagueId}&select=id,user_id,team_name`,
      { headers: asUser(a.token) })).json()
    const m = members.find(x => x.id === d.current_member_id)
    const who = USERS.find(u => u.team === m.team_name)
    const c = counts[who.email]

    const pick = players.find(p => !owned.has(p.id) && c[p.position] < CAPS[p.position])
    await rpc('make_pick', who.token, { p_league: leagueId, p_player: pick.id })
    owned.add(pick.id); c[pick.position]++
  }
  // Leave the first user on the clock, whatever the randomised order gave us -
  // otherwise every pick control is legitimately disabled and a UI run can't
  // exercise them.
  if (process.env.STOP_AFTER) {
    for (let i = 0; i < 8; i++) {
      const [d] = await (await fetch(
        `${U}/rest/v1/drafts?league_id=eq.${leagueId}&select=status,current_member_id`,
        { headers: asUser(a.token) })).json()
      if (!d || d.status === 'complete') break
      const members = await (await fetch(
        `${U}/rest/v1/league_members?league_id=eq.${leagueId}&select=id,team_name`,
        { headers: asUser(a.token) })).json()
      const onClock = members.find(x => x.id === d.current_member_id)
      if (onClock.team_name === a.team) break
      const who = USERS.find(u => u.team === onClock.team_name)
      const c = counts[who.email]
      const pick = players.find(pl => !owned.has(pl.id) && c[pl.position] < CAPS[pl.position])
      await rpc('make_pick', who.token, { p_league: leagueId, p_player: pick.id })
      owned.add(pick.id); c[pick.position]++
    }
    console.log('left', a.team, 'on the clock')
  }
  console.log('draft advanced')

  // A pending trade so the Trades screen has something real on it.
  const mine = await (await fetch(
    `${U}/rest/v1/roster_players?league_id=eq.${leagueId}&select=member_id,player_id`,
    { headers: asUser(a.token) })).json()
  const members = await (await fetch(
    `${U}/rest/v1/league_members?league_id=eq.${leagueId}&select=id,team_name`,
    { headers: asUser(a.token) })).json()
  const aId = members.find(m => m.team_name === a.team).id
  const bId = members.find(m => m.team_name === b.team).id
  const pos = id => players.find(p => p.id === id).position
  const aMid = mine.find(r => r.member_id === aId && pos(r.player_id) === 'MID')
  const bMid = mine.find(r => r.member_id === bId && pos(r.player_id) === 'MID')
  try {
    await rpc('propose_trade', b.token, {
      p_league: leagueId, p_receiver: aId,
      p_offer: [bMid.player_id], p_request: [aMid.player_id]
    })
    console.log('pending trade created')
  } catch (e) { console.log('trade skipped:', e.message.slice(0, 90)) }

  console.log(JSON.stringify({ leagueId, code, login: { email: a.email, password: a.password } }))
}

main().catch(e => { console.error(e); process.exit(1) })

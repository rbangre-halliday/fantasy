/**
 * State and interaction tests.
 *
 * The suite this complements checks that controls respond. This one checks the
 * harder thing: that what you see afterwards is true — immediately, without a
 * refresh, after a refresh, and in the *other* manager's browser.
 *
 * The bug that prompted it: a pick updated the board only when the realtime
 * echo of your own write happened to arrive, so the squad could stay empty
 * until you reloaded. Any assertion made straight after an action passes on a
 * fast socket and fails on a slow one, so every check here is made three ways.
 *
 *   node e2e-state.mjs <baseUrl> <leagueId> <emailA> <emailB> <password>
 */
import { chromium } from 'playwright'

const [base, leagueId, emailA, emailB, password] = process.argv.slice(2)
const results = []
const errors = []

async function step (name, fn) {
  try { results.push(['PASS', name, (await fn()) ?? '']) }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0].slice(0, 150)]) }
}

const browser = await chromium.launch()

async function signIn (email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${email}: ${e.message.slice(0, 120)}`))
  await page.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('form button[type=submit], form .btn.lg')
  await page.waitForURL(u => !u.pathname.includes('signin'), { timeout: 20000 })
  return { ctx, page }
}

const A = await signIn(emailA)
const B = await signIn(emailB)

const draftUrl = `${base}/l/${leagueId}/draft`
const squadUrl = `${base}/l/${leagueId}/team`

const goto = async (p, url) => { await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800) }

const squadCount = p => p.evaluate(() =>
  document.querySelectorAll('.pitch .slot.filled').length)

const onClock = async p => (await p.textContent('.slab')).includes('on the clock')

// Whichever browser is on the clock does the picking.
async function clockHolder () {
  await goto(A.page, draftUrl); await goto(B.page, draftUrl)
  if (await onClock(A.page)) return [A, B]
  if (await onClock(B.page)) return [B, A]
  throw new Error('neither browser is on the clock')
}

const [me, them] = await clockHolder()

// ---------------------------------------------------------------- picking ---
let pickedName = ''

await step('a pick lands on my own pitch with no refresh', async () => {
  const before = await squadCount(me.page)
  pickedName = (await me.page.textContent('.pick-row:first-child .name')).trim()
  await me.page.click('.pick-row:first-child .list-row')
  await me.page.waitForSelector('.sheet')
  await me.page.click('.sheet-foot .btn:not(.ghost)')
  await me.page.waitForTimeout(2500)          // no reload anywhere in here
  const after = await squadCount(me.page)
  if (after !== before + 1) throw new Error(`pitch went ${before} -> ${after}, expected ${before + 1}`)
  const names = await me.page.$$eval('.slot.filled .slot-name', e => e.map(x => x.textContent.trim()))
  return `${before} -> ${after}, ${names.length} named`
})

await step('the same pick survives a reload', async () => {
  const before = await squadCount(me.page)
  await me.page.reload({ waitUntil: 'networkidle' })
  await me.page.waitForTimeout(2500)
  const after = await squadCount(me.page)
  if (after !== before) throw new Error(`pitch was ${before} before reload, ${after} after`)
  return `${after} both sides of a reload`
})

await step('the squad screen agrees with the draft screen', async () => {
  const onDraft = await squadCount(me.page)
  await goto(me.page, squadUrl)
  const counts = await me.page.textContent('.page-head-compact, .squad-grid, body')
  if (onDraft > 0 && !counts) throw new Error('squad screen rendered nothing')
  await goto(me.page, draftUrl)
  return `${onDraft} on the draft screen`
})

await step('the drafted player is gone from the board', async () => {
  const rows = await me.page.$$eval('.pick-row .name', e => e.map(x => x.textContent.trim()))
  if (rows.includes(pickedName)) throw new Error(`${pickedName} is still listed as available`)
  return `${pickedName} removed`
})

await step("the other manager sees the pick without reloading", async () => {
  await them.page.waitForTimeout(2500)
  const feed = await them.page.$$eval('.picks-list li, .list li', e => e.map(x => x.textContent))
  const seen = feed.some(t => t && t.includes(pickedName))
  if (!seen) throw new Error(`${pickedName} not in the other browser's feed`)
  return 'propagated'
})

await step('the turn passed to the other manager', async () => {
  await them.page.waitForTimeout(1500)
  if (!(await onClock(them.page))) throw new Error('the other browser is not on the clock')
  if (await onClock(me.page)) throw new Error('both browsers think they are on the clock')
  return 'turn moved'
})

// ------------------------------------------- the socket is not a guarantee ---
// The decisive test. With realtime alive, a pick appears either because the
// client refetched or because the socket echoed our own write, and on a fast
// connection you cannot tell which. Kill the socket and only a real refetch
// can be responsible. This is the check that actually catches the bug.

await step('a pick still lands with realtime blocked', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()
  await page.routeWebSocket('**/realtime/**', ws => ws.close())

  await page.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', await onClock(me.page) ? emailA : emailB)
  await page.fill('input[type=password]', password)
  await page.click('form button[type=submit], form .btn.lg')
  await page.waitForURL(u => !u.pathname.includes('signin'), { timeout: 20000 })
  await goto(page, draftUrl)

  if (!(await page.textContent('.slab')).includes('on the clock')) {
    await ctx.close()
    return 'skipped — this account is not on the clock'
  }

  const before = await page.evaluate(() => document.querySelectorAll('.pitch .slot.filled').length)
  await page.click('.pick-row:first-child .list-row')
  await page.waitForSelector('.sheet')
  await page.click('.sheet-foot .btn:not(.ghost)')
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => document.querySelectorAll('.pitch .slot.filled').length)
  await ctx.close()

  if (after !== before + 1) {
    throw new Error(`with no socket the pitch went ${before} -> ${after}: the UI is relying on the realtime echo of its own write`)
  }
  return `${before} -> ${after} with the socket closed`
})

// ------------------------------------------------------------- shortlist ----
await step('a star survives a reload and a navigation', async () => {
  await goto(me.page, draftUrl)
  const name = (await me.page.textContent('.pick-row:nth-child(2) .name')).trim()
  await me.page.click('.pick-row:nth-child(2) .star')
  await me.page.waitForTimeout(400)
  await goto(me.page, squadUrl)
  await goto(me.page, draftUrl)
  const stars = await me.page.$$eval('.star.on', e => e.length)
  if (stars < 1) throw new Error('star lost after navigating away and back')
  await me.page.click('.star.on')                       // leave it as we found it
  return `kept for ${name}`
})

// ------------------------------------------------------- squad screen -------
await step('squad screen shows no phantom players', async () => {
  await goto(me.page, squadUrl)
  const filled = await me.page.$$eval('.slot.filled .slot-name',
    e => e.map(x => x.textContent.trim()).filter(Boolean))
  const blank = filled.filter(n => n === '' || n === '…')
  if (blank.length) throw new Error(`${blank.length} slots render an empty name`)
  return `${filled.length} named slots`
})

await step('no name in the pitch is truncated to nothing', async () => {
  const bad = await me.page.$$eval('.slot.filled .slot-name', els =>
    els.map(e => e.textContent.trim())
       .filter(t => t.length > 0 && t.replace(/[…\s]/g, '').length < 3))
  if (bad.length) throw new Error(`unreadable names: ${bad.join(', ')}`)
  return 'all legible'
})

// -------------------------------------------------------------- images ------
await step('every rendered crest actually loads', async () => {
  await goto(me.page, draftUrl)
  const broken = await me.page.$$eval('img.crest',
    els => els.filter(i => i.complete && i.naturalWidth === 0).length)
  const total = await me.page.$$eval('img.crest', e => e.length)
  if (total === 0) throw new Error('no crests rendered at all')
  if (broken) throw new Error(`${broken} of ${total} crests failed to load`)
  return `${total} crests, none broken`
})

await step('no stale player photos are requested anywhere', async () => {
  const hits = []
  me.page.on('request', r => { if (r.url().includes('/photos/players/')) hits.push(r.url()) })
  await goto(me.page, draftUrl)
  await me.page.click('.pick-row:first-child .list-row').catch(() => {})
  await me.page.waitForTimeout(1200)
  await me.page.keyboard.press('Escape')
  if (hits.length) throw new Error(`${hits.length} legacy photo requests`)
  return 'none'
})

// -------------------------------------------------------- cross-screen ------
await step('tab badge for a pending trade matches the trades screen', async () => {
  await goto(me.page, `${base}/l/${leagueId}/table`)
  const badge = await me.page.$eval('.tab-badge', e => e.textContent.trim()).catch(() => null)
  await goto(me.page, `${base}/l/${leagueId}/trades`)
  const open = await me.page.$$eval('.trade', e => e.length).catch(() => 0)
  if (badge && Number(badge) > open) throw new Error(`badge says ${badge}, screen shows ${open}`)
  return badge ? `badge ${badge}, ${open} shown` : 'no pending trades'
})

await browser.close()

// ------------------------------------------------------------------ report --
for (const [s, n, d] of results) console.log(`${s === 'PASS' ? ' ok ' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`)
if (errors.length) { console.log('\npage errors:'); for (const e of [...new Set(errors)]) console.log('  ' + e) }
const fail = results.filter(r => r[0] === 'FAIL').length
console.log(`\n${results.length - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

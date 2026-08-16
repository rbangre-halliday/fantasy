/**
 * Interaction test: drives every control in the app against a real database
 * and asserts what actually happened, rather than screenshotting and hoping.
 *
 *   node e2e.mjs <baseUrl> <email> <password> <leagueId>
 *
 * Seeded state expected: a two-manager league mid-draft, with this user on the
 * clock. Run scripts/seed for that.
 */
import { chromium } from 'playwright'

const [base, email, password, leagueId] = process.argv.slice(2)
const results = []
let consoleErrors = []

const ok = (name, detail = '') => results.push(['PASS', name, detail])
const bad = (name, detail = '') => results.push(['FAIL', name, detail])

async function step (name, fn) {
  try {
    const detail = await fn()
    ok(name, detail ?? '')
  } catch (e) {
    bad(name, e.message.split('\n')[0].slice(0, 140))
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + e.message.slice(0, 160)))

// --------------------------------------------------------------- sign in ---
await step('sign in', async () => {
  await page.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('form button[type=submit], form .btn.lg')
  await page.waitForURL(u => !u.pathname.includes('signin'), { timeout: 15000 })
  return page.url()
})

await step('my leagues lists each league once', async () => {
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const codes = await page.$$eval('.card .num', els => els.map(e => e.textContent.trim()))
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dupes.length) throw new Error(`duplicate leagues: ${dupes}`)
  return `${codes.length} league(s)`
})

// ----------------------------------------------------------------- draft ---
const draftUrl = `${base}/l/${leagueId}/draft`

await step('draft room loads with a running clock', async () => {
  await page.goto(draftUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const t1 = await page.textContent('.slab .num')
  await page.waitForTimeout(1600)
  const t2 = await page.textContent('.slab .num')
  if (t1 === t2) throw new Error(`clock not ticking (${t1})`)
  return `${t1} -> ${t2}`
})

await step('no element overlaps the clock', async () => {
  const r = await page.evaluate(() => {
    const slab = document.querySelector('.slab')
    const grid = slab.parentElement.querySelector('.mt-32')
    const s = slab.getBoundingClientRect(), g = grid.getBoundingClientRect()
    return { slabBottom: Math.round(s.bottom), gridTop: Math.round(g.top) }
  })
  if (r.gridTop < r.slabBottom) throw new Error(`grid starts ${r.slabBottom - r.gridTop}px inside the clock`)
  return `clock ends ${r.slabBottom}, grid starts ${r.gridTop}`
})

await step('search filters the board', async () => {
  const before = await page.$$eval('.pick-row', e => e.length)
  await page.fill('input[type=search]', 'salah')
  await page.waitForTimeout(500)
  const after = await page.$$eval('.pick-row', e => e.length)
  if (after >= before) throw new Error(`search did not narrow (${before} -> ${after})`)
  await page.fill('input[type=search]', '')
  await page.waitForTimeout(400)
  return `${before} -> ${after}`
})

await step('position filter narrows to that position', async () => {
  await page.click('.seg button:has-text("GK")')
  await page.waitForTimeout(500)
  const positions = await page.$$eval('.pick-row .pos', e => [...new Set(e.map(x => x.textContent.trim()))])
  if (positions.length !== 1 || positions[0] !== 'GK') throw new Error(`saw ${positions}`)
  await page.click('.seg button:has-text("All")')
  await page.waitForTimeout(400)
  return 'GK only'
})

await step('shortlist star toggles and persists a reload', async () => {
  const name = await page.textContent('.pick-row:first-child .name')
  await page.click('.pick-row:first-child .star')
  await page.waitForTimeout(300)
  const on = await page.$$eval('.star.on', e => e.length)
  if (on !== 1) throw new Error(`expected 1 starred, got ${on}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const stillOn = await page.$$eval('.star.on', e => e.length)
  if (stillOn !== 1) throw new Error(`lost the star on reload (${stillOn})`)
  return `starred ${name.trim()}`
})

await step('shortlist filter shows only starred', async () => {
  await page.click('.seg button:has-text("★")')
  await page.waitForTimeout(500)
  const rows = await page.$$eval('.pick-row', e => e.length)
  if (rows !== 1) throw new Error(`expected 1 row, got ${rows}`)
  await page.click('.seg button:has-text("All")')
  await page.waitForTimeout(400)
  return '1 row'
})

await step('starring again removes it', async () => {
  await page.click('.star.on')
  await page.waitForTimeout(300)
  const on = await page.$$eval('.star.on', e => e.length)
  if (on !== 0) throw new Error(`still ${on} starred`)
  return 'cleared'
})

// ------------------------------------------------------------- the modal ---
await step('clicking a player opens the confirm sheet, on screen', async () => {
  await page.click('.pick-row .list-row')
  await page.waitForSelector('.sheet', { timeout: 4000 })
  const r = await page.evaluate(() => {
    const s = document.querySelector('.sheet').getBoundingClientRect()
    const sc = document.querySelector('.scrim').getBoundingClientRect()
    return {
      sheet: [Math.round(s.top), Math.round(s.left), Math.round(s.width), Math.round(s.height)],
      scrim: [Math.round(sc.width), Math.round(sc.height)],
      vw: innerWidth, vh: innerHeight
    }
  })
  if (r.scrim[0] !== r.vw || r.scrim[1] !== r.vh) throw new Error(`scrim ${r.scrim} != viewport ${r.vw}x${r.vh}`)
  const [top, left, w, h] = r.sheet
  if (top < 0 || left < 0 || top + h > r.vh + 1 || left + w > r.vw + 1)
    throw new Error(`sheet off screen: top=${top} left=${left} ${w}x${h} in ${r.vw}x${r.vh}`)
  return `sheet ${w}x${h} at ${left},${top}`
})

await step('sheet closes on Escape', async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  if (await page.$('.sheet')) throw new Error('sheet still open')
  return 'closed'
})

await step('sheet closes on backdrop click', async () => {
  await page.click('.pick-row .list-row')
  await page.waitForSelector('.sheet')
  await page.mouse.click(20, 20)
  await page.waitForTimeout(400)
  if (await page.$('.sheet')) throw new Error('sheet still open')
  return 'closed'
})

// --------------------------------------------------------- making a pick ---
await step('confirming a pick drafts the player', async () => {
  const name = (await page.textContent('.pick-row:first-child .name')).trim()
  const before = await page.textContent('.slab .eyebrow')
  await page.click('.pick-row:first-child .list-row')
  await page.waitForSelector('.sheet')
  await page.click('.sheet-foot .btn:not(.ghost)')
  await page.waitForTimeout(2500)
  if (await page.$('.sheet')) throw new Error('sheet stayed open after drafting')
  const after = await page.textContent('.slab .eyebrow')
  if (before === after) throw new Error(`pick number did not advance (${before})`)
  const onPitch = await page.$$eval('.slot.filled .slot-name', e => e.map(x => x.textContent.trim()))
  if (!onPitch.includes(name)) throw new Error(`${name} not on the pitch: ${onPitch.join(', ')}`)
  return `${before} -> ${after}, ${name} on pitch`
})

await step('drafted player leaves the available board', async () => {
  const rows = await page.$$eval('.pick-row .name', e => e.map(x => x.textContent.trim()))
  const pitch = await page.$$eval('.slot.filled .slot-name', e => e.map(x => x.textContent.trim()))
  const leak = rows.filter(r => pitch.includes(r))
  if (leak.length) throw new Error(`owned players still listed: ${leak.join(', ')}`)
  return `${rows.length} available`
})

// ---------------------------------------------------------- other screens --
for (const [name, path, expect] of [
  ['squad', `/l/${leagueId}/team`, '.squad-grid, .empty, .notice'],
  ['table', `/l/${leagueId}/table`, '.thead, .empty'],
  ['commissioner', `/l/${leagueId}/commissioner`, '.input']
]) {
  await step(`${name} screen renders`, async () => {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await page.waitForSelector(expect, { timeout: 8000 })
    return 'ok'
  })
}

await step('tab navigation works', async () => {
  await page.goto(draftUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.click('.tabs-desktop a:has-text("Squad")')
  await page.waitForTimeout(1500)
  if (!page.url().includes('/team')) throw new Error(`went to ${page.url()}`)
  const active = await page.textContent('.tabs-desktop a.active')
  if (!active.includes('Squad')) throw new Error(`active tab is ${active}`)
  return 'Squad active'
})

await step('no horizontal overflow at 390px', async () => {
  const m = await ctx.newPage()
  await m.setViewportSize({ width: 390, height: 844 })
  const bad = []
  for (const path of ['/', `/l/${leagueId}/draft`, `/l/${leagueId}/team`, `/l/${leagueId}/table`]) {
    await m.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await m.waitForTimeout(1800)
    const over = await m.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) bad.push(`${path} +${over}px`)
  }
  await m.close()
  if (bad.length) throw new Error(bad.join(', '))
  return 'none'
})

await browser.close()

// ------------------------------------------------------------------ report -
const pass = results.filter(r => r[0] === 'PASS').length
const fail = results.filter(r => r[0] === 'FAIL').length
for (const [status, name, detail] of results) {
  console.log(`${status === 'PASS' ? ' ok ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const realErrors = consoleErrors.filter(e => !/favicon|net::ERR_|Download the React/i.test(e))
if (realErrors.length) {
  console.log('\nconsole errors:')
  for (const e of [...new Set(realErrors)]) console.log('  ' + e)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// Signs in and screenshots every screen at desktop and phone widths.
//   node shots.mjs <baseUrl> <email> <password> <leagueId> <outDir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [base, email, password, leagueId, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })

const VIEWPORTS = [
  { tag: 'desktop', viewport: { width: 1440, height: 1000 } },
  { tag: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
]

const SCREENS = [
  ['draft',   `/l/${leagueId}/draft`,       true],
  ['leagues', '/',                          true]
]

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const { tag, ...opts } = vp
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark' })
  const page = await ctx.newPage()

  // sign in once per context
  await page.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${out}/${tag}-landing.png`, fullPage: true })

  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('form button[type=submit], form .btn.lg')
  await page.waitForURL(u => !u.pathname.includes('signin'), { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)

  for (const [name, path, needsAuth] of SCREENS) {
    if (!needsAuth) continue
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true })
    console.log(`${tag}/${name}`)
  }

  // scrolled draft view, to check the clock against the list
  await page.goto(`${base}/l/${leagueId}/draft`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${tag}-draft-scrolled.png` })

  await ctx.close()
}

await browser.close()
console.log('done')

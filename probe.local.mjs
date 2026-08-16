import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage()
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERROR:', m.text().slice(0,200)) })
p.on('pageerror', e => console.log('PAGE ERROR:', e.message.slice(0,200)))
await p.goto('http://localhost:4173/signin', {waitUntil:'networkidle'})
await p.fill('input[type=email]','uitest1@example.com'); await p.fill('input[type=password]','uitest12345')
await p.click('form button[type=submit], form .btn.lg')
await p.waitForTimeout(2000)
await p.goto('http://localhost:4173/l/aacecd25-2206-4c9a-8754-920e11d7194f/draft',{waitUntil:'networkidle'})
await p.waitForTimeout(2500)

await p.click('.pick-row .list-row')      // open the confirm sheet
await p.waitForTimeout(900)

const r = await p.evaluate(() => {
  const scrim = document.querySelector('.scrim')
  const sheet = document.querySelector('.sheet')
  if (!scrim) return { scrim: null }
  const sr = scrim.getBoundingClientRect(), hr = sheet?.getBoundingClientRect()
  // walk up looking for anything that makes a containing block for fixed
  const offenders = []
  let n = scrim.parentElement
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n)
    if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
        cs.willChange.includes('transform') || cs.contain.includes('paint') ||
        cs.backdropFilter !== 'none')
      offenders.push({ el: n.className || n.tagName, transform: cs.transform, filter: cs.filter,
                       backdrop: cs.backdropFilter, willChange: cs.willChange, animation: cs.animationName })
    n = n.parentElement
  }
  return {
    viewport: [innerWidth, innerHeight],
    scrim: [Math.round(sr.top), Math.round(sr.left), Math.round(sr.width), Math.round(sr.height)],
    sheet: hr ? [Math.round(hr.top), Math.round(hr.left), Math.round(hr.width), Math.round(hr.height)] : null,
    sheetOpacity: sheet ? getComputedStyle(sheet).opacity : null,
    offenders
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()

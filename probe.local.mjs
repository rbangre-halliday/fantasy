import { chromium } from 'playwright'
const LID='2dc048e1-695c-4d6c-9b85-2ed43103ef45'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage()
await p.goto('http://localhost:4173/signin',{waitUntil:'networkidle'})
await p.fill('input[type=email]','uitest1@example.com'); await p.fill('input[type=password]','uitest12345')
await p.click('form button[type=submit], form .btn.lg'); await p.waitForTimeout(2000)
await p.goto(`http://localhost:4173/l/${LID}/draft`,{waitUntil:'networkidle'}); await p.waitForTimeout(2500)

const r = await p.evaluate(() => {
  const q = s => document.querySelector(s)
  const box = e => e ? [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().bottom)] : null
  const slab = q('.slab')
  const row  = q('.pick-row .list-row')
  const rb = row?.getBoundingClientRect()
  // what is actually on top at the row's centre?
  let hit = null, chain = []
  if (rb) {
    const x = rb.left + rb.width/2, y = rb.top + rb.height/2
    const el = document.elementFromPoint(x, y)
    hit = el ? (el.className || el.tagName) : null
    let n = el
    while (n && chain.length < 5) { chain.push(n.className || n.tagName); n = n.parentElement }
  }
  const cs = slab ? getComputedStyle(slab) : null
  return {
    headH: getComputedStyle(document.documentElement).getPropertyValue('--head-h').trim(),
    slabBox: box(slab),
    slabPosition: cs?.position, slabTop: cs?.top, slabZ: cs?.zIndex,
    slabClass: slab?.className,
    clockText: q('.slab .figure')?.textContent?.trim() ?? q('.slab .num')?.textContent?.trim() ?? null,
    rowBox: rb ? [Math.round(rb.top), Math.round(rb.bottom)] : null,
    hitAtRowCentre: hit,
    chain,
    rowsCount: document.querySelectorAll('.pick-row').length
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
